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
const FURIMANE_PRICE_TEXT_TAIL_PATTERN = /(?:[\u00a5\uffe5]\s*[\d,]+|[\d,]+\s*\u5186).*$/;
const FURIMANE_PRICE_TEXT_PREFIX_PATTERN = /^(?:SOLD\s*)?(?:[\u00a5\uffe5]\s*[\d,]+|[\d,]+\s*\u5186)\s*/i;
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

  const rawListings = apiPayload.data.filter(isFurimaneResearchObject);
  const listings = normalizeFurimaneFetchedListings(
    mapFurimaneApiListingsToResearchListings(rawListings, seller.platform),
    seller.platform
  );
  const totalCount = typeof data.totalCount === "number" ? data.totalCount : listings.length;

  logFurimaneApiPeriodAnalysis(listings, data.partial ? "page_api_progress" : "page_api_done");
  logFurimaneApiPeriodDiagnostics(rawListings, listings);

  options.onProgress?.(listings.length, {
    listings,
    totalCount,
    pageLikeIndex: data.pageLikeIndex ?? null,
    partial: Boolean(data.partial),
    phase: data.partial ? "api_progress" : "api_done"
  });

  return listings.length;
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

function parseFurimaneResearchPrice(text) {
  const match = text.match(FURIMANE_PRICE_TEXT_PATTERN);

  if (!match) {
    return null;
  }

  const amount = match[1] ?? match[2];
  const price = Number(amount.replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function parseFurimaneResearchSoldAt(text) {
  const today = new Date();
  const fullDateMatch = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);

  if (fullDateMatch) {
    const [, year, month, day] = fullDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  }

  const shortDateMatch = text.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})(?:\D|$)/);

  if (shortDateMatch) {
    const [, month, day] = shortDateMatch;
    const parsed = new Date(today.getFullYear(), Number(month) - 1, Number(day));

    if (parsed.getTime() > today.getTime() + 24 * 60 * 60 * 1000) {
      parsed.setFullYear(parsed.getFullYear() - 1);
    }

    return parsed.toISOString();
  }

  const daysAgoMatch = text.match(/(\d+)\s*\u65e5\u524d/);

  if (daysAgoMatch) {
    const parsed = new Date(today);
    parsed.setDate(parsed.getDate() - Number(daysAgoMatch[1]));
    return parsed.toISOString();
  }

  if (text.includes("\u6628\u65e5")) {
    const parsed = new Date(today);
    parsed.setDate(parsed.getDate() - 1);
    return parsed.toISOString();
  }

  if (text.includes("\u4eca\u65e5") || text.includes("\u6642\u9593\u524d") || text.includes("\u5206\u524d")) {
    return today.toISOString();
  }

  return null;
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

function getFurimaneResearchListingContainer(link) {
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

  return candidates.find((candidate) => parseFurimaneResearchPrice(getFurimaneResearchText(candidate)) !== null) ?? candidates[0] ?? link;
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

function getFurimaneResearchTitle(link, container, listingText) {
  const imageAlt = link.querySelector("img")?.getAttribute("alt")?.trim();
  const normalizedImageAlt = imageAlt?.replace(/^Image:\s*/i, "").trim();

  if (normalizedImageAlt && normalizedImageAlt !== "縺ｮ繧ｵ繝繝阪う繝ｫ") {
    return normalizedImageAlt.replace(FURIMANE_PRICE_TEXT_TAIL_PATTERN, "").trim();
  }

  const ariaLabel = link.getAttribute("aria-label")?.trim();

  if (ariaLabel) {
    return ariaLabel.replace(FURIMANE_PRICE_TEXT_TAIL_PATTERN, "").trim();
  }

  const text = listingText || getFurimaneResearchText(container);
  const candidates = [
    text.replace(FURIMANE_PRICE_TEXT_PREFIX_PATTERN, "").trim(),
    text.replace(FURIMANE_PRICE_TEXT_TAIL_PATTERN, "").trim()
  ];

  const lines = text
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return [...candidates, ...lines].find((line) => {
    const normalized = line.replace(/^Image:\s*/i, "").replace(FURIMANE_PRICE_TEXT_PREFIX_PATTERN, "").trim();

    return normalized && !/^(SOLD|[¥￥]?\s*[\d,]+|[\d,]+\s*円|雋ｩ螢ｲ荳ｭ|譁ｰ逹鬆・縺吶∋縺ｦ縺ｮ蝠・・ｽ・ｽ)$/i.test(normalized);
  }) ?? "";
}

function getFurimaneResearchListingLinkSelector(platform) {
  return platform === "mercari_shops"
    ? 'a[href*="/shops/product/"]'
    : 'a[href*="/item/"]';
}

function getFurimaneResearchListingLinks(platform) {
  return Array.from(document.querySelectorAll(getFurimaneResearchListingLinkSelector(platform)));
}

function getFurimaneResearchListingStatus(text, platform) {
  if (/sold/i.test(text) || text.includes("\u58f2\u308a\u5207\u308c") || text.includes("\u58f2\u5374\u6e08\u307f")) {
    return "sold";
  }

  return "active";
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

function collectFurimaneResearchListings(platform, diagnostics) {
  const links = getFurimaneResearchListingLinks(platform);
  const listings = new Map();

  if (diagnostics) {
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

    if (listings.has(itemId)) {
      continue;
    }

    const container = getFurimaneResearchListingContainer(link);
    const text = getFurimaneResearchListingText(link, container);
    const price = parseFurimaneResearchPrice(text);
    const title = getFurimaneResearchTitle(link, container, text);

    if (diagnostics && !diagnostics.firstContainerTag) {
      diagnostics.firstContainerTag = container.tagName?.toLowerCase() ?? null;
      diagnostics.firstContainerTextLength = text.length;
      diagnostics.firstContainerTextSample = text.slice(0, 120);
    }

    if (price === null && diagnostics) {
      diagnostics.skippedMissingPrice += 1;
    }

    if (!title && diagnostics) {
      diagnostics.skippedMissingTitle += 1;
    }

    if (!title || price === null) {
      continue;
    }

    if (diagnostics) {
      diagnostics.acceptedCount += 1;
    }

    const soldAt = parseFurimaneResearchSoldAt(text);

    listings.set(itemId, {
      item_id: itemId,
      title,
      price,
      sold_at: soldAt,
      period_date: soldAt,
      period_date_source: soldAt ? "sold_at" : null,
      period_date_estimated: false,
      thumbnail_url: getFurimaneResearchThumbnailUrl(link),
      item_url: itemUrl,
      status: getFurimaneResearchListingStatus(text, platform),
      platform: platform ?? "mercari"
    });
  }

  return Array.from(listings.values());
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

function filterFurimaneResearchListingsWithinThreeMonths(listings) {
  const cutoff = Date.now() - FURIMANE_THREE_MONTHS_MS;

  return listings.filter((listing) => {
    const periodTime = getFurimaneListingPeriodDateMs(listing);

    if (periodTime === null) {
      return true;
    }

    return periodTime >= cutoff;
  });
}

function normalizeFurimaneFetchedListings(listings, platform) {
  return filterFurimaneResearchListingsWithinThreeMonths(listings)
    .map((listing) => ({
      ...listing,
      platform: listing.platform ?? platform
    }));
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

function getFurimaneApiThumbnailUrl(rawListing) {
  const listing = getFurimaneApiListingSource(rawListing);
  const thumbnails = getFurimaneResearchArrayValue(listing.thumbnails, listing.photos, listing.images);

  for (const thumbnail of thumbnails) {
    const url = typeof thumbnail === "string"
      ? getFurimaneResearchHttpUrlValue(thumbnail)
      : isFurimaneResearchObject(thumbnail)
        ? getFurimaneResearchHttpUrlValue(
            thumbnail.url,
            thumbnail.src,
            thumbnail.thumbnail_url,
            thumbnail.thumbnailUrl
          )
        : null;

    if (url) {
      return url;
    }
  }

  return getFurimaneResearchHttpUrlValue(
    listing.thumbnail_url,
    listing.thumbnailUrl,
    listing.image_url,
    listing.imageUrl,
    listing.photo_url,
    listing.photoUrl
  );
}

function getFurimaneApiItemUrl(itemId) {
  return itemId ? `https://jp.mercari.com/item/${encodeURIComponent(itemId)}` : null;
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

function getFurimaneListingPeriodDateMs(listing) {
  const value = listing.period_date || listing.sold_at;

  if (!value) {
    return null;
  }

  const timeMs = new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

function getFurimaneListingPeriodKeyForLog(listing) {
  const timeMs = getFurimaneListingPeriodDateMs(listing);

  if (timeMs === null) {
    return null;
  }

  const daysAgo = Math.floor((Date.now() - timeMs) / (24 * 60 * 60 * 1000));

  if (daysAgo < 0 || daysAgo > 90) {
    return null;
  }

  if (daysAgo <= 30) {
    return "period_0_30_count";
  }

  if (daysAgo <= 60) {
    return "period_31_60_count";
  }

  return "period_61_90_count";
}

function getFurimanePeriodAnalysisLogPayload(listings, stopReason) {
  const sourceCounts = {};
  let oldestTimeMs = null;
  let period030Count = 0;
  let period3160Count = 0;
  let period6190Count = 0;
  let outOfRangeCount = 0;

  for (const listing of listings) {
    const timeMs = getFurimaneListingPeriodDateMs(listing);

    if (timeMs === null) {
      continue;
    }

    const source = listing.period_date_source || (listing.sold_at ? "sold_at" : "unknown");
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    oldestTimeMs = oldestTimeMs === null ? timeMs : Math.min(oldestTimeMs, timeMs);

    const periodKey = getFurimaneListingPeriodKeyForLog(listing);

    if (periodKey === "period_0_30_count") {
      period030Count += 1;
    } else if (periodKey === "period_31_60_count") {
      period3160Count += 1;
    } else if (periodKey === "period_61_90_count") {
      period6190Count += 1;
    } else {
      outOfRangeCount += 1;
    }
  }

  const sourceEntries = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  const oldestItemDaysAgo = oldestTimeMs === null
    ? null
    : Math.floor((Date.now() - oldestTimeMs) / (24 * 60 * 60 * 1000));

  return {
    period_source_field: sourceEntries.length === 0 ? "unavailable" : sourceEntries.length === 1 ? sourceEntries[0][0] : "mixed",
    sourceCounts,
    oldest_item_days_ago: oldestItemDaysAgo,
    reached_90_days: oldestItemDaysAgo !== null && oldestItemDaysAgo >= 90,
    stop_reason: stopReason,
    totalFetched: listings.length,
    period_0_30_count: period030Count,
    period_31_60_count: period3160Count,
    period_61_90_count: period6190Count,
    out_of_range_count: outOfRangeCount
  };
}

function logFurimaneApiPeriodAnalysis(listings, stopReason) {
  logFurimaneApiFetch("info", "period_analysis", getFurimanePeriodAnalysisLogPayload(listings, stopReason));
}

function getFurimaneTimeMsFromDateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }

  if (typeof value !== "string") {
    return null;
  }

  const timeMs = new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

function getFurimanePeriodKeyFromDateValue(value) {
  const timeMs = getFurimaneTimeMsFromDateValue(value);

  if (timeMs === null) {
    return null;
  }

  const daysAgo = Math.floor((Date.now() - timeMs) / (24 * 60 * 60 * 1000));

  if (daysAgo < 0 || daysAgo > 90) {
    return "out_of_range";
  }

  if (daysAgo <= 30) {
    return "period_0_30";
  }

  if (daysAgo <= 60) {
    return "period_31_60";
  }

  return "period_61_90";
}

function getFurimaneDaysAgoFromDateValue(value) {
  const timeMs = getFurimaneTimeMsFromDateValue(value);
  return timeMs === null ? null : Math.floor((Date.now() - timeMs) / (24 * 60 * 60 * 1000));
}

function createFurimanePeriodRevenueSummary() {
  return {
    period_0_30: { count: 0, revenue: 0 },
    period_31_60: { count: 0, revenue: 0 },
    period_61_90: { count: 0, revenue: 0 },
    out_of_range: { count: 0, revenue: 0 },
    missing: { count: 0, revenue: 0 }
  };
}

function addFurimanePeriodRevenue(summary, periodKey, price) {
  const bucket = periodKey === "period_0_30" || periodKey === "period_31_60" || periodKey === "period_61_90" || periodKey === "out_of_range"
    ? periodKey
    : "missing";
  const revenue = Number.isFinite(price) ? Number(price) : 0;

  summary[bucket].count += 1;
  summary[bucket].revenue += revenue;
}

function getFurimaneRawApiItemPrice(rawListing) {
  const listing = getFurimaneApiListingSource(rawListing);
  return getFurimaneResearchNumberValue(listing.price, listing.amount, listing.sold_price, listing.soldPrice);
}

function getFurimaneRawApiItemTitle(rawListing) {
  const listing = getFurimaneApiListingSource(rawListing);
  return getFurimaneResearchStringValue(listing.name, listing.title, listing.item_name, listing.itemName);
}

function getFurimaneRawApiItemId(rawListing) {
  const listing = getFurimaneApiListingSource(rawListing);
  return getFurimaneResearchStringValue(listing.id, listing.item_id, listing.itemId);
}

function getFurimaneRawApiDateValue(rawListing, keys) {
  const listing = getFurimaneApiListingSource(rawListing);

  for (const key of keys) {
    if (listing[key] !== undefined && listing[key] !== null) {
      return listing[key];
    }
  }

  return null;
}

function getFurimaneRawApiStatus(rawListing) {
  const listing = getFurimaneApiListingSource(rawListing);
  return getFurimaneResearchStringValue(listing.status, listing.item_status, listing.itemStatus);
}

function summarizeFurimaneRawApiItemsByDateField(rawListings, keys) {
  const summary = createFurimanePeriodRevenueSummary();

  for (const rawListing of rawListings) {
    const price = getFurimaneRawApiItemPrice(rawListing);
    const dateValue = getFurimaneRawApiDateValue(rawListing, keys);
    addFurimanePeriodRevenue(summary, getFurimanePeriodKeyFromDateValue(dateValue), price);
  }

  return summary;
}

function summarizeFurimaneMappedItemsByCurrentPeriod(listings) {
  const summary = createFurimanePeriodRevenueSummary();

  for (const listing of listings) {
    addFurimanePeriodRevenue(summary, getFurimaneCurrentPeriodBucketForListing(listing), listing.price);
  }

  return summary;
}

function getFurimaneCurrentPeriodBucketForListing(listing) {
  const logKey = getFurimaneListingPeriodKeyForLog(listing);

  if (logKey === "period_0_30_count") {
    return "period_0_30";
  }

  if (logKey === "period_31_60_count") {
    return "period_31_60";
  }

  if (logKey === "period_61_90_count") {
    return "period_61_90";
  }

  return getFurimaneListingPeriodDateMs(listing) === null ? null : "out_of_range";
}

function normalizeFurimaneApiStatusForSummary(status) {
  return (status || "unknown").trim().toLowerCase() || "unknown";
}

function summarizeFurimaneMappedItemsByStatus(listings) {
  const summaryByStatus = {};

  for (const listing of listings) {
    const status = normalizeFurimaneApiStatusForSummary(listing.status);

    if (!summaryByStatus[status]) {
      summaryByStatus[status] = {
        total: { count: 0, revenue: 0 },
        periods: createFurimanePeriodRevenueSummary()
      };
    }

    const revenue = Number.isFinite(listing.price) ? Number(listing.price) : 0;
    summaryByStatus[status].total.count += 1;
    summaryByStatus[status].total.revenue += revenue;
    addFurimanePeriodRevenue(summaryByStatus[status].periods, getFurimaneCurrentPeriodBucketForListing(listing), listing.price);
  }

  return summaryByStatus;
}

function logFurimaneApiPeriodDiagnostics(rawListings, listings) {
  const isDebugLogEnabled = localStorage.getItem("furimane-research-debug") === "true";

  if (!isDebugLogEnabled) {
    return;
  }

  const mappedByItemId = new Map(listings.map((listing) => [listing.item_id, listing]));
  const sample = rawListings.slice(0, 20).map((rawListing) => {
    const itemId = getFurimaneRawApiItemId(rawListing);
    const mapped = itemId ? mappedByItemId.get(itemId) : null;

    return {
      item_id: itemId,
      title: getFurimaneRawApiItemTitle(rawListing),
      price: getFurimaneRawApiItemPrice(rawListing),
      status: getFurimaneRawApiStatus(rawListing),
      created: getFurimaneRawApiDateValue(rawListing, ["created", "created_at", "createdAt"]),
      created_type: typeof getFurimaneRawApiDateValue(rawListing, ["created", "created_at", "createdAt"]),
      updated: getFurimaneRawApiDateValue(rawListing, ["updated", "updated_at", "updatedAt"]),
      updated_type: typeof getFurimaneRawApiDateValue(rawListing, ["updated", "updated_at", "updatedAt"]),
      has_sold_at: getFurimaneRawApiDateValue(rawListing, ["sold_at", "soldAt"]) !== null,
      has_purchased_at: getFurimaneRawApiDateValue(rawListing, ["purchased_at", "purchasedAt"]) !== null,
      period_date: mapped?.period_date ?? null,
      period_source_field: mapped?.period_date_source ?? null,
      daysAgo: mapped ? getFurimaneDaysAgoFromDateValue(mapped.period_date || mapped.sold_at) : null,
      assignedPeriod: mapped ? getFurimaneListingPeriodKeyForLog(mapped) : null
    };
  });

  logFurimaneApiFetch("info", "period_item_diagnostics", {
    sampleLimit: 20,
    totalRawItems: rawListings.length,
    sample
  });

  logFurimaneApiFetch("info", "period_basis_compare_summary", {
    current_period_date: summarizeFurimaneMappedItemsByCurrentPeriod(listings),
    created: summarizeFurimaneRawApiItemsByDateField(rawListings, ["created", "created_at", "createdAt"]),
    updated: summarizeFurimaneRawApiItemsByDateField(rawListings, ["updated", "updated_at", "updatedAt"]),
    sold_at: summarizeFurimaneRawApiItemsByDateField(rawListings, ["sold_at", "soldAt"]),
    purchased_at: summarizeFurimaneRawApiItemsByDateField(rawListings, ["purchased_at", "purchasedAt"])
  });

  logFurimaneApiFetch("info", "period_status_compare_summary", {
    current_period_date: summarizeFurimaneMappedItemsByStatus(listings)
  });
}

function getFurimaneApiListingStatus(rawListing, soldAt) {
  const listing = getFurimaneApiListingSource(rawListing);
  const status = getFurimaneResearchStringValue(
    listing.status,
    listing.item_status,
    listing.itemStatus
  );

  if (status) {
    return status;
  }

  const requestStatus = getFurimaneResearchStringValue(listing.__furimane_request_status);

  if (requestStatus) {
    const normalizedRequestStatus = requestStatus.toLowerCase();

    if (normalizedRequestStatus.includes("sold_out")) {
      return "sold_out";
    }

    if (normalizedRequestStatus.includes("trading")) {
      return "trading";
    }

    if (normalizedRequestStatus.includes("sold") || normalizedRequestStatus.includes("complete")) {
      return "sold";
    }
  }

  return soldAt ? "sold" : "active";
}

function mapFurimaneApiListingToResearchListing(rawListing, platform) {
  if (!isFurimaneResearchObject(rawListing)) {
    return null;
  }

  const listing = getFurimaneApiListingSource(rawListing);

  const itemId = getFurimaneResearchStringValue(
    listing.id,
    listing.item_id,
    listing.itemId,
    getFurimaneResearchItemIdFromUrl(
      getFurimaneResearchHttpUrlValue(
        listing.item_url,
        listing.itemUrl,
        listing.url,
        listing.webUrl
      ) ?? ""
    )
  );
  const title = getFurimaneResearchStringValue(
    listing.name,
    listing.title,
    listing.item_name,
    listing.itemName
  );
  const price = getFurimaneResearchNumberValue(
    listing.price,
    listing.amount,
    listing.sold_price,
    listing.soldPrice
  );

  if (!itemId || !title || price === null) {
    return null;
  }

  const seller = isFurimaneResearchObject(listing.seller) ? listing.seller : null;
  const soldAt = getFurimaneResearchIsoDateValue(
    listing.sold_at,
    listing.soldAt,
    listing.purchased_at,
    listing.purchasedAt
  );
  const periodDate = getFurimaneApiPeriodDateCandidate(rawListing);
  const itemUrl = getFurimaneResearchHttpUrlValue(
    listing.item_url,
    listing.itemUrl,
    listing.url,
    listing.webUrl,
    getFurimaneApiItemUrl(itemId)
  );

  return {
    item_id: itemId,
    title,
    price,
    sold_at: soldAt,
    period_date: periodDate?.isoValue ?? soldAt,
    period_date_source: periodDate?.source ?? (soldAt ? "sold_at" : null),
    period_date_estimated: periodDate?.isEstimated ?? false,
    thumbnail_url: getFurimaneApiThumbnailUrl(rawListing),
    item_url: itemUrl,
    seller_id: getFurimaneResearchStringValue(listing.seller_id, listing.sellerId, seller?.id),
    seller_name: getFurimaneResearchStringValue(listing.seller_name, listing.sellerName, seller?.name),
    status: getFurimaneApiListingStatus(rawListing, soldAt),
    platform
  };
}

function mapFurimaneApiListingsToResearchListings(rawListings, platform) {
  if (!Array.isArray(rawListings)) {
    return [];
  }

  const listings = [];
  const itemIds = new Set();

  for (const rawListing of rawListings) {
    const mappedListing = mapFurimaneApiListingToResearchListing(rawListing, platform);

    if (!mappedListing || itemIds.has(mappedListing.item_id)) {
      continue;
    }

    itemIds.add(mappedListing.item_id);
    listings.push(mappedListing);
  }

  return listings;
}

async function fetchFurimaneSellerListingsByDom(options = {}) {
  const seller = getFurimaneSellerContextFromCurrentPage();

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  await clickFurimaneResearchSoldTab(seller.platform, options.signal);

  const initialDiagnostics = createFurimaneDomCollectDiagnostics(seller.platform);
  let listings = collectFurimaneResearchListings(seller.platform, initialDiagnostics);
  const initialItemLinkCount = initialDiagnostics.linkCount;
  let stableCount = 0;

  if (initialItemLinkCount === 0) {
    logFurimaneDomCollectDiagnostics("no_item_links_found", initialDiagnostics);
  }

  if (initialItemLinkCount > 0 && listings.length === 0) {
    logFurimaneDomCollectDiagnostics("mercari_dom_changed", initialDiagnostics);
    throw new Error("mercari_dom_changed");
  }

  options.onProgress?.(listings.length);

  for (let attempt = 0; attempt < FURIMANE_MAX_SCROLL_ATTEMPTS; attempt += 1) {
    throwIfFurimaneResearchAborted(options.signal);

    const beforeCount = listings.length;
    // 隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｫ繝夲ｿｽE繧ｸ菴咲ｽｮ繧貞･ｪ繧上↑縺・・ｽ・ｽ繧√∵僑蠑ｵ蛛ｴ縺九ｉ閾ｪ蜍輔せ繧ｯ繝ｭ繝ｼ繝ｫ縺励↑縺・・ｽ・ｽE    // 縺薙％縺ｧ縺ｯ迴ｾ蝨ｨDOM縺ｫ謠冗判貂医∩縺ｮ蝠・・ｽ・ｽ縺縺代ｒ螳会ｿｽE縺ｫ蜀榊庶髮・・ｽ・ｽ繧九・    await sleepForFurimaneResearch(1000, options.signal);

    listings = collectFurimaneResearchListings(seller.platform);
    options.onProgress?.(listings.length);

    stableCount = listings.length === beforeCount ? stableCount + 1 : 0;

    if (stableCount >= FURIMANE_STABLE_SCROLL_LIMIT) {
      break;
    }
  }

  return normalizeFurimaneFetchedListings(listings, seller.platform);
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
      return normalizeFurimaneApiPayloadToResearchListings(apiPayload, seller, options);
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

  return normalizeFurimaneApiPayloadToResearchListings(apiPayload, seller, options);
}

function normalizeFurimaneApiPayloadToResearchListings(apiPayload, seller, options) {
  if (!isFurimaneResearchObject(apiPayload) || !Array.isArray(apiPayload.data)) {
    throw new Error("mercari_api_invalid_response");
  }

  const rawListings = apiPayload.data.filter(isFurimaneResearchObject);
  const listings = mapFurimaneApiListingsToResearchListings(rawListings, seller.platform);
  const normalizedListings = normalizeFurimaneFetchedListings(listings, seller.platform);

  if (rawListings.length > 0 && normalizedListings.length === 0) {
    throw new Error("mercari_api_mapping_empty");
  }

  logFurimaneApiPagerDiagnostic(apiPayload, rawListings);
  logFurimaneApiPeriodAnalysis(normalizedListings, "page_api_payload_received");
  logFurimaneApiPeriodDiagnostics(rawListings, normalizedListings);
  options.onProgress?.(normalizedListings.length, {
    totalCount: normalizedListings.length,
    pageLikeIndex: null,
    partial: false,
    phase: "api_done"
  });

  logFurimaneApiFetch("info", "mappedCount", {
    mappedCount: normalizedListings.length
  });

  return normalizedListings;
}

async function fetchFurimaneSellerResearchData(options = {}) {
  const seller = await waitForFurimaneSellerContextFromCurrentPage(options.signal);

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  const strategy = options.strategy ?? "api";
  let listings;
  let resolvedStrategy = strategy;

  if (strategy === "api") {
    try {
      listings = await fetchFurimaneSellerListingsByApiPoc(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
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
      listings = await fetchFurimaneSellerListingsByDom(options);
      resolvedStrategy = "dom";
    }
  } else {
    logFurimaneApiFetch("info", "api_branch_not_entered", {
      sellerId: seller.seller_id,
      strategy
    });
    listings = await fetchFurimaneSellerListingsByDom(options);
  }

  return {
    seller,
    listings,
    strategy: resolvedStrategy
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

    throw new Error("scraping_failed");
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
