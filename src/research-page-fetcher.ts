(function () {
  const WATCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
  const WATCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
  const WATCH_SETTLE_MS = 9000;
  const DIRECT_FETCH_STATUS = "trading,sold_out";
  const DIRECT_FETCH_FALLBACK_STATUS: string | null = null;
  const DIRECT_FETCH_MAX_ITEMS = 1000;
  const DIRECT_FETCH_MAX_PAGES_PER_STATUS = 40;
  const DIRECT_FETCH_PAGE_LIMIT = 132;

  type PageHookWindow = Window & {
    __furimaneResearchPageApiHookInstalled?: boolean;
  };

  type PageApiWatchRequest = {
    type?: string;
    requestId?: string;
    sellerId?: string;
    directFetch?: boolean;
  };

  type HookedXhr = XMLHttpRequest & {
    __furimaneResearchUrl?: string | null;
    __furimaneResearchMethod?: string;
    __furimaneResearchHeaders?: Record<string, string>;
  };

  type RequestSnapshot = {
    headers: Record<string, string>;
    credentials: RequestCredentials | null;
  };

  type WatchState = {
    sellerId: string;
    directFetch: boolean;
    payload: unknown;
    pageLikeIndex: number;
    lastMergedCount: number;
    lastDedupedCount: number;
    lastTotalCount: number;
    settleTimeoutId: number | null;
  };

  type CachedSellerPayload = Omit<WatchState, "directFetch" | "settleTimeoutId">;

  const pageWindow = window as PageHookWindow;
  const watches = new Map<string, WatchState>();
  const cachedPayloadsBySellerId = new Map<string, CachedSellerPayload>();
  const latestGetItemsUrlsBySellerId = new Map<string, URL>();
  const latestGetItemsRequestSnapshotsBySellerId = new Map<string, RequestSnapshot>();
  const directFetchRequestIds = new Set<string>();

  const originalFetch = window.fetch.bind(window);
  const OriginalXhr = window.XMLHttpRequest;
  const originalXhrOpen = OriginalXhr.prototype.open;
  const originalXhrSetRequestHeader = OriginalXhr.prototype.setRequestHeader;
  const originalXhrSend = OriginalXhr.prototype.send;

  if (pageWindow.__furimaneResearchPageApiHookInstalled) {
    return;
  }

  pageWindow.__furimaneResearchPageApiHookInstalled = true;

  function log(step: string, payload?: Record<string, unknown>) {
    console.log(`[furimane-research][page-hook] ${step}`, payload ?? {});
  }

  function postToContent(requestId: string, body: Record<string, unknown>) {
    window.postMessage({
      type: WATCH_RESPONSE_TYPE,
      requestId,
      ...body
    }, window.location.origin);
  }

  function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function getStringValue(...candidates: unknown[]) {
    for (const candidate of candidates) {
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

  function getRequestUrl(input: RequestInfo | URL) {
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

  function addHeadersToSnapshot(target: Record<string, string>, headers: HeadersInit | undefined) {
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

  function getFetchRequestSnapshot(input: RequestInfo | URL, init?: RequestInit): RequestSnapshot {
    const headers: Record<string, string> = {};

    if (input instanceof Request) {
      addHeadersToSnapshot(headers, input.headers);
    }

    addHeadersToSnapshot(headers, init?.headers);

    return {
      headers,
      credentials: init?.credentials ?? (input instanceof Request ? input.credentials : null)
    };
  }

  function parseGetItemsUrl(rawUrl: string | null) {
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

  function normalizeSellerId(value: unknown) {
    return typeof value === "string" ? value.trim() : null;
  }

  function getPayloadData(payload: unknown) {
    if (!isObject(payload) || !Array.isArray(payload.data)) {
      return [];
    }

    return payload.data.filter(isObject);
  }

  function attachRequestStatusToPayload(payload: unknown, requestStatus: string | null) {
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

  function getPayloadItemId(item: Record<string, unknown> | null) {
    return getStringValue(item?.id, item?.item_id, item?.itemId);
  }

  function getPayloadMeta(payload: unknown) {
    return isObject(payload) && isObject(payload.meta) ? payload.meta : null;
  }

  function getPayloadHasNext(payload: unknown) {
    const meta = getPayloadMeta(payload);
    return meta?.has_next === true || meta?.hasNext === true;
  }

  function getPayloadPagerId(payload: unknown) {
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

  function getMetaPagerId(payload: unknown) {
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

  function getListingPagerId(item: Record<string, unknown> | null) {
    return getStringValue(item?.pager_id, item?.pagerId);
  }

  function getLastListingPagerId(items: Record<string, unknown>[]) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const pagerId = getListingPagerId(items[index]);

      if (pagerId) {
        return pagerId;
      }
    }

    return null;
  }

  function getNextPagerId(payload: unknown, items: Record<string, unknown>[]) {
    return getMetaPagerId(payload) || getPayloadPagerId(payload) || getLastListingPagerId(items);
  }

  function getPagerIdLocation(payload: unknown, items: Record<string, unknown>[]) {
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

  function buildPagerDiagnostic(payload: unknown, items: Record<string, unknown>[]) {
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

  function mergePayloadIntoWatch(existingPayload: unknown, incomingPayload: unknown) {
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

    const mergedData: Record<string, unknown>[] = [];
    const seenItemIds = new Set<string>();
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

  function clearWatchSettleTimeout(watch: WatchState | undefined) {
    if (!watch || watch.settleTimeoutId == null) {
      return;
    }

    window.clearTimeout(watch.settleTimeoutId);
    watch.settleTimeoutId = null;
  }

  function deleteOtherWatchesForSeller(sellerId: string, keepRequestId: string) {
    for (const [requestId, watch] of watches.entries()) {
      if (requestId === keepRequestId || normalizeSellerId(watch.sellerId) !== normalizeSellerId(sellerId)) {
        continue;
      }

      clearWatchSettleTimeout(watch);
      watches.delete(requestId);
    }
  }

  function flushWatch(requestId: string) {
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

  function postWatchPayload(requestId: string, watch: WatchState, partial: boolean) {
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

  function cacheSellerPayload(sellerId: string, payload: unknown) {
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

  function replayCachedPayload(requestId: string, watch: WatchState) {
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

  function scheduleWatchFlush(requestId: string) {
    const watch = watches.get(requestId);

    if (!watch) {
      return;
    }

    clearWatchSettleTimeout(watch);
    watch.settleTimeoutId = window.setTimeout(() => {
      flushWatch(requestId);
    }, WATCH_SETTLE_MS);
  }

  function buildDirectFetchUrl(sellerId: string, status: string | null, maxPagerId: string | null) {
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

  function buildDirectFetchHeaders(sellerId: string) {
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

  function getDirectFetchCredentials(sellerId: string): RequestCredentials {
    return latestGetItemsRequestSnapshotsBySellerId.get(sellerId)?.credentials ?? "include";
  }

  async function fetchDirectSellerItems(requestId: string, watch: WatchState) {
    if (directFetchRequestIds.has(requestId)) {
      return;
    }

    directFetchRequestIds.add(requestId);

    try {
      log("direct_fetch_started", {
        sellerId: watch.sellerId,
        status: DIRECT_FETCH_STATUS,
        fallbackStatus: DIRECT_FETCH_FALLBACK_STATUS,
        limit: DIRECT_FETCH_PAGE_LIMIT
      });

      let totalFetched = 0;

      const fetchPages = async (status: string | null) => {
        let fetchedCount = 0;
        let maxPagerId: string | null = null;

        for (let pageIndex = 0; pageIndex < DIRECT_FETCH_MAX_PAGES_PER_STATUS && totalFetched < DIRECT_FETCH_MAX_ITEMS; pageIndex += 1) {
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

          let payload: unknown;

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

          const items = getPayloadData(payload);
          const hasNext = getPayloadHasNext(payload);
          const nextPagerId = getNextPagerId(payload, items);

          log("direct_fetch_page_received", {
            sellerId: watch.sellerId,
            status,
            pageIndex: pageIndex + 1,
            itemCount: items.length,
            hasNext,
            hasNextPagerId: Boolean(nextPagerId)
          });

          if (items.length === 0) {
            break;
          }

          await handleMatchedPayload(url, payload, { notify: false });
          totalFetched += items.length;
          fetchedCount += items.length;
          maxPagerId = nextPagerId;

          if (hasNext !== true || !maxPagerId) {
            break;
          }
        }

        return { fetchedCount, failed: false };
      };

      const primaryResult = await fetchPages(DIRECT_FETCH_STATUS);

      if (primaryResult.failed || primaryResult.fetchedCount === 0) {
        await fetchPages(DIRECT_FETCH_FALLBACK_STATUS);
      }

      log("direct_fetch_completed", {
        sellerId: watch.sellerId,
        totalFetched
      });
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

  async function handleMatchedPayload(url: URL, payload: unknown, options: { notify?: boolean; requestSnapshot?: RequestSnapshot } = {}) {
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

    latestGetItemsUrlsBySellerId.set(sellerId, url);
    if (options.requestSnapshot) {
      latestGetItemsRequestSnapshotsBySellerId.set(sellerId, options.requestSnapshot);
    }
    const requestStatus = url.searchParams.get("status");
    const payloadWithRequestStatus = attachRequestStatusToPayload(payload, requestStatus);
    cacheSellerPayload(sellerId, payloadWithRequestStatus);

    const matchingWatches = Array.from(watches.entries()).filter(([, watch]) => normalizeSellerId(watch.sellerId) === sellerId);
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

  function inspectFetchResponse(rawUrl: string | null, response: Response, requestSnapshot?: RequestSnapshot) {
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
    window.fetch = async function furimaneResearchFetchHook(input: RequestInfo | URL, init?: RequestInit) {
      const rawUrl = getRequestUrl(input);
      const requestSnapshot = getFetchRequestSnapshot(input, init);
      const response = await originalFetch(input, init);
      inspectFetchResponse(rawUrl, response, requestSnapshot);
      return response;
    };
  }

  function installXhrHook() {
    OriginalXhr.prototype.open = function furimaneResearchXhrOpen(method: string, url: string | URL) {
      const xhr = this as HookedXhr;
      xhr.__furimaneResearchUrl = typeof url === "string" ? url : url?.toString?.() ?? null;
      xhr.__furimaneResearchMethod = method;
      xhr.__furimaneResearchHeaders = {};
      return originalXhrOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest["open"]>);
    };

    OriginalXhr.prototype.setRequestHeader = function furimaneResearchXhrSetRequestHeader(name: string, value: string) {
      const xhr = this as HookedXhr;
      xhr.__furimaneResearchHeaders = xhr.__furimaneResearchHeaders ?? {};
      xhr.__furimaneResearchHeaders[name] = value;
      return originalXhrSetRequestHeader.apply(this, arguments as unknown as Parameters<XMLHttpRequest["setRequestHeader"]>);
    };

    OriginalXhr.prototype.send = function furimaneResearchXhrSend() {
      this.addEventListener("load", () => {
        const xhr = this as HookedXhr;
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
            // Ignore page-hook processing failures in this PoC.
          });
        } catch (_error) {
          // Ignore non-JSON responses in this PoC.
        }
      });

      return originalXhrSend.apply(this, arguments as unknown as Parameters<XMLHttpRequest["send"]>);
    };
  }

  installFetchHook();
  installXhrHook();
  log("hook_installed");

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const data = event.data as PageApiWatchRequest | null;

    if (!data || data.type !== WATCH_REQUEST_TYPE || typeof data.requestId !== "string" || typeof data.sellerId !== "string") {
      return;
    }

    const existingWatch = watches.get(data.requestId);

    clearWatchSettleTimeout(existingWatch);
    deleteOtherWatchesForSeller(data.sellerId, data.requestId);
    const watch: WatchState = {
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

export {};
