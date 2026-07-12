const PERIOD_DEFINITIONS = [
    { key: "period1", label: "0〜30日", shortLabel: "0〜30日", accentClass: "period1" },
    { key: "period2", label: "31〜60日", shortLabel: "31〜60日", accentClass: "period2" },
    { key: "period3", label: "61〜90日", shortLabel: "61〜90日", accentClass: "period3" }
];
const TABLE_INITIAL_ROW_LIMIT = 300;
const TABLE_ROW_INCREMENT = 300;
const PURCHASE_PRICE_PREFETCH_ROW_LIMIT = 300;
let researchTableRenderSequence = 0;
function formatResearchPrice(price) {
    return `¥${Math.round(price).toLocaleString("ja-JP")}`;
}
function normalizeResearchPlatform(value) {
    return value === "mercari_shops" ? "mercari_shops" : "mercari";
}
function getResearchPlatform(seller, listing) {
    return normalizeResearchPlatform(listing?.platform ?? seller.platform);
}
function getResearchPlatformLabel(platform) {
    return platform === "mercari_shops" ? "Shops" : "メルカリ";
}
function formatResearchDate(value) {
    if (!value) {
        return "取得日時不明";
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "取得日時不明";
    }
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}
function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (textContent !== undefined) {
        element.textContent = textContent;
    }
    return element;
}
function sanitizeResearchUrl(value) {
    if (!value) {
        return "#";
    }
    try {
        const url = new URL(value, window.location.origin);
        return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#";
    }
    catch {
        return "#";
    }
}
function createEmptyTotals() {
    return { revenue: 0, count: 0 };
}
function createEmptyStats() {
    return {
        period1: createEmptyTotals(),
        period2: createEmptyTotals(),
        period3: createEmptyTotals(),
        total: createEmptyTotals()
    };
}
function createEmptyPeriodAnalysis() {
    return {
        stats: createEmptyStats(),
        available: false,
        usesEstimatedDates: false,
        periodSourceField: "unavailable",
        sourceCounts: {},
        oldestItemDaysAgo: null,
        reached90Days: false,
        outOfRangeCount: 0,
        datedCount: 0
    };
}
function hasUsableSoldAt(listings) {
    return listings.length > 0 && listings.every((listing) => {
        if (!listing.sold_at) {
            return false;
        }
        return Number.isFinite(new Date(listing.sold_at).getTime());
    });
}
function getListingPeriodStats(listing) {
    const periods = {
        period1: createEmptyTotals(),
        period2: createEmptyTotals(),
        period3: createEmptyTotals()
    };
    const periodKey = listing.period_key ?? null;
    if (periodKey) {
        periods[periodKey] = {
            count: 1,
            revenue: Number.isFinite(listing.price) ? listing.price : 0
        };
    }
    return periods;
}
function getListingSoldAtMs(listing) {
    if (!listing.sold_at) {
        return 0;
    }
    const soldAtMs = new Date(listing.sold_at).getTime();
    return Number.isFinite(soldAtMs) ? soldAtMs : 0;
}
function normalizeProductTitle(title) {
    return title
        .normalize("NFKC")
        .replace(/[\u00a0\u3000]/g, " ")
        .replace(/[‐‑‒–—―]/g, "-")
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function getProductGroupKey(listing, platform) {
    const normalizedTitle = normalizeProductTitle(listing.title);
    return `${platform}::${normalizedTitle || `item:${listing.item_id}`}`;
}
function isSoldListing(listing) {
    const status = (listing.status || "").trim().toLowerCase();
    if (!status) {
        return Boolean(listing.sold_at);
    }
    return (status.includes("sold") ||
        status.includes("trading") ||
        status.includes("complete") ||
        status.includes("\u58f2\u308a\u5207\u308c") ||
        status.includes("\u58f2\u5374\u6e08") ||
        status.includes("\u53d6\u5f15\u4e2d"));
}
function buildDisplayRows(listings) {
    const groups = new Map();
    for (const listing of listings) {
        const platform = normalizeResearchPlatform(listing.platform);
        const key = getProductGroupKey(listing, platform);
        const itemPeriods = getListingPeriodStats(listing);
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, {
                key,
                listing,
                platform,
                title: listing.title,
                thumbnailUrl: listing.thumbnail_url,
                price: listing.price,
                totalCount: 1,
                totalSales: Number.isFinite(listing.price) ? listing.price : 0,
                latestSoldAtMs: getListingSoldAtMs(listing),
                periods: itemPeriods
            });
            continue;
        }
        existing.thumbnailUrl = existing.thumbnailUrl ?? listing.thumbnail_url;
        existing.totalCount += 1;
        existing.totalSales += Number.isFinite(listing.price) ? listing.price : 0;
        existing.latestSoldAtMs = Math.max(existing.latestSoldAtMs, getListingSoldAtMs(listing));
        for (const period of PERIOD_DEFINITIONS) {
            existing.periods[period.key].count += itemPeriods[period.key].count;
            existing.periods[period.key].revenue += itemPeriods[period.key].revenue;
        }
    }
    return Array.from(groups.values());
}
function getTrendScore(row) {
    const weightedSales = row.periods.period1.revenue * 1 +
        row.periods.period2.revenue * 0.35 +
        row.periods.period3.revenue * 0.1;
    const weightedCount = row.periods.period1.count * 1 +
        row.periods.period2.count * 0.6 +
        row.periods.period3.count * 0.25;
    const repeatBonus = 1 + Math.min(Math.max(weightedCount - 1, 0) * 0.08, 0.24);
    const oldSinglePenalty = row.totalCount === 1 && row.periods.period1.count === 0
        ? row.periods.period2.count === 1
            ? 0.85
            : row.periods.period3.count === 1
                ? 0.55
                : 1
        : 1;
    return weightedSales * repeatBonus * oldSinglePenalty;
}
function sortRowsByDisplayedSales(rows) {
    return [...rows].sort((a, b) => {
        const trendScoreDiff = getTrendScore(b) - getTrendScore(a);
        if (trendScoreDiff !== 0) {
            return trendScoreDiff;
        }
        const period1RevenueDiff = b.periods.period1.revenue - a.periods.period1.revenue;
        if (period1RevenueDiff !== 0) {
            return period1RevenueDiff;
        }
        const period1CountDiff = b.periods.period1.count - a.periods.period1.count;
        if (period1CountDiff !== 0) {
            return period1CountDiff;
        }
        const latestSoldAtDiff = b.latestSoldAtMs - a.latestSoldAtMs;
        if (latestSoldAtDiff !== 0) {
            return latestSoldAtDiff;
        }
        const totalSalesDiff = b.totalSales - a.totalSales;
        if (totalSalesDiff !== 0) {
            return totalSalesDiff;
        }
        return b.price - a.price;
    });
}
function buildDashboardData(seller, listings, options) {
    const platform = getResearchPlatform(seller);
    const sellerName = seller.seller_name || seller.seller_id || "出品者";
    const sourceLabel = options.sourceLabel ?? "リサーチ結果";
    const fetchedAtLabel = formatResearchDate(seller.fetched_at);
    const soldListings = listings.filter(isSoldListing);
    const displayListings = soldListings.length > 0 ? soldListings : listings;
    const totals = displayListings.reduce((result, listing) => ({
        count: result.count + 1,
        revenue: result.revenue + (Number.isFinite(listing.price) ? listing.price : 0)
    }), createEmptyTotals());
    const periodAnalysis = options.periodAnalysis ?? createEmptyPeriodAnalysis();
    const hasDatedListings = periodAnalysis.available || hasUsableSoldAt(displayListings);
    const stats = hasDatedListings && (options.stats || periodAnalysis.stats)
        ? (options.stats ?? periodAnalysis.stats)
        : createEmptyStats();
    return {
        platform,
        sellerName,
        sourceLabel,
        fetchedAtLabel,
        totals,
        hasDatedListings,
        usesEstimatedPeriodDates: periodAnalysis.usesEstimatedDates,
        periodAnalysis,
        periodCards: PERIOD_DEFINITIONS.map((period) => ({
            ...period,
            count: stats[period.key].count,
            revenue: stats[period.key].revenue
        })),
        rows: sortRowsByDisplayedSales(buildDisplayRows(displayListings))
    };
}
function getSortValue(row, sortKey) {
    switch (sortKey) {
        case "price":
            return row.price;
        case "title":
            return row.title;
        case "period1_count":
            return row.periods.period1.count;
        case "period1_revenue":
            return row.periods.period1.revenue;
        case "period2_count":
            return row.periods.period2.count;
        case "period2_revenue":
            return row.periods.period2.revenue;
        case "period3_count":
            return row.periods.period3.count;
        case "period3_revenue":
            return row.periods.period3.revenue;
        default:
            return row.listing.sold_at ? new Date(row.listing.sold_at).getTime() : 0;
    }
}
function sortRows(rows, sortKey) {
    return [...rows].sort((a, b) => {
        const aValue = getSortValue(a, sortKey);
        const bValue = getSortValue(b, sortKey);
        if (sortKey === "title") {
            return String(aValue).localeCompare(String(bValue), "ja");
        }
        return Number(bValue) - Number(aValue);
    });
}
function findItemBookmark(state, listing, platform) {
    return state.items.find((bookmark) => bookmark.bookmark_type !== "seller" &&
        bookmark.item_id === listing.item_id &&
        bookmark.platform === platform);
}
function showBookmarkToast(message) {
    document.querySelector(".furimane-research-table__toast")?.remove();
    const toast = createElement("div", "furimane-research-table__toast", message);
    document.body.appendChild(toast);
    window.setTimeout(() => {
        toast.remove();
    }, 2600);
}
function setBookmarkButtonState(button, isSaved) {
    button.classList.toggle("furimane-research-table__bookmark-button--saved", isSaved);
    button.textContent = isSaved ? "★" : "☆";
    button.setAttribute("aria-label", isSaved ? "ブックマーク解除" : "ブックマーク保存");
}
function toBookmarkSalesNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}
function setBookmarkSalesDataset(rowElement, row) {
    rowElement.dataset.period1Count = String(row.periods.period1.count);
    rowElement.dataset.period1Revenue = String(row.periods.period1.revenue);
    rowElement.dataset.period2Count = String(row.periods.period2.count);
    rowElement.dataset.period2Revenue = String(row.periods.period2.revenue);
    rowElement.dataset.period3Count = String(row.periods.period3.count);
    rowElement.dataset.period3Revenue = String(row.periods.period3.revenue);
    rowElement.dataset.totalCount = String(row.totalCount);
    rowElement.dataset.totalRevenue = String(row.totalSales);
}
function createBookmarkPeriodSales(row, rowElement) {
    if (rowElement) {
        return {
            period1: {
                count: toBookmarkSalesNumber(rowElement.dataset.period1Count),
                revenue: toBookmarkSalesNumber(rowElement.dataset.period1Revenue)
            },
            period2: {
                count: toBookmarkSalesNumber(rowElement.dataset.period2Count),
                revenue: toBookmarkSalesNumber(rowElement.dataset.period2Revenue)
            },
            period3: {
                count: toBookmarkSalesNumber(rowElement.dataset.period3Count),
                revenue: toBookmarkSalesNumber(rowElement.dataset.period3Revenue)
            },
            total: {
                count: toBookmarkSalesNumber(rowElement.dataset.totalCount),
                revenue: toBookmarkSalesNumber(rowElement.dataset.totalRevenue)
            }
        };
    }
    return {
        period1: { ...row.periods.period1 },
        period2: { ...row.periods.period2 },
        period3: { ...row.periods.period3 },
        total: {
            count: row.totalCount,
            revenue: row.totalSales
        }
    };
}
function logBookmarkSalesPayload(row, periodSales) {
    console.info("[furimane-research] bookmark sales payload", {
        item_id: row.listing.item_id,
        title: row.title,
        period_sales: periodSales
    });
}
function createPendingBookmark(row, rowElement) {
    return {
        id: `pending:${row.platform}:${row.listing.item_id}`,
        bookmark_type: "item",
        platform: row.platform,
        item_id: row.listing.item_id,
        title: row.title,
        price: row.price,
        thumbnail_url: row.thumbnailUrl,
        item_url: row.listing.item_url,
        period_sales: createBookmarkPeriodSales(row, rowElement)
    };
}

function assertBookmarkSuccess(response, fallbackMessage) {
    if (response.success === false) {
        throw new Error(response.message || fallbackMessage);
    }
}
async function loadResearchBookmarks() {
    try {
        const response = await window.FurimanagerResearchApi?.getBookmarks?.();
        if (!response) {
            return { items: [], count: 0, limit: 50 };
        }
        return {
            items: Array.isArray(response.items) ? response.items : [],
            count: Number.isFinite(response.count) ? response.count : 0,
            limit: Number.isFinite(response.limit) ? response.limit : 50
        };
    }
    catch (error) {
        console.error("[furimane-research] bookmark load failed", error);
        showBookmarkToast("ブックマークの取得に失敗しました");
        return { items: [], count: 0, limit: 50 };
    }
}
async function loadResearchPurchasePrices(rows, platform) {
    const itemIds = Array.from(new Set(rows.slice(0, PURCHASE_PRICE_PREFETCH_ROW_LIMIT).map((row) => row.listing.item_id).filter(Boolean)));
    if (itemIds.length === 0 || !window.FurimanagerResearchApi?.getPurchasePricesBatch) {
        return {};
    }
    try {
        return await window.FurimanagerResearchApi.getPurchasePricesBatch(platform, itemIds);
    }
    catch (error) {
        console.error("[furimane-research] purchase prices batch load failed", error);
        return {};
    }
}
async function loadResearchPurchasePriceForRow(row, purchasePrices) {
    const itemId = row.listing.item_id;
    if (!itemId || purchasePrices[itemId] || !window.FurimanagerResearchApi?.getPurchasePricesBatch) {
        return;
    }
    try {
        Object.assign(purchasePrices, await window.FurimanagerResearchApi.getPurchasePricesBatch(row.platform, [itemId]));
    }
    catch (error) {
        console.error("[furimane-research] purchase price lazy load failed", error);
    }
}
function createSortTabs(currentSort, hasDatedListings, onChange) {
    const wrapper = createElement("div", "furimane-research-table__sorts");
    const title = createElement("span", "furimane-research-table__sorts-label", "並び替え");
    const tabs = createElement("div", "furimane-research-table__sort-tabs");
    const labels = [
        { key: "price", label: "売値" },
        { key: "title", label: "商品名" },
        { key: "period1_revenue", label: "0〜30日売上" },
        { key: "period2_revenue", label: "31〜60日売上" },
        { key: "period3_revenue", label: "61〜90日売上" }
    ];
    if (hasDatedListings) {
        labels.unshift({ key: "sold_at", label: "新しい順" });
    }
    for (const item of labels) {
        const button = createElement("button", "furimane-research-table__sort-tab", item.label);
        button.type = "button";
        if (item.key === currentSort) {
            button.classList.add("furimane-research-table__sort-tab--active");
        }
        button.addEventListener("click", () => onChange(item.key));
        tabs.appendChild(button);
    }
    wrapper.append(title, tabs);
    return wrapper;
}
function createMetaItem(label, value, accent = false) {
    const item = createElement("span", accent
        ? "furimane-research-table__meta-item furimane-research-table__meta-item--accent"
        : "furimane-research-table__meta-item");
    const labelElement = createElement("span", "furimane-research-table__meta-label", `${label} `);
    const valueElement = createElement("strong", "furimane-research-table__meta-value", value);
    item.append(labelElement, valueElement);
    return item;
}
function getResearchUsageLabel(usage) {
    if (!usage) {
        return "今月のリサーチ -- / 30";
    }
    if (usage.unlimited) {
        return "無制限";
    }
    return `今月のリサーチ ${usage.used} / ${usage.limit}`;
}
function createResearchUsageCount(usage) {
    const usageCount = createElement("span", usage?.unlimited
        ? "furimane-research-table__usage-count furimane-research-table__usage-count--unlimited"
        : "furimane-research-table__usage-count");
    const usageText = createElement("span", "furimane-research-table__usage-count-text", getResearchUsageLabel(usage));
    usageCount.appendChild(usageText);
    return usageCount;
}
function getResearchTableAssetUrl(path) {
    try {
        return chrome.runtime.getURL(path);
    }
    catch (error) {
        console.warn("[furimane-research] extension asset unavailable", error);
        return null;
    }
}
function createResearchHero(seller, dashboard, options, bookmarkState) {
    const wrapper = createElement("section", "furimane-research-table__hero");
    const main = createElement("div", "furimane-research-table__hero-main");
    const eyebrow = createElement("div", "furimane-research-table__eyebrow");
    const brand = createElement("h3", "furimane-research-table__brand");
    const brandLogoUrl = getResearchTableAssetUrl("icons/icon-48.png");
    const brandText = createElement("span", undefined, "フリマネ リサーチ");
    if (brandLogoUrl) {
        const brandLogo = document.createElement("img");
        brandLogo.className = "furimane-research-table__brand-logo";
        brandLogo.src = brandLogoUrl;
        brandLogo.alt = "";
        brandLogo.decoding = "async";
        brand.append(brandLogo);
    }
    brand.append(brandText);
    const sellerName = createElement("h2", "furimane-research-table__seller-name", dashboard.sellerName);
    const meta = createElement("div", "furimane-research-table__meta-row");
    meta.append(createMetaItem("状態", dashboard.sourceLabel), createMetaItem("最終取得", dashboard.fetchedAtLabel), createMetaItem("取得件数", `${dashboard.totals.count}件`), createMetaItem("売上合計（取得分）", formatResearchPrice(dashboard.totals.revenue), true), createMetaItem("期間集計", dashboard.usesEstimatedPeriodDates ? "推定" : dashboard.hasDatedListings ? "確定" : "未取得"));
    eyebrow.append(brand);
    main.append(eyebrow, sellerName, meta);
    const actions = createElement("div", "furimane-research-table__hero-actions");
    const usageCount = createResearchUsageCount(options.usage);
    const bookmarkCount = createElement("span", "furimane-research-table__bookmark-count", bookmarkState.loading ? "ブックマーク 読込中" : `ブックマーク ${bookmarkState.count} / ${bookmarkState.limit}`);
    const refreshButton = createElement("button", "furimane-research-table__action-button", "更新");
    refreshButton.type = "button";
    refreshButton.addEventListener("click", async () => {
        if (!options.onRefresh) {
            return;
        }
        if (!window.confirm("最新データを取得しますか？（30秒〜1分かかります）")) {
            return;
        }
        refreshButton.disabled = true;
        refreshButton.classList.add("furimane-research-table__action-button--loading");
        refreshButton.textContent = "更新中...";
        try {
            await options.onRefresh();
        }
        catch (error) {
            console.error("[furimane-research] refresh failed", error);
            refreshButton.disabled = false;
            refreshButton.classList.remove("furimane-research-table__action-button--loading");
            refreshButton.textContent = "更新";
            window.alert(error instanceof Error ? error.message : "更新に失敗しました。");
        }
    });
    const saveButton = createElement("button", "furimane-research-table__save-button", "★ 保存する");
    saveButton.type = "button";
    saveButton.addEventListener("click", async () => {
        if (!options.onSaveSeller) {
            return;
        }
        saveButton.disabled = true;
        saveButton.textContent = "保存中...";
        try {
            await options.onSaveSeller(seller);
            saveButton.textContent = "★ 保存済み";
            saveButton.classList.add("furimane-research-table__save-button--saved");
        }
        catch (error) {
            console.error("[furimane-research] seller save failed", error);
            saveButton.disabled = false;
            saveButton.textContent = "★ 保存する";
            window.alert(error instanceof Error ? error.message : "保存に失敗しました。");
        }
    });
    actions.append(usageCount, bookmarkCount, refreshButton, saveButton);
    wrapper.append(main, actions);
    return wrapper;
}
function createPeriodCards(dashboard) {
    const grid = createElement("section", "furimane-research-table__period-grid");
    for (const period of dashboard.periodCards) {
        const card = createElement("article", `furimane-research-table__period-card furimane-research-table__period-card--${period.accentClass}`);
        const label = createElement("p", "furimane-research-table__period-label", period.label);
        const amount = createElement("strong", "furimane-research-table__period-revenue", dashboard.hasDatedListings ? formatResearchPrice(period.revenue) : "—");
        const count = createElement("span", "furimane-research-table__period-count", dashboard.hasDatedListings ? `${period.count}件` : "集計不可");
        card.append(label, amount, count);
        grid.appendChild(card);
    }
    return grid;
}
function createStatsPendingNotice() {
    return createElement("div", "furimane-research-table__stats-note", "販売日時未取得のため、0〜30日 / 31〜60日 / 61〜90日の期間別集計はまだ確定表示していません。取得件数・売上合計・保存・シミュレーターは利用できます。");
}
function createStatsEstimatedNotice() {
    return createElement("div", "furimane-research-table__stats-note furimane-research-table__stats-note--estimated", "API取得データの created / updated を使った推定集計です。売却日時が取れた場合は確定集計に切り替えます。");
}
function createBookmarkButton(row, bookmarkState, onUpdated, rowElement) {
    const existingBookmark = findItemBookmark(bookmarkState, row.listing, row.platform);
    const button = createElement("button", existingBookmark
        ? "furimane-research-table__bookmark-button furimane-research-table__bookmark-button--saved"
        : "furimane-research-table__bookmark-button", existingBookmark ? "★" : "☆");
    button.type = "button";
    button.disabled = bookmarkState.loading === true;
    button.setAttribute("aria-label", existingBookmark ? "ブックマーク解除" : "ブックマーク保存");
    button.addEventListener("click", async () => {
        if (!window.FurimanagerResearchApi?.addBookmark || !window.FurimanagerResearchApi?.removeBookmark) {
            showBookmarkToast("ブックマークAPIが利用できません");
            return;
        }
        button.disabled = true;
        const previousItems = [...bookmarkState.items];
        const previousCount = bookmarkState.count;
        const previousLimit = bookmarkState.limit;
        try {
            if (existingBookmark) {
                setBookmarkButtonState(button, false);
                bookmarkState.items = bookmarkState.items.filter((bookmark) => bookmark.id !== existingBookmark.id);
                bookmarkState.count = Math.max(0, bookmarkState.count - 1);
                onUpdated();
                const response = await window.FurimanagerResearchApi.removeBookmark(existingBookmark.id);
                assertBookmarkSuccess(response, "ブックマーク解除に失敗しました");
                bookmarkState.count = response.count;
                bookmarkState.limit = response.limit;
                onUpdated();
                showBookmarkToast("ブックマークを解除しました");
            }
            else {
                if (bookmarkState.count >= bookmarkState.limit) {
                    showBookmarkToast("ブックマークは最大50件まで保存できます");
                    button.disabled = false;
                    return;
                }
                const pendingBookmark = createPendingBookmark(row, rowElement);
                setBookmarkButtonState(button, true);
                bookmarkState.items = [
                    pendingBookmark,
                    ...bookmarkState.items.filter((bookmark) => bookmark.id !== pendingBookmark.id)
                ];
                bookmarkState.count += 1;
                onUpdated();
                const periodSales = createBookmarkPeriodSales(row, rowElement);
                logBookmarkSalesPayload(row, periodSales);
                const response = await window.FurimanagerResearchApi.addBookmark({
                    platform: row.platform,
                    item_id: row.listing.item_id,
                    title: row.title,
                    price: row.price,
                    thumbnail_url: row.thumbnailUrl,
                    item_url: row.listing.item_url,
                    period_sales: periodSales
                });
                assertBookmarkSuccess(response, "ブックマーク保存に失敗しました");
                const newBookmark = response.item ?? response.bookmark;
                if (!newBookmark) {
                    throw new Error("ブックマーク保存結果を確認できませんでした");
                }
                bookmarkState.items = [
                    newBookmark,
                    ...bookmarkState.items.filter((bookmark) => bookmark.id !== newBookmark.id && bookmark.id !== pendingBookmark.id)
                ];
                bookmarkState.count = response.count;
                bookmarkState.limit = response.limit;
                onUpdated();
                showBookmarkToast("ブックマークに保存しました");
            }
        }
        catch (error) {
            console.error("[furimane-research] bookmark update failed", error);
            bookmarkState.items = previousItems;
            bookmarkState.count = previousCount;
            bookmarkState.limit = previousLimit;
            setBookmarkButtonState(button, Boolean(existingBookmark));
            onUpdated();
            showBookmarkToast(error instanceof Error ? error.message : "ブックマークの更新に失敗しました");
            button.disabled = false;
        }
    });
    return button;
}
async function addBookmarkFromSimulation(row, bookmarkState, rowElement) {
    if (!window.FurimanagerResearchApi?.addBookmark) {
        showBookmarkToast("仕入れ値は保存しましたが、ブックマークAPIが利用できません");
        return false;
    }
    const existingBookmark = findItemBookmark(bookmarkState, row.listing, row.platform);
    if (existingBookmark) {
        try {
            const periodSales = createBookmarkPeriodSales(row, rowElement);
            logBookmarkSalesPayload(row, periodSales);
            const response = await window.FurimanagerResearchApi.addBookmark({
                platform: row.platform,
                item_id: row.listing.item_id,
                title: row.title,
                price: row.price,
                thumbnail_url: row.thumbnailUrl,
                item_url: row.listing.item_url,
                period_sales: periodSales
            });
            assertBookmarkSuccess(response, "ブックマーク売上の更新に失敗しました");
            const updatedBookmark = response.item ?? response.bookmark;
            if (updatedBookmark) {
                bookmarkState.items = bookmarkState.items.map((bookmark) => bookmark.id === existingBookmark.id ? updatedBookmark : bookmark);
            }
            bookmarkState.count = response.count;
            bookmarkState.limit = response.limit;
            showBookmarkToast("仕入れ値とブックマーク売上を保存しました");
            return true;
        }
        catch (error) {
            console.error("[furimane-research] simulator bookmark sales update failed", error);
            showBookmarkToast("仕入れ値は保存しましたが、ブックマーク売上の更新に失敗しました");
            return false;
        }
    }
    if (bookmarkState.count >= bookmarkState.limit) {
        showBookmarkToast("仕入れ値は保存しましたが、ブックマークは上限です");
        return false;
    }
    const previousItems = [...bookmarkState.items];
    const previousCount = bookmarkState.count;
    const previousLimit = bookmarkState.limit;
    const pendingBookmark = createPendingBookmark(row, rowElement);
    bookmarkState.items = [
        pendingBookmark,
        ...bookmarkState.items.filter((bookmark) => bookmark.id !== pendingBookmark.id)
    ];
    bookmarkState.count += 1;
    try {
        const periodSales = createBookmarkPeriodSales(row, rowElement);
        logBookmarkSalesPayload(row, periodSales);
        const response = await window.FurimanagerResearchApi.addBookmark({
            platform: row.platform,
            item_id: row.listing.item_id,
            title: row.title,
            price: row.price,
            thumbnail_url: row.thumbnailUrl,
            item_url: row.listing.item_url,
            period_sales: periodSales
        });
        assertBookmarkSuccess(response, "ブックマーク追加に失敗しました");
        const newBookmark = response.item ?? response.bookmark;
        if (!newBookmark) {
            throw new Error("ブックマーク保存結果を確認できませんでした");
        }
        bookmarkState.items = [
            newBookmark,
            ...bookmarkState.items.filter((bookmark) => bookmark.id !== newBookmark.id && bookmark.id !== pendingBookmark.id)
        ];
        bookmarkState.count = response.count;
        bookmarkState.limit = response.limit;
        showBookmarkToast("仕入れ値を保存し、ブックマークにも追加しました");
        return true;
    }
    catch (error) {
        console.error("[furimane-research] simulator bookmark save failed", error);
        bookmarkState.items = previousItems;
        bookmarkState.count = previousCount;
        bookmarkState.limit = previousLimit;
        showBookmarkToast("仕入れ値は保存しましたが、ブックマーク追加に失敗しました");
        return false;
    }
}
function createCountCellContent(count, hasDatedListings) {
    const text = !hasDatedListings || count === 0 ? "—" : String(count);
    const className = count > 0 && hasDatedListings
        ? "furimane-research-table__period-number furimane-research-table__period-number--count"
        : "furimane-research-table__period-dash";
    return createElement("span", className, text);
}
function createRevenueCellContent(revenue, hasDatedListings) {
    const text = !hasDatedListings || revenue === 0 ? "—" : formatResearchPrice(revenue);
    const className = revenue > 0 && hasDatedListings
        ? "furimane-research-table__period-number furimane-research-table__period-number--revenue"
        : "furimane-research-table__period-dash";
    return createElement("span", className, text);
}
function createResearchTable(rows, dashboard, bookmarkState, purchasePrices, rerender) {
    const panel = createElement("section", "furimane-research-table__table-panel");
    const scrollArea = createElement("div", "furimane-research-table__scroll");
    const table = createElement("table", "furimane-research-table");
    const colgroup = createResearchTableColGroup();
    const thead = document.createElement("thead");
    const mainHeaderRow = document.createElement("tr");
    const subHeaderRow = document.createElement("tr");
    const createRowspanHeader = (label) => {
        const th = createElement("th", "furimane-research-table__sticky", label);
        th.rowSpan = 2;
        return th;
    };
    mainHeaderRow.append(createRowspanHeader("サムネ"), createRowspanHeader("商品名"), createRowspanHeader("売値"));
    for (const period of PERIOD_DEFINITIONS) {
        const th = createElement("th", `furimane-research-table__period-group furimane-research-table__period-group--${period.accentClass}`, period.shortLabel);
        th.colSpan = 2;
        mainHeaderRow.appendChild(th);
        const countHeader = createElement("th", `furimane-research-table__period-subhead furimane-research-table__period-subhead--${period.accentClass}`, "件数");
        const revenueHeader = createElement("th", `furimane-research-table__period-subhead furimane-research-table__period-subhead--${period.accentClass}`, "売上");
        subHeaderRow.append(countHeader, revenueHeader);
    }
    mainHeaderRow.append(createRowspanHeader("操作"));
    thead.append(mainHeaderRow, subHeaderRow);
    const tbody = document.createElement("tbody");
    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.className = "furimane-research-table__row";
        setBookmarkSalesDataset(tr, row);
        const thumbnailCell = document.createElement("td");
        const thumbnail = createElement("div", "furimane-research-table__thumbnail");
        if (row.thumbnailUrl) {
            const image = document.createElement("img");
            image.alt = row.title;
            image.addEventListener("load", () => {
                const ratio = image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 0;
                thumbnail.classList.toggle("furimane-research-table__thumbnail--portrait", ratio >= 1.35);
                thumbnail.classList.toggle("furimane-research-table__thumbnail--tall", ratio >= 1.8);
            }, { once: true });
            image.src = row.thumbnailUrl;
            thumbnail.appendChild(image);
        }
        else {
            thumbnail.appendChild(createElement("span", "furimane-research-table__thumbnail-text", "画像"));
        }
        thumbnailCell.appendChild(thumbnail);
        const titleCell = document.createElement("td");
        const titleWrap = createElement("div", "furimane-research-table__title-wrap");
        const titleLink = createElement("a", "furimane-research-table__title-link", row.title);
        titleLink.href = sanitizeResearchUrl(row.listing.item_url);
        titleLink.target = "_blank";
        titleLink.rel = "noopener noreferrer";
        const titleMeta = createElement("p", "furimane-research-table__title-meta", `合計 ${row.totalCount}件 / 合計売上 ${formatResearchPrice(row.totalSales)}${row.totalCount > 1 ? " / 売値は代表商品の価格" : ""}`);
        titleWrap.append(titleLink, titleMeta);
        titleCell.appendChild(titleWrap);
        const priceCell = createElement("td", "furimane-research-table__price", formatResearchPrice(row.price));
        const periodCells = PERIOD_DEFINITIONS.flatMap((period) => {
            const countCell = document.createElement("td");
            countCell.className = `furimane-research-table__period-cell furimane-research-table__period-cell--${period.accentClass}`;
            countCell.appendChild(createCountCellContent(row.periods[period.key].count, dashboard.hasDatedListings));
            const revenueCell = document.createElement("td");
            revenueCell.className = `furimane-research-table__period-cell furimane-research-table__period-cell--${period.accentClass}`;
            revenueCell.appendChild(createRevenueCellContent(row.periods[period.key].revenue, dashboard.hasDatedListings));
            return [countCell, revenueCell];
        });
        const actionCell = document.createElement("td");
        const actionWrapper = createElement("div", "furimane-research-table__row-actions");
        const bookmarkButton = createBookmarkButton(row, bookmarkState, rerender, tr);
        const simulateButton = createElement("button", "furimane-research-table__simulate-button", "シミュレート");
        simulateButton.type = "button";
        simulateButton.addEventListener("click", async () => {
            const nextRow = tr.nextElementSibling;
            if (nextRow?.classList.contains("furimane-research-simulator-row")) {
                nextRow.remove();
                return;
            }
            if (!window.FurimanagerResearchSimulator?.renderSimulator) {
                showBookmarkToast("シミュレーターを読み込めませんでした");
                return;
            }
            await loadResearchPurchasePriceForRow(row, purchasePrices);
            const savedPrice = purchasePrices[row.listing.item_id] ?? { purchasePrice: null, shippingFee: null };
            await window.FurimanagerResearchSimulator.renderSimulator(tr, row.listing, {
                savedPrice,
                platform: row.platform,
                monthlySalesCount: dashboard.hasDatedListings ? row.periods.period1.count : row.totalCount,
                onSave: async (nextSavedPrice) => {
                    purchasePrices[row.listing.item_id] = nextSavedPrice;
                    const addedBookmark = await addBookmarkFromSimulation(row, bookmarkState, tr);
                    if (addedBookmark) {
                        setBookmarkButtonState(bookmarkButton, true);
                    }
                }
            });
        });
        actionWrapper.append(bookmarkButton, simulateButton);
        actionCell.appendChild(actionWrapper);
        tr.append(thumbnailCell, titleCell, priceCell, ...periodCells, actionCell);
        tbody.appendChild(tr);
    }
    table.append(colgroup, thead, tbody);
    scrollArea.appendChild(table);
    panel.appendChild(scrollArea);
    return panel;
}
function createResearchTableColGroup() {
    const colgroup = document.createElement("colgroup");
    const widths = ["13%", "33%", "8%", "4%", "7%", "4%", "7%", "4%", "7%", "13%"];
    for (const width of widths) {
        const col = document.createElement("col");
        col.style.width = width;
        colgroup.appendChild(col);
    }
    return colgroup;
}
function createRowsLimitNotice(totalRows, visibleRows, onShowMore) {
    const wrapper = createElement("div", "furimane-research-table__stats-note");
    const text = createElement("span", undefined, `表示高速化のため、表は ${visibleRows} / ${totalRows} 件を表示中です。集計は全件で計算済みです。`);
    const button = createElement("button", "furimane-research-table__action-button", "さらに表示");
    button.type = "button";
    button.addEventListener("click", onShowMore);
    wrapper.append(text, button);
    return wrapper;
}
async function renderResearchTable(container, seller, listings, options = {}) {
    const normalizedListings = listings.map((listing) => ({
        ...listing,
        platform: getResearchPlatform(seller, listing)
    }));
    const renderSequence = ++researchTableRenderSequence;
    const isCurrentRender = () => renderSequence === researchTableRenderSequence;
    const dashboard = buildDashboardData(seller, normalizedListings, options);
    const bookmarkState = { items: [], count: 0, limit: 50, loading: true };
    const purchasePrices = {};
    let visibleRowLimit = Math.min(dashboard.rows.length, TABLE_INITIAL_ROW_LIMIT);
    const render = () => {
        if (!isCurrentRender()) {
            return;
        }
        const root = createElement("div", "furimane-research-table-root");
        const mobileMessage = createElement("div", "furimane-research-table__mobile-message", "リサーチ機能はPC専用です。PC幅でご利用ください。");
        const desktop = createElement("div", "furimane-research-table__desktop");
        const visibleRows = dashboard.rows.slice(0, visibleRowLimit);
        desktop.append(createResearchHero(seller, dashboard, options, bookmarkState), createPeriodCards(dashboard));
        if (!dashboard.hasDatedListings) {
            desktop.appendChild(createStatsPendingNotice());
        }
        desktop.appendChild(createResearchTable(visibleRows, dashboard, bookmarkState, purchasePrices, render));
        if (visibleRows.length < dashboard.rows.length) {
            desktop.appendChild(createRowsLimitNotice(dashboard.rows.length, visibleRows.length, () => {
                visibleRowLimit = Math.min(dashboard.rows.length, visibleRowLimit + TABLE_ROW_INCREMENT);
                render();
            }));
        }
        root.append(mobileMessage, desktop);
        container.replaceChildren(root);
    };
    render();
    void loadResearchBookmarks().then((nextBookmarkState) => {
        if (!isCurrentRender()) {
            return;
        }
        bookmarkState.items = nextBookmarkState.items;
        bookmarkState.count = nextBookmarkState.count;
        bookmarkState.limit = nextBookmarkState.limit;
        bookmarkState.loading = false;
        render();
    });
    void loadResearchPurchasePrices(dashboard.rows, dashboard.platform).then((nextPurchasePrices) => {
        if (!isCurrentRender()) {
            return;
        }
        if (Object.keys(nextPurchasePrices).length > 0) {
            Object.assign(purchasePrices, nextPurchasePrices);
            render();
        }
    });
}
window.FurimanagerResearchTable = {
    renderTable: renderResearchTable
};
