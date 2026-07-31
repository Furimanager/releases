(() => {
  const MERCARI_PROFILE_URL_PATTERN = /\/user\/profile\/([^/?#]+)/;
  const MERCARI_SHOPS_PROFILE_URL_PATTERN = /\/shops\/profile\/([^/?#]+)/;
  const MAX_SCROLL_ATTEMPTS = 40;
  const STABLE_SCROLL_LIMIT = 3;
  const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1e3;
  const API_FETCH_LOG_PREFIX = "[furimane-research][api-fetch]";
  const PAGE_FETCHER_SCRIPT_ID = "furimane-research-page-fetcher";
  const PAGE_FETCHER_SCRIPT_PATH = "src/research-page-fetcher.js";
  const PAGE_FETCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
  const PAGE_FETCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
  const PAGE_FETCH_CANCEL_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_CANCEL";
  const PAGE_FETCH_TIMEOUT_MS = 3e4;
  const DOM_FETCH_LOG_PREFIX = "[furimane-research][dom-fetch]";
  const PRICE_TEXT_PATTERN = /(?:[\u00a5\uffe5]\s*([\d,]+)|([\d,]+)\s*\u5186)/;
  const API_AUTO_MORE_MAX_CLICKS = 5;
  const API_AUTO_MORE_PROGRESS_TIMEOUT_MS = 8e3;
  const API_AUTO_MORE_POLL_MS = 200;
  const API_AUTO_MORE_CLICK_DELAY_MS = 300;
  const API_AUTO_MORE_AFTER_CLICK_MS = 800;
  const SELLER_CONTEXT_RETRY_COUNT = 6;
  const SELLER_CONTEXT_RETRY_DELAY_MS = 250;
  const API_ALWAYS_LOG_STEPS = /* @__PURE__ */ new Set([
    "api_mode_entered",
    "period_analysis",
    "payload_received",
    "mappedCount",
    "timeout_waiting_page_api",
    "direct_fetch_failed_warm_page_api",
    "direct_fetch_retry_after_warmup",
    "direct_fetch_warmup_failed_retry_page_api",
    "auto_more_assist_completed"
  ]);
  const API_VERBOSE_LOG_STEPS = /* @__PURE__ */ new Set([
    "pager_diagnostic",
    "period_item_diagnostics",
    "period_basis_compare_summary",
    "period_status_compare_summary"
  ]);
  let pageFetcherInjectPromise = null;
  let pageApiPayloadRequest = null;
  let latestPageApiProgress = null;
  let pageApiProgressListeners = [];
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timeoutId = window.setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timeoutId);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }
  function createRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `furimane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function ensurePageFetcherInjected() {
    if (pageFetcherInjectPromise) {
      return pageFetcherInjectPromise;
    }
    pageFetcherInjectPromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById(PAGE_FETCHER_SCRIPT_ID);
      if (existingScript) {
        resolve();
        return;
      }
      if (typeof chrome === "undefined" || !chrome.runtime?.getURL) {
        reject(new Error("page_fetcher_runtime_unavailable"));
        return;
      }
      const script = document.createElement("script");
      script.id = PAGE_FETCHER_SCRIPT_ID;
      script.src = chrome.runtime.getURL(PAGE_FETCHER_SCRIPT_PATH);
      script.async = false;
      script.addEventListener("load", () => {
        script.remove();
        resolve();
      }, { once: true });
      script.addEventListener("error", () => {
        pageFetcherInjectPromise = null;
        script.remove();
        reject(new Error("page_fetcher_inject_failed"));
      }, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
    return pageFetcherInjectPromise;
  }
  function emitApiProgressFromPagePayload(seller, options, data) {
    const apiPayload = data.payload;
    if (!isResearchObject(apiPayload) || !Array.isArray(apiPayload["data"])) {
      const progressCount = typeof data.totalCount === "number" ? data.totalCount : typeof data.dedupedCount === "number" ? data.dedupedCount : typeof data.mergedCount === "number" ? data.mergedCount : null;
      if (progressCount !== null) {
        options.onProgress?.(progressCount, {
          totalCount: progressCount,
          pageLikeIndex: data.pageLikeIndex ?? null,
          partial: Boolean(data.partial),
          phase: data.partial ? "api_progress" : "api_done"
        });
      }
      return progressCount;
    }
    if (data.partial) {
      const rawCount2 = apiPayload["data"].length;
      const progressCount = typeof data.totalCount === "number" ? data.totalCount : typeof data.dedupedCount === "number" ? data.dedupedCount : typeof data.mergedCount === "number" ? data.mergedCount : rawCount2;
      options.onProgress?.(progressCount, {
        totalCount: progressCount,
        pageLikeIndex: data.pageLikeIndex ?? null,
        partial: true,
        phase: "api_progress"
      });
      return progressCount;
    }
    const rawCount = apiPayload["data"].length;
    const totalCount = typeof data.totalCount === "number" ? data.totalCount : rawCount;
    options.onProgress?.(rawCount, {
      totalCount,
      pageLikeIndex: data.pageLikeIndex ?? null,
      partial: Boolean(data.partial),
      phase: data.partial ? "api_progress" : "api_done"
    });
    return rawCount;
  }
  function isSamePageApiSeller(seller, data) {
    return String(data.sellerId ?? "") === seller.seller_id;
  }
  function addPageApiProgressListener(seller, options) {
    if (typeof options.onProgress !== "function") {
      return () => {
      };
    }
    const listener = { seller, options };
    pageApiProgressListeners.push(listener);
    if (latestPageApiProgress && isSamePageApiSeller(seller, latestPageApiProgress)) {
      emitApiProgressFromPagePayload(seller, options, latestPageApiProgress);
    }
    return () => {
      pageApiProgressListeners = pageApiProgressListeners.filter((current) => current !== listener);
    };
  }
  function notifyPageApiProgress(data) {
    latestPageApiProgress = data;
    let mappedCount = null;
    for (const listener of pageApiProgressListeners) {
      if (!isSamePageApiSeller(listener.seller, data)) {
        continue;
      }
      mappedCount = emitApiProgressFromPagePayload(listener.seller, listener.options, data);
    }
    return mappedCount;
  }
  async function waitMercariApiPayloadFromPage(seller, options = {}) {
    const removeProgressListener = addPageApiProgressListener(seller, options);
    const wantsDirectFetch = options.directFetch !== false;
    if (pageApiPayloadRequest?.sellerId === seller.seller_id && (pageApiPayloadRequest.directFetch || !wantsDirectFetch)) {
      return pageApiPayloadRequest.promise.finally(removeProgressListener);
    }
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      removeProgressListener();
      throw error;
    }
    try {
      await ensurePageFetcherInjected();
    } catch (error) {
      removeProgressListener();
      throw error;
    }
    logApiFetch("info", "hook_installed", {
      sellerId: seller.seller_id
    });
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      removeProgressListener();
      throw error;
    }
    let promise;
    promise = new Promise((resolve, reject) => {
      const requestId = createRequestId();
      let timeoutId = null;
      const cancelPageRequest = (reason) => {
        window.postMessage({
          type: PAGE_FETCH_CANCEL_TYPE,
          requestId,
          reason
        }, window.location.origin);
      };
      const clearPayloadRequest = () => {
        if (pageApiPayloadRequest?.promise === promise) {
          pageApiPayloadRequest = null;
        }
      };
      const resetTimeout = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(() => {
          cancelPageRequest("timeout");
          cleanup();
          clearPayloadRequest();
          logApiFetch("info", "timeout_waiting_page_api", {
            sellerId: seller.seller_id
          });
          reject(new Error("page_api_payload_timeout"));
        }, PAGE_FETCH_TIMEOUT_MS);
      };
      resetTimeout();
      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        window.removeEventListener("message", handleMessage);
        options.signal?.removeEventListener("abort", handleAbort);
        removeProgressListener();
      };
      const handleAbort = () => {
        cancelPageRequest("abort");
        cleanup();
        clearPayloadRequest();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const handleMessage = (event) => {
        if (event.source !== window || event.origin !== window.location.origin) {
          return;
        }
        const data = event.data;
        if (!data || data.type !== PAGE_FETCH_RESPONSE_TYPE || data.requestId !== requestId) {
          return;
        }
        if (data.error) {
          cleanup();
          clearPayloadRequest();
          reject(new Error(data.error));
          return;
        }
        if (data.partial) {
          const mappedCount = notifyPageApiProgress(data);
          logApiFetch("info", "payload_progress_received", {
            sellerId: seller.seller_id,
            matchedSellerId: data.sellerId ?? null,
            pageLikeIndex: data.pageLikeIndex ?? null,
            mergedCount: data.mergedCount ?? null,
            dedupedCount: data.dedupedCount ?? null,
            totalCount: data.totalCount ?? null,
            mappedCount
          });
          if (options.resolveOnFirstPartial) {
            cancelPageRequest("warmup_completed");
            cleanup();
            clearPayloadRequest();
            resolve(data.payload);
            return;
          }
          resetTimeout();
          return;
        }
        cleanup();
        logApiFetch("info", "payload_received", {
          sellerId: seller.seller_id,
          matchedSellerId: data.sellerId ?? null,
          pageLikeIndex: data.pageLikeIndex ?? null,
          mergedCount: data.mergedCount ?? null,
          dedupedCount: data.dedupedCount ?? null,
          totalCount: data.totalCount ?? null
        });
        notifyPageApiProgress(data);
        clearPayloadRequest();
        resolve(data.payload);
      };
      window.addEventListener("message", handleMessage);
      options.signal?.addEventListener("abort", handleAbort, { once: true });
      window.postMessage({
        type: PAGE_FETCH_REQUEST_TYPE,
        requestId,
        sellerId: seller.seller_id,
        directFetch: wantsDirectFetch
      }, window.location.origin);
    });
    pageApiPayloadRequest = { sellerId: seller.seller_id, promise, directFetch: wantsDirectFetch };
    return promise;
  }
  function getSellerIdFromCurrentUrl() {
    const pathname = window.location.pathname;
    return pathname.match(MERCARI_PROFILE_URL_PATTERN)?.[1] ?? pathname.match(MERCARI_SHOPS_PROFILE_URL_PATTERN)?.[1] ?? null;
  }
  function getPlatformFromCurrentUrl() {
    const pathname = window.location.pathname;
    if (MERCARI_SHOPS_PROFILE_URL_PATTERN.test(pathname)) {
      return "mercari_shops";
    }
    if (MERCARI_PROFILE_URL_PATTERN.test(pathname)) {
      return "mercari";
    }
    return null;
  }
  function getSellerContextFromCurrentPage() {
    const platform = getPlatformFromCurrentUrl();
    const sellerId = getSellerIdFromCurrentUrl();
    if (!platform || !sellerId) {
      return null;
    }
    return {
      platform,
      seller_id: sellerId,
      seller_name: getSellerName(platform),
      seller_url: window.location.href
    };
  }
  function getSellerName(platform = getPlatformFromCurrentUrl()) {
    const selectors = platform === "mercari_shops" ? [
      'main [data-testid*="shop-name"]',
      'main [data-testid*="shop"] h1',
      'main [data-testid*="shops"] h1',
      'header [data-testid*="shop-name"]',
      "main h1",
      "h1"
    ] : [
      'main [data-testid*="profile-name"]',
      'main [data-testid*="profile"] h1',
      ".profile-name",
      "main h1",
      "h1"
    ];
    const candidates = selectors.map((selector) => document.querySelector(selector));
    for (const candidate of candidates) {
      const text = candidate?.textContent?.replace(/\s+/g, " ").trim();
      if (text) {
        return text;
      }
    }
    const suffixPattern = platform === "mercari_shops" ? /\s*[-|]\s*メルカリShops.*$/ : /\s*[-|]\s*メルカリ.*$/;
    return document.title.replace(suffixPattern, "").trim() || null;
  }
  function getText(element) {
    return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  function getItemIdFromUrl(url) {
    const itemMatch = url.match(/\/item\/([^/?#]+)/);
    const shopProductMatch = url.match(/\/shops\/product\/([^/?#]+)/);
    return itemMatch?.[1] ?? shopProductMatch?.[1] ?? null;
  }
  function getAncestorCandidates(element, maxDepth = 10) {
    const candidates = [];
    let current = element.parentElement;
    for (let depth = 0; current && depth < maxDepth; depth += 1) {
      candidates.push(current);
      current = current.parentElement;
    }
    return candidates;
  }
  function getUniqueElements(elements) {
    const seen = /* @__PURE__ */ new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) {
        return false;
      }
      seen.add(element);
      return true;
    });
  }
  function getListingContainer(link, pricePattern = PRICE_TEXT_PATTERN) {
    const candidates = getUniqueElements([
      link,
      link.closest("li"),
      link.closest("article"),
      link.closest('[data-testid*="item"]'),
      link.closest('[data-testid*="product"]'),
      link.closest("[role='listitem']"),
      link.closest("[data-testid]"),
      link.parentElement,
      link.parentElement?.parentElement,
      ...getAncestorCandidates(link)
    ]);
    return candidates.find((candidate) => pricePattern.test(getText(candidate))) ?? candidates[0] ?? link;
  }
  function getUniqueTextValues(values) {
    const seen = /* @__PURE__ */ new Set();
    return values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }
  function getListingText(link, container) {
    const parent = link.parentElement;
    const grandParent = parent?.parentElement;
    return getUniqueTextValues([
      getText(container),
      getText(parent),
      getText(grandParent),
      getText(parent?.nextElementSibling),
      getText(grandParent?.nextElementSibling),
      link.getAttribute("aria-label"),
      link.querySelector("img")?.getAttribute("alt")
    ]).join(" ");
  }
  function getListingLinkSelector(platform) {
    return platform === "mercari_shops" ? 'a[href*="/shops/product/"]' : 'a[href*="/item/"]';
  }
  function getThumbnailUrl(link) {
    const image = link.querySelector("img");
    return image?.currentSrc || image?.getAttribute("src") || image?.getAttribute("data-src") || null;
  }
  function createDomCollectDiagnostics(platform) {
    return {
      platform,
      linkSelector: getListingLinkSelector(platform),
      linkCount: 0,
      acceptedCount: 0,
      skippedMissingItemId: 0,
      skippedMissingPrice: 0,
      skippedMissingTitle: 0,
      firstLinkHref: null,
      firstContainerTag: null,
      firstContainerTextLength: 0,
      firstContainerTextSample: ""
    };
  }
  async function waitForSellerContextFromCurrentPage(signal) {
    for (let attempt = 0; attempt <= SELLER_CONTEXT_RETRY_COUNT; attempt += 1) {
      const seller = getSellerContextFromCurrentPage();
      if (seller) {
        return seller;
      }
      if (attempt < SELLER_CONTEXT_RETRY_COUNT) {
        await sleep(SELLER_CONTEXT_RETRY_DELAY_MS, signal);
      }
    }
    return null;
  }
  function logDomCollectDiagnostics(step, diagnostics) {
    console.log(`${DOM_FETCH_LOG_PREFIX} ${step}`, diagnostics);
  }
  function collectDomCandidates(platform, siteConfig, diagnostics) {
    const selector = siteConfig.config?.listingLinkSelectors?.[platform] ?? getListingLinkSelector(platform);
    const pricePattern = new RegExp(siteConfig.config?.pricePattern ?? PRICE_TEXT_PATTERN.source);
    const maxTextLength = Number(siteConfig.config?.domTextMaxLength ?? 500);
    const links = Array.from(document.querySelectorAll(selector));
    const candidates = /* @__PURE__ */ new Map();
    if (diagnostics) {
      diagnostics.linkSelector = selector;
      diagnostics.linkCount = links.length;
      diagnostics.firstLinkHref = links[0]?.href ?? null;
    }
    for (const link of links) {
      const itemUrl = new URL(link.href, window.location.origin).toString();
      const itemId = getItemIdFromUrl(itemUrl);
      if (!itemId) {
        if (diagnostics) {
          diagnostics.skippedMissingItemId += 1;
        }
        continue;
      }
      if (candidates.has(itemUrl)) {
        continue;
      }
      const container = getListingContainer(link, pricePattern);
      const text = getListingText(link, container).slice(0, maxTextLength);
      if (diagnostics && !diagnostics.firstContainerTag) {
        diagnostics.firstContainerTag = container.tagName?.toLowerCase() ?? null;
        diagnostics.firstContainerTextLength = text.length;
        diagnostics.firstContainerTextSample = text.slice(0, 120);
      }
      if (!pricePattern.test(text)) {
        if (diagnostics) {
          diagnostics.skippedMissingPrice += 1;
        }
        continue;
      }
      if (diagnostics) {
        diagnostics.acceptedCount += 1;
      }
      candidates.set(itemUrl, {
        item_url: itemUrl,
        text,
        image_alt: link.querySelector("img")?.getAttribute("alt") ?? null,
        aria_label: link.getAttribute("aria-label"),
        thumbnail_url: getThumbnailUrl(link)
      });
    }
    return Array.from(candidates.values());
  }
  async function clickSoldTab(platform, signal) {
    if (platform === "mercari_shops") {
      return;
    }
    const candidates = Array.from(document.querySelectorAll("button, a, [role='tab']"));
    const soldTab = candidates.find((candidate) => {
      const text = getText(candidate);
      return text.includes("\u8CA9\u58F2\u6E08\u307F") || text.includes("\u58F2\u308A\u5207\u308C") || text.includes("\u58F2\u5374\u6E08\u307F") || /sold/i.test(text);
    });
    if (!soldTab) {
      return;
    }
    soldTab.click();
    await sleep(1e3, signal);
  }
  function getApiAutoMoreButtonText(element) {
    return [
      getText(element),
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? ""
    ].join(" ").replace(/\s+/g, " ").trim();
  }
  function isApiAutoMoreButtonDisabled(element) {
    return Boolean(
      element instanceof HTMLButtonElement && element.disabled || element.getAttribute("aria-disabled") === "true" || element.getAttribute("disabled") !== null
    );
  }
  function isApiAutoMoreButtonVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findApiAutoMoreButton() {
    const candidates = Array.from(document.querySelectorAll('main button, main a, main [role="button"]'));
    return candidates.find((candidate) => {
      const text = getApiAutoMoreButtonText(candidate);
      if (!text) {
        return false;
      }
      return (/もっと\s*見る/.test(text) || /さらに\s*表示/.test(text) || /さらに\s*見る/.test(text) || /load\s*more/i.test(text) || /show\s*more/i.test(text)) && !isApiAutoMoreButtonDisabled(candidate) && isApiAutoMoreButtonVisible(candidate);
    }) ?? null;
  }
  function getLatestApiProgressForSeller(seller) {
    if (!latestPageApiProgress || !isSamePageApiSeller(seller, latestPageApiProgress)) {
      return null;
    }
    return latestPageApiProgress;
  }
  async function waitForApiProgressAfter(seller, minPageLikeIndex, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < API_AUTO_MORE_PROGRESS_TIMEOUT_MS) {
      throwIfAborted(signal);
      const progress = getLatestApiProgressForSeller(seller);
      const pageLikeIndex = Number(progress?.pageLikeIndex ?? 0);
      if (progress && pageLikeIndex > minPageLikeIndex) {
        return progress;
      }
      await sleep(API_AUTO_MORE_POLL_MS, signal);
    }
    return null;
  }
  function getApiProgressRawListings(progress) {
    const payload = progress?.payload;
    if (!isResearchObject(payload) || !Array.isArray(payload["data"])) {
      return [];
    }
    return payload["data"].filter(isResearchObject);
  }
  function getApiPeriodDateCandidate(rawListing) {
    if (!isResearchObject(rawListing)) {
      return null;
    }
    const listing = getApiListingSource(rawListing);
    const confirmedCandidates = [
      ["sold_at", listing.sold_at],
      ["soldAt", listing.soldAt],
      ["purchased_at", listing.purchased_at],
      ["purchasedAt", listing.purchasedAt]
    ];
    const estimatedCandidates = [
      ["created", listing.created],
      ["created_at", listing.created_at],
      ["createdAt", listing.createdAt],
      ["updated", listing.updated],
      ["updated_at", listing.updated_at],
      ["updatedAt", listing.updatedAt]
    ];
    for (const [source, value] of [...confirmedCandidates, ...estimatedCandidates]) {
      const isEstimated = estimatedCandidates.some(([estimatedSource]) => estimatedSource === source);
      const isoValue = getIsoDateValue(value);
      if (isoValue) {
        const timeMs = new Date(isoValue).getTime();
        if (Number.isFinite(timeMs)) {
          return { source, isoValue, timeMs, isEstimated };
        }
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        const timeMs = value > 1e11 ? value : value * 1e3;
        if (Number.isFinite(timeMs)) {
          return { source, isoValue: new Date(timeMs).toISOString(), timeMs, isEstimated };
        }
      }
    }
    return null;
  }
  function getApiAutoMorePeriodState(progress) {
    const rawListings = getApiProgressRawListings(progress);
    const cutoff = Date.now() - THREE_MONTHS_MS;
    const sourceCounts = {};
    let newerCount = 0;
    let olderCount = 0;
    let missingDateCount = 0;
    let oldestTimeMs = null;
    for (const rawListing of rawListings) {
      const candidate = getApiPeriodDateCandidate(rawListing);
      if (!candidate) {
        missingDateCount += 1;
        continue;
      }
      sourceCounts[candidate.source] = (sourceCounts[candidate.source] ?? 0) + 1;
      oldestTimeMs = oldestTimeMs === null ? candidate.timeMs : Math.min(oldestTimeMs, candidate.timeMs);
      if (candidate.timeMs < cutoff) {
        olderCount += 1;
      } else {
        newerCount += 1;
      }
    }
    const observedDateCount = newerCount + olderCount;
    const oldestDaysAgo = oldestTimeMs === null ? null : Math.floor((Date.now() - oldestTimeMs) / (24 * 60 * 60 * 1e3));
    return {
      observedDateCount,
      newerCount,
      olderCount,
      missingDateCount,
      oldestDaysAgo,
      sourceCounts
    };
  }
  async function runApiAutoMoreAssist(seller, signal) {
    let handledPageLikeIndex = 0;
    let clickedCount = 0;
    logApiFetch("info", "auto_more_assist_started", {
      maxClicks: API_AUTO_MORE_MAX_CLICKS,
      progressTimeoutMs: API_AUTO_MORE_PROGRESS_TIMEOUT_MS
    });
    for (let clickCount = 0; clickCount < API_AUTO_MORE_MAX_CLICKS; clickCount += 1) {
      logApiFetch("info", "auto_more_waiting_progress", {
        clickCount,
        handledPageLikeIndex
      });
      const progress = await waitForApiProgressAfter(seller, handledPageLikeIndex, signal);
      if (!progress) {
        logApiFetch("info", "auto_more_progress_timeout", {
          clickCount,
          clickedCount,
          handledPageLikeIndex
        });
        return;
      }
      handledPageLikeIndex = Number(progress.pageLikeIndex ?? handledPageLikeIndex);
      const periodState = getApiAutoMorePeriodState(progress);
      const totalCount = typeof progress.totalCount === "number" ? progress.totalCount : null;
      logApiFetch("info", "auto_more_period_check", {
        pageLikeIndex: handledPageLikeIndex,
        totalCount,
        ...periodState
      });
      await sleep(API_AUTO_MORE_CLICK_DELAY_MS, signal);
      const button = findApiAutoMoreButton();
      if (!button) {
        logApiFetch("info", "auto_more_button_not_found", {
          clickCount,
          clickedCount,
          pageLikeIndex: handledPageLikeIndex,
          totalCount: progress.totalCount ?? null
        });
        return;
      }
      logApiFetch("info", "auto_more_button_clicked", {
        clickCount: clickCount + 1,
        pageLikeIndex: handledPageLikeIndex,
        totalCount: progress.totalCount ?? null
      });
      button.click();
      clickedCount += 1;
      await sleep(API_AUTO_MORE_AFTER_CLICK_MS, signal);
    }
    logApiFetch("info", "auto_more_assist_completed", {
      clickedCount,
      handledPageLikeIndex,
      stop_reason: "safety_limit_clicks_exhausted"
    });
  }
  async function triggerApiFetchAfterWatch(seller, signal, force = false) {
    await sleep(API_AUTO_MORE_CLICK_DELAY_MS, signal);
    if (!force && getLatestApiProgressForSeller(seller)) {
      logApiFetch("info", "api_kickoff_skipped_existing_progress", {
        sellerId: seller.seller_id
      });
      return;
    }
    const button = findApiAutoMoreButton();
    if (button) {
      logApiFetch("info", "api_kickoff_more_button_clicked", {
        sellerId: seller.seller_id
      });
      button.click();
      await sleep(API_AUTO_MORE_AFTER_CLICK_MS, signal);
      return;
    }
    logApiFetch("info", "api_kickoff_scroll", {
      sellerId: seller.seller_id
    });
    window.scrollBy({ top: Math.max(window.innerHeight, 600), behavior: "auto" });
    await sleep(API_AUTO_MORE_AFTER_CLICK_MS, signal);
  }
  async function warmDirectFetchHeadersFromPageApi(seller, options) {
    const warmupPromise = waitMercariApiPayloadFromPage(seller, {
      ...options,
      directFetch: false,
      resolveOnFirstPartial: true,
      onProgress: void 0
    });
    await triggerApiFetchAfterWatch(seller, options.signal, true);
    await warmupPromise;
  }
  async function runApiAssistAfterWatch(seller, signal) {
    await triggerApiFetchAfterWatch(seller, signal);
    await runApiAutoMoreAssist(seller, signal);
  }
  function isDirectFetchFailure(error) {
    return error instanceof Error && ["direct_fetch_empty", "direct_fetch_error", "direct_fetch_missing_snapshot", "direct_fetch_rate_limited"].includes(error.message);
  }
  function isServerAnalyzeFailure(error) {
    if (!(error instanceof Error)) {
      return false;
    }
    if (error.name === "ResearchApiError") {
      return true;
    }
    return [
      "auth_required",
      "plan_required",
      "research_monthly_limit_exceeded",
      "analyze_mapping_empty",
      "api_timeout",
      "network_error",
      "research_api_missing"
    ].includes(error.message);
  }
  function runApiAssistAfterWatchSafe(seller, signal) {
    runApiAssistAfterWatch(seller, signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      logApiFetch("warn", "auto_more_assist_failed", {
        reason: error instanceof Error ? error.message : String(error)
      });
    });
  }
  function isResearchObject(value) {
    return typeof value === "object" && value !== null;
  }
  function getIsoDateValue(...values) {
    for (const value of values) {
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
      }
      if (typeof value !== "string") {
        continue;
      }
      const normalized = value.trim();
      if (!normalized) {
        continue;
      }
      const parsed = new Date(normalized);
      if (Number.isFinite(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  }
  function getNestedApiListing(rawListing) {
    if (!rawListing) {
      return null;
    }
    for (const key of ["item", "itemData", "item_data", "itemDetail", "item_detail", "listing", "product"]) {
      const value = rawListing[key];
      if (isResearchObject(value)) {
        return value;
      }
    }
    return null;
  }
  function getApiListingSource(rawListing) {
    const nestedListing = getNestedApiListing(rawListing);
    return nestedListing ? {
      ...rawListing,
      ...nestedListing,
      __furimane_request_status: nestedListing["__furimane_request_status"] ?? rawListing["__furimane_request_status"]
    } : rawListing;
  }
  function logApiFetch(_level, step, payload = {}) {
    const isDebugLogEnabled = localStorage.getItem("furimane-research-debug") === "true";
    const isVerboseLogEnabled = localStorage.getItem("furimane-research-verbose") === "true";
    if (API_VERBOSE_LOG_STEPS.has(step) && !isVerboseLogEnabled) {
      return;
    }
    if (!isDebugLogEnabled && !API_ALWAYS_LOG_STEPS.has(step)) {
      return;
    }
    console.log(`${API_FETCH_LOG_PREFIX} ${step}`, payload);
  }
  async function fetchSellerListingsByDom(options = {}) {
    const seller = getSellerContextFromCurrentPage();
    const api = window.FurimanagerResearchApi;
    if (!seller) {
      throw new Error("seller_id_not_found");
    }
    if (!api?.getSiteConfig || !api?.analyzeResearchData || !api?.buildDomItemForAnalyze) {
      throw new Error("research_api_missing");
    }
    const siteConfig = await api.getSiteConfig(seller.platform, { signal: options.signal });
    await clickSoldTab(seller.platform, options.signal);
    const initialDiagnostics = createDomCollectDiagnostics(seller.platform);
    let candidates = collectDomCandidates(seller.platform, siteConfig, initialDiagnostics);
    const initialItemLinkCount = initialDiagnostics.linkCount;
    let stableCount = 0;
    if (initialItemLinkCount === 0) {
      logDomCollectDiagnostics("no_item_links_found", initialDiagnostics);
    }
    if (initialItemLinkCount > 0 && candidates.length === 0) {
      logDomCollectDiagnostics("mercari_dom_changed", initialDiagnostics);
      throw new Error("mercari_dom_changed");
    }
    options.onProgress?.(candidates.length);
    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt += 1) {
      throwIfAborted(options.signal);
      const beforeCount = candidates.length;
      await sleep(1e3, options.signal);
      candidates = collectDomCandidates(seller.platform, siteConfig);
      options.onProgress?.(candidates.length);
      stableCount = candidates.length === beforeCount ? stableCount + 1 : 0;
      if (stableCount >= STABLE_SCROLL_LIMIT) {
        break;
      }
    }
    const maxTextLength = Number(siteConfig.config?.domTextMaxLength ?? 500);
    const domItems = candidates.slice(0, Number(siteConfig.config?.maxItems ?? 1e3)).map((candidate) => api.buildDomItemForAnalyze?.(candidate, maxTextLength)).filter((item) => Boolean(item));
    const result = await api.analyzeResearchData({
      seller: {
        platform: seller.platform,
        seller_id: seller.seller_id,
        seller_name: seller.seller_name ?? null,
        seller_url: seller.seller_url ?? null
      },
      source: "dom",
      domItems
    }, { signal: options.signal });
    options.onProgress?.(result.listings.length, {
      totalCount: result.listings.length,
      pageLikeIndex: null,
      partial: false,
      phase: "api_done"
    });
    return {
      listings: result.listings,
      stats: result.stats ?? null,
      periodAnalysis: result.periodAnalysis ?? null,
      usage: result.usage ?? null,
      seller: result.seller ?? null,
      savedOnServer: true
    };
  }
  async function analyzePayloadViaServer(apiPayload, seller, options) {
    const api = window.FurimanagerResearchApi;
    if (!api?.trimRawItemsForAnalyze || !api?.analyzeResearchData) {
      throw new Error("research_api_missing");
    }
    if (!isResearchObject(apiPayload) || !Array.isArray(apiPayload["data"])) {
      throw new Error("mercari_api_invalid_response");
    }
    const rawItems = api.trimRawItemsForAnalyze(apiPayload["data"].filter(isResearchObject));
    const result = await api.analyzeResearchData({
      seller: {
        platform: seller.platform,
        seller_id: seller.seller_id,
        seller_name: seller.seller_name ?? null,
        seller_url: seller.seller_url ?? null
      },
      source: "page_api",
      rawItems
    }, { signal: options.signal });
    options.onProgress?.(result.listings.length, {
      totalCount: result.listings.length,
      pageLikeIndex: null,
      partial: false,
      phase: "api_done"
    });
    return {
      listings: result.listings,
      stats: result.stats ?? null,
      periodAnalysis: result.periodAnalysis ?? null,
      usage: result.usage ?? null,
      seller: result.seller ?? null,
      savedOnServer: true
    };
  }
  async function fetchSellerListingsByApiPoc(options = {}) {
    const seller = await waitForSellerContextFromCurrentPage(options.signal);
    if (!seller) {
      throw new Error("seller_id_not_found");
    }
    if (seller.platform !== "mercari") {
      throw new Error("unsupported_api_platform");
    }
    logApiFetch("info", "api_mode_entered", {
      sellerId: seller.seller_id,
      strategy: options.strategy ?? null
    });
    let apiPayloadPromise = waitMercariApiPayloadFromPage(seller, options);
    const shouldRunPageAssist = options.directFetch === false;
    if (shouldRunPageAssist) {
      runApiAssistAfterWatchSafe(seller, options.signal);
    }
    let apiPayload;
    try {
      apiPayload = await apiPayloadPromise;
    } catch (error) {
      if (!isDirectFetchFailure(error) || options.directFetch === false) {
        throw error;
      }
      logApiFetch("warn", "direct_fetch_failed_warm_page_api", {
        reason: error instanceof Error ? error.message : String(error)
      });
      try {
        await warmDirectFetchHeadersFromPageApi(seller, options);
      } catch (warmupError) {
        logApiFetch("warn", "direct_fetch_warmup_failed_retry_page_api", {
          reason: warmupError instanceof Error ? warmupError.message : String(warmupError)
        });
        apiPayloadPromise = waitMercariApiPayloadFromPage(seller, { ...options, directFetch: false });
        runApiAssistAfterWatchSafe(seller, options.signal);
        apiPayload = await apiPayloadPromise;
        return analyzePayloadViaServer(apiPayload, seller, options);
      }
      logApiFetch("info", "direct_fetch_retry_after_warmup", {
        sellerId: seller.seller_id
      });
      try {
        apiPayload = await waitMercariApiPayloadFromPage(seller, options);
      } catch (retryError) {
        if (!isDirectFetchFailure(retryError)) {
          throw retryError;
        }
        logApiFetch("warn", "direct_fetch_failed_retry_page_api", {
          reason: retryError instanceof Error ? retryError.message : String(retryError)
        });
        apiPayloadPromise = waitMercariApiPayloadFromPage(seller, { ...options, directFetch: false });
        runApiAssistAfterWatchSafe(seller, options.signal);
        apiPayload = await apiPayloadPromise;
      }
    }
    return analyzePayloadViaServer(apiPayload, seller, options);
  }
  async function fetchSellerResearchData(options = {}) {
    const seller = await waitForSellerContextFromCurrentPage(options.signal);
    if (!seller) {
      throw new Error("seller_id_not_found");
    }
    const strategy = options.strategy ?? "api";
    let analyzed;
    let resolvedStrategy = strategy;
    if (strategy === "api") {
      try {
        analyzed = await fetchSellerListingsByApiPoc(options);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (isServerAnalyzeFailure(error)) {
          throw error;
        }
        logApiFetch("warn", "fallback_to_dom", {
          reason: error instanceof Error ? error.message : String(error)
        });
        options.onProgress?.(0, {
          totalCount: 0,
          pageLikeIndex: null,
          partial: false,
          phase: "dom_fallback"
        });
        analyzed = await fetchSellerListingsByDom(options);
        resolvedStrategy = "dom";
      }
    } else {
      logApiFetch("info", "api_branch_not_entered", {
        sellerId: seller.seller_id,
        strategy
      });
      analyzed = await fetchSellerListingsByDom(options);
    }
    return {
      seller: analyzed.seller ?? seller,
      listings: analyzed.listings,
      strategy: resolvedStrategy,
      stats: analyzed.stats ?? null,
      periodAnalysis: analyzed.periodAnalysis ?? null,
      usage: analyzed.usage ?? null,
      savedOnServer: analyzed.savedOnServer === true
    };
  }
  async function scrapeSellerPageSafe(options = {}) {
    try {
      return await fetchSellerResearchData(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      console.error("[furimane-research] scrape failed", error);
      if (error instanceof Error && ["seller_id_not_found", "mercari_dom_changed"].includes(error.message)) {
        throw error;
      }
      throw error;
    }
  }
  window.FurimanagerResearchScraper = {
    getSellerIdFromCurrentUrl,
    getPlatformFromCurrentUrl,
    getSellerContextFromCurrentPage,
    fetchSellerListingsByDom,
    fetchSellerListingsByApi: fetchSellerListingsByApiPoc,
    fetchSellerResearchData,
    scrapeSellerPage: scrapeSellerPageSafe
  };
  try {
    const seller = getSellerContextFromCurrentPage();
    if (seller?.platform === "mercari") {
      waitMercariApiPayloadFromPage(seller, { directFetch: false }).catch(() => {
      });
    }
  } catch (_error) {
  }
})();
