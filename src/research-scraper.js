const FURIMANE_MERCARI_PROFILE_URL_PATTERN = /\/user\/profile\/([^/?#]+)/;
const FURIMANE_MERCARI_SHOPS_PROFILE_URL_PATTERN = /\/shops\/profile\/([^/?#]+)/;
const FURIMANE_MAX_SCROLL_ATTEMPTS = 40;
const FURIMANE_STABLE_SCROLL_LIMIT = 3;
const FURIMANE_THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const FURIMANE_API_FETCH_LOG_PREFIX = "[furimane-research][api-fetch]";
const FURIMANE_PAGE_FETCHER_SCRIPT_ID = "furimane-research-page-fetcher";
const FURIMANE_PAGE_FETCHER_SCRIPT_PATH = "src/research-page-fetcher.js";
const FURIMANE_PAGE_FETCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
const FURIMANE_PAGE_FETCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
const FURIMANE_PAGE_FETCH_CANCEL_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_CANCEL";
const FURIMANE_PAGE_FETCH_TIMEOUT_MS = 30000;
const FURIMANE_DOM_FETCH_LOG_PREFIX = "[furimane-research][dom-fetch]";
const FURIMANE_PRICE_TEXT_PATTERN = /(?:[\u00a5\uffe5]\s*([\d,]+)|([\d,]+)\s*\u5186)/;
const FURIMANE_API_AUTO_MORE_MAX_CLICKS = 5;
const FURIMANE_API_AUTO_MORE_PROGRESS_TIMEOUT_MS = 8000;
const FURIMANE_API_AUTO_MORE_POLL_MS = 200;
const FURIMANE_API_AUTO_MORE_CLICK_DELAY_MS = 300;
const FURIMANE_API_AUTO_MORE_AFTER_CLICK_MS = 800;
const FURIMANE_SELLER_CONTEXT_RETRY_COUNT = 6;
const FURIMANE_SELLER_CONTEXT_RETRY_DELAY_MS = 250;
const FURIMANE_API_ALWAYS_LOG_STEPS = new Set([
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
const FURIMANE_API_VERBOSE_LOG_STEPS = new Set([
  "pager_diagnostic",
  "period_item_diagnostics",
  "period_basis_compare_summary",
  "period_status_compare_summary"
]);
let hasLoggedFurimaneApiPagerDiagnostic = false;
let furimanePageFetcherInjectPromise = null;
let furimanePageApiPayloadRequest = null;
let furimaneLatestPageApiProgress = null;
let furimanePageApiProgressListeners = [];

function sleepForFurimaneResearch(ms, signal) {
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

function throwIfFurimaneResearchAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function createFurimaneResearchRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `furimane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureFurimanePageFetcherInjected() {
  if (furimanePageFetcherInjectPromise) {
    return furimanePageFetcherInjectPromise;
  }

  furimanePageFetcherInjectPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(FURIMANE_PAGE_FETCHER_SCRIPT_ID);

    if (existingScript) {
      resolve();
      return;
    }

    if (typeof chrome === "undefined" || !chrome.runtime?.getURL) {
      reject(new Error("page_fetcher_runtime_unavailable"));
      return;
    }

    const script = document.createElement("script");
    script.id = FURIMANE_PAGE_FETCHER_SCRIPT_ID;
    script.src = chrome.runtime.getURL(FURIMANE_PAGE_FETCHER_SCRIPT_PATH);
    script.async = false;

    script.addEventListener("load", () => {
      script.remove();
      resolve();
    }, { once: true });

    script.addEventListener("error", () => {
      furimanePageFetcherInjectPromise = null;
      script.remove();
      reject(new Error("page_fetcher_inject_failed"));
    }, { once: true });

    (document.head || document.documentElement).appendChild(script);
  });

  return furimanePageFetcherInjectPromise;
}

function emitFurimaneApiProgressFromPagePayload(seller, options, data) {
  const apiPayload = data.payload;

  if (!isFurimaneResearchObject(apiPayload) || !Array.isArray(apiPayload.data)) {
    const progressCount = typeof data.totalCount === "number"
      ? data.totalCount
      : typeof data.dedupedCount === "number"
        ? data.dedupedCount
        : typeof data.mergedCount === "number"
          ? data.mergedCount
          : null;

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
    const rawCount = apiPayload.data.length;
    const progressCount = typeof data.totalCount === "number"
      ? data.totalCount
      : typeof data.dedupedCount === "number"
        ? data.dedupedCount
        : typeof data.mergedCount === "number"
          ? data.mergedCount
          : rawCount;

    options.onProgress?.(progressCount, {
      totalCount: progressCount,
      pageLikeIndex: data.pageLikeIndex ?? null,
      partial: true,
      phase: "api_progress"
    });

    return progressCount;
  }

  const rawCount = apiPayload.data.length;
  const totalCount = typeof data.totalCount === "number" ? data.totalCount : rawCount;

  options.onProgress?.(rawCount, {
    totalCount,
    pageLikeIndex: data.pageLikeIndex ?? null,
    partial: Boolean(data.partial),
    phase: data.partial ? "api_progress" : "api_done"
  });

  return rawCount;
}

function isSameFurimanePageApiSeller(seller, data) {
  return String(data.sellerId ?? "") === seller.seller_id;
}

function addFurimanePageApiProgressListener(seller, options) {
  if (typeof options.onProgress !== "function") {
    return () => {};
  }

  const listener = { seller, options };
  furimanePageApiProgressListeners.push(listener);

  if (furimaneLatestPageApiProgress && isSameFurimanePageApiSeller(seller, furimaneLatestPageApiProgress)) {
    emitFurimaneApiProgressFromPagePayload(seller, options, furimaneLatestPageApiProgress);
  }

  return () => {
    furimanePageApiProgressListeners = furimanePageApiProgressListeners.filter((current) => current !== listener);
  };
}

function notifyFurimanePageApiProgress(data) {
  furimaneLatestPageApiProgress = data;
  let mappedCount = null;

  for (const listener of furimanePageApiProgressListeners) {
    if (!isSameFurimanePageApiSeller(listener.seller, data)) {
      continue;
    }

    mappedCount = emitFurimaneApiProgressFromPagePayload(listener.seller, listener.options, data);
  }

  return mappedCount;
}

async function waitFurimaneMercariApiPayloadFromPage(seller, options = {}) {
  const removeProgressListener = addFurimanePageApiProgressListener(seller, options);
  const wantsDirectFetch = options.directFetch !== false;

  if (furimanePageApiPayloadRequest?.sellerId === seller.seller_id && (furimanePageApiPayloadRequest.directFetch || !wantsDirectFetch)) {
    return furimanePageApiPayloadRequest.promise.finally(removeProgressListener);
  }

  try {
    throwIfFurimaneResearchAborted(options.signal);
  } catch (error) {
    removeProgressListener();
    throw error;
  }
  try {
    await ensureFurimanePageFetcherInjected();
  } catch (error) {
    removeProgressListener();
    throw error;
  }
  logFurimaneApiFetch("info", "hook_installed", {
    sellerId: seller.seller_id
  });
  try {
    throwIfFurimaneResearchAborted(options.signal);
  } catch (error) {
    removeProgressListener();
    throw error;
  }

  let promise;
  promise = new Promise((resolve, reject) => {
    const requestId = createFurimaneResearchRequestId();
    let timeoutId = null;
    const cancelPageRequest = (reason) => {
      window.postMessage({
        type: FURIMANE_PAGE_FETCH_CANCEL_TYPE,
        requestId,
        reason
      }, window.location.origin);
    };
    const clearPayloadRequest = () => {
      if (furimanePageApiPayloadRequest?.promise === promise) {
        furimanePageApiPayloadRequest = null;
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
        logFurimaneApiFetch("info", "timeout_waiting_page_api", {
          sellerId: seller.seller_id
        });
        reject(new Error("page_api_payload_timeout"));
      }, FURIMANE_PAGE_FETCH_TIMEOUT_MS);
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

      if (!data || data.type !== FURIMANE_PAGE_FETCH_RESPONSE_TYPE || data.requestId !== requestId) {
        return;
      }

      if (data.error) {
        cleanup();
        clearPayloadRequest();
        reject(new Error(data.error));
        return;
      }

      if (data.partial) {
        const mappedCount = notifyFurimanePageApiProgress(data);
        logFurimaneApiFetch("info", "payload_progress_received", {
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

      logFurimaneApiFetch("info", "payload_received", {
        sellerId: seller.seller_id,
        matchedSellerId: data.sellerId ?? null,
        pageLikeIndex: data.pageLikeIndex ?? null,
        mergedCount: data.mergedCount ?? null,
        dedupedCount: data.dedupedCount ?? null,
        totalCount: data.totalCount ?? null
      });

      notifyFurimanePageApiProgress(data);
      clearPayloadRequest();
      resolve(data.payload);
    };

    window.addEventListener("message", handleMessage);
    options.signal?.addEventListener("abort", handleAbort, { once: true });

    window.postMessage({
      type: FURIMANE_PAGE_FETCH_REQUEST_TYPE,
      requestId,
      sellerId: seller.seller_id,
      directFetch: wantsDirectFetch
    }, window.location.origin);
  });

  furimanePageApiPayloadRequest = { sellerId: seller.seller_id, promise, directFetch: wantsDirectFetch };
  return promise;
}

function getFurimaneSellerIdFromCurrentUrl() {
  const pathname = window.location.pathname;
  return (
    pathname.match(FURIMANE_MERCARI_PROFILE_URL_PATTERN)?.[1] ??
    pathname.match(FURIMANE_MERCARI_SHOPS_PROFILE_URL_PATTERN)?.[1] ??
    null
  );
}

function getFurimaneResearchPlatformFromCurrentUrl() {
  const pathname = window.location.pathname;

  if (FURIMANE_MERCARI_SHOPS_PROFILE_URL_PATTERN.test(pathname)) {
    return "mercari_shops";
  }

  if (FURIMANE_MERCARI_PROFILE_URL_PATTERN.test(pathname)) {
    return "mercari";
  }

  return null;
}

function getFurimaneSellerContextFromCurrentPage() {
  const platform = getFurimaneResearchPlatformFromCurrentUrl();
  const sellerId = getFurimaneSellerIdFromCurrentUrl();

  if (!platform || !sellerId) {
    return null;
  }

  return {
    platform,
    seller_id: sellerId,
    seller_name: getFurimaneSellerName(platform),
    seller_url: window.location.href
  };
}

function getFurimaneSellerName(platform = getFurimaneResearchPlatformFromCurrentUrl()) {
  const selectors = platform === "mercari_shops"
    ? [
        'main [data-testid*="shop-name"]',
        'main [data-testid*="shop"] h1',
        'main [data-testid*="shops"] h1',
        'header [data-testid*="shop-name"]',
        "main h1",
        "h1"
      ]
    : [
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

  const suffixPattern = platform === "mercari_shops"
    ? /\s*[-|]\s*繝｡繝ｫ繧ｫ繝ｪShops.*$/
    : /\s*[-|]\s*繝｡繝ｫ繧ｫ繝ｪ.*$/;

  return document.title.replace(suffixPattern, "").trim() || null;
}

function getFurimaneResearchText(element) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function getFurimaneResearchItemIdFromUrl(url) {
  const itemMatch = url.match(/\/item\/([^/?#]+)/);
  const shopProductMatch = url.match(/\/shops\/product\/([^/?#]+)/);

  return itemMatch?.[1] ?? shopProductMatch?.[1] ?? null;
}

function getFurimaneResearchAncestorCandidates(element, maxDepth = 10) {
  const candidates = [];
  let current = element.parentElement;

  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    candidates.push(current);
    current = current.parentElement;
  }

  return candidates;
}

function getUniqueFurimaneResearchElements(elements) {
  const seen = new Set();
  return elements.filter((element) => {
    if (!element || seen.has(element)) {
      return false;
    }

    seen.add(element);
    return true;
  });
}

function getFurimaneResearchListingContainer(link, pricePattern = FURIMANE_PRICE_TEXT_PATTERN) {
  const candidates = getUniqueFurimaneResearchElements([
    link,
    link.closest("li"),
    link.closest("article"),
    link.closest('[data-testid*="item"]'),
    link.closest('[data-testid*="product"]'),
    link.closest("[role='listitem']"),
    link.closest("[data-testid]"),
    link.parentElement,
    link.parentElement?.parentElement,
    ...getFurimaneResearchAncestorCandidates(link)
  ]);

  return candidates.find((candidate) => pricePattern.test(getFurimaneResearchText(candidate))) ?? candidates[0] ?? link;
}

function getUniqueFurimaneResearchTextValues(values) {
  const seen = new Set();

  return values
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

function getFurimaneResearchListingText(link, container) {
  const parent = link.parentElement;
  const grandParent = parent?.parentElement;

  return getUniqueFurimaneResearchTextValues([
    getFurimaneResearchText(container),
    getFurimaneResearchText(parent),
    getFurimaneResearchText(grandParent),
    getFurimaneResearchText(parent?.nextElementSibling),
    getFurimaneResearchText(grandParent?.nextElementSibling),
    link.getAttribute("aria-label"),
    link.querySelector("img")?.getAttribute("alt")
  ]).join(" ");
}

function getFurimaneResearchListingLinkSelector(platform) {
  return platform === "mercari_shops"
    ? 'a[href*="/shops/product/"]'
    : 'a[href*="/item/"]';
}

function getFurimaneResearchListingLinks(platform) {
  return Array.from(document.querySelectorAll(getFurimaneResearchListingLinkSelector(platform)));
}

function getFurimaneResearchThumbnailUrl(link) {
  const image = link.querySelector("img");

  return image?.currentSrc || image?.getAttribute("src") || image?.getAttribute("data-src") || null;
}

function createFurimaneDomCollectDiagnostics(platform) {
  return {
    platform,
    linkSelector: getFurimaneResearchListingLinkSelector(platform),
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

async function waitForFurimaneSellerContextFromCurrentPage(signal) {
  for (let attempt = 0; attempt <= FURIMANE_SELLER_CONTEXT_RETRY_COUNT; attempt += 1) {
    const seller = getFurimaneSellerContextFromCurrentPage();

    if (seller) {
      return seller;
    }

    if (attempt < FURIMANE_SELLER_CONTEXT_RETRY_COUNT) {
      await sleepForFurimaneResearch(FURIMANE_SELLER_CONTEXT_RETRY_DELAY_MS, signal);
    }
  }

  return null;
}

function logFurimaneDomCollectDiagnostics(step, diagnostics) {
  console.log(`${FURIMANE_DOM_FETCH_LOG_PREFIX} ${step}`, diagnostics);
}

function collectFurimaneResearchDomCandidates(platform, siteConfig, diagnostics) {
  const selector = siteConfig?.config?.listingLinkSelectors?.[platform] ?? getFurimaneResearchListingLinkSelector(platform);
  const pricePattern = new RegExp(siteConfig?.config?.pricePattern ?? FURIMANE_PRICE_TEXT_PATTERN.source);
  const maxTextLength = Number(siteConfig?.config?.domTextMaxLength ?? 500);
  const links = Array.from(document.querySelectorAll(selector));
  const candidates = new Map();

  if (diagnostics) {
    diagnostics.linkSelector = selector;
    diagnostics.linkCount = links.length;
    diagnostics.firstLinkHref = links[0]?.href ?? null;
  }

  for (const link of links) {
    const itemUrl = new URL(link.href, window.location.origin).toString();
    const itemId = getFurimaneResearchItemIdFromUrl(itemUrl);

    if (!itemId) {
      if (diagnostics) {
        diagnostics.skippedMissingItemId += 1;
      }
      continue;
    }

    if (candidates.has(itemUrl)) {
      continue;
    }

    const container = getFurimaneResearchListingContainer(link, pricePattern);
    const text = getFurimaneResearchListingText(link, container).slice(0, maxTextLength);

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
      thumbnail_url: getFurimaneResearchThumbnailUrl(link)
    });
  }

  return Array.from(candidates.values());
}

async function clickFurimaneResearchSoldTab(platform, signal) {
  if (platform === "mercari_shops") {
    return;
  }

  const candidates = Array.from(document.querySelectorAll("button, a, [role='tab']"));
  const soldTab = candidates.find((candidate) => {
    const text = getFurimaneResearchText(candidate);
    return text.includes("\u8ca9\u58f2\u6e08\u307f") || text.includes("\u58f2\u308a\u5207\u308c") || text.includes("\u58f2\u5374\u6e08\u307f") || /sold/i.test(text);
  });

  if (!soldTab) {
    return;
  }

  soldTab.click();
  await sleepForFurimaneResearch(1000, signal);
}

function getFurimaneApiAutoMoreButtonText(element) {
  return [
    getFurimaneResearchText(element),
    element.getAttribute?.("aria-label") ?? "",
    element.getAttribute?.("title") ?? ""
  ].join(" ").replace(/\s+/g, " ").trim();
}

function isFurimaneApiAutoMoreButtonDisabled(element) {
  return Boolean(
    element.disabled ||
    element.getAttribute?.("aria-disabled") === "true" ||
    element.getAttribute?.("disabled") !== null
  );
}

function isFurimaneApiAutoMoreButtonVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findFurimaneApiAutoMoreButton() {
  const candidates = Array.from(document.querySelectorAll('main button, main a, main [role="button"]'));

  return candidates.find((candidate) => {
    const text = getFurimaneApiAutoMoreButtonText(candidate);

    if (!text) {
      return false;
    }

    return (
      /もっと\s*見る/.test(text) ||
      /さらに\s*表示/.test(text) ||
      /さらに\s*見る/.test(text) ||
      /load\s*more/i.test(text) ||
      /show\s*more/i.test(text)
    ) && !isFurimaneApiAutoMoreButtonDisabled(candidate) && isFurimaneApiAutoMoreButtonVisible(candidate);
  }) ?? null;
}

function getFurimaneLatestApiProgressForSeller(seller) {
  if (!furimaneLatestPageApiProgress || !isSameFurimanePageApiSeller(seller, furimaneLatestPageApiProgress)) {
    return null;
  }

  return furimaneLatestPageApiProgress;
}

async function waitForFurimaneApiProgressAfter(seller, minPageLikeIndex, signal) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < FURIMANE_API_AUTO_MORE_PROGRESS_TIMEOUT_MS) {
    throwIfFurimaneResearchAborted(signal);

    const progress = getFurimaneLatestApiProgressForSeller(seller);
    const pageLikeIndex = Number(progress?.pageLikeIndex ?? 0);

    if (progress && pageLikeIndex > minPageLikeIndex) {
      return progress;
    }

    await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_POLL_MS, signal);
  }

  return null;
}

function getFurimaneApiProgressRawListings(progress) {
  const payload = progress?.payload;

  if (!isFurimaneResearchObject(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  return payload.data.filter(isFurimaneResearchObject);
}

function getFurimaneApiPeriodDateCandidate(rawListing) {
  if (!isFurimaneResearchObject(rawListing)) {
    return null;
  }

  const listing = getFurimaneApiListingSource(rawListing);

  const confirmedCandidates = [
    ["sold_at", listing.sold_at],
    ["soldAt", listing.soldAt],
    ["purchased_at", listing.purchased_at],
    ["purchasedAt", listing.purchasedAt]
  ];
  // 売却日時が無いAPI取得分は、期間集計用の推定日として作成日時を優先する。
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
    const isoValue = getFurimaneResearchIsoDateValue(value);

    if (isoValue) {
      const timeMs = new Date(isoValue).getTime();

      if (Number.isFinite(timeMs)) {
        return { source, isoValue, timeMs, isEstimated };
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const timeMs = value > 100000000000 ? value : value * 1000;

      if (Number.isFinite(timeMs)) {
        return { source, isoValue: new Date(timeMs).toISOString(), timeMs, isEstimated };
      }
    }
  }

  return null;
}

function getFurimaneApiAutoMorePeriodState(progress) {
  const rawListings = getFurimaneApiProgressRawListings(progress);
  const cutoff = Date.now() - FURIMANE_THREE_MONTHS_MS;
  const sourceCounts = {};
  let newerCount = 0;
  let olderCount = 0;
  let missingDateCount = 0;
  let oldestTimeMs = null;

  for (const rawListing of rawListings) {
    const candidate = getFurimaneApiPeriodDateCandidate(rawListing);

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
  const oldestDaysAgo = oldestTimeMs === null
    ? null
    : Math.floor((Date.now() - oldestTimeMs) / (24 * 60 * 60 * 1000));

  return {
    observedDateCount,
    newerCount,
    olderCount,
    missingDateCount,
    oldestDaysAgo,
    sourceCounts
  };
}

async function runFurimaneApiAutoMoreAssist(seller, signal) {
  let handledPageLikeIndex = 0;
  let clickedCount = 0;

  logFurimaneApiFetch("info", "auto_more_assist_started", {
    maxClicks: FURIMANE_API_AUTO_MORE_MAX_CLICKS,
    progressTimeoutMs: FURIMANE_API_AUTO_MORE_PROGRESS_TIMEOUT_MS
  });

  for (let clickCount = 0; clickCount < FURIMANE_API_AUTO_MORE_MAX_CLICKS; clickCount += 1) {
    logFurimaneApiFetch("info", "auto_more_waiting_progress", {
      clickCount,
      handledPageLikeIndex
    });

    const progress = await waitForFurimaneApiProgressAfter(seller, handledPageLikeIndex, signal);

    if (!progress) {
      logFurimaneApiFetch("info", "auto_more_progress_timeout", {
        clickCount,
        handledPageLikeIndex,
        clickedCount
      });
      return;
    }

    handledPageLikeIndex = Number(progress.pageLikeIndex ?? handledPageLikeIndex);
    const periodState = getFurimaneApiAutoMorePeriodState(progress);
    const totalCount = typeof progress.totalCount === "number" ? progress.totalCount : null;

    logFurimaneApiFetch("info", "auto_more_period_check", {
      pageLikeIndex: handledPageLikeIndex,
      totalCount,
      ...periodState
    });

    await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_CLICK_DELAY_MS, signal);

    const button = findFurimaneApiAutoMoreButton();

    if (!button) {
      logFurimaneApiFetch("info", "auto_more_button_not_found", {
        clickCount,
        pageLikeIndex: handledPageLikeIndex,
        totalCount: progress.totalCount ?? null,
        clickedCount
      });
      return;
    }

    logFurimaneApiFetch("info", "auto_more_button_clicked", {
      clickCount: clickCount + 1,
      pageLikeIndex: handledPageLikeIndex,
      totalCount: progress.totalCount ?? null
    });
    button.click();
    clickedCount += 1;
    await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_AFTER_CLICK_MS, signal);
  }

  logFurimaneApiFetch("info", "auto_more_assist_completed", {
    clickedCount,
    handledPageLikeIndex,
    stop_reason: "safety_limit_clicks_exhausted"
  });
}

async function triggerFurimaneApiFetchAfterWatch(seller, signal, force = false) {
  await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_CLICK_DELAY_MS, signal);

  if (!force && getFurimaneLatestApiProgressForSeller(seller)) {
    logFurimaneApiFetch("info", "api_kickoff_skipped_existing_progress", {
      sellerId: seller.seller_id
    });
    return;
  }

  const button = findFurimaneApiAutoMoreButton();

  if (button) {
    logFurimaneApiFetch("info", "api_kickoff_more_button_clicked", {
      sellerId: seller.seller_id
    });
    button.click();
    await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_AFTER_CLICK_MS, signal);
    return;
  }

  logFurimaneApiFetch("info", "api_kickoff_scroll", {
    sellerId: seller.seller_id
  });
  window.scrollBy({ top: Math.max(window.innerHeight, 600), behavior: "auto" });
  await sleepForFurimaneResearch(FURIMANE_API_AUTO_MORE_AFTER_CLICK_MS, signal);
}

async function warmFurimaneDirectFetchHeadersFromPageApi(seller, options) {
  const warmupPromise = waitFurimaneMercariApiPayloadFromPage(seller, {
    ...options,
    directFetch: false,
    resolveOnFirstPartial: true,
    onProgress: undefined
  });

  await triggerFurimaneApiFetchAfterWatch(seller, options.signal, true);
  await warmupPromise;
}

async function runFurimaneApiAssistAfterWatch(seller, signal) {
  await triggerFurimaneApiFetchAfterWatch(seller, signal);
  await runFurimaneApiAutoMoreAssist(seller, signal);
}

function isFurimaneDirectFetchFailure(error) {
  return error instanceof Error && ["direct_fetch_empty", "direct_fetch_error", "direct_fetch_missing_snapshot"].includes(error.message);
}

function isFurimaneServerAnalyzeFailure(error) {
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

function runFurimaneApiAssistAfterWatchSafe(seller, signal) {
  runFurimaneApiAssistAfterWatch(seller, signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    logFurimaneApiFetch("warn", "auto_more_assist_failed", {
      reason: error instanceof Error ? error.message : String(error)
    });
  });
}

function isFurimaneResearchObject(value) {
  return typeof value === "object" && value !== null;
}

function getFurimaneResearchStringValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getFurimaneResearchNumberValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.replace(/[^\d.-]/g, "");

    if (!normalized) {
      continue;
    }

    const parsed = Number(normalized);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getFurimaneResearchIsoDateValue(...values) {
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

function getFurimaneResearchHttpUrlValue(...values) {
  const rawUrl = getFurimaneResearchStringValue(...values);

  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl, window.location.origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch (_error) {
    return null;
  }
}

function getFurimaneResearchArrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return [];
}

function getNestedFurimaneApiListing(rawListing) {
  if (!rawListing) {
    return null;
  }

  for (const key of ["item", "itemData", "item_data", "itemDetail", "item_detail", "listing", "product"]) {
    const value = rawListing[key];

    if (isFurimaneResearchObject(value)) {
      return value;
    }
  }

  return null;
}

function getFurimaneApiListingSource(rawListing) {
  const nestedListing = getNestedFurimaneApiListing(rawListing);

  return nestedListing
    ? {
        ...rawListing,
        ...nestedListing,
        __furimane_request_status: nestedListing.__furimane_request_status ?? rawListing.__furimane_request_status
      }
    : rawListing;
}

function getFurimaneApiMeta(payload) {
  return isFurimaneResearchObject(payload.meta) ? payload.meta : null;
}

function getFurimaneApiPayloadPagerId(payload) {
  return getFurimaneResearchStringValue(
    payload.next_pager_id,
    payload.nextPagerId,
    payload.pager_id,
    payload.pagerId,
    payload.next_page_token,
    payload.nextPageToken
  );
}

function getFurimaneApiMetaPagerId(payload) {
  const meta = getFurimaneApiMeta(payload);

  if (!meta) {
    return null;
  }

  return getFurimaneResearchStringValue(
    meta.next_pager_id,
    meta.nextPagerId,
    meta.pager_id,
    meta.pagerId,
    meta.next_page_token,
    meta.nextPageToken
  );
}

function getFurimaneApiListingPagerId(rawListing) {
  return getFurimaneResearchStringValue(rawListing.pager_id, rawListing.pagerId);
}

function getFurimaneLastListingPagerId(rawListings) {
  for (let index = rawListings.length - 1; index >= 0; index -= 1) {
    const pagerId = getFurimaneApiListingPagerId(rawListings[index]);

    if (pagerId) {
      return pagerId;
    }
  }

  return null;
}

function getFurimaneApiPagerLocation(payload, rawListings) {
  if (getFurimaneApiMetaPagerId(payload)) {
    return "meta";
  }

  if (getFurimaneApiPayloadPagerId(payload)) {
    return "top_level";
  }

  if (getFurimaneLastListingPagerId(rawListings)) {
    return "listing";
  }

  return "none";
}

function logFurimaneApiPagerDiagnostic(payload, rawListings) {
  if (hasLoggedFurimaneApiPagerDiagnostic) {
    return;
  }

  const meta = getFurimaneApiMeta(payload);
  const firstItem = rawListings[0] ?? null;
  const lastItem = rawListings[rawListings.length - 1] ?? null;

  logFurimaneApiFetch("info", "pager_diagnostic", {
    dataLength: rawListings.length,
    topLevelKeys: Object.keys(payload),
    metaKeys: meta ? Object.keys(meta) : [],
    firstItemKeys: isFurimaneResearchObject(firstItem) ? Object.keys(firstItem) : [],
    lastItemKeys: isFurimaneResearchObject(lastItem) ? Object.keys(lastItem) : [],
    firstItemHasPagerId: Boolean(getFurimaneApiListingPagerId(firstItem ?? {})),
    lastItemHasPagerId: Boolean(getFurimaneApiListingPagerId(lastItem ?? {})),
    pagerIdLocation: getFurimaneApiPagerLocation(payload, rawListings)
  });

  hasLoggedFurimaneApiPagerDiagnostic = true;
}

function logFurimaneApiFetch(_level, step, payload = {}) {
  const isDebugLogEnabled = localStorage.getItem("furimane-research-debug") === "true";
  const isVerboseLogEnabled = localStorage.getItem("furimane-research-verbose") === "true";

  if (FURIMANE_API_VERBOSE_LOG_STEPS.has(step) && !isVerboseLogEnabled) {
    return;
  }

  if (!isDebugLogEnabled && !FURIMANE_API_ALWAYS_LOG_STEPS.has(step)) {
    return;
  }

  console.log(`${FURIMANE_API_FETCH_LOG_PREFIX} ${step}`, payload);
}

async function fetchFurimaneSellerListingsByDom(options = {}) {
  const seller = getFurimaneSellerContextFromCurrentPage();
  const api = window.FurimanagerResearchApi;

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  if (!api?.getSiteConfig || !api?.analyzeResearchData || !api?.buildDomItemForAnalyze) {
    throw new Error("research_api_missing");
  }

  const siteConfig = await api.getSiteConfig(seller.platform, { signal: options.signal });
  await clickFurimaneResearchSoldTab(seller.platform, options.signal);

  const initialDiagnostics = createFurimaneDomCollectDiagnostics(seller.platform);
  let candidates = collectFurimaneResearchDomCandidates(seller.platform, siteConfig, initialDiagnostics);
  const initialItemLinkCount = initialDiagnostics.linkCount;
  let stableCount = 0;

  if (initialItemLinkCount === 0) {
    logFurimaneDomCollectDiagnostics("no_item_links_found", initialDiagnostics);
  }

  if (initialItemLinkCount > 0 && candidates.length === 0) {
    logFurimaneDomCollectDiagnostics("mercari_dom_changed", initialDiagnostics);
    throw new Error("mercari_dom_changed");
  }

  options.onProgress?.(candidates.length);

  for (let attempt = 0; attempt < FURIMANE_MAX_SCROLL_ATTEMPTS; attempt += 1) {
    throwIfFurimaneResearchAborted(options.signal);

    const beforeCount = candidates.length;
    // ページ読み込みを待ってから、現在DOMに描画済みの商品だけを再収集する。
    await sleepForFurimaneResearch(1000, options.signal);

    candidates = collectFurimaneResearchDomCandidates(seller.platform, siteConfig);
    options.onProgress?.(candidates.length);

    stableCount = candidates.length === beforeCount ? stableCount + 1 : 0;

    if (stableCount >= FURIMANE_STABLE_SCROLL_LIMIT) {
      break;
    }
  }

  const maxTextLength = Number(siteConfig?.config?.domTextMaxLength ?? 500);
  const domItems = candidates
    .slice(0, Number(siteConfig?.config?.maxItems ?? 1000))
    .map((candidate) => api.buildDomItemForAnalyze(candidate, maxTextLength));
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

async function analyzeFurimanePayloadViaServer(apiPayload, seller, options) {
  const api = window.FurimanagerResearchApi;

  if (!api?.trimRawItemsForAnalyze || !api?.analyzeResearchData) {
    throw new Error("research_api_missing");
  }

  if (!isFurimaneResearchObject(apiPayload) || !Array.isArray(apiPayload.data)) {
    throw new Error("mercari_api_invalid_response");
  }

  const rawItems = api.trimRawItemsForAnalyze(apiPayload.data.filter(isFurimaneResearchObject));
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


async function fetchFurimaneSellerListingsByApiPoc(options = {}) {
  const seller = await waitForFurimaneSellerContextFromCurrentPage(options.signal);

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  if (seller.platform !== "mercari") {
    throw new Error("unsupported_api_platform");
  }

  logFurimaneApiFetch("info", "api_mode_entered", {
    sellerId: seller.seller_id,
    strategy: options.strategy ?? null
  });

  let apiPayloadPromise = waitFurimaneMercariApiPayloadFromPage(seller, options);
  const shouldRunPageAssist = options.directFetch === false;

  if (shouldRunPageAssist) {
    runFurimaneApiAssistAfterWatchSafe(seller, options.signal);
  }

  let apiPayload;

  try {
    apiPayload = await apiPayloadPromise;
  } catch (error) {
    if (!isFurimaneDirectFetchFailure(error) || options.directFetch === false) {
      throw error;
    }

    logFurimaneApiFetch("warn", "direct_fetch_failed_warm_page_api", {
      reason: error instanceof Error ? error.message : String(error)
    });

    try {
      await warmFurimaneDirectFetchHeadersFromPageApi(seller, options);
    } catch (warmupError) {
      logFurimaneApiFetch("warn", "direct_fetch_warmup_failed_retry_page_api", {
        reason: warmupError instanceof Error ? warmupError.message : String(warmupError)
      });
      apiPayloadPromise = waitFurimaneMercariApiPayloadFromPage(seller, { ...options, directFetch: false });
      runFurimaneApiAssistAfterWatchSafe(seller, options.signal);
      apiPayload = await apiPayloadPromise;
      return analyzeFurimanePayloadViaServer(apiPayload, seller, options);
    }

    logFurimaneApiFetch("info", "direct_fetch_retry_after_warmup", {
      sellerId: seller.seller_id
    });
    try {
      apiPayload = await waitFurimaneMercariApiPayloadFromPage(seller, options);
    } catch (retryError) {
      if (!isFurimaneDirectFetchFailure(retryError)) {
        throw retryError;
      }

      logFurimaneApiFetch("warn", "direct_fetch_failed_retry_page_api", {
        reason: retryError instanceof Error ? retryError.message : String(retryError)
      });
      apiPayloadPromise = waitFurimaneMercariApiPayloadFromPage(seller, { ...options, directFetch: false });
      runFurimaneApiAssistAfterWatchSafe(seller, options.signal);
      apiPayload = await apiPayloadPromise;
    }
  }

  return analyzeFurimanePayloadViaServer(apiPayload, seller, options);
}

async function fetchFurimaneSellerResearchData(options = {}) {
  const seller = await waitForFurimaneSellerContextFromCurrentPage(options.signal);

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  const strategy = options.strategy ?? "api";
  let analyzed;
  let resolvedStrategy = strategy;

  if (strategy === "api") {
    try {
      analyzed = await fetchFurimaneSellerListingsByApiPoc(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (isFurimaneServerAnalyzeFailure(error)) {
        throw error;
      }

      logFurimaneApiFetch("warn", "fallback_to_dom", {
        reason: error instanceof Error ? error.message : String(error)
      });
      options.onProgress?.(0, {
        totalCount: 0,
        pageLikeIndex: null,
        partial: false,
        phase: "dom_fallback"
      });
      analyzed = await fetchFurimaneSellerListingsByDom(options);
      resolvedStrategy = "dom";
    }
  } else {
    logFurimaneApiFetch("info", "api_branch_not_entered", {
      sellerId: seller.seller_id,
      strategy
    });
    analyzed = await fetchFurimaneSellerListingsByDom(options);
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

async function scrapeFurimaneSellerPageSafe(options = {}) {
  try {
    return await fetchFurimaneSellerResearchData(options);
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
  getSellerIdFromCurrentUrl: getFurimaneSellerIdFromCurrentUrl,
  getPlatformFromCurrentUrl: getFurimaneResearchPlatformFromCurrentUrl,
  getSellerContextFromCurrentPage: getFurimaneSellerContextFromCurrentPage,
  fetchSellerListingsByDom: fetchFurimaneSellerListingsByDom,
  fetchSellerListingsByApi: fetchFurimaneSellerListingsByApiPoc,
  fetchSellerResearchData: fetchFurimaneSellerResearchData,
  scrapeSellerPage: scrapeFurimaneSellerPageSafe
};

try {
  const seller = getFurimaneSellerContextFromCurrentPage();

  if (seller?.platform === "mercari") {
    waitFurimaneMercariApiPayloadFromPage(seller, { directFetch: false }).catch(() => {
      // api mode flow will fallback to DOM if no page API payload arrives.
    });
  }
} catch (_error) {
  // Keep the DOM path untouched if the early PoC watcher cannot start.
}
