const FURIMANE_PROFILE_URL_PREFIX = "https://jp.mercari.com/user/profile/";
const FURIMANE_SHOPS_PROFILE_URL_PREFIX = "https://jp.mercari.com/shops/profile/";
const FURIMANE_OVERLAY_ID = "furimane-research-overlay";
const FURIMANE_OPEN_BUTTON_ID = "furimane-research-open-button";
const FURIMANE_CLOSED_STORAGE_KEY = "furimane-research-closed";
const FURIMANE_MAX_RETRY_COUNT = 3;
const FURIMANE_DEFAULT_FETCH_STRATEGY = "api";
const FURIMANE_FETCH_STRATEGY_STORAGE_KEY = "furimane-research-fetch-strategy";
const FURIMANE_READY_DELAY_MS = 250;
const FURIMANE_ROUTE_SYNC_DELAY_MS = 250;
const FURIMANE_MAX_INLINE_INSERT_RETRY_COUNT = 12;
const FURIMANE_LOCAL_RESEARCH_CACHE_PREFIX = "furimane-research-local-cache:";
const FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let currentAbortController = null;
let currentResearchPageKey = null;
let routeSyncTimerId = null;
let lastObservedUrl = window.location.href;
let overlayInsertRetryCount = 0;
function getOverlayWindow() {
    return window;
}
function getResearchFetchStrategy() {
    const storedStrategy = localStorage.getItem(FURIMANE_FETCH_STRATEGY_STORAGE_KEY);
    return storedStrategy === "dom" ? "dom" : FURIMANE_DEFAULT_FETCH_STRATEGY;
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
    return cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);
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
    return Boolean(value.seller && Array.isArray(value.listings));
}
function hasRenderableResearchData(data) {
    return Boolean(data && Array.isArray(data.listings) && data.listings.length > 0);
}
function hasResearchPeriodData(data) {
    return Boolean(data && hasPeriodAnalysisData(data.listings));
}
function shouldRenderCacheData(data, renderedCache, renderedCacheHasPeriodData) {
    if (!hasRenderableResearchData(data)) {
        return false;
    }
    const nextHasPeriodData = hasResearchPeriodData(data);
    return !renderedCache || nextHasPeriodData || !renderedCacheHasPeriodData;
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
        if (typeof parsed.savedAt !== "number" ||
            Date.now() - parsed.savedAt > FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS ||
            !isResearchResultData(parsed.data)) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        return parsed.data;
    }
    catch (error) {
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
        localStorage.setItem(cacheKey, JSON.stringify({
            savedAt: Date.now(),
            data
        }));
    }
    catch (error) {
        console.warn("[furimane-research] local cache write failed", error);
    }
}
function hasUsablePeriodDate(value) {
    if (!value) {
        return false;
    }
    return !Number.isNaN(new Date(value).getTime());
}
function hasPeriodAnalysisData(listings) {
    return (listings ?? []).some((listing) => (hasUsablePeriodDate(listing.period_date) || hasUsablePeriodDate(listing.sold_at)));
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
    const itemLinks = Array.from(document.querySelectorAll('main a[href*="/item/"], main a[href*="/shops/product/"]'));
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
        return text.includes("出品") || text.includes("商品") || text.includes("一覧");
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
function formatPrice(price) {
    return `¥${price.toLocaleString("ja-JP")}`;
}
function formatDate(value) {
    if (!value) {
        return "日付不明";
    }
    return new Date(value).toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
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
function renderAccessLocked(container) {
    const wrapper = document.createElement("div");
    wrapper.className = "furimane-research-overlay__state";
    const title = document.createElement("h3");
    title.className = "furimane-research-overlay__state-title";
    title.textContent = "リサーチ追加プランで利用できます";
    const description = createParagraph("出品者の販売履歴分析を使うには、フリマネ側でリサーチ追加プランに加入してください。");
    const link = document.createElement("a");
    link.className = "furimane-research-overlay__link-button";
    link.href = `${getOverlayWindow().FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000"}/dashboard/research`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "リサーチ追加プランを確認する";
    wrapper.append(title, description, link);
    setOverlayBody(container, [wrapper]);
}
function renderError(container, message, retry) {
    const wrapper = document.createElement("div");
    wrapper.className = "furimane-research-overlay__state";
    const title = document.createElement("h3");
    title.className = "furimane-research-overlay__state-title";
    title.textContent = message === "auth_required" ? "フリマネにログインしてください" : "取得に失敗しました。再試行してください";
    const description = createParagraph(message === "auth_required"
        ? "拡張機能のポップアップからフリマネにログインしてから、もう一度お試しください。"
        : message);
    const retryButton = createButton("再試行する", retry, "secondary");
    wrapper.append(title, description, retryButton);
    setOverlayBody(container, [wrapper]);
}
function getResearchErrorKind(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "auth_required") {
        return "auth";
    }
    if (message === "plan_required") {
        return "plan";
    }
    if (message === "api_timeout" || message === "network_error") {
        return "timeout";
    }
    if (message === "seller_id_not_found" || message === "mercari_dom_changed") {
        return "dom_changed";
    }
    if (message === "scraping_failed") {
        return "scraping";
    }
    return "unknown";
}
function getResearchErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function getResearchFetchFunction(scraper) {
    return scraper.fetchSellerResearchData ?? scraper.scrapeSellerPage ?? null;
}
function getResearchErrorCopy(kind) {
    switch (kind) {
        case "auth":
            return {
                title: "フリマネにログインしてください",
                description: "リサーチ機能を使うには、先にフリマネへログインしてください。",
                actionLabel: "ログインページを開く"
            };
        case "plan":
            return {
                title: "リサーチ追加プランでご利用いただけます",
                description: "この機能はリサーチ追加プラン加入後に利用できます。",
                actionLabel: "プランを確認する"
            };
        case "timeout":
            return {
                title: "通信エラーが発生しました",
                description: "通信に時間がかかっています。少し時間を置いて再試行してください。",
                actionLabel: "再試行する"
            };
        case "dom_changed":
            return {
                title: "メルカリのページ構造が変わっている可能性があります",
                description: "商品情報を読み取れませんでした。ページを再読み込みしても直らない場合はサポートへ連絡してください。",
                actionLabel: "再試行する"
            };
        case "scraping":
            return {
                title: "データ取得に失敗しました",
                description: "ページを再読み込みしてお試しください。",
                actionLabel: "再試行する"
            };
        default:
            return {
                title: "データ取得に失敗しました",
                description: "ページを再読み込みしてお試しください。",
                actionLabel: "再試行する"
            };
    }
}
function renderResearchError(container, error, retry, retryCount = 0) {
    const kind = getResearchErrorKind(error);
    const copy = getResearchErrorCopy(kind);
    const errorMessage = getResearchErrorMessage(error);
    const appUrl = getOverlayWindow().FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000";
    const wrapper = document.createElement("div");
    wrapper.className = "furimane-research-overlay__state furimane-research-overlay__state--error";
    const title = document.createElement("h3");
    title.className = "furimane-research-overlay__state-title";
    title.textContent = copy.title;
    const description = createParagraph(copy.description);
    wrapper.append(title, description);
    if (kind === "scraping" || kind === "unknown") {
        const detail = createParagraph(`原因コード: ${errorMessage}`, "furimane-research-overlay__support-text");
        wrapper.appendChild(detail);
    }
    if (kind === "auth" || kind === "plan") {
        const link = document.createElement("a");
        link.className = "furimane-research-overlay__link-button";
        link.href = kind === "auth" ? `${appUrl}/login` : `${appUrl}/dashboard/research`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = copy.actionLabel;
        wrapper.appendChild(link);
    }
    else if (retryCount < FURIMANE_MAX_RETRY_COUNT) {
        wrapper.appendChild(createButton(copy.actionLabel, retry, "secondary"));
    }
    else {
        const support = createParagraph("再試行上限に達しました。ページを再読み込みしても直らない場合はサポートへ連絡してください。");
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
        setOverlayBody(container, [createParagraph("リサーチ結果の表示に失敗しました。")]);
        return;
    }
    table.renderTable(body, data.seller, data.listings, {
        sourceLabel,
        onRefresh: () => {
            return runResearchFlowSafe(container, { forceRefresh: true });
        },
        onSaveSeller: async (seller) => {
            if (!api?.saveSeller) {
                throw new Error("保存APIを読み込めませんでした。");
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
        renderLoading(container, count > 0
            ? `通常取得に切り替えて読み込み中... 現在 ${count}件`
            : "取得が安定しないため、通常取得に切り替えています...");
        return;
    }
    if (details?.phase === "api_progress" || details?.partial === true) {
        const totalCount = typeof details?.totalCount === "number" ? details.totalCount : count;
        renderLoading(container, `リサーチデータを取得中... 現在 ${totalCount}件`);
        return;
    }
    if (!progressListings || progressListings.length === 0) {
        renderLoading(container, mode === "api"
            ? `リサーチデータを取得中... 現在 ${count}件`
            : `通常取得中... 現在 ${count}件`);
        return;
    }
    const totalCount = typeof details?.totalCount === "number" ? details.totalCount : progressListings.length;
    const sourceLabel = details?.phase === "api_done" || details?.partial === false
        ? `取得完了：${totalCount}件`
        : `取得中：${totalCount}件を表示中`;
    renderResults(container, {
        seller: {
            ...seller,
            fetched_at: new Date().toISOString()
        },
        listings: progressListings
    }, sourceLabel);
}
function saveResearchDataInBackground(data, signal) {
    const api = getOverlayWindow().FurimanagerResearchApi;
    if (!api) {
        return;
    }
    void api.saveResearchData(data.seller, data.listings, { signal }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }
        console.warn("[furimane-research] background save failed", error);
    });
}
async function runResearchFlow(container, options = {}) {
    currentAbortController?.abort();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    const api = getOverlayWindow().FurimanagerResearchApi;
    const scraper = getOverlayWindow().FurimanagerResearchScraper;
    let renderedCache = false;
    let renderedCacheHasPeriodData = false;
    if (!api || !scraper) {
        renderError(container, "リサーチ機能の読み込みに失敗しました。", () => runResearchFlow(container));
        return;
    }
    try {
        renderLoading(container, "アクセス確認中...");
        const access = await api.checkAccess({ signal });
        if (!(access.canUseResearch ?? access.canUse)) {
            renderAccessLocked(container);
            return;
        }
        const seller = scraper.getSellerContextFromCurrentPage?.();
        if (!seller) {
            renderError(container, "出品者情報を取得できませんでした。", () => runResearchFlow(container));
            return;
        }
        renderLoading(container, "キャッシュ確認中...");
        const cache = options.forceRefresh ? null : await api.checkCache(seller.seller_id, seller.platform, { signal });
        const cachedData = getCachedResearchData(cache);
        if (hasRenderableResearchData(cachedData)) {
            renderResults(container, cachedData, "24\u6642\u9593\u4ee5\u5185\u306e\u30ad\u30e3\u30c3\u30b7\u30e5");
            writeLocalResearchCache(cachedData);
            renderedCache = true;
        }
        const strategy = getResearchFetchStrategy();
        console.log("[furimane-research] fetch strategy selected", {
            strategy,
            sellerId: seller.seller_id
        });
        if (!renderedCache) {
            renderLoading(container, strategy === "api"
                ? "\u30ea\u30b5\u30fc\u30c1\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d... \u53d6\u5f97\u3067\u304d\u305f\u5206\u304b\u3089\u53cd\u6620\u3057\u307e\u3059"
                : "\u901a\u5e38\u53d6\u5f97\u4e2d... \u73fe\u5728 0\u4ef6");
        }
        let progressMode = strategy;
        const fetchResearchData = getResearchFetchFunction(scraper);
        if (!fetchResearchData) {
            throw new Error("research_scraper_method_missing");
        }
        const scraped = await fetchResearchData({
            strategy,
            signal,
            onProgress: (count, details) => {
                if (details?.phase === "dom_fallback") {
                    progressMode = "dom_fallback";
                }
                if (renderedCache) {
                    return;
                }
                renderResearchProgress(container, seller, count, details, progressMode);
            }
        });
        const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
            ? "取得完了"
            : strategy === "api" && scraped.strategy === "dom"
                ? "通常取得で表示"
                : "新規取得";
        scraped.seller.fetched_at = new Date().toISOString();
        renderResults(container, scraped, finalSourceLabel);
        writeLocalResearchCache(scraped);
        saveResearchDataInBackground(scraped, signal);
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }
        const message = error instanceof Error ? error.message : "取得に失敗しました。";
        console.error("[furimane-research] flow failed", error);
        if (renderedCache) {
            console.warn("[furimane-research] refresh failed; showing cached result");
            return;
        }
        renderError(container, message, () => runResearchFlow(container));
    }
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
    let renderedCacheHasPeriodData = false;
    if (!api || !scraper) {
        const error = new Error("scraping_failed");
        console.error("[furimane-research] modules missing", { hasApi: Boolean(api), hasScraper: Boolean(scraper) });
        renderResearchError(container, error, retry, retryCount);
        return;
    }
    try {
        renderLoading(container, "\u30a2\u30af\u30bb\u30b9\u78ba\u8a8d\u4e2d...");
        const seller = scraper.getSellerContextFromCurrentPage?.();
        if (!seller) {
            const error = new Error("seller_id_not_found");
            console.error("[furimane-research] seller context not found", { url: window.location.href });
            renderResearchError(container, error, retry, retryCount);
            return;
        }
        const localCachedData = options.forceRefresh ? null : readLocalResearchCache(seller);
        if (hasRenderableResearchData(localCachedData)) {
            renderResults(container, localCachedData, "\u30d6\u30e9\u30a6\u30b6\u30ad\u30e3\u30c3\u30b7\u30e5");
            renderedCache = true;
            renderedCacheHasPeriodData = hasResearchPeriodData(localCachedData);
        }
        if (!renderedCache) {
            renderLoading(container, options.forceRefresh ? "\u6700\u65b0\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d..." : "\u30ad\u30e3\u30c3\u30b7\u30e5\u78ba\u8a8d\u4e2d...");
        }
        const accessPromise = api.checkAccess({ signal });
        const cachePromise = options.forceRefresh
            ? Promise.resolve(null)
            : api.checkCache(seller.seller_id, seller.platform, { signal }).catch((error) => {
                console.warn("[furimane-research] cache check failed; continuing with live fetch", error);
                return null;
            });
        const cache = await cachePromise;
        const cachedData = getCachedResearchData(cache);
        if (shouldRenderCacheData(cachedData, renderedCache, renderedCacheHasPeriodData)) {
            const cachedDataHasPeriodData = hasResearchPeriodData(cachedData);
            renderResults(container, cachedData, "24\u6642\u9593\u4ee5\u5185\u306e\u30ad\u30e3\u30c3\u30b7\u30e5");
            if (cachedDataHasPeriodData || !renderedCacheHasPeriodData) {
                writeLocalResearchCache(cachedData);
            }
            renderedCache = true;
            renderedCacheHasPeriodData = cachedDataHasPeriodData;
        }
        else if (cachedData && renderedCache) {
            console.info("[furimane-research] skipped lower quality server cache");
        }
        const access = await accessPromise;
        if (!(access.canUseResearch ?? access.canUse)) {
            renderResearchError(container, new Error("plan_required"), retry, retryCount);
            return;
        }
        const strategy = getResearchFetchStrategy();
        console.log("[furimane-research] fetch strategy selected", {
            strategy,
            sellerId: seller.seller_id
        });
        if (!renderedCache) {
            renderLoading(container, strategy === "api"
                ? "\u30ea\u30b5\u30fc\u30c1\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d... \u53d6\u5f97\u3067\u304d\u305f\u5206\u304b\u3089\u53cd\u6620\u3057\u307e\u3059"
                : "\u901a\u5e38\u53d6\u5f97\u4e2d... \u73fe\u5728 0\u4ef6");
        }
        let progressMode = strategy;
        const fetchResearchData = getResearchFetchFunction(scraper);
        if (!fetchResearchData) {
            throw new Error("research_scraper_method_missing");
        }
        const scraped = await fetchResearchData({
            strategy,
            signal,
            onProgress: (count, details) => {
                if (details?.phase === "dom_fallback") {
                    progressMode = "dom_fallback";
                }
                if (renderedCache) {
                    return;
                }
                renderResearchProgress(container, seller, count, details, progressMode);
            }
        });
        const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
            ? "\u53d6\u5f97\u5b8c\u4e86"
            : strategy === "api" && scraped.strategy === "dom"
                ? "\u901a\u5e38\u53d6\u5f97\u3067\u8868\u793a"
                : "\u65b0\u898f\u53d6\u5f97";
        scraped.seller.fetched_at = new Date().toISOString();
        renderResults(container, scraped, finalSourceLabel);
        writeLocalResearchCache(scraped);
        saveResearchDataInBackground(scraped, signal);
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }
        console.error("[furimane-research] research flow failed", error);
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
    button.textContent = "リサーチを開く";
    button.addEventListener("click", () => {
        localStorage.removeItem(FURIMANE_CLOSED_STORAGE_KEY);
        button.remove();
        renderResearchOverlay();
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
    const logo = document.createElement("img");
    logo.className = "furimane-research-overlay__logo";
    logo.src = chrome.runtime.getURL("icons/icon-48.png");
    logo.alt = "";
    logo.decoding = "async";
    const titleText = document.createElement("span");
    titleText.textContent = "フリマネ リサーチ";
    title.append(logo, titleText);
    const closeButton = document.createElement("button");
    closeButton.className = "furimane-research-overlay__close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "リサーチを閉じる");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
        currentAbortController?.abort();
        localStorage.setItem(FURIMANE_CLOSED_STORAGE_KEY, "true");
        container.remove();
        createOpenButton();
    });
    header.append(title, closeButton);
    const body = document.createElement("div");
    body.className = "furimane-research-overlay__body";
    body.appendChild(createParagraph("データ取得中..."));
    container.append(header, body);
    return container;
}
function renderResearchOverlay() {
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
        overlayInsertRetryCount += 1;
        if (overlayInsertRetryCount <= FURIMANE_MAX_INLINE_INSERT_RETRY_COUNT) {
            scheduleResearchOverlaySync();
            return;
        }
        insertTarget = findOverlayFallbackInsertTarget();
        if (!insertTarget) {
            scheduleResearchOverlaySync();
            return;
        }
    }
    else {
        overlayInsertRetryCount = 0;
    }
    if (insertTarget.isFixedFallback) {
        overlay.classList.add("furimane-research-overlay--fixed");
    }
    insertTarget.parent.insertBefore(overlay, insertTarget.before);
    console.log("[furimane-research] overlay inserted", { reason: insertTarget.reason });
    void runResearchFlowSafe(overlay);
}
function removeResearchOverlayUi() {
    currentAbortController?.abort();
    currentAbortController = null;
    document.getElementById(FURIMANE_OVERLAY_ID)?.remove();
    removeOpenButton();
}
function syncResearchOverlayForCurrentPage() {
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
        void waitForReady().then(syncResearchOverlayForCurrentPage);
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
window.addEventListener("beforeunload", () => {
    currentAbortController?.abort();
});
installResearchNavigationListener();
void waitForReady().then(syncResearchOverlayForCurrentPage);
