(() => {
  (function() {
    const WATCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
    const WATCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
    const WATCH_CANCEL_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_CANCEL";
    const WATCH_SETTLE_MS = 9e3;
    const DIRECT_FETCH_STATUS = "trading,sold_out";
    const DIRECT_FETCH_FALLBACK_STATUS = null;
    const DIRECT_FETCH_MAX_PAGES_PER_STATUS = 50;
    const DIRECT_FETCH_MAX_TOTAL_PAGES = 50;
    const DIRECT_FETCH_TIMEOUT_MS = 15e3;
    const DIRECT_FETCH_MIN_START_INTERVAL_MS = 5e3;
    const DIRECT_FETCH_PAGE_LIMIT = 100;
    const DIRECT_FETCH_MIN_FULL_PAGE_COUNT = 100;
    const DIRECT_FETCH_SNAPSHOT_WAIT_MS = 400;
    const DIRECT_FETCH_SNAPSHOT_POLL_MS = 100;
    const DIRECT_FETCH_THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1e3;
    const DIRECT_FETCH_OLD_PAGE_STOP_COUNT = 2;
    const DIRECT_FETCH_MIN_DATED_ITEMS_FOR_PERIOD_STOP = 20;
    const PAGE_HOOK_ALWAYS_LOG_STEPS = /* @__PURE__ */ new Set([
      "hook_installed",
      "direct_fetch_started",
      "direct_fetch_completed",
      "direct_fetch_stop_by_period",
      "direct_fetch_failed",
      "direct_fetch_error",
      "direct_fetch_unhandled_error",
      "watch_cancelled"
    ]);
    const pageWindow = window;
    const watches = /* @__PURE__ */ new Map();
    const cachedPayloadsBySellerId = /* @__PURE__ */ new Map();
    const latestGetItemsUrlsBySellerId = /* @__PURE__ */ new Map();
    const latestGetItemsRequestSnapshotsBySellerId = /* @__PURE__ */ new Map();
    const directFetchRequestIds = /* @__PURE__ */ new Set();
    let activeDirectFetchRequestId = null;
    let lastDirectFetchStartedAt = 0;
    const originalFetch = window.fetch.bind(window);
    const OriginalXhr = window.XMLHttpRequest;
    const originalXhrOpen = OriginalXhr.prototype.open;
    const originalXhrSetRequestHeader = OriginalXhr.prototype.setRequestHeader;
    const originalXhrSend = OriginalXhr.prototype.send;
    if (pageWindow.__furimaneResearchPageApiHookInstalled) {
      return;
    }
    pageWindow.__furimaneResearchPageApiHookInstalled = true;
    function isDebugLogEnabled() {
      try {
        return window.localStorage.getItem("furimane-research-page-hook-debug") === "true";
      } catch (_error) {
        return false;
      }
    }
    function log(step, payload) {
      if (!isDebugLogEnabled() && !PAGE_HOOK_ALWAYS_LOG_STEPS.has(step)) {
        return;
      }
      console.log(`[furimane-research][page-hook] ${step}`, payload ?? {});
    }
    function postToContent(requestId, body) {
      window.postMessage({
        type: WATCH_RESPONSE_TYPE,
        requestId,
        ...body
      }, window.location.origin);
    }
    function isObject(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    function getStringValue(...candidates) {
      for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          return String(candidate);
        }
        if (typeof candidate !== "string") {
          continue;
        }
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
      return null;
    }
    function getRequestUrl(input) {
      if (typeof input === "string") {
        return input;
      }
      if (input instanceof URL) {
        return input.toString();
      }
      if (input instanceof Request) {
        return input.url;
      }
      return null;
    }
    function addHeadersToSnapshot(target, headers) {
      if (!headers) {
        return;
      }
      try {
        new Headers(headers).forEach((value, key) => {
          target[key] = value;
        });
      } catch (_error) {
      }
    }
    function getFetchRequestSnapshot(input, init) {
      const headers = {};
      if (input instanceof Request) {
        addHeadersToSnapshot(headers, input.headers);
      }
      addHeadersToSnapshot(headers, init?.headers);
      return {
        headers,
        credentials: init?.credentials ?? (input instanceof Request ? input.credentials : null)
      };
    }
    function parseGetItemsUrl(rawUrl) {
      if (!rawUrl) {
        return null;
      }
      try {
        const url = new URL(rawUrl, window.location.origin);
        if (!url.href.includes("/items/get_items")) {
          return null;
        }
        return url;
      } catch (_error) {
        return null;
      }
    }
    function getCurrentProfileSellerId() {
      return window.location.pathname.match(/\/user\/profile\/([^/?#]+)/)?.[1] ?? null;
    }
    function normalizeSellerId(value) {
      return typeof value === "string" ? value.trim() : null;
    }
    function getPayloadData(payload) {
      if (!isObject(payload) || !Array.isArray(payload.data)) {
        return [];
      }
      return payload.data.filter(isObject);
    }
    function getNestedPayloadItem(item) {
      if (!item) {
        return null;
      }
      for (const key of ["item", "itemData", "item_data", "itemDetail", "item_detail", "listing", "product"]) {
        const value = item[key];
        if (isObject(value)) {
          return value;
        }
      }
      return null;
    }
    function getPayloadItemSource(item) {
      const nestedItem = getNestedPayloadItem(item);
      return item && nestedItem ? { ...item, ...nestedItem } : item;
    }
    function getTimestampMs(value) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value > 1e11 ? value : value * 1e3;
      }
      if (typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (/^\d+$/.test(trimmed)) {
        const numericValue = Number(trimmed);
        return Number.isFinite(numericValue) ? numericValue > 1e11 ? numericValue : numericValue * 1e3 : null;
      }
      const parsedValue = Date.parse(trimmed);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    }
    function getItemPeriodTimestampMs(item) {
      const source = getPayloadItemSource(item) ?? item;
      const candidates = [
        source.sold_at,
        source.soldAt,
        source.purchased_at,
        source.purchasedAt,
        source.created,
        source.created_at,
        source.createdAt,
        source.updated,
        source.updated_at,
        source.updatedAt
      ];
      for (const candidate of candidates) {
        const timestampMs = getTimestampMs(candidate);
        if (timestampMs !== null && Number.isFinite(timestampMs)) {
          return timestampMs;
        }
      }
      return null;
    }
    function getDirectFetchPeriodState(items) {
      const cutoff = Date.now() - DIRECT_FETCH_THREE_MONTHS_MS;
      let newerCount = 0;
      let olderCount = 0;
      let missingDateCount = 0;
      for (const item of items) {
        const timestampMs = getItemPeriodTimestampMs(item);
        if (timestampMs === null) {
          missingDateCount += 1;
          continue;
        }
        if (timestampMs < cutoff) {
          olderCount += 1;
        } else {
          newerCount += 1;
        }
      }
      const datedCount = newerCount + olderCount;
      const minDatedCount = Math.min(DIRECT_FETCH_MIN_DATED_ITEMS_FOR_PERIOD_STOP, items.length);
      return {
        newerCount,
        olderCount,
        missingDateCount,
        datedCount,
        oldOnlyPage: items.length > 0 && datedCount >= minDatedCount && newerCount === 0 && olderCount > 0
      };
    }
    function attachRequestStatusToPayload(payload, requestStatus) {
      if (!requestStatus || !isObject(payload) || !Array.isArray(payload.data)) {
        return payload;
      }
      return {
        ...payload,
        data: payload.data.map((item) => isObject(item) ? { ...item, __furimane_request_status: requestStatus } : item)
      };
    }
    function getPayloadItemId(item) {
      const source = getPayloadItemSource(item);
      return getStringValue(source?.id, source?.item_id, source?.itemId);
    }
    function getPayloadMeta(payload) {
      return isObject(payload) && isObject(payload.meta) ? payload.meta : null;
    }
    function normalizeHasNextValue(value) {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "number") {
        return value === 1;
      }
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
          return true;
        }
        if (normalized === "false" || normalized === "0") {
          return false;
        }
      }
      return null;
    }
    function getPayloadHasNext(payload) {
      if (!isObject(payload)) {
        return null;
      }
      const topLevelValue = normalizeHasNextValue(payload.has_next ?? payload.hasNext);
      if (topLevelValue !== null) {
        return topLevelValue;
      }
      const meta = getPayloadMeta(payload);
      if (!meta) {
        return null;
      }
      return normalizeHasNextValue(meta.has_next ?? meta.hasNext);
    }
    function getPayloadPagerId(payload) {
      if (!isObject(payload)) {
        return null;
      }
      return getStringValue(
        payload.next_pager_id,
        payload.nextPagerId,
        payload.pager_id,
        payload.pagerId,
        payload.next_page_token,
        payload.nextPageToken
      );
    }
    function getMetaPagerId(payload) {
      const meta = getPayloadMeta(payload);
      if (!meta) {
        return null;
      }
      return getStringValue(
        meta.next_pager_id,
        meta.nextPagerId,
        meta.pager_id,
        meta.pagerId,
        meta.next_page_token,
        meta.nextPageToken
      );
    }
    function getListingPagerId(item) {
      return getStringValue(item?.pager_id, item?.pagerId);
    }
    function getLastListingPagerId(items) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const pagerId = getListingPagerId(items[index]);
        if (pagerId) {
          return pagerId;
        }
      }
      return null;
    }
    function getNextPagerId(payload, items) {
      return getMetaPagerId(payload) || getPayloadPagerId(payload) || getLastListingPagerId(items);
    }
    function getPagerIdLocation(payload, items) {
      if (getMetaPagerId(payload)) {
        return "meta";
      }
      if (getPayloadPagerId(payload)) {
        return "top_level";
      }
      if (getLastListingPagerId(items)) {
        return "listing";
      }
      return "none";
    }
    function buildPagerDiagnostic(payload, items) {
      const meta = getPayloadMeta(payload);
      const firstItem = items[0] ?? null;
      const lastItem = items[items.length - 1] ?? null;
      return {
        dataLength: items.length,
        topLevelKeys: isObject(payload) ? Object.keys(payload) : [],
        metaKeys: meta ? Object.keys(meta) : [],
        firstItemKeys: isObject(firstItem) ? Object.keys(firstItem) : [],
        lastItemKeys: isObject(lastItem) ? Object.keys(lastItem) : [],
        firstItemHasPagerId: Boolean(getListingPagerId(firstItem)),
        lastItemHasPagerId: Boolean(getListingPagerId(lastItem)),
        pagerIdLocation: getPagerIdLocation(payload, items)
      };
    }
    function mergePayloadIntoWatch(existingPayload, incomingPayload) {
      const incomingItems = getPayloadData(incomingPayload);
      const normalizedIncomingPayload = isObject(incomingPayload) ? incomingPayload : { data: incomingItems };
      if (!isObject(existingPayload) || !Array.isArray(existingPayload.data)) {
        return {
          payload: normalizedIncomingPayload,
          mergedCount: incomingItems.length,
          dedupedCount: 0,
          totalCount: incomingItems.length
        };
      }
      const mergedData = [];
      const seenItemIds = /* @__PURE__ */ new Set();
      let mergedCount = 0;
      let dedupedCount = 0;
      for (const item of getPayloadData(existingPayload)) {
        const itemId = getPayloadItemId(item);
        if (itemId && seenItemIds.has(itemId)) {
          continue;
        }
        if (itemId) {
          seenItemIds.add(itemId);
        }
        mergedData.push(item);
      }
      for (const item of incomingItems) {
        const itemId = getPayloadItemId(item);
        if (itemId && seenItemIds.has(itemId)) {
          dedupedCount += 1;
          continue;
        }
        if (itemId) {
          seenItemIds.add(itemId);
        }
        mergedData.push(item);
        mergedCount += 1;
      }
      return {
        payload: {
          ...existingPayload,
          ...normalizedIncomingPayload,
          data: mergedData
        },
        mergedCount,
        dedupedCount,
        totalCount: mergedData.length
      };
    }
    function clearWatchSettleTimeout(watch) {
      if (!watch || watch.settleTimeoutId == null) {
        return;
      }
      window.clearTimeout(watch.settleTimeoutId);
      watch.settleTimeoutId = null;
    }
    function deleteOtherWatchesForSeller(sellerId, keepRequestId) {
      for (const [requestId, watch] of watches.entries()) {
        if (requestId === keepRequestId || normalizeSellerId(watch.sellerId) !== normalizeSellerId(sellerId)) {
          continue;
        }
        clearWatchSettleTimeout(watch);
        watches.delete(requestId);
      }
    }
    function isCurrentWatch(requestId, watch) {
      return watches.get(requestId) === watch;
    }
    function flushWatch(requestId) {
      const watch = watches.get(requestId);
      if (!watch) {
        return;
      }
      clearWatchSettleTimeout(watch);
      if (!watch.payload) {
        watches.delete(requestId);
        return;
      }
      postWatchPayload(requestId, watch, false);
      watches.delete(requestId);
    }
    function postWatchPayload(requestId, watch, partial) {
      postToContent(requestId, {
        ok: true,
        status: 200,
        partial,
        sellerId: watch.sellerId,
        pageLikeIndex: watch.pageLikeIndex,
        mergedCount: watch.lastMergedCount,
        dedupedCount: watch.lastDedupedCount,
        totalCount: watch.lastTotalCount,
        payload: watch.payload
      });
    }
    function postWatchProgress(requestId, watch) {
      postToContent(requestId, {
        ok: true,
        status: 200,
        partial: true,
        sellerId: watch.sellerId,
        pageLikeIndex: watch.pageLikeIndex,
        mergedCount: watch.lastMergedCount,
        dedupedCount: watch.lastDedupedCount,
        totalCount: watch.lastTotalCount
      });
    }
    function cacheSellerPayload(sellerId, payload) {
      const existing = cachedPayloadsBySellerId.get(sellerId);
      const mergeResult = mergePayloadIntoWatch(existing?.payload ?? null, payload);
      cachedPayloadsBySellerId.set(sellerId, {
        sellerId,
        payload: mergeResult.payload,
        pageLikeIndex: (existing?.pageLikeIndex ?? 0) + 1,
        lastMergedCount: mergeResult.mergedCount,
        lastDedupedCount: mergeResult.dedupedCount,
        lastTotalCount: mergeResult.totalCount
      });
    }
    function cacheWatchPayload(watch) {
      if (!watch.payload) {
        return;
      }
      cachedPayloadsBySellerId.set(watch.sellerId, {
        sellerId: watch.sellerId,
        payload: watch.payload,
        pageLikeIndex: watch.pageLikeIndex,
        lastMergedCount: watch.lastMergedCount,
        lastDedupedCount: watch.lastDedupedCount,
        lastTotalCount: watch.lastTotalCount
      });
    }
    function replayCachedPayload(requestId, watch) {
      const cached = cachedPayloadsBySellerId.get(watch.sellerId);
      if (!cached?.payload) {
        return;
      }
      watch.payload = cached.payload;
      watch.pageLikeIndex = cached.pageLikeIndex;
      watch.lastMergedCount = cached.lastMergedCount;
      watch.lastDedupedCount = cached.lastDedupedCount;
      watch.lastTotalCount = cached.lastTotalCount;
      log("cached_payload_replayed", {
        sellerId: watch.sellerId,
        totalCount: watch.lastTotalCount
      });
      postWatchPayload(requestId, watch, true);
      scheduleWatchFlush(requestId);
    }
    function scheduleWatchFlush(requestId) {
      const watch = watches.get(requestId);
      if (!watch) {
        return;
      }
      clearWatchSettleTimeout(watch);
      watch.settleTimeoutId = window.setTimeout(() => {
        flushWatch(requestId);
      }, WATCH_SETTLE_MS);
    }
    function buildDirectFetchUrl(sellerId, status, maxPagerId) {
      const cachedUrl = latestGetItemsUrlsBySellerId.get(sellerId);
      const url = cachedUrl ? new URL(cachedUrl.toString()) : new URL("https://api.mercari.jp/items/get_items");
      url.searchParams.set("seller_id", sellerId);
      url.searchParams.set("limit", String(DIRECT_FETCH_PAGE_LIMIT));
      if (status) {
        url.searchParams.set("status", status);
      } else {
        url.searchParams.delete("status");
      }
      if (maxPagerId) {
        url.searchParams.set("max_pager_id", maxPagerId);
      } else {
        url.searchParams.delete("max_pager_id");
      }
      return url;
    }
    function buildDirectFetchHeaders(sellerId) {
      const snapshot = latestGetItemsRequestSnapshotsBySellerId.get(sellerId);
      const headers = new Headers();
      if (snapshot) {
        for (const [key, value] of Object.entries(snapshot.headers)) {
          try {
            headers.set(key, value);
          } catch (_error) {
          }
        }
      }
      if (!headers.has("accept")) {
        headers.set("accept", "application/json");
      }
      if (!headers.has("x-platform")) {
        headers.set("x-platform", "web");
      }
      return headers;
    }
    function getDirectFetchCredentials(sellerId) {
      return latestGetItemsRequestSnapshotsBySellerId.get(sellerId)?.credentials ?? "include";
    }
    function sleep(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
    async function waitForDirectFetchSnapshot(sellerId) {
      const startedAt = Date.now();
      while (!latestGetItemsRequestSnapshotsBySellerId.has(sellerId) && Date.now() - startedAt < DIRECT_FETCH_SNAPSHOT_WAIT_MS) {
        await sleep(DIRECT_FETCH_SNAPSHOT_POLL_MS);
      }
    }
    async function fetchDirectSellerItems(requestId, watch) {
      if (directFetchRequestIds.has(requestId)) {
        return;
      }
      if (activeDirectFetchRequestId || Date.now() - lastDirectFetchStartedAt < DIRECT_FETCH_MIN_START_INTERVAL_MS) {
        watches.delete(requestId);
        postToContent(requestId, {
          ok: false,
          sellerId: watch.sellerId,
          error: "direct_fetch_rate_limited"
        });
        return;
      }
      directFetchRequestIds.add(requestId);
      activeDirectFetchRequestId = requestId;
      lastDirectFetchStartedAt = Date.now();
      try {
        await waitForDirectFetchSnapshot(watch.sellerId);
        if (!isCurrentWatch(requestId, watch)) {
          return;
        }
        log("direct_fetch_started", {
          sellerId: watch.sellerId,
          status: DIRECT_FETCH_STATUS,
          fallbackStatus: DIRECT_FETCH_FALLBACK_STATUS,
          limit: DIRECT_FETCH_PAGE_LIMIT,
          hasRequestSnapshot: latestGetItemsRequestSnapshotsBySellerId.has(watch.sellerId)
        });
        let totalFetched = 0;
        let totalRequestedPages = 0;
        const fetchPages = async (status) => {
          let fetchedCount = 0;
          let maxPagerId = null;
          let oldOnlyPageCount = 0;
          let pageCount = 0;
          let stopReason = "pager_completed";
          const seenPagerIds = /* @__PURE__ */ new Set();
          for (let pageIndex = 0; pageIndex < DIRECT_FETCH_MAX_PAGES_PER_STATUS; pageIndex += 1) {
            if (!isCurrentWatch(requestId, watch)) {
              break;
            }
            if (totalRequestedPages >= DIRECT_FETCH_MAX_TOTAL_PAGES) {
              stopReason = "total_page_limit";
              break;
            }
            const url = buildDirectFetchUrl(watch.sellerId, status, maxPagerId);
            totalRequestedPages += 1;
            const response = await originalFetch(url.toString(), {
              method: "GET",
              headers: buildDirectFetchHeaders(watch.sellerId),
              credentials: getDirectFetchCredentials(watch.sellerId),
              signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS)
            });
            if (!response.ok) {
              log("direct_fetch_failed", {
                sellerId: watch.sellerId,
                status,
                httpStatus: response.status
              });
              return { fetchedCount, failed: true, pageCount, stopReason: "http_failed" };
            }
            let payload;
            try {
              payload = attachRequestStatusToPayload(await response.json(), status);
            } catch (error) {
              log("direct_fetch_failed", {
                sellerId: watch.sellerId,
                status,
                jsonError: error instanceof Error ? error.message : String(error)
              });
              return { fetchedCount, failed: true, pageCount, stopReason: "json_failed" };
            }
            if (!isCurrentWatch(requestId, watch)) {
              break;
            }
            const items = getPayloadData(payload);
            const hasNext = getPayloadHasNext(payload);
            const nextPagerId = getNextPagerId(payload, items);
            const pagerIdLocation = getPagerIdLocation(payload, items);
            const isLikelyFullPage = items.length >= DIRECT_FETCH_MIN_FULL_PAGE_COUNT;
            const shouldContinue = Boolean(nextPagerId) && (hasNext === true || isLikelyFullPage && hasNext !== false);
            const periodState = getDirectFetchPeriodState(items);
            log("direct_fetch_page_received", {
              sellerId: watch.sellerId,
              status,
              pageIndex: pageIndex + 1,
              itemCount: items.length,
              hasNext,
              hasNextPagerId: Boolean(nextPagerId),
              pagerIdLocation,
              isLikelyFullPage,
              periodState,
              continueByFullPage: hasNext !== true && shouldContinue
            });
            if (items.length === 0) {
              stopReason = "empty_page";
              break;
            }
            pageCount += 1;
            await handleMatchedPayload(url, payload, { notify: false, targetRequestId: requestId, cache: false });
            totalFetched += items.length;
            fetchedCount += items.length;
            if (!isCurrentWatch(requestId, watch)) {
              break;
            }
            postWatchProgress(requestId, watch);
            oldOnlyPageCount = periodState.oldOnlyPage ? oldOnlyPageCount + 1 : 0;
            if (oldOnlyPageCount >= DIRECT_FETCH_OLD_PAGE_STOP_COUNT) {
              stopReason = "period_old_pages";
              log("direct_fetch_stop_by_period", {
                sellerId: watch.sellerId,
                status,
                pageIndex: pageIndex + 1,
                oldOnlyPageCount,
                ...periodState
              });
              break;
            }
            if (!shouldContinue || !nextPagerId || seenPagerIds.has(nextPagerId)) {
              stopReason = seenPagerIds.has(nextPagerId) ? "duplicate_pager" : "pager_completed";
              break;
            }
            seenPagerIds.add(nextPagerId);
            maxPagerId = nextPagerId;
          }
          return { fetchedCount, failed: false, pageCount, stopReason };
        };
        const primaryResult = await fetchPages(DIRECT_FETCH_STATUS);
        let finalStopReason = primaryResult.stopReason;
        if (!isCurrentWatch(requestId, watch)) {
          return;
        }
        if (primaryResult.failed || primaryResult.fetchedCount === 0) {
          const fallbackResult = await fetchPages(DIRECT_FETCH_FALLBACK_STATUS);
          finalStopReason = fallbackResult.stopReason;
        }
        cacheWatchPayload(watch);
        log("direct_fetch_completed", {
          sellerId: watch.sellerId,
          totalFetched,
          pageCount: totalRequestedPages,
          stopReason: finalStopReason
        });
        if (!isCurrentWatch(requestId, watch)) {
          return;
        }
        if (!watch.payload) {
          watches.delete(requestId);
          postToContent(requestId, {
            ok: false,
            sellerId: watch.sellerId,
            error: "direct_fetch_empty"
          });
          return;
        }
        flushWatch(requestId);
      } catch (error) {
        log("direct_fetch_error", {
          sellerId: watch.sellerId,
          message: error instanceof Error ? error.message : String(error)
        });
        if (!isCurrentWatch(requestId, watch)) {
          return;
        }
        if (!watch.payload) {
          watches.delete(requestId);
          postToContent(requestId, {
            ok: false,
            sellerId: watch.sellerId,
            error: "direct_fetch_error"
          });
        } else {
          flushWatch(requestId);
        }
      } finally {
        directFetchRequestIds.delete(requestId);
        if (activeDirectFetchRequestId === requestId) {
          activeDirectFetchRequestId = null;
        }
      }
    }
    async function handleMatchedPayload(url, payload, options = {}) {
      const detectedSellerIdRaw = url.searchParams.get("seller_id");
      const currentProfileSellerIdRaw = getCurrentProfileSellerId();
      const sellerId = normalizeSellerId(detectedSellerIdRaw);
      const currentProfileSellerId = normalizeSellerId(currentProfileSellerIdRaw);
      const hasMaxPagerId = url.searchParams.has("max_pager_id");
      log("get_items_detected", {
        hasSellerId: Boolean(sellerId)
      });
      log("detected_seller_id_raw", {
        value: detectedSellerIdRaw
      });
      log("current_profile_seller_id_raw", {
        value: currentProfileSellerIdRaw
      });
      log("seller_id_compare_types", {
        detectedType: typeof detectedSellerIdRaw,
        currentProfileType: typeof currentProfileSellerIdRaw,
        activeWatchTypes: Array.from(watches.values()).map((watch) => typeof watch.sellerId)
      });
      if (!sellerId) {
        log("matched_seller_id_skipped_reason", {
          reason: "no_detected_seller_id"
        });
        return;
      }
      if (options.targetRequestId && !watches.has(options.targetRequestId)) {
        log("matched_seller_id_skipped_reason", {
          reason: "stale_direct_fetch_request"
        });
        return;
      }
      latestGetItemsUrlsBySellerId.set(sellerId, url);
      if (options.requestSnapshot) {
        latestGetItemsRequestSnapshotsBySellerId.set(sellerId, options.requestSnapshot);
      }
      const requestStatus = url.searchParams.get("status");
      const payloadWithRequestStatus = attachRequestStatusToPayload(payload, requestStatus);
      if (options.cache !== false) {
        cacheSellerPayload(sellerId, payloadWithRequestStatus);
      }
      const matchingWatches = Array.from(watches.entries()).filter(([requestId, watch]) => normalizeSellerId(watch.sellerId) === sellerId && (!options.targetRequestId || requestId === options.targetRequestId));
      log("seller_id_compare_result", {
        currentProfileMatches: Boolean(currentProfileSellerId && sellerId === currentProfileSellerId),
        activeWatchCount: watches.size,
        matchingWatchCount: matchingWatches.length
      });
      if (matchingWatches.length === 0) {
        const reason = watches.size === 0 ? "no_active_watch" : currentProfileSellerId && sellerId !== currentProfileSellerId ? "detected_seller_differs_from_profile" : "watch_seller_mismatch";
        log("matched_seller_id_skipped_reason", {
          reason,
          activeWatchCount: watches.size
        });
        return;
      }
      const items = getPayloadData(payloadWithRequestStatus);
      log("pager_diagnostic", buildPagerDiagnostic(payloadWithRequestStatus, items));
      for (const [requestId, watch] of matchingWatches) {
        if (watch.directFetch && options.notify !== false) {
          continue;
        }
        const mergeResult = mergePayloadIntoWatch(watch.payload, payloadWithRequestStatus);
        const beforePageLikeIndex = watch.pageLikeIndex;
        watch.payload = mergeResult.payload;
        log("page_like_index_before_increment", {
          pageLikeIndex: beforePageLikeIndex
        });
        watch.pageLikeIndex = beforePageLikeIndex + 1;
        watch.lastMergedCount = mergeResult.mergedCount;
        watch.lastDedupedCount = mergeResult.dedupedCount;
        watch.lastTotalCount = mergeResult.totalCount;
        log("matched_seller_id", {
          sellerId
        });
        log("page_like_index", {
          pageLikeIndex: watch.pageLikeIndex
        });
        log("page_like_index_after_increment", {
          pageLikeIndex: watch.pageLikeIndex
        });
        log("hasMaxPagerId", {
          hasMaxPagerId
        });
        log("mergedCount", {
          mergedCount: mergeResult.mergedCount
        });
        log("dedupedCount", {
          dedupedCount: mergeResult.dedupedCount
        });
        log("totalCount", {
          totalCount: mergeResult.totalCount
        });
        if (options.notify !== false) {
          postWatchPayload(requestId, watch, true);
          scheduleWatchFlush(requestId);
        }
      }
    }
    function inspectFetchResponse(rawUrl, response, requestSnapshot) {
      const url = parseGetItemsUrl(rawUrl);
      if (!url) {
        return;
      }
      response.clone().json().then((payload) => {
        handleMatchedPayload(url, payload, { requestSnapshot }).catch(() => {
        });
      }).catch(() => {
      });
    }
    function installFetchHook() {
      window.fetch = async function furimaneResearchFetchHook(input, init) {
        const rawUrl = getRequestUrl(input);
        const requestSnapshot = getFetchRequestSnapshot(input, init);
        const response = await originalFetch(input, init);
        inspectFetchResponse(rawUrl, response, requestSnapshot);
        return response;
      };
    }
    function installXhrHook() {
      OriginalXhr.prototype.open = function furimaneResearchXhrOpen(method, url) {
        const xhr = this;
        xhr.__furimaneResearchUrl = typeof url === "string" ? url : url?.toString?.() ?? null;
        xhr.__furimaneResearchMethod = method;
        xhr.__furimaneResearchHeaders = {};
        return originalXhrOpen.apply(this, arguments);
      };
      OriginalXhr.prototype.setRequestHeader = function furimaneResearchXhrSetRequestHeader(name, value) {
        const xhr = this;
        xhr.__furimaneResearchHeaders = xhr.__furimaneResearchHeaders ?? {};
        xhr.__furimaneResearchHeaders[name] = value;
        return originalXhrSetRequestHeader.apply(this, arguments);
      };
      OriginalXhr.prototype.send = function furimaneResearchXhrSend() {
        this.addEventListener("load", () => {
          const xhr = this;
          const url = parseGetItemsUrl(xhr.__furimaneResearchUrl ?? null);
          if (!url) {
            return;
          }
          try {
            const payload = JSON.parse(this.responseText);
            handleMatchedPayload(url, payload, {
              requestSnapshot: {
                headers: xhr.__furimaneResearchHeaders ?? {},
                credentials: "include"
              }
            }).catch(() => {
            });
          } catch (_error) {
          }
        });
        return originalXhrSend.apply(this, arguments);
      };
    }
    installFetchHook();
    installXhrHook();
    log("hook_installed");
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (data?.type === WATCH_CANCEL_TYPE && typeof data.requestId === "string") {
        const existingWatch2 = watches.get(data.requestId);
        clearWatchSettleTimeout(existingWatch2);
        watches.delete(data.requestId);
        directFetchRequestIds.delete(data.requestId);
        log("watch_cancelled", {
          requestId: data.requestId,
          reason: data.reason ?? null
        });
        return;
      }
      if (!data || data.type !== WATCH_REQUEST_TYPE || typeof data.requestId !== "string" || typeof data.sellerId !== "string") {
        return;
      }
      if (normalizeSellerId(data.sellerId) !== normalizeSellerId(getCurrentProfileSellerId())) {
        postToContent(data.requestId, { ok: false, error: "seller_context_mismatch" });
        return;
      }
      const existingWatch = watches.get(data.requestId);
      clearWatchSettleTimeout(existingWatch);
      deleteOtherWatchesForSeller(data.sellerId, data.requestId);
      const watch = {
        sellerId: data.sellerId,
        directFetch: data.directFetch !== false,
        payload: null,
        pageLikeIndex: 0,
        lastMergedCount: 0,
        lastDedupedCount: 0,
        lastTotalCount: 0,
        settleTimeoutId: null
      };
      watches.set(data.requestId, watch);
      if (data.directFetch === false) {
        replayCachedPayload(data.requestId, watch);
      } else {
        fetchDirectSellerItems(data.requestId, watch).catch((error) => {
          log("direct_fetch_unhandled_error", {
            sellerId: watch.sellerId,
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });
  })();
})();
