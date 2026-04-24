const FURIMANE_PROFILE_URL_PREFIX = "https://jp.mercari.com/user/profile/";
const FURIMANE_SHOPS_PROFILE_URL_PREFIX = "https://jp.mercari.com/shops/profile/";
const FURIMANE_OVERLAY_ID = "furimane-research-overlay";
const FURIMANE_OPEN_BUTTON_ID = "furimane-research-open-button";
const FURIMANE_CLOSED_STORAGE_KEY = "furimane-research-closed";
const FURIMANE_MAX_RETRY_COUNT = 3;
const FURIMANE_DEFAULT_FETCH_STRATEGY = "dom";
const FURIMANE_FETCH_STRATEGY_STORAGE_KEY = "furimane-research-fetch-strategy";

let currentFurimaneResearchAbortController = null;

function getFurimaneResearchFetchStrategy() {
  const storedStrategy = localStorage.getItem(FURIMANE_FETCH_STRATEGY_STORAGE_KEY);
  return storedStrategy === "api" ? "api" : FURIMANE_DEFAULT_FETCH_STRATEGY;
}

function getFurimaneResearchPageSupportStatus() {
  if (window.location.href.startsWith(FURIMANE_PROFILE_URL_PREFIX)) {
    return "supported";
  }

  if (window.location.href.startsWith(FURIMANE_SHOPS_PROFILE_URL_PREFIX)) {
    return "unsupported";
  }

  return "outside";
}

function logFurimaneUnsupportedResearchPage() {
  console.info("[furimane-research] unsupported page. skip research flow", {
    url: window.location.href
  });
}

function waitForReady() {
  return new Promise((resolve) => {
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

  return {
    parent: document.body,
    before: null,
    reason: "body_fixed_fallback",
    isFixedFallback: true
  };
}

function formatFurimaneResearchPrice(price) {
  return `¥${price.toLocaleString("ja-JP")}`;
}

function formatFurimaneResearchDate(value) {
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

  const description = createParagraph(
    "出品者の販売履歴分析を使うには、フリマネ側でリサーチ追加プランに加入してください。"
  );

  const link = document.createElement("a");
  link.className = "furimane-research-overlay__link-button";
  link.href = `${window.FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000"}/dashboard/research`;
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

  const description = createParagraph(
    message === "auth_required"
      ? "拡張機能のポップアップからフリマネにログインしてから、もう一度お試しください。"
      : message
  );
  const retryButton = createButton("再試行する", retry, "secondary");

  wrapper.append(title, description, retryButton);
  setOverlayBody(container, [wrapper]);
}

function getFurimaneResearchErrorKind(error) {
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

function getFurimaneResearchErrorCopy(kind) {
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

function renderFurimaneResearchError(container, error, retry, retryCount = 0) {
  const kind = getFurimaneResearchErrorKind(error);
  const copy = getFurimaneResearchErrorCopy(kind);
  const appUrl = window.FurimanagerResearchApi?.getAppUrl?.() ?? "http://localhost:3000";
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

function renderResults(container, data, sourceLabel) {
  const body = getOverlayBody(container);
  const table = window.FurimanagerResearchTable;
  const api = window.FurimanagerResearchApi;

  if (!body || !table) {
    setOverlayBody(container, [createParagraph("リサーチ結果の表示に失敗しました。")]);
    return;
  }

  table.renderTable(body, data.seller, data.listings, {
    sourceLabel,
    onRefresh: () => {
      return runFurimaneResearchFlowSafe(container, { forceRefresh: true });
    },
    onSaveSeller: async (seller) => {
      if (!api?.saveSeller) {
        throw new Error("保存APIを読み込めませんでした。");
      }

      await api.saveSeller({
        platform: seller.platform || window.FurimanagerResearchScraper?.getPlatformFromCurrentUrl?.() || "mercari",
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
      : "API取得が安定しないため、通常取得に切り替えています...");
    return;
  }

  if (!progressListings || progressListings.length === 0) {
    renderLoading(container, mode === "api"
      ? `API取得を待っています... 現在 ${count}件`
      : `通常取得中... 現在 ${count}件`);
    return;
  }

  const totalCount = typeof details?.totalCount === "number" ? details.totalCount : progressListings.length;
  const sourceLabel = details?.phase === "api_done" || details?.partial === false
    ? `API取得の反映完了：${totalCount}件`
    : `API取得中：${totalCount}件を表示中`;

  renderResults(container, {
    seller: {
      ...seller,
      fetched_at: new Date().toISOString()
    },
    listings: progressListings
  }, sourceLabel);
}

async function runResearchFlow(container, options = {}) {
  currentFurimaneResearchAbortController?.abort();
  currentFurimaneResearchAbortController = new AbortController();
  const { signal } = currentFurimaneResearchAbortController;
  const api = window.FurimanagerResearchApi;
  const scraper = window.FurimanagerResearchScraper;

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

    if (cache?.cached) {
      const cachedData = cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);

      if (cachedData) {
        renderResults(container, cachedData, "24時間以内のキャッシュ");
        return;
      }

      return;
    }

    const strategy = getFurimaneResearchFetchStrategy();
    console.log("[furimane-research] fetch strategy selected", {
      strategy,
      sellerId: seller.seller_id
    });

    renderLoading(container, strategy === "api"
      ? "API取得を待っています... メルカリ側の表示に合わせて反映します"
      : "通常取得中... 現在 0件");

    let progressMode = strategy;
    const scraped = await scraper.fetchSellerResearchData({
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
      ? "API取得完了"
      : strategy === "api" && scraped.strategy === "dom"
        ? "通常取得で表示"
        : "新規取得";

    renderLoading(container, scraped.strategy === "api" ? "API取得が完了しました。保存中..." : "保存中...");
    await api.saveResearchData(scraped.seller, scraped.listings, { signal });
    scraped.seller.fetched_at = new Date().toISOString();
    renderResults(container, scraped, finalSourceLabel);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    const message = error instanceof Error ? error.message : "取得に失敗しました。";
    console.error("[furimane-research] flow failed", error);
    renderError(container, message, () => runResearchFlow(container));
  }
}

async function runFurimaneResearchFlowSafe(container, options = {}) {
  currentFurimaneResearchAbortController?.abort();
  currentFurimaneResearchAbortController = new AbortController();
  const { signal } = currentFurimaneResearchAbortController;
  const retryCount = options.retryCount ?? 0;
  const retry = () => runFurimaneResearchFlowSafe(container, { ...options, retryCount: retryCount + 1 });
  const api = window.FurimanagerResearchApi;
  const scraper = window.FurimanagerResearchScraper;

  if (!api || !scraper) {
    const error = new Error("scraping_failed");
    console.error("[furimane-research] modules missing", { hasApi: Boolean(api), hasScraper: Boolean(scraper) });
    renderFurimaneResearchError(container, error, retry, retryCount);
    return;
  }

  try {
    renderLoading(container, "アクセス確認中...");

    const access = await api.checkAccess({ signal });

    if (!(access.canUseResearch ?? access.canUse)) {
      renderFurimaneResearchError(container, new Error("plan_required"), retry, retryCount);
      return;
    }

    const seller = scraper.getSellerContextFromCurrentPage?.();

    if (!seller) {
      const error = new Error("seller_id_not_found");
      console.error("[furimane-research] seller context not found", { url: window.location.href });
      renderFurimaneResearchError(container, error, retry, retryCount);
      return;
    }

    renderLoading(container, options.forceRefresh ? "最新データを取得中..." : "キャッシュ確認中...");

    const cache = options.forceRefresh ? null : await api.checkCache(seller.seller_id, seller.platform, { signal });

    if (cache?.cached) {
      const cachedData = cache.data ?? (cache.seller && cache.listings ? { seller: cache.seller, listings: cache.listings } : null);

      if (cachedData) {
        renderResults(container, cachedData, "24時間以内のキャッシュ");
        return;
      }
    }

    const strategy = getFurimaneResearchFetchStrategy();
    console.log("[furimane-research] fetch strategy selected", {
      strategy,
      sellerId: seller.seller_id
    });

    renderLoading(container, strategy === "api"
      ? "API取得を待っています... メルカリ側の表示に合わせて反映します"
      : "通常取得中... 現在 0件");

    let progressMode = strategy;
    const scraped = await scraper.fetchSellerResearchData({
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
      ? "API取得完了"
      : strategy === "api" && scraped.strategy === "dom"
        ? "通常取得で表示"
        : "新規取得";

    renderLoading(container, scraped.strategy === "api" ? "API取得が完了しました。保存中..." : "保存中...");
    await api.saveResearchData(scraped.seller, scraped.listings, { signal });
    scraped.seller.fetched_at = new Date().toISOString();
    renderResults(container, scraped, finalSourceLabel);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    console.error("[furimane-research] flow failed", error);
    renderFurimaneResearchError(container, error, retry, retryCount);
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
    currentFurimaneResearchAbortController?.abort();
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
  const supportStatus = getFurimaneResearchPageSupportStatus();

  if (supportStatus === "unsupported") {
    logFurimaneUnsupportedResearchPage();
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
  void runFurimaneResearchFlowSafe(overlay);
}

window.addEventListener("beforeunload", () => {
  currentFurimaneResearchAbortController?.abort();
});

void waitForReady().then(renderResearchOverlay);
