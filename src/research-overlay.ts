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
const FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FURIMANE_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const FURIMANE_RESEARCH_ENABLED_KEY = "furimaneResearchEnabled";

declare namespace chrome {
  namespace runtime {
    function getURL(path: string): string;
  }
  namespace storage {
    const local: {
      get(keys: string[], callback: (result: Record<string, unknown>) => void): void;
    };
    const onChanged: {
      addListener(callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => void): void;
    };
  }
}

type OverlayInsertTarget = {
  parent: Node;
  before: Node | null;
  reason: string;
  isFixedFallback?: boolean;
};

type ResearchListing = {
  item_id: string;
  title: string;
  price: number;
  sold_at: string | null;
  period_date?: string | null;
  period_date_source?: string | null;
  period_date_estimated?: boolean;
  thumbnail_url: string | null;
  item_url: string | null;
  status?: string;
  platform?: string;
};

type ResearchResultData = {
  seller: {
    platform?: string;
    seller_id?: string;
    seller_name?: string | null;
    seller_url?: string | null;
    fetched_at?: string | null;
  };
  listings: ResearchListing[];
  stats?: unknown;
  periodAnalysis?: unknown;
  usage?: ResearchUsageState | null;
  savedOnServer?: boolean;
};

type ResearchCacheResponse = {
  cached?: boolean;
  data?: ResearchResultData;
  seller?: ResearchResultData["seller"];
  listings?: ResearchListing[];
  stats?: unknown;
  periodAnalysis?: unknown;
} | null;

type ResearchUsageState = {
  allowed?: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetAt?: string;
  unlimited?: boolean;
};

type LocalResearchCacheEntry = {
  savedAt: number;
  data: ResearchResultData;
};

type ResearchProgressDetails = {
  listings?: ResearchListing[];
  totalCount?: number | null;
  pageLikeIndex?: number | null;
  partial?: boolean;
  phase?: "api_progress" | "api_done" | "dom_fallback";
};

type ResearchFlowOptions = {
  forceRefresh?: boolean;
  retryCount?: number;
};

type ResearchErrorKind = "auth" | "plan" | "limit" | "timeout" | "scraping" | "dom_changed" | "mapping" | "unknown";

type ResearchOverlayWindow = Window & {
  FurimanagerResearchApi?: {
    getAppUrl?: () => string;
    checkAccess: (options?: { signal?: AbortSignal }) => Promise<{
      canUse?: boolean;
      canUseResearch?: boolean;
      hasAddon?: boolean;
      usage?: ResearchUsageState;
    }>;
    checkCache: (
      sellerId: string,
      platform: string,
      options?: { signal?: AbortSignal }
    ) => Promise<ResearchCacheResponse>;
    saveResearchData: (
      seller: ResearchResultData["seller"],
      listings: ResearchListing[],
      options?: { signal?: AbortSignal }
    ) => Promise<{ usage?: ResearchUsageState } | unknown>;
    saveSeller: (seller: {
      platform: string;
      seller_id: string;
      seller_name: string | null;
      seller_url: string;
    }) => Promise<unknown>;
  };
  FurimanagerResearchScraper?: {
    getSellerContextFromCurrentPage?: () => ResearchResultData["seller"] | null;
    getPlatformFromCurrentUrl?: () => string | null;
    fetchSellerResearchData: (options: {
      strategy: "dom" | "api";
      signal?: AbortSignal;
      onProgress?: (count: number, details?: ResearchProgressDetails) => void;
    }) => Promise<ResearchResultData & { strategy: "dom" | "api" }>;
    scrapeSellerPage?: (options: {
      strategy: "dom" | "api";
      signal?: AbortSignal;
      onProgress?: (count: number, details?: ResearchProgressDetails) => void;
    }) => Promise<ResearchResultData & { strategy: "dom" | "api" }>;
  };
  FurimanagerResearchTable?: {
    renderTable: (
      container: HTMLElement,
      seller: ResearchResultData["seller"],
      listings: ResearchListing[],
      options?: {
        sourceLabel?: string;
        usage?: ResearchUsageState | null;
        stats?: unknown;
        periodAnalysis?: unknown;
        onRefresh?: () => Promise<void>;
        onSaveSeller?: (seller: ResearchResultData["seller"]) => Promise<void>;
      }
    ) => void | Promise<void>;
  };
};

let currentAbortController: AbortController | null = null;
let currentResearchPageKey: string | null = null;
let routeSyncTimerId: number | null = null;
let lastObservedUrl = window.location.href;
let overlayInsertRetryCount = 0;
let cachedResearchAccess: { savedAt: number; value: { canUse?: boolean; canUseResearch?: boolean; usage?: ResearchUsageState } } | null = null;
let currentResearchUsage: ResearchUsageState | null = null;

function showResearchNotice(message: string) {
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
  return window as unknown as ResearchOverlayWindow;
}

function getChromeLocalStorage(keys: string[]) {
  return new Promise<Record<string, unknown>>((resolve) => {
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

function getCachedResearchData(cache: ResearchCacheResponse) {
  if (!cache?.cached) {
    return null;
  }

  const data = cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);
  return data ? { ...data, stats: cache.stats ?? data.stats ?? null, periodAnalysis: cache.periodAnalysis ?? data.periodAnalysis ?? null } : null;
}

function getResearchCacheSellerKey(seller: ResearchResultData["seller"]) {
  const platform = seller.platform || "mercari";
  const sellerId = seller.seller_id;

  return sellerId ? `${platform}:${sellerId}` : null;
}

function getLocalResearchCacheKey(seller: ResearchResultData["seller"]) {
  const sellerKey = getResearchCacheSellerKey(seller);

  return sellerKey ? `${FURIMANE_LOCAL_RESEARCH_CACHE_PREFIX}${sellerKey}` : null;
}

function isResearchResultData(value: unknown): value is ResearchResultData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<ResearchResultData>;
  return Boolean(data.seller && Array.isArray(data.listings));
}

function hasRenderableResearchData(data: ResearchResultData | null | undefined) {
  return Boolean(data && Array.isArray(data.listings) && data.listings.length > 0);
}

function hasResearchPeriodData(data: ResearchResultData | null | undefined) {
  return Boolean(data && hasPeriodAnalysisData(data.listings));
}

function shouldRenderCacheData(
  data: ResearchResultData | null | undefined,
  renderedCache: boolean,
  renderedCacheHasPeriodData: boolean
) {
  if (!hasRenderableResearchData(data)) {
    return false;
  }

  const nextHasPeriodData = hasResearchPeriodData(data);
  return !renderedCache || nextHasPeriodData || !renderedCacheHasPeriodData;
}

function readLocalResearchCache(seller: ResearchResultData["seller"]) {
  const cacheKey = getLocalResearchCacheKey(seller);

  if (!cacheKey) {
    return null;
  }

  try {
    const rawValue = localStorage.getItem(cacheKey);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<LocalResearchCacheEntry>;

    if (
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > FURIMANE_LOCAL_RESEARCH_CACHE_TTL_MS ||
      !isResearchResultData(parsed.data)
    ) {
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

function writeLocalResearchCache(data: ResearchResultData) {
  const cacheKey = getLocalResearchCacheKey(data.seller);

  if (!cacheKey || !Array.isArray(data.listings) || data.listings.length === 0) {
    return;
  }

  try {
    const entry: LocalResearchCacheEntry = {
      savedAt: Date.now(),
      data
    };
    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (error) {
    console.warn("[furimane-research] local cache write failed", error);
  }
}

function hasUsablePeriodDate(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

function hasPeriodAnalysisData(listings: ResearchListing[] | undefined) {
  return (listings ?? []).some((listing) => (
    hasUsablePeriodDate(listing.period_date) || hasUsablePeriodDate(listing.sold_at)
  ));
}

function getResearchPageSupportStatus() {
  if (window.location.href.startsWith(FURIMANE_PROFILE_URL_PREFIX)) {
    return "supported" as const;
  }

  if (window.location.href.startsWith(FURIMANE_SHOPS_PROFILE_URL_PREFIX)) {
    // TODO: Shopsリサーチは型だけ先に用意しているため、画面入口は未対応として止める。
    return "unsupported" as const;
  }

  return "outside" as const;
}

function logUnsupportedResearchPage() {
  console.info("[furimane-research] unsupported page. skip research flow", {
    url: window.location.href
  });
}

function waitForReady() {
  return new Promise<void>((resolve) => {
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

function getNormalizedText(element: Element) {
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

function findOverlayInsertTarget(): OverlayInsertTarget | null {
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

function findOverlayFallbackInsertTarget(): OverlayInsertTarget | null {
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

function formatPrice(price: number) {
  return `¥${price.toLocaleString("ja-JP")}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "日付不明";
  }

  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function getOverlayBody(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".furimane-research-overlay__body");
}

function setOverlayBody(container: HTMLElement, children: Node[]) {
  const body = getOverlayBody(container);

  if (!body) {
    return;
  }

  body.replaceChildren(...children);
}

function createParagraph(text: string, className = "furimane-research-overlay__placeholder") {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function createButton(label: string, onClick: () => void, variant: "primary" | "secondary" = "primary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `furimane-research-overlay__button furimane-research-overlay__button--${variant}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderLoading(container: HTMLElement, message: string) {
  setOverlayBody(container, [createParagraph(message)]);
}

function renderAccessLocked(container: HTMLElement) {
  const wrapper = document.createElement("div");
  wrapper.className = "furimane-research-overlay__state";

  const title = document.createElement("h3");
  title.className = "furimane-research-overlay__state-title";
  title.textContent = "リサーチ追加プランで利用できます";

  const description = createParagraph(
    "出品者の販売履歴分析を使うには、フリマネ側でリサーチ追加プランに加入してください。"
  );

  const link = document.createElement("a");
  link.className = "furimane-research-overlay__link-button";
  link.href = `${getOverlayWindow().FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000"}/dashboard/research`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "リサーチ追加プランを確認する";

  wrapper.append(title, description, link);
  setOverlayBody(container, [wrapper]);
}

function renderError(container: HTMLElement, message: string, retry: () => void) {
  const wrapper = document.createElement("div");
  wrapper.className = "furimane-research-overlay__state";

  const title = document.createElement("h3");
  title.className = "furimane-research-overlay__state-title";
  title.textContent = message === "auth_required" ? "フリマネにログインしてください" : "取得に失敗しました。再試行してください";

  const description = createParagraph(
    message === "auth_required"
      ? "拡張機能のポップアップからフリマネにログインしてから、もう一度お試しください。"
      : message
  );
  const retryButton = createButton("再試行する", retry, "secondary");

  wrapper.append(title, description, retryButton);
  setOverlayBody(container, [wrapper]);
}

function getResearchErrorKind(error: unknown): ResearchErrorKind {
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

function getResearchErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function canContinueResearchWithoutAccessCheck(
  error: unknown,
  api: NonNullable<ResearchOverlayWindow["FurimanagerResearchApi"]>
) {
  const message = getResearchErrorMessage(error);
  const appUrl = api.getAppUrl?.() ?? "";

  return (
    (message === "network_error" || message === "api_timeout") &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(appUrl)
  );
}

function getResearchFetchFunction(scraper: NonNullable<ResearchOverlayWindow["FurimanagerResearchScraper"]>) {
  return scraper.fetchSellerResearchData ?? scraper.scrapeSellerPage ?? null;
}

async function checkResearchAccessWithCache(
  api: NonNullable<ResearchOverlayWindow["FurimanagerResearchApi"]>,
  signal?: AbortSignal
) {
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

function normalizeResearchAccess(access: { canUse?: boolean; canUseResearch?: boolean; hasAddon?: boolean; usage?: ResearchUsageState }) {
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

function updateResearchUsageChip(usage: ResearchUsageState | null | undefined) {
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

  const usageChip = document.querySelector<HTMLElement>(".furimane-research-table__usage-count");

  if (!usageChip) {
    return;
  }

  usageChip.classList.toggle("furimane-research-table__usage-count--unlimited", usage.unlimited === true);
  const usageText = usageChip.querySelector<HTMLElement>(".furimane-research-table__usage-count-text");
  const label = usage.unlimited
    ? "無制限"
    : `今月のリサーチ ${usage.used} / ${usage.limit}`;

  if (usageText) {
    usageText.textContent = label;
    return;
  }

  usageChip.textContent = label;
}

function createChildAbortController(parentSignal: AbortSignal) {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return controller;
}

function getResearchErrorCopy(kind: ResearchErrorKind) {
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
    case "limit":
      return {
        title: "今月のリサーチ上限に達しました",
        description: "今月の利用上限に達しました。来月1日にリセットされます。",
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
    case "mapping":
      return {
        title: "商品データを解析できませんでした",
        description: "取得した商品データの形式に対応できませんでした。時間を置いて再試行してください。",
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

function renderResearchError(container: HTMLElement, error: unknown, retry: () => void, retryCount = 0) {
  const kind = getResearchErrorKind(error);

  if (kind === "limit") {
    cachedResearchAccess = null;
  }

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

  if (kind === "auth" || kind === "plan" || kind === "limit") {
    const link = document.createElement("a");
    link.className = "furimane-research-overlay__link-button";
    link.href = kind === "auth" ? `${appUrl}/login` : `${appUrl}/dashboard/research`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = copy.actionLabel;
    wrapper.appendChild(link);
  } else if (retryCount < FURIMANE_MAX_RETRY_COUNT) {
    wrapper.appendChild(createButton(copy.actionLabel, retry, "secondary"));
  } else {
    const support = createParagraph("再試行上限に達しました。ページを再読み込みしても直らない場合はサポートへ連絡してください。");
    support.className = "furimane-research-overlay__support-text";
    wrapper.appendChild(support);
  }

  setOverlayBody(container, [wrapper]);
}

function renderResults(container: HTMLElement, data: ResearchResultData, sourceLabel: string) {
  const body = getOverlayBody(container);
  const table = getOverlayWindow().FurimanagerResearchTable;
  const api = getOverlayWindow().FurimanagerResearchApi;

  if (!body || !table) {
    setOverlayBody(container, [createParagraph("リサーチ結果の表示に失敗しました。")]);
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

function renderResearchProgress(
  container: HTMLElement,
  seller: ResearchResultData["seller"],
  count: number,
  details?: ResearchProgressDetails,
  mode: "dom" | "api" | "dom_fallback" = "dom"
) {
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

function saveResearchDataInBackground(data: ResearchResultData, signal?: AbortSignal) {
  const api = getOverlayWindow().FurimanagerResearchApi;

  if (!api) {
    return;
  }

  void api.saveResearchData(data.seller, data.listings, { signal }).then((result) => {
    const usage = result && typeof result === "object" ? (result as { usage?: ResearchUsageState }).usage : null;
    updateResearchUsageChip(usage);
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    console.warn("[furimane-research] background save failed", error);
    showResearchNotice("サーバー保存に失敗しました。ブラウザ内キャッシュのみ保存されています。");
  });
}

function persistResearchDataAfterPaint(data: ResearchResultData, signal?: AbortSignal) {
  window.setTimeout(() => {
    writeLocalResearchCache(data);
    if (data.savedOnServer === true) {
      updateResearchUsageChip(data.usage ?? null);
      return;
    }
    saveResearchDataInBackground(data, signal);
  }, 0);
}

async function runResearchFlow(container: HTMLElement, options: ResearchFlowOptions = {}) {
  currentAbortController?.abort();
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;
  const api = getOverlayWindow().FurimanagerResearchApi;
  const scraper = getOverlayWindow().FurimanagerResearchScraper;
  let renderedCache = false;

  if (!api || !scraper) {
    renderError(container, "リサーチ機能の読み込みに失敗しました。", () => runResearchFlow(container));
    return;
  }

  try {
    renderLoading(container, "アクセス確認中...");

    const seller = scraper.getSellerContextFromCurrentPage?.();

    if (!seller) {
      renderError(container, "出品者情報を取得できませんでした。", () => runResearchFlow(container));
      return;
    }

    const localCachedData = options.forceRefresh ? null : readLocalResearchCache(seller);

    let access: { canUse?: boolean; canUseResearch?: boolean; usage?: ResearchUsageState };
    try {
      access = await checkResearchAccessWithCache(api, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (hasRenderableResearchData(localCachedData)) {
        renderResults(container, localCachedData, "ブラウザキャッシュ");
        renderedCache = true;
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
          renderResults(container, cachedData, "24時間以内のキャッシュ");
          writeLocalResearchCache(cachedData);
          return;
        }

        renderResearchError(container, new Error("research_monthly_limit_exceeded"), () => runResearchFlow(container));
        return;
      }

      renderAccessLocked(container);
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

    let progressMode: "dom" | "api" | "dom_fallback" = strategy;
    const fetchResearchData = getResearchFetchFunction(scraper);

    if (!fetchResearchData) {
      throw new Error("research_scraper_method_missing");
    }

    const scraped: ResearchResultData & { strategy: "dom" | "api" } = await fetchResearchData({
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
    persistResearchDataAfterPaint(scraped, signal);
  } catch (error) {
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

async function runResearchFlowSafe(container: HTMLElement, options: ResearchFlowOptions = {}) {
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
    renderLoading(container, "アクセス確認中...");

    const seller = scraper.getSellerContextFromCurrentPage?.();

    if (!seller) {
      const error = new Error("seller_id_not_found");
      console.error("[furimane-research] seller context not found", { url: window.location.href });
      renderResearchError(container, error, retry, retryCount);
      return;
    }

    const localCachedData = options.forceRefresh ? null : readLocalResearchCache(seller);

    let access: { canUse?: boolean; canUseResearch?: boolean; usage?: ResearchUsageState };
    try {
      access = await checkResearchAccessWithCache(api, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (hasRenderableResearchData(localCachedData)) {
        renderResults(container, localCachedData, "ブラウザキャッシュ");
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
          renderResults(container, cachedData, "24時間以内のキャッシュ");
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
      renderResults(container, localCachedData, "ブラウザキャッシュ");
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

    renderLoading(container, options.forceRefresh ? "最新データを取得中..." : "リサーチデータを取得中...");

    let cacheDecisionDone = options.forceRefresh === true;
    let flowSettled = false;
    let progressMode: "dom" | "api" | "dom_fallback" = strategy;
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
      (scraped) => ({ type: "live" as const, scraped }),
      (error) => ({ type: "live_error" as const, error })
    );

    const cachePromise = options.forceRefresh
      ? Promise.resolve({ type: "cache" as const, cachedData: null })
      : api.checkCache(seller.seller_id, seller.platform, { signal })
          .then((cache) => ({ type: "cache" as const, cachedData: getCachedResearchData(cache) }))
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              throw error;
            }

            console.warn("[furimane-research] cache check failed; continuing with live fetch", error);
            return { type: "cache" as const, cachedData: null };
          });

    const firstResult = await Promise.race([cachePromise, liveFetchPromise]);

    if (firstResult.type === "cache") {
      cacheDecisionDone = true;

      if (hasRenderableResearchData(firstResult.cachedData)) {
        flowSettled = true;
        liveAbortController.abort();
        renderResults(container, firstResult.cachedData, "24時間以内のキャッシュ");
        writeLocalResearchCache(firstResult.cachedData);
        return;
      }

      renderLoading(container, strategy === "api"
        ? "リサーチデータを取得中... 取得できた分から反映します"
        : "通常取得中... 現在 0件");

      const liveResult = await liveFetchPromise;

      if (liveResult.type === "live_error") {
        throw liveResult.error;
      }

      const scraped = liveResult.scraped;
      const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
        ? "取得完了"
        : strategy === "api" && scraped.strategy === "dom"
          ? "通常取得で表示"
          : "新規取得";

      flowSettled = true;
      scraped.seller.fetched_at = new Date().toISOString();
      renderResults(container, scraped, finalSourceLabel);
      persistResearchDataAfterPaint(scraped, signal);
      return;
    }

    if (firstResult.type === "live_error") {
      throw firstResult.error;
    }

    flowSettled = true;
    cacheDecisionDone = true;
    const scraped = firstResult.scraped;

    const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
      ? "取得完了"
      : strategy === "api" && scraped.strategy === "dom"
        ? "通常取得で表示"
        : "新規取得";

    scraped.seller.fetched_at = new Date().toISOString();
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
  title.textContent = "フリマネ リサーチ";

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
  } else {
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

async function syncResearchOverlayForCurrentPage() {
  if (!(await isResearchFeatureEnabled())) {
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

  window.history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    originalPushState.call(this, data, unused, url);
    handlePossibleResearchRouteChange();
  };

  window.history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
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
    if (areaName !== "local" || !(FURIMANE_RESEARCH_ENABLED_KEY in changes)) {
      return;
    }

    if (changes[FURIMANE_RESEARCH_ENABLED_KEY]?.newValue === false) {
      removeResearchOverlayUi();
      currentResearchPageKey = null;
      return;
    }

    scheduleResearchOverlaySync();
  });
}

window.addEventListener("beforeunload", () => {
  currentAbortController?.abort();
});

installResearchNavigationListener();
installResearchSettingListener();
void waitForReady().then(() => syncResearchOverlayForCurrentPage());
