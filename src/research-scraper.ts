type ResearchPlatform = "mercari" | "mercari_shops";
type ResearchFetchStrategy = "dom" | "api";

type ResearchSellerContext = {
  platform: ResearchPlatform;
  seller_id: string;
  seller_name: string | null;
  seller_url: string;
};

type ResearchListingRecord = {
  item_id: string;
  title: string;
  price: number;
  sold_at: string | null;
  period_date?: string | null;
  period_date_source?: string | null;
  period_date_estimated?: boolean;
  thumbnail_url: string | null;
  item_url: string | null;
  seller_id?: string;
  seller_name?: string | null;
  status?: string;
  platform?: ResearchPlatform;
};

type ResearchProgressDetails = {
  listings?: ResearchListingRecord[];
  totalCount?: number | null;
  pageLikeIndex?: number | null;
  partial?: boolean;
  phase?: "api_progress" | "api_done" | "dom_fallback";
};

type ResearchFetchOptions = {
  signal?: AbortSignal;
  onProgress?: (count: number, details?: ResearchProgressDetails) => void;
  strategy?: ResearchFetchStrategy;
  directFetch?: boolean;
  resolveOnFirstPartial?: boolean;
};

type ResearchFetchResult = {
  seller: ResearchSellerContext;
  listings: ResearchListingRecord[];
  strategy: ResearchFetchStrategy;
};

type ResearchApiRawListing = Record<string, unknown>;

type ApiPeriodDateCandidate = {
  source: string;
  isoValue: string;
  timeMs: number;
  isEstimated: boolean;
};

type PageContextFetchResponse = {
  type: string;
  requestId: string;
  ok: boolean;
  status?: number;
  sellerId?: string;
  pageLikeIndex?: number;
  mergedCount?: number;
  dedupedCount?: number;
  totalCount?: number;
  partial?: boolean;
  payload?: unknown;
  error?: string;
  jsonError?: string;
};

declare const chrome: {
  runtime?: {
    getURL?: (path: string) => string;
  };
} | undefined;

declare global {
  interface Window {
    FurimanagerResearchScraper?: {
      getSellerIdFromCurrentUrl: () => string | null;
      getPlatformFromCurrentUrl: () => ResearchPlatform | null;
      getSellerContextFromCurrentPage: () => ResearchSellerContext | null;
      fetchSellerListingsByDom: (options?: ResearchFetchOptions) => Promise<ResearchListingRecord[]>;
      fetchSellerListingsByApi: (options?: ResearchFetchOptions) => Promise<ResearchListingRecord[]>;
      fetchSellerResearchData: (options?: ResearchFetchOptions) => Promise<ResearchFetchResult>;
      scrapeSellerPage: (options?: ResearchFetchOptions) => Promise<ResearchFetchResult>;
    };
  }
}

const MERCARI_PROFILE_URL_PATTERN = /\/user\/profile\/([^/?#]+)/;
const MERCARI_SHOPS_PROFILE_URL_PATTERN = /\/shops\/profile\/([^/?#]+)/;
const MAX_SCROLL_ATTEMPTS = 40;
const STABLE_SCROLL_LIMIT = 3;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const API_FETCH_LOG_PREFIX = "[furimane-research][api-fetch]";
const PAGE_FETCHER_SCRIPT_ID = "furimane-research-page-fetcher";
const PAGE_FETCHER_SCRIPT_PATH = "src/research-page-fetcher.js";
const PAGE_FETCH_REQUEST_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_REQUEST";
const PAGE_FETCH_RESPONSE_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_RESPONSE";
const PAGE_FETCH_CANCEL_TYPE = "FURIMANE_RESEARCH_PAGE_API_WATCH_CANCEL";
const PAGE_FETCH_TIMEOUT_MS = 30000;
const DOM_FETCH_LOG_PREFIX = "[furimane-research][dom-fetch]";
const PRICE_TEXT_PATTERN = /(?:[\u00a5\uffe5]\s*([\d,]+)|([\d,]+)\s*\u5186)/;
const PRICE_TEXT_TAIL_PATTERN = /(?:[\u00a5\uffe5]\s*[\d,]+|[\d,]+\s*\u5186).*$/;
const PRICE_TEXT_PREFIX_PATTERN = /^(?:SOLD\s*)?(?:[\u00a5\uffe5]\s*[\d,]+|[\d,]+\s*\u5186)\s*/i;
const API_AUTO_MORE_MAX_CLICKS = 5;
const API_AUTO_MORE_PROGRESS_TIMEOUT_MS = 8000;
const API_AUTO_MORE_POLL_MS = 200;
const API_AUTO_MORE_CLICK_DELAY_MS = 300;
const API_AUTO_MORE_AFTER_CLICK_MS = 800;
const SELLER_CONTEXT_RETRY_COUNT = 6;
const SELLER_CONTEXT_RETRY_DELAY_MS = 250;
const API_ALWAYS_LOG_STEPS = new Set([
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
const API_VERBOSE_LOG_STEPS = new Set([
  "pager_diagnostic",
  "period_item_diagnostics",
  "period_basis_compare_summary",
  "period_status_compare_summary"
]);
let hasLoggedApiPagerDiagnostic = false;
let pageFetcherInjectPromise: Promise<void> | null = null;
let pageApiPayloadRequest: { sellerId: string; promise: Promise<unknown>; directFetch: boolean } | null = null;
let latestPageApiProgress: Partial<PageContextFetchResponse> | null = null;
let pageApiProgressListeners: Array<{
  seller: ResearchSellerContext;
  options: ResearchFetchOptions;
}> = [];

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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

function throwIfAborted(signal?: AbortSignal) {
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

  pageFetcherInjectPromise = new Promise<void>((resolve, reject) => {
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

function emitApiProgressFromPagePayload(
  seller: ResearchSellerContext,
  options: ResearchFetchOptions,
  data: Partial<PageContextFetchResponse>
) {
  const apiPayload = data.payload;

  if (!isResearchObject(apiPayload) || !Array.isArray(apiPayload["data"])) {
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
    const rawCount = apiPayload["data"].length;
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

  const rawListings = apiPayload["data"].filter(isResearchObject);
  const listings = normalizeFetchedListings(
    mapApiListingsToResearchListings(rawListings, seller.platform),
    seller.platform
  );
  const totalCount = typeof data.totalCount === "number" ? data.totalCount : listings.length;

  logApiPeriodAnalysis(listings, data.partial ? "page_api_progress" : "page_api_done");
  logApiPeriodDiagnostics(rawListings, listings);

  options.onProgress?.(listings.length, {
    listings,
    totalCount,
    pageLikeIndex: data.pageLikeIndex ?? null,
    partial: Boolean(data.partial),
    phase: data.partial ? "api_progress" : "api_done"
  });

  return listings.length;
}

function isSamePageApiSeller(seller: ResearchSellerContext, data: Partial<PageContextFetchResponse>) {
  return String(data.sellerId ?? "") === seller.seller_id;
}

function addPageApiProgressListener(seller: ResearchSellerContext, options: ResearchFetchOptions) {
  if (typeof options.onProgress !== "function") {
    return () => {};
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

function notifyPageApiProgress(data: Partial<PageContextFetchResponse>) {
  latestPageApiProgress = data;
  let mappedCount: number | null = null;

  for (const listener of pageApiProgressListeners) {
    if (!isSamePageApiSeller(listener.seller, data)) {
      continue;
    }

    mappedCount = emitApiProgressFromPagePayload(listener.seller, listener.options, data);
  }

  return mappedCount;
}

async function waitMercariApiPayloadFromPage(seller: ResearchSellerContext, options: ResearchFetchOptions = {}) {
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

  let promise: Promise<unknown>;
  promise = new Promise<unknown>((resolve, reject) => {
    const requestId = createRequestId();
    let timeoutId: number | null = null;
    const cancelPageRequest = (reason: string) => {
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

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as Partial<PageContextFetchResponse> | null;

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
  return (
    pathname.match(MERCARI_PROFILE_URL_PATTERN)?.[1] ??
    pathname.match(MERCARI_SHOPS_PROFILE_URL_PATTERN)?.[1] ??
    null
  );
}

function getPlatformFromCurrentUrl(): ResearchPlatform | null {
  const pathname = window.location.pathname;

  if (MERCARI_SHOPS_PROFILE_URL_PATTERN.test(pathname)) {
    return "mercari_shops";
  }

  if (MERCARI_PROFILE_URL_PATTERN.test(pathname)) {
    return "mercari";
  }

  return null;
}

function getSellerContextFromCurrentPage(): ResearchSellerContext | null {
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

function getSellerName(platform: ResearchPlatform | null = getPlatformFromCurrentUrl()) {
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

function getText(element: Element | null) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parsePrice(text: string) {
  const match = text.match(PRICE_TEXT_PATTERN);

  if (!match) {
    return null;
  }

  const amount = match[1] ?? match[2];
  const price = Number(amount.replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function parseSoldAt(text: string) {
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

function getItemIdFromUrl(url: string) {
  const itemMatch = url.match(/\/item\/([^/?#]+)/);
  const shopProductMatch = url.match(/\/shops\/product\/([^/?#]+)/);

  return itemMatch?.[1] ?? shopProductMatch?.[1] ?? null;
}

function getAncestorCandidates(element: HTMLElement, maxDepth = 10) {
  const candidates: Element[] = [];
  let current = element.parentElement;

  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    candidates.push(current);
    current = current.parentElement;
  }

  return candidates;
}

function getUniqueElements(elements: Array<Element | null | undefined>) {
  const seen = new Set<Element>();
  return elements.filter((element): element is Element => {
    if (!element || seen.has(element)) {
      return false;
    }

    seen.add(element);
    return true;
  });
}

function getListingContainer(link: HTMLAnchorElement) {
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

  return candidates.find((candidate) => parsePrice(getText(candidate)) !== null) ?? candidates[0] ?? link;
}

function getUniqueTextValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

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

function getListingText(link: HTMLAnchorElement, container: Element) {
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

function getTitle(link: HTMLAnchorElement, container: Element, listingText?: string) {
  const imageAlt = link.querySelector("img")?.getAttribute("alt")?.trim();
  const normalizedImageAlt = imageAlt?.replace(/^Image:\s*/i, "").trim();

  if (normalizedImageAlt && normalizedImageAlt !== "縺ｮ繧ｵ繝繝阪う繝ｫ") {
    return normalizedImageAlt.replace(PRICE_TEXT_TAIL_PATTERN, "").trim();
  }

  const ariaLabel = link.getAttribute("aria-label")?.trim();

  if (ariaLabel) {
    return ariaLabel.replace(PRICE_TEXT_TAIL_PATTERN, "").trim();
  }

  const text = listingText || getText(container);
  const candidates = [
    text.replace(PRICE_TEXT_PREFIX_PATTERN, "").trim(),
    text.replace(PRICE_TEXT_TAIL_PATTERN, "").trim()
  ];

  const lines = text
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return [...candidates, ...lines].find((line) => {
    const normalized = line.replace(/^Image:\s*/i, "").replace(PRICE_TEXT_PREFIX_PATTERN, "").trim();

    return normalized && !/^(SOLD|[¥￥]?\s*[\d,]+|[\d,]+\s*円|雋ｩ螢ｲ荳ｭ|譁ｰ逹鬆・縺吶∋縺ｦ縺ｮ蝠・・ｽ・ｽ)$/i.test(normalized);
  }) ?? "";
}

function getListingLinkSelector(platform: ResearchPlatform | null) {
  return platform === "mercari_shops"
    ? 'a[href*="/shops/product/"]'
    : 'a[href*="/item/"]';
}

function getListingLinks(platform: ResearchPlatform | null) {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(getListingLinkSelector(platform)));
}

function getListingStatus(text: string, platform: ResearchPlatform | null) {
  if (/sold/i.test(text) || text.includes("\u58f2\u308a\u5207\u308c") || text.includes("\u58f2\u5374\u6e08\u307f")) {
    return "sold";
  }

  return "active";
}

function getThumbnailUrl(link: HTMLAnchorElement) {
  const image = link.querySelector("img");

  return image?.currentSrc || image?.getAttribute("src") || image?.getAttribute("data-src") || null;
}

type DomCollectDiagnostics = {
  platform: ResearchPlatform | null;
  linkSelector: string;
  linkCount: number;
  acceptedCount: number;
  skippedMissingItemId: number;
  skippedMissingPrice: number;
  skippedMissingTitle: number;
  firstLinkHref: string | null;
  firstContainerTag: string | null;
  firstContainerTextLength: number;
  firstContainerTextSample: string;
};

function createDomCollectDiagnostics(platform: ResearchPlatform | null): DomCollectDiagnostics {
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

async function waitForSellerContextFromCurrentPage(signal?: AbortSignal) {
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

function logDomCollectDiagnostics(step: string, diagnostics: DomCollectDiagnostics) {
  console.log(`${DOM_FETCH_LOG_PREFIX} ${step}`, diagnostics);
}

function collectListings(platform: ResearchPlatform | null, diagnostics?: DomCollectDiagnostics) {
  const links = getListingLinks(platform);
  const listings = new Map<string, ResearchListingRecord>();

  if (diagnostics) {
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

    if (listings.has(itemId)) {
      continue;
    }

    const container = getListingContainer(link);
    const text = getListingText(link, container);
    const price = parsePrice(text);
    const title = getTitle(link, container, text);

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

    const soldAt = parseSoldAt(text);

    listings.set(itemId, {
      item_id: itemId,
      title,
      price,
      sold_at: soldAt,
      period_date: soldAt,
      period_date_source: soldAt ? "sold_at" : null,
      period_date_estimated: false,
      thumbnail_url: getThumbnailUrl(link),
      item_url: itemUrl,
      status: getListingStatus(text, platform),
      platform: platform ?? "mercari"
    });
  }

  return Array.from(listings.values());
}

async function clickSoldTab(platform: ResearchPlatform | null, signal?: AbortSignal) {
  if (platform === "mercari_shops") {
    return;
  }

  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a, [role='tab']"));
  const soldTab = candidates.find((candidate) => {
    const text = getText(candidate);
    return text.includes("\u8ca9\u58f2\u6e08\u307f") || text.includes("\u58f2\u308a\u5207\u308c") || text.includes("\u58f2\u5374\u6e08\u307f") || /sold/i.test(text);
  });

  if (!soldTab) {
    return;
  }

  soldTab.click();
  await sleep(1000, signal);
}

function getApiAutoMoreButtonText(element: Element) {
  return [
    getText(element),
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? ""
  ].join(" ").replace(/\s+/g, " ").trim();
}

function isApiAutoMoreButtonDisabled(element: Element) {
  return Boolean(
    (element instanceof HTMLButtonElement && element.disabled) ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("disabled") !== null
  );
}

function isApiAutoMoreButtonVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findApiAutoMoreButton() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('main button, main a, main [role="button"]'));

  return candidates.find((candidate) => {
    const text = getApiAutoMoreButtonText(candidate);

    if (!text) {
      return false;
    }

    return (
      /もっと\s*見る/.test(text) ||
      /さらに\s*表示/.test(text) ||
      /さらに\s*見る/.test(text) ||
      /load\s*more/i.test(text) ||
      /show\s*more/i.test(text)
    ) && !isApiAutoMoreButtonDisabled(candidate) && isApiAutoMoreButtonVisible(candidate);
  }) ?? null;
}

function getLatestApiProgressForSeller(seller: ResearchSellerContext) {
  if (!latestPageApiProgress || !isSamePageApiSeller(seller, latestPageApiProgress)) {
    return null;
  }

  return latestPageApiProgress;
}

async function waitForApiProgressAfter(
  seller: ResearchSellerContext,
  minPageLikeIndex: number,
  signal?: AbortSignal
) {
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

function getApiProgressRawListings(progress: Partial<PageContextFetchResponse>) {
  const payload = progress?.payload;

  if (!isResearchObject(payload) || !Array.isArray(payload["data"])) {
    return [];
  }

  return payload["data"].filter(isResearchObject);
}

function getApiPeriodDateCandidate(rawListing: ResearchApiRawListing): ApiPeriodDateCandidate | null {
  if (!isResearchObject(rawListing)) {
    return null;
  }

  const listing = getApiListingSource(rawListing);

  const confirmedCandidates: Array<[string, unknown]> = [
    ["sold_at", listing.sold_at],
    ["soldAt", listing.soldAt],
    ["purchased_at", listing.purchased_at],
    ["purchasedAt", listing.purchasedAt]
  ];
  // 売却日時が無いAPI取得分は、期間集計用の推定日として作成日時を優先する。
  const estimatedCandidates: Array<[string, unknown]> = [
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
      const timeMs = value > 100000000000 ? value : value * 1000;

      if (Number.isFinite(timeMs)) {
        return { source, isoValue: new Date(timeMs).toISOString(), timeMs, isEstimated };
      }
    }
  }

  return null;
}

function getApiAutoMorePeriodState(progress: Partial<PageContextFetchResponse>) {
  const rawListings = getApiProgressRawListings(progress);
  const cutoff = Date.now() - THREE_MONTHS_MS;
  const sourceCounts: Record<string, number> = {};
  let newerCount = 0;
  let olderCount = 0;
  let missingDateCount = 0;
  let oldestTimeMs: number | null = null;

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

async function runApiAutoMoreAssist(seller: ResearchSellerContext, signal?: AbortSignal) {
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

async function triggerApiFetchAfterWatch(seller: ResearchSellerContext, signal?: AbortSignal, force = false) {
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

async function warmDirectFetchHeadersFromPageApi(seller: ResearchSellerContext, options: ResearchFetchOptions) {
  const warmupPromise = waitMercariApiPayloadFromPage(seller, {
    ...options,
    directFetch: false,
    resolveOnFirstPartial: true,
    onProgress: undefined
  });

  await triggerApiFetchAfterWatch(seller, options.signal, true);
  await warmupPromise;
}

async function runApiAssistAfterWatch(seller: ResearchSellerContext, signal?: AbortSignal) {
  await triggerApiFetchAfterWatch(seller, signal);
  await runApiAutoMoreAssist(seller, signal);
}

function isDirectFetchFailure(error: unknown) {
  return error instanceof Error && ["direct_fetch_empty", "direct_fetch_error", "direct_fetch_missing_snapshot"].includes(error.message);
}

function runApiAssistAfterWatchSafe(seller: ResearchSellerContext, signal?: AbortSignal) {
  runApiAssistAfterWatch(seller, signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    logApiFetch("warn", "auto_more_assist_failed", {
      reason: error instanceof Error ? error.message : String(error)
    });
  });
}

function filterListingsWithinThreeMonths(listings: ResearchListingRecord[]) {
  const cutoff = Date.now() - THREE_MONTHS_MS;

  return listings.filter((listing) => {
    const periodTime = getListingPeriodDateMs(listing);

    if (periodTime === null) {
      return true;
    }

    return periodTime >= cutoff;
  });
}

function normalizeFetchedListings(listings: ResearchListingRecord[], platform: ResearchPlatform) {
  return filterListingsWithinThreeMonths(listings)
    .map((listing) => ({
      ...listing,
      platform: listing.platform ?? platform
    }));
}

function isResearchObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringValue(...values: unknown[]) {
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

function getNumberValue(...values: unknown[]) {
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

function getIsoDateValue(...values: unknown[]) {
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

function getHttpUrlValue(...values: unknown[]) {
  const rawUrl = getStringValue(...values);

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

function getArrayValue(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return [];
}

function getNestedApiListing(rawListing: ResearchApiRawListing | null) {
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

function getApiListingSource(rawListing: ResearchApiRawListing) {
  const nestedListing = getNestedApiListing(rawListing);

  return nestedListing
    ? {
        ...rawListing,
        ...nestedListing,
        __furimane_request_status: nestedListing["__furimane_request_status"] ?? rawListing["__furimane_request_status"]
      }
    : rawListing;
}

function getApiMeta(payload: Record<string, unknown>) {
  return isResearchObject(payload["meta"]) ? payload["meta"] : null;
}

function getApiPayloadPagerId(payload: Record<string, unknown>) {
  return getStringValue(
    payload["next_pager_id"],
    payload["nextPagerId"],
    payload["pager_id"],
    payload["pagerId"],
    payload["next_page_token"],
    payload["nextPageToken"]
  );
}

function getApiMetaPagerId(payload: Record<string, unknown>) {
  const meta = getApiMeta(payload);

  if (!meta) {
    return null;
  }

  return getStringValue(
    meta["next_pager_id"],
    meta["nextPagerId"],
    meta["pager_id"],
    meta["pagerId"],
    meta["next_page_token"],
    meta["nextPageToken"]
  );
}

function getApiListingPagerId(rawListing: ResearchApiRawListing) {
  return getStringValue(rawListing["pager_id"], rawListing["pagerId"]);
}

function getLastListingPagerId(rawListings: ResearchApiRawListing[]) {
  for (let index = rawListings.length - 1; index >= 0; index -= 1) {
    const pagerId = getApiListingPagerId(rawListings[index]);

    if (pagerId) {
      return pagerId;
    }
  }

  return null;
}

function getApiPagerLocation(payload: Record<string, unknown>, rawListings: ResearchApiRawListing[]) {
  if (getApiMetaPagerId(payload)) {
    return "meta";
  }

  if (getApiPayloadPagerId(payload)) {
    return "top_level";
  }

  if (getLastListingPagerId(rawListings)) {
    return "listing";
  }

  return "none";
}

function logApiPagerDiagnostic(payload: Record<string, unknown>, rawListings: ResearchApiRawListing[]) {
  if (hasLoggedApiPagerDiagnostic) {
    return;
  }

  const meta = getApiMeta(payload);
  const firstItem = rawListings[0] ?? null;
  const lastItem = rawListings[rawListings.length - 1] ?? null;

  logApiFetch("info", "pager_diagnostic", {
    dataLength: rawListings.length,
    topLevelKeys: Object.keys(payload),
    metaKeys: meta ? Object.keys(meta) : [],
    firstItemKeys: isResearchObject(firstItem) ? Object.keys(firstItem) : [],
    lastItemKeys: isResearchObject(lastItem) ? Object.keys(lastItem) : [],
    firstItemHasPagerId: Boolean(getApiListingPagerId(firstItem ?? {})),
    lastItemHasPagerId: Boolean(getApiListingPagerId(lastItem ?? {})),
    pagerIdLocation: getApiPagerLocation(payload, rawListings)
  });

  hasLoggedApiPagerDiagnostic = true;
}

function getApiThumbnailUrl(rawListing: ResearchApiRawListing) {
  const listing = getApiListingSource(rawListing);
  const thumbnails = getArrayValue(listing["thumbnails"], listing["photos"], listing["images"]);

  for (const thumbnail of thumbnails) {
    const url = typeof thumbnail === "string"
      ? getHttpUrlValue(thumbnail)
      : isResearchObject(thumbnail)
        ? getHttpUrlValue(
            thumbnail["url"],
            thumbnail["src"],
            thumbnail["thumbnail_url"],
            thumbnail["thumbnailUrl"]
          )
        : null;

    if (url) {
      return url;
    }
  }

  return getHttpUrlValue(
    listing["thumbnail_url"],
    listing["thumbnailUrl"],
    listing["image_url"],
    listing["imageUrl"],
    listing["photo_url"],
    listing["photoUrl"]
  );
}

function getApiItemUrl(itemId: string) {
  return itemId ? `https://jp.mercari.com/item/${encodeURIComponent(itemId)}` : null;
}

function logApiFetch(_level: "info" | "warn" | "error", step: string, payload: Record<string, unknown> = {}) {
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

function getListingPeriodDateMs(listing: ResearchListingRecord) {
  const value = listing.period_date || listing.sold_at;

  if (!value) {
    return null;
  }

  const timeMs = new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

function getListingPeriodKeyForLog(listing: ResearchListingRecord) {
  const timeMs = getListingPeriodDateMs(listing);

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

function getTimeMsFromDateValue(value: unknown) {
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

function getPeriodKeyFromDateValue(value: unknown) {
  const timeMs = getTimeMsFromDateValue(value);

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

function getDaysAgoFromDateValue(value: unknown) {
  const timeMs = getTimeMsFromDateValue(value);
  return timeMs === null ? null : Math.floor((Date.now() - timeMs) / (24 * 60 * 60 * 1000));
}

function createPeriodRevenueSummary() {
  return {
    period_0_30: { count: 0, revenue: 0 },
    period_31_60: { count: 0, revenue: 0 },
    period_61_90: { count: 0, revenue: 0 },
    out_of_range: { count: 0, revenue: 0 },
    missing: { count: 0, revenue: 0 }
  };
}

function addPeriodRevenue(summary: ReturnType<typeof createPeriodRevenueSummary>, periodKey: string | null, price: number | null) {
  const bucket = periodKey === "period_0_30" || periodKey === "period_31_60" || periodKey === "period_61_90" || periodKey === "out_of_range"
    ? periodKey
    : "missing";
  const revenue = Number.isFinite(price) ? Number(price) : 0;

  summary[bucket].count += 1;
  summary[bucket].revenue += revenue;
}

function getRawApiItemPrice(rawListing: ResearchApiRawListing) {
  const listing = getApiListingSource(rawListing);
  return getNumberValue(listing["price"], listing["amount"], listing["sold_price"], listing["soldPrice"]);
}

function getRawApiItemTitle(rawListing: ResearchApiRawListing) {
  const listing = getApiListingSource(rawListing);
  return getStringValue(listing["name"], listing["title"], listing["item_name"], listing["itemName"]);
}

function getRawApiItemId(rawListing: ResearchApiRawListing) {
  const listing = getApiListingSource(rawListing);
  return getStringValue(listing["id"], listing["item_id"], listing["itemId"]);
}

function getRawApiDateValue(rawListing: ResearchApiRawListing, keys: string[]) {
  const listing = getApiListingSource(rawListing);

  for (const key of keys) {
    if (listing[key] !== undefined && listing[key] !== null) {
      return listing[key];
    }
  }

  return null;
}

function getRawApiStatus(rawListing: ResearchApiRawListing) {
  const listing = getApiListingSource(rawListing);
  return getStringValue(listing["status"], listing["item_status"], listing["itemStatus"]);
}

function summarizeRawApiItemsByDateField(rawListings: ResearchApiRawListing[], keys: string[]) {
  const summary = createPeriodRevenueSummary();

  for (const rawListing of rawListings) {
    const price = getRawApiItemPrice(rawListing);
    const dateValue = getRawApiDateValue(rawListing, keys);
    addPeriodRevenue(summary, getPeriodKeyFromDateValue(dateValue), price);
  }

  return summary;
}

function summarizeMappedItemsByCurrentPeriod(listings: ResearchListingRecord[]) {
  const summary = createPeriodRevenueSummary();

  for (const listing of listings) {
    addPeriodRevenue(summary, getCurrentPeriodBucketForListing(listing), listing.price);
  }

  return summary;
}

function getCurrentPeriodBucketForListing(listing: ResearchListingRecord) {
  const logKey = getListingPeriodKeyForLog(listing);

  if (logKey === "period_0_30_count") {
    return "period_0_30";
  }

  if (logKey === "period_31_60_count") {
    return "period_31_60";
  }

  if (logKey === "period_61_90_count") {
    return "period_61_90";
  }

  return getListingPeriodDateMs(listing) === null ? null : "out_of_range";
}

function normalizeApiStatusForSummary(status: string | null | undefined) {
  return (status || "unknown").trim().toLowerCase() || "unknown";
}

function summarizeMappedItemsByStatus(listings: ResearchListingRecord[]) {
  const summaryByStatus: Record<string, { total: { count: number; revenue: number }; periods: ReturnType<typeof createPeriodRevenueSummary> }> = {};

  for (const listing of listings) {
    const status = normalizeApiStatusForSummary(listing.status);

    if (!summaryByStatus[status]) {
      summaryByStatus[status] = {
        total: { count: 0, revenue: 0 },
        periods: createPeriodRevenueSummary()
      };
    }

    const revenue = Number.isFinite(listing.price) ? Number(listing.price) : 0;
    summaryByStatus[status].total.count += 1;
    summaryByStatus[status].total.revenue += revenue;
    addPeriodRevenue(summaryByStatus[status].periods, getCurrentPeriodBucketForListing(listing), listing.price);
  }

  return summaryByStatus;
}

function logApiPeriodDiagnostics(rawListings: ResearchApiRawListing[], listings: ResearchListingRecord[]) {
  const isDebugLogEnabled = localStorage.getItem("furimane-research-debug") === "true";

  if (!isDebugLogEnabled) {
    return;
  }

  const mappedByItemId = new Map(listings.map((listing) => [listing.item_id, listing]));
  const sample = rawListings.slice(0, 20).map((rawListing) => {
    const itemId = getRawApiItemId(rawListing);
    const mapped = itemId ? mappedByItemId.get(itemId) : null;

    return {
      item_id: itemId,
      title: getRawApiItemTitle(rawListing),
      price: getRawApiItemPrice(rawListing),
      status: getRawApiStatus(rawListing),
      created: getRawApiDateValue(rawListing, ["created", "created_at", "createdAt"]),
      created_type: typeof getRawApiDateValue(rawListing, ["created", "created_at", "createdAt"]),
      updated: getRawApiDateValue(rawListing, ["updated", "updated_at", "updatedAt"]),
      updated_type: typeof getRawApiDateValue(rawListing, ["updated", "updated_at", "updatedAt"]),
      has_sold_at: getRawApiDateValue(rawListing, ["sold_at", "soldAt"]) !== null,
      has_purchased_at: getRawApiDateValue(rawListing, ["purchased_at", "purchasedAt"]) !== null,
      period_date: mapped?.period_date ?? null,
      period_source_field: mapped?.period_date_source ?? null,
      daysAgo: mapped ? getDaysAgoFromDateValue(mapped.period_date || mapped.sold_at) : null,
      assignedPeriod: mapped ? getListingPeriodKeyForLog(mapped) : null
    };
  });

  logApiFetch("info", "period_item_diagnostics", {
    sampleLimit: 20,
    totalRawItems: rawListings.length,
    sample
  });

  logApiFetch("info", "period_basis_compare_summary", {
    current_period_date: summarizeMappedItemsByCurrentPeriod(listings),
    created: summarizeRawApiItemsByDateField(rawListings, ["created", "created_at", "createdAt"]),
    updated: summarizeRawApiItemsByDateField(rawListings, ["updated", "updated_at", "updatedAt"]),
    sold_at: summarizeRawApiItemsByDateField(rawListings, ["sold_at", "soldAt"]),
    purchased_at: summarizeRawApiItemsByDateField(rawListings, ["purchased_at", "purchasedAt"])
  });

  logApiFetch("info", "period_status_compare_summary", {
    current_period_date: summarizeMappedItemsByStatus(listings)
  });
}

function getPeriodAnalysisLogPayload(listings: ResearchListingRecord[], stopReason: string) {
  const sourceCounts: Record<string, number> = {};
  let oldestTimeMs: number | null = null;
  let period030Count = 0;
  let period3160Count = 0;
  let period6190Count = 0;
  let outOfRangeCount = 0;

  for (const listing of listings) {
    const timeMs = getListingPeriodDateMs(listing);

    if (timeMs === null) {
      continue;
    }

    const source = listing.period_date_source || (listing.sold_at ? "sold_at" : "unknown");
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    oldestTimeMs = oldestTimeMs === null ? timeMs : Math.min(oldestTimeMs, timeMs);

    const periodKey = getListingPeriodKeyForLog(listing);

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

function logApiPeriodAnalysis(listings: ResearchListingRecord[], stopReason: string) {
  logApiFetch("info", "period_analysis", getPeriodAnalysisLogPayload(listings, stopReason));
}

function getApiListingStatus(rawListing: ResearchApiRawListing, soldAt: string | null) {
  const listing = getApiListingSource(rawListing);
  const status = getStringValue(
    listing["status"],
    listing["item_status"],
    listing["itemStatus"]
  );

  if (status) {
    return status;
  }

  const requestStatus = getStringValue(listing["__furimane_request_status"]);

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

function mapApiListingToResearchListing(
  rawListing: ResearchApiRawListing,
  platform: ResearchPlatform
): ResearchListingRecord | null {
  const listing = getApiListingSource(rawListing);
  const itemId = getStringValue(
    listing["id"],
    listing["item_id"],
    listing["itemId"],
    getItemIdFromUrl(
      getHttpUrlValue(
        listing["item_url"],
        listing["itemUrl"],
        listing["url"],
        listing["webUrl"]
      ) ?? ""
    )
  );
  const title = getStringValue(
    listing["name"],
    listing["title"],
    listing["item_name"],
    listing["itemName"]
  );
  const price = getNumberValue(
    listing["price"],
    listing["amount"],
    listing["sold_price"],
    listing["soldPrice"]
  );

  if (!itemId || !title || price === null) {
    return null;
  }

  const seller = isResearchObject(listing["seller"]) ? listing["seller"] : null;
  const soldAt = getIsoDateValue(
    listing["sold_at"],
    listing["soldAt"],
    listing["purchased_at"],
    listing["purchasedAt"]
  );
  const periodDate = getApiPeriodDateCandidate(rawListing);
  const itemUrl = getHttpUrlValue(
    listing["item_url"],
    listing["itemUrl"],
    listing["url"],
    listing["webUrl"],
    getApiItemUrl(itemId)
  );
  return {
    item_id: itemId,
    title,
    price,
    sold_at: soldAt,
    period_date: periodDate?.isoValue ?? soldAt,
    period_date_source: periodDate?.source ?? (soldAt ? "sold_at" : null),
    period_date_estimated: periodDate?.isEstimated ?? false,
    thumbnail_url: getApiThumbnailUrl(rawListing),
    item_url: itemUrl,
    seller_id: getStringValue(listing["seller_id"], listing["sellerId"], seller?.["id"]),
    seller_name: getStringValue(listing["seller_name"], listing["sellerName"], seller?.["name"]),
    status: getApiListingStatus(rawListing, soldAt),
    platform
  };
}

function mapApiListingsToResearchListings(rawListings: ResearchApiRawListing[], platform: ResearchPlatform) {
  const listings: ResearchListingRecord[] = [];
  const itemIds = new Set<string>();

  for (const rawListing of rawListings) {
    const mappedListing = mapApiListingToResearchListing(rawListing, platform);

    if (!mappedListing || itemIds.has(mappedListing.item_id)) {
      continue;
    }

    itemIds.add(mappedListing.item_id);
    listings.push(mappedListing);
  }

  return listings;
}

async function fetchSellerListingsByDom(options: ResearchFetchOptions = {}) {
  const seller = getSellerContextFromCurrentPage();

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  await clickSoldTab(seller.platform, options.signal);

  const initialDiagnostics = createDomCollectDiagnostics(seller.platform);
  let listings = collectListings(seller.platform, initialDiagnostics);
  const initialItemLinkCount = initialDiagnostics.linkCount;
  let stableCount = 0;

  if (initialItemLinkCount === 0) {
    logDomCollectDiagnostics("no_item_links_found", initialDiagnostics);
  }

  if (initialItemLinkCount > 0 && listings.length === 0) {
    logDomCollectDiagnostics("mercari_dom_changed", initialDiagnostics);
    throw new Error("mercari_dom_changed");
  }

  options.onProgress?.(listings.length);

  for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal);

    const beforeCount = listings.length;
    // 隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｫ繝夲ｿｽE繧ｸ菴咲ｽｮ繧貞･ｪ繧上↑縺・・ｽ・ｽ繧√∵僑蠑ｵ蛛ｴ縺九ｉ閾ｪ蜍輔せ繧ｯ繝ｭ繝ｼ繝ｫ縺励↑縺・・ｽ・ｽE    // 縺薙％縺ｧ縺ｯ迴ｾ蝨ｨDOM縺ｫ謠冗判貂医∩縺ｮ蝠・・ｽ・ｽ縺縺代ｒ螳会ｿｽE縺ｫ蜀榊庶髮・・ｽ・ｽ繧九・    await sleep(1000, options.signal);

    listings = collectListings(seller.platform);
    options.onProgress?.(listings.length);

    stableCount = listings.length === beforeCount ? stableCount + 1 : 0;

    if (stableCount >= STABLE_SCROLL_LIMIT) {
      break;
    }
  }

  return normalizeFetchedListings(listings, seller.platform);
}


async function fetchSellerListingsByApiPoc(options: ResearchFetchOptions = {}) {
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

  let apiPayload: unknown;

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
      return normalizeApiPayloadToResearchListings(apiPayload, seller, options);
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

  return normalizeApiPayloadToResearchListings(apiPayload, seller, options);
}

function normalizeApiPayloadToResearchListings(
  apiPayload: unknown,
  seller: ResearchSellerContext,
  options: ResearchFetchOptions
) {
  if (!isResearchObject(apiPayload) || !Array.isArray(apiPayload["data"])) {
    throw new Error("mercari_api_invalid_response");
  }

  const rawListings = apiPayload["data"].filter(isResearchObject);
  const listings = mapApiListingsToResearchListings(rawListings, seller.platform);
  const normalizedListings = normalizeFetchedListings(listings, seller.platform);

  if (rawListings.length > 0 && normalizedListings.length === 0) {
    throw new Error("mercari_api_mapping_empty");
  }

  logApiPagerDiagnostic(apiPayload, rawListings);
  logApiPeriodAnalysis(normalizedListings, "page_api_payload_received");
  logApiPeriodDiagnostics(rawListings, normalizedListings);
  options.onProgress?.(normalizedListings.length, {
    totalCount: normalizedListings.length,
    pageLikeIndex: null,
    partial: false,
    phase: "api_done"
  });

  logApiFetch("info", "mappedCount", {
    mappedCount: normalizedListings.length
  });

  return normalizedListings;
}

async function fetchSellerResearchData(options: ResearchFetchOptions = {}): Promise<ResearchFetchResult> {
  const seller = await waitForSellerContextFromCurrentPage(options.signal);

  if (!seller) {
    throw new Error("seller_id_not_found");
  }

  const strategy = options.strategy ?? "api";
  let listings: ResearchListingRecord[];
  let resolvedStrategy: ResearchFetchStrategy = strategy;

  if (strategy === "api") {
    try {
      listings = await fetchSellerListingsByApiPoc(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
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
      listings = await fetchSellerListingsByDom(options);
      resolvedStrategy = "dom";
    }
  } else {
    logApiFetch("info", "api_branch_not_entered", {
      sellerId: seller.seller_id,
      strategy
    });
    listings = await fetchSellerListingsByDom(options);
  }

  return {
    seller,
    listings,
    strategy: resolvedStrategy
  };
}

async function scrapeSellerPageSafe(options: ResearchFetchOptions = {}) {
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

    throw new Error("scraping_failed");
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
      // api mode flow will fallback to DOM if no page API payload arrives.
    });
  }
} catch (_error) {
  // Keep the DOM path untouched if the early PoC watcher cannot start.
}

export {};
