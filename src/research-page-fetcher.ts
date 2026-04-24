(function () {
  const WATCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
  const WATCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
  const WATCH_SETTLE_MS = 15000;

  type PageHookWindow = Window & {
    __furimaneResearchPageApiHookInstalled?: boolean;
  };

  type PageApiWatchRequest = {
    type?: string;
    requestId?: string;
    sellerId?: string;
  };

  type HookedXhr = XMLHttpRequest & {
    __furimaneResearchUrl?: string | null;
    __furimaneResearchMethod?: string;
  };

  type WatchState = {
    sellerId: string;
    payload: unknown;
    pageLikeIndex: number;
    lastMergedCount: number;
    lastDedupedCount: number;
    lastTotalCount: number;
    settleTimeoutId: number | null;
  };

  const pageWindow = window as PageHookWindow;
  const watches = new Map<string, WatchState>();

  const originalFetch = window.fetch.bind(window);
  const OriginalXhr = window.XMLHttpRequest;
  const originalXhrOpen = OriginalXhr.prototype.open;
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

  function getPayloadItemId(item: Record<string, unknown> | null) {
    return getStringValue(item?.id, item?.item_id, item?.itemId);
  }

  function getPayloadMeta(payload: unknown) {
    return isObject(payload) && isObject(payload.meta) ? payload.meta : null;
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

  async function handleMatchedPayload(url: URL, payload: unknown) {
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

    const items = getPayloadData(payload);
    log("pager_diagnostic", buildPagerDiagnostic(payload, items));

    for (const [requestId, watch] of matchingWatches) {
      const mergeResult = mergePayloadIntoWatch(watch.payload, payload);
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

      postWatchPayload(requestId, watch, true);
      scheduleWatchFlush(requestId);
    }
  }

  function inspectFetchResponse(rawUrl: string | null, response: Response) {
    const url = parseGetItemsUrl(rawUrl);

    if (!url) {
      return;
    }

    response.clone().json()
      .then((payload) => {
        handleMatchedPayload(url, payload).catch(() => {
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
      const response = await originalFetch(input, init);
      inspectFetchResponse(rawUrl, response);
      return response;
    };
  }

  function installXhrHook() {
    OriginalXhr.prototype.open = function furimaneResearchXhrOpen(method: string, url: string | URL) {
      const xhr = this as HookedXhr;
      xhr.__furimaneResearchUrl = typeof url === "string" ? url : url?.toString?.() ?? null;
      xhr.__furimaneResearchMethod = method;
      return originalXhrOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest["open"]>);
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

          handleMatchedPayload(url, payload).catch(() => {
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
    watches.set(data.requestId, {
      sellerId: data.sellerId,
      payload: null,
      pageLikeIndex: 0,
      lastMergedCount: 0,
      lastDedupedCount: 0,
      lastTotalCount: 0,
      settleTimeoutId: null
    });
  });
})();

export {};
