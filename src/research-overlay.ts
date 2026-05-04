const FURIMANE_PROFILE_URL_PREFIX = "https://jp.mercari.com/user/profile/";
const FURIMANE_SHOPS_PROFILE_URL_PREFIX = "https://jp.mercari.com/shops/profile/";
const FURIMANE_OVERLAY_ID = "furimane-research-overlay";
const FURIMANE_OPEN_BUTTON_ID = "furimane-research-open-button";
const FURIMANE_CLOSED_STORAGE_KEY = "furimane-research-closed";
const FURIMANE_MAX_RETRY_COUNT = 3;
const FURIMANE_DEFAULT_FETCH_STRATEGY = "api";
const FURIMANE_FETCH_STRATEGY_STORAGE_KEY = "furimane-research-fetch-strategy";

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
};

type ResearchCacheResponse = {
  cached?: boolean;
  data?: ResearchResultData;
  seller?: ResearchResultData["seller"];
  listings?: ResearchListing[];
} | null;

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

type ResearchErrorKind = "auth" | "plan" | "timeout" | "scraping" | "dom_changed" | "unknown";

type ResearchOverlayWindow = Window & {
  FurimanagerResearchApi?: {
    getAppUrl?: () => string;
    checkAccess: (options?: { signal?: AbortSignal }) => Promise<{ canUse?: boolean; canUseResearch?: boolean }>;
    checkCache: (
      sellerId: string,
      platform: string,
      options?: { signal?: AbortSignal }
    ) => Promise<ResearchCacheResponse>;
    saveResearchData: (
      seller: ResearchResultData["seller"],
      listings: ResearchListing[],
      options?: { signal?: AbortSignal }
    ) => Promise<unknown>;
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
  };
  FurimanagerResearchTable?: {
    renderTable: (
      container: HTMLElement,
      seller: ResearchResultData["seller"],
      listings: ResearchListing[],
      options?: {
        sourceLabel?: string;
        onRefresh?: () => Promise<void>;
        onSaveSeller?: (seller: ResearchResultData["seller"]) => Promise<void>;
      }
    ) => void | Promise<void>;
  };
};

let currentAbortController: AbortController | null = null;

function getOverlayWindow() {
  return window as unknown as ResearchOverlayWindow;
}

function getResearchFetchStrategy() {
  const storedStrategy = localStorage.getItem(FURIMANE_FETCH_STRATEGY_STORAGE_KEY);
  return storedStrategy === "dom" ? "dom" : FURIMANE_DEFAULT_FETCH_STRATEGY;
}

function getCachedResearchData(cache: ResearchCacheResponse) {
  if (!cache?.cached) {
    return null;
  }

  return cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);
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
      window.setTimeout(resolve, 1000);
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

  return document.querySelector("main section") ?? document.querySelector("main");
}

function findOverlayInsertTarget(): OverlayInsertTarget {
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

  return {
    parent: document.body,
    before: null,
    reason: "body_fixed_fallback",
    isFixedFallback: true
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

function renderResearchError(container: HTMLElement, error: unknown, retry: () => void, retryCount = 0) {
  const kind = getResearchErrorKind(error);
  const copy = getResearchErrorCopy(kind);
  const appUrl = getOverlayWindow().FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000";
  const wrapper = document.createElement("div");
  wrapper.className = "furimane-research-overlay__state furimane-research-overlay__state--error";

  const title = document.createElement("h3");
  title.className = "furimane-research-overlay__state-title";
  title.textContent = copy.title;

  const description = createParagraph(copy.description);
  wrapper.append(title, description);

  if (kind === "auth" || kind === "plan") {
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

    if (cachedData) {
      if (hasPeriodAnalysisData(cachedData.listings)) {
        renderResults(container, cachedData, "24\u6642\u9593\u4ee5\u5185\u306e\u30ad\u30e3\u30c3\u30b7\u30e5");
        renderedCache = true;
      } else {
        renderLoading(container, "\u4fdd\u5b58\u6e08\u307f\u30c7\u30fc\u30bf\u3092\u78ba\u8a8d\u3057\u307e\u3057\u305f\u3002\u6700\u65b0\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d...");
      }
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
    const scraped: ResearchResultData & { strategy: "dom" | "api" } = await scraper.fetchSellerResearchData({
      strategy,
      signal,
      onProgress: (count, details) => {
        if (details?.phase === "dom_fallback") {
          progressMode = "dom_fallback";
        }

        renderResearchProgress(container, seller, count, details, progressMode);
      }
    });

    const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
      ? "取得完了"
      : strategy === "api" && scraped.strategy === "dom"
        ? "通常取得で表示"
        : "新規取得";

    renderLoading(container, scraped.strategy === "api" ? "取得が完了しました。保存中..." : "保存中...");
    await api.saveResearchData(scraped.seller, scraped.listings, { signal });
    scraped.seller.fetched_at = new Date().toISOString();
    renderResults(container, scraped, finalSourceLabel);
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

    const access = await api.checkAccess({ signal });

    if (!(access.canUseResearch ?? access.canUse)) {
      renderResearchError(container, new Error("plan_required"), retry, retryCount);
      return;
    }

    const seller = scraper.getSellerContextFromCurrentPage?.();

    if (!seller) {
      const error = new Error("seller_id_not_found");
      console.error("[furimane-research] seller context not found", { url: window.location.href });
      renderResearchError(container, error, retry, retryCount);
      return;
    }

    renderLoading(container, options.forceRefresh ? "最新データを取得中..." : "キャッシュ確認中...");

    const cache = options.forceRefresh ? null : await api.checkCache(seller.seller_id, seller.platform, { signal });
    const cachedData = getCachedResearchData(cache);

    if (cachedData) {
      if (hasPeriodAnalysisData(cachedData.listings)) {
        renderResults(container, cachedData, "24\u6642\u9593\u4ee5\u5185\u306e\u30ad\u30e3\u30c3\u30b7\u30e5");
        renderedCache = true;
      } else {
        renderLoading(container, "\u4fdd\u5b58\u6e08\u307f\u30c7\u30fc\u30bf\u3092\u78ba\u8a8d\u3057\u307e\u3057\u305f\u3002\u6700\u65b0\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d...");
      }
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
    const scraped: ResearchResultData & { strategy: "dom" | "api" } = await scraper.fetchSellerResearchData({
      strategy,
      signal,
      onProgress: (count, details) => {
        if (details?.phase === "dom_fallback") {
          progressMode = "dom_fallback";
        }

        renderResearchProgress(container, seller, count, details, progressMode);
      }
    });

    const finalSourceLabel = strategy === "api" && scraped.strategy === "api"
      ? "取得完了"
      : strategy === "api" && scraped.strategy === "dom"
        ? "通常取得で表示"
        : "新規取得";

    renderLoading(container, scraped.strategy === "api" ? "取得が完了しました。保存中..." : "保存中...");
    await api.saveResearchData(scraped.seller, scraped.listings, { signal });
    scraped.seller.fetched_at = new Date().toISOString();
    renderResults(container, scraped, finalSourceLabel);
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

  if (supportStatus === "unsupported") {
    logUnsupportedResearchPage();
    return;
  }

  if (supportStatus !== "supported") {
    return;
  }

  if (document.getElementById(FURIMANE_OVERLAY_ID)) {
    return;
  }

  if (localStorage.getItem(FURIMANE_CLOSED_STORAGE_KEY) === "true") {
    createOpenButton();
    return;
  }

  removeOpenButton();

  const overlay = createResearchOverlay();
  const insertTarget = findOverlayInsertTarget();

  if (insertTarget.isFixedFallback) {
    overlay.classList.add("furimane-research-overlay--fixed");
  }

  insertTarget.parent.insertBefore(overlay, insertTarget.before);
  console.log("[furimane-research] overlay inserted", { reason: insertTarget.reason });
  void runResearchFlowSafe(overlay);
}

window.addEventListener("beforeunload", () => {
  currentAbortController?.abort();
});

void waitForReady().then(renderResearchOverlay);
