(() => {
  const FURIMANE_PROFILE_URL_PREFIX = "https://jp.mercari.com/user/profile/";
  const FURIMANE_SHOPS_PROFILE_URL_PREFIX = "https://jp.mercari.com/shops/profile/";
  const FURIMANE_OVERLAY_ID = "furimane-research-overlay";
  const FURIMANE_OPEN_BUTTON_ID = "furimane-research-open-button";
  const FURIMANE_CLOSED_STORAGE_KEY = "furimane-research-closed";
  const FURIMANE_MAX_RETRY_COUNT = 3;
  const FURIMANE_DEFAULT_FETCH_STRATEGY = "api";
  const FURIMANE_READY_DELAY_MS = 250;
  const FURIMANE_ROUTE_SYNC_DELAY_MS = 250;
  const FURIMANE_MAX_INLINE_INSERT_RETRY_COUNT = 12;
  const FURIMANE_LOCAL_RESEARCH_CACHE_PREFIX = "furimane-research-local-cache:";
  const FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  const FURIMANE_ACCESS_CACHE_TTL_MS = 30 * 1e3;
  const FURIMANE_RESEARCH_ENABLED_KEY = "furimaneResearchEnabled";
  let currentAbortController = null;
  let currentResearchPageKey = null;
  let routeSyncTimerId = null;
  let lastObservedUrl = window.location.href;
  let overlayInsertRetryCount = 0;
  let cachedResearchAccess = null;
  let currentResearchUsage = null;
  function showResearchNotice(message) {
    document.querySelector(".furimane-research-table__toast")?.remove();
    const notice = document.createElement("div");
    notice.className = "furimane-research-table__toast";
    notice.textContent = message;
    document.body.appendChild(notice);
    window.setTimeout(() => {
      notice.remove();
    }, 3200);
  }
  function getOverlayWindow() {
    return window;
  }
  function getChromeLocalStorage(keys) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => {
        resolve(result ?? {});
      });
    });
  }
  async function isResearchFeatureEnabled() {
    const storage = await getChromeLocalStorage([FURIMANE_RESEARCH_ENABLED_KEY]);
    return storage[FURIMANE_RESEARCH_ENABLED_KEY] === true;
  }
  function getResearchFetchStrategy() {
    return FURIMANE_DEFAULT_FETCH_STRATEGY;
  }
  function getResearchPageKey() {
    const url = new URL(window.location.href);
    const mercariProfileMatch = url.pathname.match(/^\/user\/profile\/([^/?#]+)/);
    if (mercariProfileMatch?.[1]) {
      return `mercari:${mercariProfileMatch[1]}`;
    }
    const shopsProfileMatch = url.pathname.match(/^\/shops\/profile\/([^/?#]+)/);
    if (shopsProfileMatch?.[1]) {
      return `mercari_shops:${shopsProfileMatch[1]}`;
    }
    return null;
  }
  function getCachedResearchData(cache) {
    if (!cache?.cached) {
      return null;
    }
    const data = cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);
    return data ? { ...data, stats: cache.stats ?? data.stats ?? null, periodAnalysis: cache.periodAnalysis ?? data.periodAnalysis ?? null } : null;
  }
  function getResearchCacheSellerKey(seller) {
    const platform = seller.platform || "mercari";
    const sellerId = seller.seller_id;
    return sellerId ? `${platform}:${sellerId}` : null;
  }
  function getLocalResearchCacheKey(seller) {
    const sellerKey = getResearchCacheSellerKey(seller);
    return sellerKey ? `${FURIMANE_LOCAL_RESEARCH_CACHE_PREFIX}${sellerKey}` : null;
  }
  function isResearchResultData(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const data = value;
    return Boolean(data.seller && Array.isArray(data.listings));
  }
  function hasRenderableResearchData(data) {
    return Boolean(data && Array.isArray(data.listings) && data.listings.length > 0);
  }
  function readLocalResearchCache(seller) {
    const cacheKey = getLocalResearchCacheKey(seller);
    if (!cacheKey) {
      return null;
    }
    try {
      const rawValue = localStorage.getItem(cacheKey);
      if (!rawValue) {
        return null;
      }
      const parsed = JSON.parse(rawValue);
      if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS || !isResearchResultData(parsed.data)) {
        localStorage.removeItem(cacheKey);
        return null;
      }
      return parsed.data;
    } catch (error) {
      console.warn("[furimane-research] local cache read failed", error);
      localStorage.removeItem(cacheKey);
      return null;
    }
  }
  function writeLocalResearchCache(data) {
    const cacheKey = getLocalResearchCacheKey(data.seller);
    if (!cacheKey || !Array.isArray(data.listings) || data.listings.length === 0) {
      return;
    }
    try {
      const entry = {
        savedAt: Date.now(),
        data
      };
      localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch (error) {
      console.warn("[furimane-research] local cache write failed", error);
    }
  }
  function getResearchPageSupportStatus() {
    if (window.location.href.startsWith(FURIMANE_PROFILE_URL_PREFIX)) {
      return "supported";
    }
    if (window.location.href.startsWith(FURIMANE_SHOPS_PROFILE_URL_PREFIX)) {
      return "unsupported";
    }
    return "outside";
  }
  function logUnsupportedResearchPage() {
    console.info("[furimane-research] unsupported page. skip research flow", {
      url: window.location.href
    });
  }
  function waitForReady() {
    return new Promise((resolve) => {
      const run = () => {
        window.setTimeout(resolve, FURIMANE_READY_DELAY_MS);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
        return;
      }
      run();
    });
  }
  function getProfileHeaderElement() {
    const profileHeaderById = document.getElementById("profile-header");
    if (profileHeaderById) {
      return profileHeaderById;
    }
    const profileHeaderByClass = document.querySelector(".profile-header");
    if (profileHeaderByClass) {
      return profileHeaderByClass;
    }
    const headingCandidates = Array.from(document.querySelectorAll("h1, h2, [data-testid*='profile']"));
    return headingCandidates.find((element) => element.textContent?.trim()) ?? null;
  }
  function getNormalizedText(element) {
    return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  function findListingSectionByItemLinks() {
    const itemLinks = Array.from(
      document.querySelectorAll('main a[href*="/item/"], main a[href*="/shops/product/"]')
    );
    if (itemLinks.length === 0) {
      return null;
    }
    const firstItemLink = itemLinks[0];
    return firstItemLink.closest("section") ?? firstItemLink.closest("[data-testid]") ?? firstItemLink.parentElement;
  }
  function findListingSectionBySelectors() {
    const selectors = [
      'main [data-testid*="item-list"]',
      'main [data-testid*="items-list"]',
      'main [data-testid*="listing"]',
      'main [data-testid*="product-list"]',
      'main [data-testid*="item-grid"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const section = element?.closest("section") ?? element;
      if (section) {
        return section;
      }
    }
    return null;
  }
  function findListingSectionByHeading() {
    const headings = Array.from(document.querySelectorAll("main h2, main h3, main [role='heading']"));
    const listingHeading = headings.find((heading) => {
      const text = getNormalizedText(heading);
      return text.includes("\u51FA\u54C1") || text.includes("\u5546\u54C1") || text.includes("\u4E00\u89A7");
    });
    if (!listingHeading) {
      return null;
    }
    return listingHeading.closest("section") ?? listingHeading.parentElement;
  }
  function findListingSection() {
    return findListingSectionByItemLinks() ?? findListingSectionBySelectors() ?? findListingSectionByHeading();
  }
  function findProfileContainer() {
    const profileHeader = getProfileHeaderElement();
    if (profileHeader) {
      const closestHeader = profileHeader.closest(".profile-header") ?? profileHeader.closest("section") ?? profileHeader;
      if (closestHeader) {
        return closestHeader;
      }
    }
    return null;
  }
  function findOverlayInsertTarget() {
    const listingSection = findListingSection();
    if (listingSection?.parentElement) {
      return {
        parent: listingSection.parentElement,
        before: listingSection,
        reason: "before_listing_section"
      };
    }
    const profileContainer = findProfileContainer();
    if (profileContainer) {
      return {
        parent: profileContainer,
        before: null,
        reason: "profile_container_end"
      };
    }
    return null;
  }
  function findOverlayFallbackInsertTarget() {
    const parent = document.querySelector("main") ?? document.body;
    if (!parent) {
      return null;
    }
    return {
      parent,
      before: null,
      reason: "main_end_fallback"
    };
  }
  function getOverlayBody(container) {
    return container.querySelector(".furimane-research-overlay__body");
  }
  function setOverlayBody(container, children) {
    const body = getOverlayBody(container);
    if (!body) {
      return;
    }
    body.replaceChildren(...children);
  }
  function createParagraph(text, className = "furimane-research-overlay__placeholder") {
    const paragraph = document.createElement("p");
    paragraph.className = className;
    paragraph.textContent = text;
    return paragraph;
  }
  function createButton(label, onClick, variant = "primary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `furimane-research-overlay__button furimane-research-overlay__button--${variant}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
  function renderLoading(container, message) {
    setOverlayBody(container, [createParagraph(message)]);
  }
  function getResearchErrorKind(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "auth_required") {
      return "auth";
    }
    if (message === "plan_required") {
      return "plan";
    }
    if (message === "research_monthly_limit_exceeded") {
      return "limit";
    }
    if (message === "rate_limited") {
      return "rate_limit";
    }
    if (message === "payload_too_large") {
      return "payload_too_large";
    }
    if (message === "extension_update_required") {
      return "update_required";
    }
    if (message === "research_temporarily_disabled") {
      return "maintenance";
    }
    if (message === "api_timeout" || message === "network_error") {
      return "timeout";
    }
    if (message === "seller_id_not_found" || message === "mercari_dom_changed") {
      return "dom_changed";
    }
    if (message === "analyze_mapping_empty") {
      return "mapping";
    }
    if (message === "scraping_failed") {
      return "scraping";
    }
    return "unknown";
  }
  function getResearchErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function getResearchErrorSupportText(kind) {
    if (kind === "scraping") {
      return "\u539F\u56E0: \u5546\u54C1\u60C5\u5831\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
    }
    return "\u539F\u56E0: \u30C7\u30FC\u30BF\u53D6\u5F97\u4E2D\u306B\u554F\u984C\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
  }
  function getResearchRetryAfter(error) {
    const retryAfter = error && typeof error === "object" ? error.retryAfter : null;
    return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null;
  }
  function isRetryableResearchErrorKind(kind) {
    return !["auth", "plan", "limit", "rate_limit", "payload_too_large", "update_required", "maintenance"].includes(kind);
  }
  function canContinueResearchWithoutAccessCheck(error, api) {
    const message = getResearchErrorMessage(error);
    const appUrl = api.getAppUrl?.() ?? "";
    return (message === "network_error" || message === "api_timeout") && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(appUrl);
  }
  function canShowLocalCacheAfterAccessError(error) {
    const message = getResearchErrorMessage(error);
    return message === "network_error" || message === "api_timeout";
  }
  function getResearchFetchFunction(scraper) {
    return scraper.fetchSellerResearchData ?? scraper.scrapeSellerPage ?? null;
  }
  async function checkResearchAccessWithCache(api, signal) {
    if (cachedResearchAccess && Date.now() - cachedResearchAccess.savedAt < FURIMANE_ACCESS_CACHE_TTL_MS) {
      currentResearchUsage = cachedResearchAccess.value.usage ?? null;
      return cachedResearchAccess.value;
    }
    const access = await api.checkAccess({ signal });
    const normalizedAccess = normalizeResearchAccess(access);
    currentResearchUsage = normalizedAccess.usage ?? null;
    cachedResearchAccess = {
      savedAt: Date.now(),
      value: normalizedAccess
    };
    return normalizedAccess;
  }
  function normalizeResearchAccess(access) {
    if (access.usage || access.hasAddon !== true) {
      return access;
    }
    return {
      ...access,
      usage: {
        allowed: true,
        used: 0,
        limit: 30,
        remaining: 30,
        unlimited: true
      }
    };
  }
  function updateResearchUsageChip(usage) {
    if (!usage) {
      return;
    }
    currentResearchUsage = usage;
    const canUseResearch = usage.unlimited === true || usage.used < usage.limit;
    if (cachedResearchAccess) {
      cachedResearchAccess.value = {
        ...cachedResearchAccess.value,
        canUse: canUseResearch,
        canUseResearch,
        usage: {
          ...usage,
          allowed: canUseResearch
        }
      };
    }
    const usageChip = document.querySelector(".furimane-research-table__usage-count");
    if (!usageChip) {
      return;
    }
    usageChip.classList.toggle("furimane-research-table__usage-count--unlimited", usage.unlimited === true);
    const usageText = usageChip.querySelector(".furimane-research-table__usage-count-text");
    const label = usage.unlimited ? "\u7121\u5236\u9650" : `\u4ECA\u6708\u306E\u30EA\u30B5\u30FC\u30C1 ${usage.used} / ${usage.limit}`;
    if (usageText) {
      usageText.textContent = label;
      return;
    }
    usageChip.textContent = label;
  }
  function createChildAbortController(parentSignal) {
    const controller = new AbortController();
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller;
  }
  function getResearchErrorCopy(kind) {
    switch (kind) {
      case "auth":
        return {
          title: "\u30D5\u30EA\u30DE\u30CD\u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044",
          description: "\u30EA\u30B5\u30FC\u30C1\u6A5F\u80FD\u3092\u4F7F\u3046\u306B\u306F\u3001Chrome\u62E1\u5F35\u5074\u3067\u30D5\u30EA\u30DE\u30CD\u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002Web\u7248\u306E\u30ED\u30B0\u30A4\u30F3\u72B6\u614B\u3068\u306F\u5225\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002",
          actionLabel: "\u62E1\u5F35\u306E\u30ED\u30B0\u30A4\u30F3\u753B\u9762\u3092\u958B\u304F"
        };
      case "plan":
        return {
          title: "\u30EA\u30B5\u30FC\u30C1\u8FFD\u52A0\u30D7\u30E9\u30F3\u3067\u3054\u5229\u7528\u3044\u305F\u3060\u3051\u307E\u3059",
          description: "\u3053\u306E\u6A5F\u80FD\u306F\u30EA\u30B5\u30FC\u30C1\u8FFD\u52A0\u30D7\u30E9\u30F3\u52A0\u5165\u5F8C\u306B\u5229\u7528\u3067\u304D\u307E\u3059\u3002",
          actionLabel: "\u30D7\u30E9\u30F3\u3092\u78BA\u8A8D\u3059\u308B"
        };
      case "limit":
        return {
          title: "\u4ECA\u6708\u306E\u30EA\u30B5\u30FC\u30C1\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F",
          description: "\u4ECA\u6708\u306E\u5229\u7528\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u6765\u67081\u65E5\u306B\u30EA\u30BB\u30C3\u30C8\u3055\u308C\u307E\u3059\u3002",
          actionLabel: "\u30D7\u30E9\u30F3\u3092\u78BA\u8A8D\u3059\u308B"
        };
      case "rate_limit":
        return {
          title: "\u77ED\u6642\u9593\u306B\u30A2\u30AF\u30BB\u30B9\u304C\u96C6\u4E2D\u3057\u3066\u3044\u307E\u3059",
          description: "\u5B89\u5168\u306E\u305F\u3081\u4E00\u6642\u7684\u306B\u30EA\u30AF\u30A8\u30B9\u30C8\u3092\u5236\u9650\u3057\u3066\u3044\u307E\u3059\u3002\u5C11\u3057\u6642\u9593\u3092\u7F6E\u3044\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "payload_too_large":
        return {
          title: "\u53D6\u5F97\u30C7\u30FC\u30BF\u304C\u591A\u3059\u304E\u307E\u3059",
          description: "\u4E00\u5EA6\u306B\u9001\u4FE1\u3059\u308B\u30EA\u30B5\u30FC\u30C1\u30C7\u30FC\u30BF\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3001\u6642\u9593\u3092\u7F6E\u3044\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "update_required":
        return {
          title: "\u62E1\u5F35\u6A5F\u80FD\u306E\u66F4\u65B0\u304C\u5FC5\u8981\u3067\u3059",
          description: "\u73FE\u5728\u306E\u30D5\u30EA\u30DE\u30CD\u62E1\u5F35\u3067\u306F\u3053\u306E\u30EA\u30B5\u30FC\u30C1API\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002Chrome\u306E\u62E1\u5F35\u6A5F\u80FD\u7BA1\u7406\u753B\u9762\u304B\u3089\u66F4\u65B0\u3057\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u66F4\u65B0\u65B9\u6CD5\u3092\u78BA\u8A8D\u3059\u308B"
        };
      case "maintenance":
        return {
          title: "\u30EA\u30B5\u30FC\u30C1\u6A5F\u80FD\u3092\u4E00\u6642\u505C\u6B62\u3057\u3066\u3044\u307E\u3059",
          description: "\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9\u307E\u305F\u306F\u4FDD\u8B77\u8A2D\u5B9A\u306E\u305F\u3081\u3001\u73FE\u5728\u30EA\u30B5\u30FC\u30C1\u6A5F\u80FD\u3092\u4E00\u6642\u505C\u6B62\u3057\u3066\u3044\u307E\u3059\u3002\u5C11\u3057\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "timeout":
        return {
          title: "\u901A\u4FE1\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F",
          description: "\u901A\u4FE1\u306B\u6642\u9593\u304C\u304B\u304B\u3063\u3066\u3044\u307E\u3059\u3002\u5C11\u3057\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "dom_changed":
        return {
          title: "\u30E1\u30EB\u30AB\u30EA\u306E\u30DA\u30FC\u30B8\u69CB\u9020\u304C\u5909\u308F\u3063\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059",
          description: "\u5546\u54C1\u60C5\u5831\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3082\u76F4\u3089\u306A\u3044\u5834\u5408\u306F\u30B5\u30DD\u30FC\u30C8\u3078\u9023\u7D61\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "mapping":
        return {
          title: "\u5546\u54C1\u30C7\u30FC\u30BF\u3092\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F",
          description: "\u53D6\u5F97\u3057\u305F\u5546\u54C1\u30C7\u30FC\u30BF\u306E\u5F62\u5F0F\u306B\u5BFE\u5FDC\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      case "scraping":
        return {
          title: "\u30C7\u30FC\u30BF\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
          description: "\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
      default:
        return {
          title: "\u30C7\u30FC\u30BF\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
          description: "\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
          actionLabel: "\u518D\u8A66\u884C\u3059\u308B"
        };
    }
  }
  function openExtensionLoginPage() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      showResearchNotice("\u62E1\u5F35\u6A5F\u80FD\u306E\u30ED\u30B0\u30A4\u30F3\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      return;
    }
    chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_LOGIN" }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        showResearchNotice(response?.message ?? "\u62E1\u5F35\u6A5F\u80FD\u306E\u30ED\u30B0\u30A4\u30F3\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      }
    });
  }
  function renderResearchError(container, error, retry, retryCount = 0) {
    const kind = getResearchErrorKind(error);
    if (kind === "limit") {
      cachedResearchAccess = null;
    }
    const copy = getResearchErrorCopy(kind);
    const retryAfter = getResearchRetryAfter(error);
    const appUrl = getOverlayWindow().FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000";
    const wrapper = document.createElement("div");
    wrapper.className = "furimane-research-overlay__state furimane-research-overlay__state--error";
    const title = document.createElement("h3");
    title.className = "furimane-research-overlay__state-title";
    title.textContent = copy.title;
    const description = createParagraph(copy.description);
    wrapper.append(title, description);
    if ((kind === "rate_limit" || kind === "maintenance") && retryAfter) {
      wrapper.appendChild(createParagraph(`\u7D04${retryAfter}\u79D2\u5F8C\u306B\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002`, "furimane-research-overlay__support-text"));
    }
    if (kind === "scraping" || kind === "unknown") {
      const detail = createParagraph(getResearchErrorSupportText(kind), "furimane-research-overlay__support-text");
      wrapper.appendChild(detail);
    }
    if (kind === "auth") {
      wrapper.appendChild(createButton(copy.actionLabel, openExtensionLoginPage, "secondary"));
    } else if (kind === "plan" || kind === "limit") {
      const link = document.createElement("a");
      link.className = "furimane-research-overlay__link-button";
      link.href = `${appUrl}/dashboard/research`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = copy.actionLabel;
      wrapper.appendChild(link);
    } else if (isRetryableResearchErrorKind(kind) && retryCount < FURIMANE_MAX_RETRY_COUNT) {
      wrapper.appendChild(createButton(copy.actionLabel, retry, "secondary"));
    } else {
      const support = createParagraph(
        kind === "update_required" ? "Chrome\u306E\u62E1\u5F35\u6A5F\u80FD\u7BA1\u7406\u753B\u9762\u3067\u30D5\u30EA\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC\u3092\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : kind === "payload_too_large" ? "\u4F55\u5EA6\u3082\u767A\u751F\u3059\u308B\u5834\u5408\u306F\u3001\u5BFE\u8C61\u30DA\u30FC\u30B8\u306EURL\u3092\u6DFB\u3048\u3066\u30B5\u30DD\u30FC\u30C8\u3078\u9023\u7D61\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : kind === "rate_limit" ? "\u5C11\u3057\u6642\u9593\u3092\u7F6E\u3044\u3066\u304B\u3089\u3001\u3082\u3046\u4E00\u5EA6\u30EA\u30B5\u30FC\u30C1\u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002" : kind === "maintenance" ? "\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9\u89E3\u9664\u5F8C\u306B\u3001\u3082\u3046\u4E00\u5EA6\u30EA\u30B5\u30FC\u30C1\u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002" : "\u518D\u8A66\u884C\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3082\u76F4\u3089\u306A\u3044\u5834\u5408\u306F\u30B5\u30DD\u30FC\u30C8\u3078\u9023\u7D61\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
      support.className = "furimane-research-overlay__support-text";
      wrapper.appendChild(support);
    }
    setOverlayBody(container, [wrapper]);
  }
  function renderResults(container, data, sourceLabel) {
    const body = getOverlayBody(container);
    const table = getOverlayWindow().FurimanagerResearchTable;
    const api = getOverlayWindow().FurimanagerResearchApi;
    if (!body || !table) {
      setOverlayBody(container, [createParagraph("\u30EA\u30B5\u30FC\u30C1\u7D50\u679C\u306E\u8868\u793A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002")]);
      return;
    }
    table.renderTable(body, data.seller, data.listings, {
      sourceLabel,
      usage: currentResearchUsage,
      stats: data.stats ?? null,
      periodAnalysis: data.periodAnalysis ?? null,
      onRefresh: () => {
        return runResearchFlowSafe(container, { forceRefresh: true });
      },
      onSaveSeller: async (seller) => {
        if (!api?.saveSeller) {
          throw new Error("\u4FDD\u5B58API\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        }
        await api.saveSeller({
          platform: seller.platform || getOverlayWindow().FurimanagerResearchScraper?.getPlatformFromCurrentUrl?.() || "mercari",
          seller_id: seller.seller_id ?? "",
          seller_name: seller.seller_name ?? null,
          seller_url: seller.seller_url ?? window.location.href
        });
      }
    });
  }
  function renderResearchProgress(container, seller, count, details, mode = "dom") {
    const progressListings = Array.isArray(details?.listings) ? details.listings : null;
    if (details?.phase === "dom_fallback" || mode === "dom_fallback") {
      renderLoading(container, count > 0 ? `\u901A\u5E38\u53D6\u5F97\u306B\u5207\u308A\u66FF\u3048\u3066\u8AAD\u307F\u8FBC\u307F\u4E2D... \u73FE\u5728 ${count}\u4EF6` : "\u53D6\u5F97\u304C\u5B89\u5B9A\u3057\u306A\u3044\u305F\u3081\u3001\u901A\u5E38\u53D6\u5F97\u306B\u5207\u308A\u66FF\u3048\u3066\u3044\u307E\u3059...");
      return;
    }
    if (details?.phase === "api_progress" || details?.partial === true) {
      const totalCount2 = typeof details?.totalCount === "number" ? details.totalCount : count;
      renderLoading(container, `\u30EA\u30B5\u30FC\u30C1\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u4E2D... \u73FE\u5728 ${totalCount2}\u4EF6`);
      return;
    }
    if (!progressListings || progressListings.length === 0) {
      renderLoading(container, mode === "api" ? `\u30EA\u30B5\u30FC\u30C1\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u4E2D... \u73FE\u5728 ${count}\u4EF6` : `\u901A\u5E38\u53D6\u5F97\u4E2D... \u73FE\u5728 ${count}\u4EF6`);
      return;
    }
    const totalCount = typeof details?.totalCount === "number" ? details.totalCount : progressListings.length;
    const sourceLabel = details?.phase === "api_done" || details?.partial === false ? `\u53D6\u5F97\u5B8C\u4E86\uFF1A${totalCount}\u4EF6` : `\u53D6\u5F97\u4E2D\uFF1A${totalCount}\u4EF6\u3092\u8868\u793A\u4E2D`;
    renderResults(container, {
      seller: {
        ...seller,
        fetched_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      listings: progressListings
    }, sourceLabel);
  }
  function saveResearchDataInBackground(data, signal) {
    const api = getOverlayWindow().FurimanagerResearchApi;
    if (!api) {
      return;
    }
    void api.saveResearchData(data.seller, data.listings, { signal }).then((result) => {
      const usage = result && typeof result === "object" ? result.usage : null;
      updateResearchUsageChip(usage);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.warn("[furimane-research] background save failed", error);
      showResearchNotice("\u30B5\u30FC\u30D0\u30FC\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u5185\u30AD\u30E3\u30C3\u30B7\u30E5\u306E\u307F\u4FDD\u5B58\u3055\u308C\u3066\u3044\u307E\u3059\u3002");
    });
  }
  function persistResearchDataAfterPaint(data, signal) {
    window.setTimeout(() => {
      writeLocalResearchCache(data);
      if (data.savedOnServer === true) {
        updateResearchUsageChip(data.usage ?? null);
        return;
      }
      saveResearchDataInBackground(data, signal);
    }, 0);
  }
  async function runResearchFlowSafe(container, options = {}) {
    currentAbortController?.abort();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    const retryCount = options.retryCount ?? 0;
    const retry = () => runResearchFlowSafe(container, { ...options, retryCount: retryCount + 1 });
    const api = getOverlayWindow().FurimanagerResearchApi;
    const scraper = getOverlayWindow().FurimanagerResearchScraper;
    let renderedCache = false;
    if (!api || !scraper) {
      const error = new Error("scraping_failed");
      console.error("[furimane-research] modules missing", { hasApi: Boolean(api), hasScraper: Boolean(scraper) });
      renderResearchError(container, error, retry, retryCount);
      return;
    }
    try {
      renderLoading(container, "\u30A2\u30AF\u30BB\u30B9\u78BA\u8A8D\u4E2D...");
      const seller = scraper.getSellerContextFromCurrentPage?.();
      if (!seller) {
        const error = new Error("seller_id_not_found");
        console.error("[furimane-research] seller context not found", { url: window.location.href });
        renderResearchError(container, error, retry, retryCount);
        return;
      }
      const localCachedData = options.forceRefresh ? null : readLocalResearchCache(seller);
      let access;
      try {
        access = await checkResearchAccessWithCache(api, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (canShowLocalCacheAfterAccessError(error) && hasRenderableResearchData(localCachedData)) {
          renderResults(container, localCachedData, "\u30D6\u30E9\u30A6\u30B6\u30AD\u30E3\u30C3\u30B7\u30E5");
          return;
        }
        if (canContinueResearchWithoutAccessCheck(error, api)) {
          console.warn("[furimane-research] access check failed; continuing in local dev mode", error);
          access = { canUseResearch: true };
        } else {
          throw error;
        }
      }
      if (!(access.canUseResearch ?? access.canUse)) {
        if (access.usage?.allowed === false) {
          const cache = options.forceRefresh ? null : await api.checkCache(seller.seller_id, seller.platform, { signal });
          const cachedData = getCachedResearchData(cache);
          if (hasRenderableResearchData(cachedData)) {
            renderResults(container, cachedData, "24\u6642\u9593\u4EE5\u5185\u306E\u30AD\u30E3\u30C3\u30B7\u30E5");
            writeLocalResearchCache(cachedData);
            return;
          }
        }
        renderResearchError(
          container,
          new Error(access.usage?.allowed === false ? "research_monthly_limit_exceeded" : "plan_required"),
          retry,
          retryCount
        );
        return;
      }
      if (hasRenderableResearchData(localCachedData)) {
        renderResults(container, localCachedData, "\u30D6\u30E9\u30A6\u30B6\u30AD\u30E3\u30C3\u30B7\u30E5");
        return;
      }
      const strategy = getResearchFetchStrategy();
      console.log("[furimane-research] fetch strategy selected", {
        strategy,
        sellerId: seller.seller_id
      });
      const fetchResearchData = getResearchFetchFunction(scraper);
      if (!fetchResearchData) {
        throw new Error("research_scraper_method_missing");
      }
      renderLoading(container, options.forceRefresh ? "\u6700\u65B0\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u4E2D..." : "\u30EA\u30B5\u30FC\u30C1\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u4E2D...");
      let cacheDecisionDone = options.forceRefresh === true;
      let flowSettled = false;
      let progressMode = strategy;
      const liveAbortController = createChildAbortController(signal);
      const liveFetchPromise = fetchResearchData({
        strategy,
        signal: liveAbortController.signal,
        onProgress: (count, details) => {
          if (details?.phase === "dom_fallback") {
            progressMode = "dom_fallback";
          }
          if (!cacheDecisionDone || flowSettled) {
            return;
          }
          renderResearchProgress(container, seller, count, details, progressMode);
        }
      }).then(
        (scraped2) => ({ type: "live", scraped: scraped2 }),
        (error) => ({ type: "live_error", error })
      );
      const cachePromise = options.forceRefresh ? Promise.resolve({ type: "cache", cachedData: null }) : api.checkCache(seller.seller_id, seller.platform, { signal }).then((cache) => ({ type: "cache", cachedData: getCachedResearchData(cache) })).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.warn("[furimane-research] cache check failed; continuing with live fetch", error);
        return { type: "cache", cachedData: null };
      });
      const firstResult = await Promise.race([cachePromise, liveFetchPromise]);
      if (firstResult.type === "cache") {
        cacheDecisionDone = true;
        if (hasRenderableResearchData(firstResult.cachedData)) {
          flowSettled = true;
          liveAbortController.abort();
          renderResults(container, firstResult.cachedData, "24\u6642\u9593\u4EE5\u5185\u306E\u30AD\u30E3\u30C3\u30B7\u30E5");
          writeLocalResearchCache(firstResult.cachedData);
          return;
        }
        renderLoading(container, strategy === "api" ? "\u30EA\u30B5\u30FC\u30C1\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u4E2D... \u53D6\u5F97\u3067\u304D\u305F\u5206\u304B\u3089\u53CD\u6620\u3057\u307E\u3059" : "\u901A\u5E38\u53D6\u5F97\u4E2D... \u73FE\u5728 0\u4EF6");
        const liveResult = await liveFetchPromise;
        if (liveResult.type === "live_error") {
          throw liveResult.error;
        }
        const scraped2 = liveResult.scraped;
        const finalSourceLabel2 = strategy === "api" && scraped2.strategy === "api" ? "\u53D6\u5F97\u5B8C\u4E86" : strategy === "api" && scraped2.strategy === "dom" ? "\u901A\u5E38\u53D6\u5F97\u3067\u8868\u793A" : "\u65B0\u898F\u53D6\u5F97";
        flowSettled = true;
        scraped2.seller.fetched_at = (/* @__PURE__ */ new Date()).toISOString();
        renderResults(container, scraped2, finalSourceLabel2);
        persistResearchDataAfterPaint(scraped2, signal);
        return;
      }
      if (firstResult.type === "live_error") {
        throw firstResult.error;
      }
      flowSettled = true;
      cacheDecisionDone = true;
      const scraped = firstResult.scraped;
      const finalSourceLabel = strategy === "api" && scraped.strategy === "api" ? "\u53D6\u5F97\u5B8C\u4E86" : strategy === "api" && scraped.strategy === "dom" ? "\u901A\u5E38\u53D6\u5F97\u3067\u8868\u793A" : "\u65B0\u898F\u53D6\u5F97";
      scraped.seller.fetched_at = (/* @__PURE__ */ new Date()).toISOString();
      renderResults(container, scraped, finalSourceLabel);
      persistResearchDataAfterPaint(scraped, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("[furimane-research] flow failed", error);
      if (renderedCache) {
        console.warn("[furimane-research] refresh failed; showing cached result");
        return;
      }
      renderResearchError(container, error, retry, retryCount);
    }
  }
  function removeOpenButton() {
    document.getElementById(FURIMANE_OPEN_BUTTON_ID)?.remove();
  }
  function createOpenButton() {
    if (document.getElementById(FURIMANE_OPEN_BUTTON_ID)) {
      return;
    }
    const button = document.createElement("button");
    button.id = FURIMANE_OPEN_BUTTON_ID;
    button.className = "furimane-research-open-button";
    button.type = "button";
    button.textContent = "\u30EA\u30B5\u30FC\u30C1\u3092\u958B\u304F";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      localStorage.removeItem(FURIMANE_CLOSED_STORAGE_KEY);
      button.remove();
      renderResearchOverlay({ forceFallback: true, scrollIntoView: true });
    });
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    document.body.appendChild(button);
  }
  function createResearchOverlay() {
    const container = document.createElement("div");
    container.id = FURIMANE_OVERLAY_ID;
    container.className = "furimane-research-overlay";
    const header = document.createElement("div");
    header.className = "furimane-research-overlay__header";
    const title = document.createElement("div");
    title.className = "furimane-research-overlay__title";
    title.textContent = "\u30D5\u30EA\u30DE\u30CD \u30EA\u30B5\u30FC\u30C1";
    const closeButton = document.createElement("button");
    closeButton.className = "furimane-research-overlay__close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "\u30EA\u30B5\u30FC\u30C1\u3092\u9589\u3058\u308B");
    closeButton.textContent = "\xD7";
    closeButton.addEventListener("click", () => {
      currentAbortController?.abort();
      localStorage.setItem(FURIMANE_CLOSED_STORAGE_KEY, "true");
      container.remove();
      createOpenButton();
    });
    header.append(title, closeButton);
    const body = document.createElement("div");
    body.className = "furimane-research-overlay__body";
    body.appendChild(createParagraph("\u30C7\u30FC\u30BF\u53D6\u5F97\u4E2D..."));
    container.append(header, body);
    return container;
  }
  function renderResearchOverlay(options = {}) {
    const supportStatus = getResearchPageSupportStatus();
    const pageKey = getResearchPageKey();
    if (supportStatus === "unsupported") {
      logUnsupportedResearchPage();
      return;
    }
    if (supportStatus !== "supported" || !pageKey) {
      return;
    }
    currentResearchPageKey = pageKey;
    if (document.getElementById(FURIMANE_OVERLAY_ID)) {
      return;
    }
    if (localStorage.getItem(FURIMANE_CLOSED_STORAGE_KEY) === "true") {
      createOpenButton();
      return;
    }
    removeOpenButton();
    const overlay = createResearchOverlay();
    let insertTarget = findOverlayInsertTarget();
    if (!insertTarget) {
      if (options.forceFallback) {
        insertTarget = findOverlayFallbackInsertTarget();
      }
      if (!insertTarget) {
        overlayInsertRetryCount += 1;
        if (overlayInsertRetryCount <= FURIMANE_MAX_INLINE_INSERT_RETRY_COUNT) {
          scheduleResearchOverlaySync();
          return;
        }
        insertTarget = findOverlayFallbackInsertTarget();
      }
      if (!insertTarget) {
        scheduleResearchOverlaySync();
        return;
      }
    } else {
      overlayInsertRetryCount = 0;
    }
    if (insertTarget.isFixedFallback) {
      overlay.classList.add("furimane-research-overlay--fixed");
    }
    insertTarget.parent.insertBefore(overlay, insertTarget.before);
    console.log("[furimane-research] overlay inserted", { reason: insertTarget.reason });
    if (options.scrollIntoView && !insertTarget.isFixedFallback) {
      overlay.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    void runResearchFlowSafe(overlay);
  }
  function removeResearchOverlayUi() {
    currentAbortController?.abort();
    currentAbortController = null;
    document.getElementById(FURIMANE_OVERLAY_ID)?.remove();
    removeOpenButton();
  }
  async function syncResearchOverlayForCurrentPage() {
    if (!await isResearchFeatureEnabled()) {
      removeResearchOverlayUi();
      currentResearchPageKey = null;
      overlayInsertRetryCount = 0;
      return;
    }
    const supportStatus = getResearchPageSupportStatus();
    const pageKey = getResearchPageKey();
    if (supportStatus !== "supported" || !pageKey) {
      if (currentResearchPageKey || document.getElementById(FURIMANE_OVERLAY_ID)) {
        removeResearchOverlayUi();
      }
      currentResearchPageKey = null;
      overlayInsertRetryCount = 0;
      return;
    }
    if (currentResearchPageKey && currentResearchPageKey !== pageKey) {
      removeResearchOverlayUi();
      overlayInsertRetryCount = 0;
    }
    currentResearchPageKey = pageKey;
    renderResearchOverlay();
  }
  function scheduleResearchOverlaySync() {
    if (routeSyncTimerId !== null) {
      window.clearTimeout(routeSyncTimerId);
    }
    routeSyncTimerId = window.setTimeout(() => {
      routeSyncTimerId = null;
      void waitForReady().then(() => syncResearchOverlayForCurrentPage());
    }, FURIMANE_ROUTE_SYNC_DELAY_MS);
  }
  function handlePossibleResearchRouteChange() {
    if (lastObservedUrl === window.location.href) {
      return;
    }
    lastObservedUrl = window.location.href;
    scheduleResearchOverlaySync();
  }
  function installResearchNavigationListener() {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(data, unused, url) {
      originalPushState.call(this, data, unused, url);
      handlePossibleResearchRouteChange();
    };
    window.history.replaceState = function replaceState(data, unused, url) {
      originalReplaceState.call(this, data, unused, url);
      handlePossibleResearchRouteChange();
    };
    window.addEventListener("popstate", () => {
      handlePossibleResearchRouteChange();
    });
    window.addEventListener("pageshow", () => {
      scheduleResearchOverlaySync();
    });
    const observer = new MutationObserver(handlePossibleResearchRouteChange);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  function installResearchSettingListener() {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }
      if (FURIMANE_RESEARCH_ENABLED_KEY in changes) {
        if (changes[FURIMANE_RESEARCH_ENABLED_KEY]?.newValue === false) {
          removeResearchOverlayUi();
          currentResearchPageKey = null;
          return;
        }
        scheduleResearchOverlaySync();
        return;
      }
      const authSessionChanged = ["supabaseAccessToken", "supabaseRefreshToken", "supabaseUser"].some((key) => key in changes);
      if (!authSessionChanged) {
        return;
      }
      cachedResearchAccess = null;
      const overlay = document.getElementById(FURIMANE_OVERLAY_ID);
      if (overlay) {
        void runResearchFlowSafe(overlay, { retryCount: 0 });
      }
    });
  }
  window.addEventListener("beforeunload", () => {
    currentAbortController?.abort();
  });
  installResearchNavigationListener();
  installResearchSettingListener();
  void waitForReady().then(() => syncResearchOverlayForCurrentPage());
})();
