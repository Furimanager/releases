(function () {
  const WATCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
  const WATCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
  const WATCH_CANCEL_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_CANCEL";
  const INSTALLED_KEY = "__furimaneResearchPageApiHookInstalled";
  const WATCH_SETTLE_MS = 9000;
  const DIRECT_FETCH_STATUS = "trading,sold_out";
  const DIRECT_FETCH_FALLBACK_STATUS = null;
  const DIRECT_FETCH_MAX_PAGES_PER_STATUS = 500;
  const DIRECT_FETCH_PAGE_LIMIT = 132;
  const DIRECT_FETCH_MIN_FULL_PAGE_COUNT = 100;
  const DIRECT_FETCH_SNAPSHOT_WAIT_MS = 400;
  const DIRECT_FETCH_SNAPSHOT_POLL_MS = 100;
  const PAGE_HOOK_ALWAYS_LOG_STEPS = new Set([
    "hook_installed",
    "direct_fetch_started",
    "direct_fetch_completed",
    "direct_fetch_missing_snapshot",
    "direct_fetch_failed",
    "direct_fetch_error",
    "direct_fetch_unhandled_error",
    "watch_cancelled"
  ]);
  const watches = new Map();
  const cachedPayloadsBySellerId = new Map();
  const latestGetItemsUrlsBySellerId = new Map();
  const latestGetItemsRequestSnapshotsBySellerId = new Map();
  const directFetchRequestIds = new Set();

  const originalFetch = window.fetch.bind(window);
  const OriginalXhr = window.XMLHttpRequest;
  const originalXhrOpen = OriginalXhr.prototype.open;
  const originalXhrSetRequestHeader = OriginalXhr.prototype.setRequestHeader;
  const originalXhrSend = OriginalXhr.prototype.send;

  if (window[INSTALLED_KEY]) {
    return;
  }

  window[INSTALLED_KEY] = true;

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

  function getStringValue() {
    for (const candidate of arguments) {
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
      // Some page-provided header shapes are not cloneable. Ignore and keep the direct fetch path alive.
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

  function attachRequestStatusToPayload(payload, requestStatus) {
    if (!requestStatus || !isObject(payload) || !Array.isArray(payload.data)) {
      return payload;
    }

    return {
      ...payload,
      data: payload.data.map((item) => (
        isObject(item)
          ? { ...item, __furimane_request_status: requestStatus }
          : item
      ))
    };
  }

  function getPayloadItemId(item) {
    return getStringValue(item?.id, item?.item_id, item?.itemId);
  }

  function getPayloadMeta(payload) {
    return isObject(payload?.meta) ? payload.meta : null;
  }

  function normalizeFurimaneHasNextValue(value) {
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

    const topLevelValue = normalizeFurimaneHasNextValue(payload.has_next ?? payload.hasNext);

    if (topLevelValue !== null) {
      return topLevelValue;
    }

    const meta = getPayloadMeta(payload);

    if (!meta) {
      return null;
    }

    return normalizeFurimaneHasNextValue(meta.has_next ?? meta.hasNext);
  }

  function getPayloadPagerId(payload) {
    return getStringValue(
      payload?.next_pager_id,
      payload?.nextPagerId,
      payload?.pager_id,
      payload?.pagerId,
      payload?.next_page_token,
      payload?.nextPageToken
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
    const normalizedIncomingPayload = isObject(incomingPayload)
      ? incomingPayload
      : { data: incomingItems };

    if (!isObject(existingPayload) || !Array.isArray(existingPayload.data)) {
      return {
        payload: normalizedIncomingPayload,
        mergedCount: incomingItems.length,
        dedupedCount: 0,
        totalCount: incomingItems.length
      };
    }

    const mergedData = [];
    const seenItemIds = new Set();
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
    if (watch?.settleTimeoutId == null) {
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
    const url = cachedUrl
      ? new URL(cachedUrl.toString())
      : new URL("https://api.mercari.jp/items/get_items");

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
          // Skip headers that the browser does not allow content scripts/page scripts to set.
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

    directFetchRequestIds.add(requestId);

    try {
      await waitForDirectFetchSnapshot(watch.sellerId);

      if (!isCurrentWatch(requestId, watch)) {
        return;
      }

      if (!latestGetItemsRequestSnapshotsBySellerId.has(watch.sellerId)) {
        log("direct_fetch_missing_snapshot", {
          sellerId: watch.sellerId
        });
        watches.delete(requestId);
        postToContent(requestId, {
          ok: false,
          sellerId: watch.sellerId,
          error: "direct_fetch_missing_snapshot"
        });
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

      const fetchPages = async (status) => {
        let fetchedCount = 0;
        let maxPagerId = null;
        const seenPagerIds = new Set();

        for (let pageIndex = 0; pageIndex < DIRECT_FETCH_MAX_PAGES_PER_STATUS; pageIndex += 1) {
          if (!isCurrentWatch(requestId, watch)) {
            break;
          }

          const url = buildDirectFetchUrl(watch.sellerId, status, maxPagerId);
          const response = await originalFetch(url.toString(), {
            method: "GET",
            headers: buildDirectFetchHeaders(watch.sellerId),
            credentials: getDirectFetchCredentials(watch.sellerId)
          });

          if (!response.ok) {
            log("direct_fetch_failed", {
              sellerId: watch.sellerId,
              status,
              httpStatus: response.status
            });
            return { fetchedCount, failed: true };
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
            return { fetchedCount, failed: true };
          }

          if (!isCurrentWatch(requestId, watch)) {
            break;
          }

          const items = getPayloadData(payload);
          const hasNext = getPayloadHasNext(payload);
          const nextPagerId = getNextPagerId(payload, items);
          const pagerIdLocation = getPagerIdLocation(payload, items);
          const isLikelyFullPage = items.length >= DIRECT_FETCH_MIN_FULL_PAGE_COUNT;
          const shouldContinue = Boolean(nextPagerId) && (hasNext === true || (isLikelyFullPage && hasNext !== false));

          log("direct_fetch_page_received", {
            sellerId: watch.sellerId,
            status,
            pageIndex: pageIndex + 1,
            itemCount: items.length,
            hasNext,
            hasNextPagerId: Boolean(nextPagerId),
            pagerIdLocation,
            isLikelyFullPage,
            continueByFullPage: hasNext !== true && shouldContinue
          });

          if (items.length === 0) {
            break;
          }

          await handleMatchedPayload(url, payload, { notify: false, targetRequestId: requestId, cache: false });
          totalFetched += items.length;
          fetchedCount += items.length;

          if (!isCurrentWatch(requestId, watch)) {
            break;
          }

          postWatchProgress(requestId, watch);

          if (!shouldContinue || !nextPagerId || seenPagerIds.has(nextPagerId)) {
            break;
          }

          seenPagerIds.add(nextPagerId);
          maxPagerId = nextPagerId;
        }

        return { fetchedCount, failed: false };
      };

      const primaryResult = await fetchPages(DIRECT_FETCH_STATUS);

      if (!isCurrentWatch(requestId, watch)) {
        return;
      }

      if (primaryResult.failed || primaryResult.fetchedCount === 0) {
        await fetchPages(DIRECT_FETCH_FALLBACK_STATUS);
      }

      cacheWatchPayload(watch);

      log("direct_fetch_completed", {
        sellerId: watch.sellerId,
        totalFetched
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

    const requestStatus = url.searchParams.get("status");
    const payloadWithRequestStatus = attachRequestStatusToPayload(payload, requestStatus);
    latestGetItemsUrlsBySellerId.set(sellerId, url);
    if (options.requestSnapshot) {
      latestGetItemsRequestSnapshotsBySellerId.set(sellerId, options.requestSnapshot);
    }

    if (options.cache !== false) {
      cacheSellerPayload(sellerId, payloadWithRequestStatus);
    }

    const matchingWatches = Array.from(watches.entries()).filter(([requestId, watch]) => (
      normalizeSellerId(watch.sellerId) === sellerId && (!options.targetRequestId || requestId === options.targetRequestId)
    ));
    log("seller_id_compare_result", {
      currentProfileMatches: Boolean(currentProfileSellerId && sellerId === currentProfileSellerId),
      activeWatchCount: watches.size,
      matchingWatchCount: matchingWatches.length
    });

    if (matchingWatches.length === 0) {
      const reason = watches.size === 0
        ? "no_active_watch"
        : currentProfileSellerId && sellerId !== currentProfileSellerId
          ? "detected_seller_differs_from_profile"
          : "watch_seller_mismatch";

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
      const beforePageLikeIndex = watch.pageLikeIndex ?? 0;
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

    response.clone().json()
      .then((payload) => {
        handleMatchedPayload(url, payload, { requestSnapshot }).catch(() => {
          // Ignore page-hook processing failures in this PoC.
        });
      })
      .catch(() => {
        // Ignore non-JSON responses in this PoC.
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
      this.__furimaneResearchUrl = typeof url === "string" ? url : url?.toString?.() ?? null;
      this.__furimaneResearchMethod = method;
      this.__furimaneResearchHeaders = {};
      return originalXhrOpen.apply(this, arguments);
    };

    OriginalXhr.prototype.setRequestHeader = function furimaneResearchXhrSetRequestHeader(name, value) {
      this.__furimaneResearchHeaders = this.__furimaneResearchHeaders ?? {};
      this.__furimaneResearchHeaders[name] = value;
      return originalXhrSetRequestHeader.apply(this, arguments);
    };

    OriginalXhr.prototype.send = function furimaneResearchXhrSend() {
      this.addEventListener("load", () => {
        const url = parseGetItemsUrl(this.__furimaneResearchUrl);

        if (!url) {
          return;
        }

        try {
          const payload = JSON.parse(this.responseText);

          handleMatchedPayload(url, payload, {
            requestSnapshot: {
              headers: this.__furimaneResearchHeaders ?? {},
              credentials: "include"
            }
          }).catch(() => {
            // Ignore page-hook processing failures in this PoC.
          });
        } catch (_error) {
          // Ignore non-JSON responses in this PoC.
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
      const existingWatch = watches.get(data.requestId);
      clearWatchSettleTimeout(existingWatch);
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
