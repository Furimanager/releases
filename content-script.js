(() => {
    const mountedWindow = window;
    const chromeApi = globalThis.chrome;
    if (mountedWindow.__furimanagerMercariActionButtonsMounted) {
        return;
    }
    mountedWindow.__furimanagerMercariActionButtonsMounted = true;
    const TOOLBAR_ATTRIBUTE = "data-furimanager-action-toolbar";
    const TOOLBAR_KIND_ATTRIBUTE = "data-furimanager-action-kind";
    const OBSERVER_DEBOUNCE_MS = 250;
    const PRODUCT_PATH_PATTERN = /^\/item\//;
    const HISTORY_PATH_MARKERS = [
        "/mypage/listings/sold",
        "/mypage/listings/completed",
        "/mypage/listings/trading",
        "/mypage/listings/history",
    ];
    const BROWSING_HISTORY_PATH_MARKERS = [
        "/mypage/browsing_history",
    ];
    const ACTIVE_LISTING_PATH_MARKERS = [
        "/mypage/listings",
        "/mypage/listings/listing",
        "/mypage/listings/active",
        "/mypage/listings/in_progress",
    ];
    const OWN_PRODUCT_TEXT_MARKERS = [
        "商品の編集",
        "商品を編集",
        "出品を停止",
        "公開停止",
        "商品を削除",
        "削除する",
        "価格を変更",
    ];
    const ACTIVE_LISTING_TEXT_MARKERS = [
        "現在出品している商品",
        "出品中の商品",
        "出品した商品",
        "販売中",
    ];
    const BUTTONS_BY_KIND = {
        otherProduct: [
            { id: "copy-listing", label: "コピー出品", action: "copyListing" },
            { id: "copy-draft", label: "下書き", action: "saveDraft" },
        ],
        ownProduct: [
            { id: "stop-listing", label: "停止", action: "stopListing" },
            { id: "delete-listing", label: "削除", action: "deleteListing" },
            { id: "relist", label: "再出品", action: "relist" },
            { id: "save-draft", label: "下書き", action: "saveDraft" },
            { id: "increase-price", label: "+100", action: "adjustPrice", amount: 100 },
            { id: "decrease-price", label: "-100", action: "adjustPrice", amount: -100 },
        ],
        history: [
            { id: "relist", label: "再出品", action: "relist" },
            { id: "save-draft", label: "下書き", action: "saveDraft" },
        ],
        activeListings: [
            { id: "relist", label: "再出品", action: "relist" },
            { id: "save-draft", label: "下書き", action: "saveDraft" },
            { id: "increase-price", label: "+100", action: "adjustPrice", amount: 100 },
            { id: "decrease-price", label: "-100", action: "adjustPrice", amount: -100 },
        ],
    };
    BUTTONS_BY_KIND.otherProduct = BUTTONS_BY_KIND.otherProduct.filter((definition) => definition.action === "copyListing");
    let injectionTimer = null;
    let retryTimer = null;
    let retryCount = 0;
    function detectPageKind() {
        const path = window.location.pathname;
        if (isBrowsingHistoryPage(path)) {
            return "browsingHistory";
        }
        if (isHistoryPage(path)) {
            return "history";
        }
        if (PRODUCT_PATH_PATTERN.test(path)) {
            return isOwnProductPage() ? "ownProduct" : "otherProduct";
        }
        if (isActiveListingsPage(path)) {
            return "activeListings";
        }
        return "unknown";
    }
    function matchesPathMarker(path, marker) {
        return path === marker || path.startsWith(`${marker}/`);
    }
    function isBrowsingHistoryPage(path) {
        return BROWSING_HISTORY_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker));
    }
    function isHistoryPage(path) {
        return HISTORY_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker));
    }
    function isActiveListingsPage(path) {
        if (isBrowsingHistoryPage(path) || isHistoryPage(path)) {
            return false;
        }
        if (ACTIVE_LISTING_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker))) {
            const selectedTab = getSelectedListingsTabText();
            return selectedTab ? selectedTab.includes("出品中") : true;
        }
        if (!path.includes("/mypage")) {
            return false;
        }
        const bodyText = document.body?.innerText ?? "";
        return ACTIVE_LISTING_TEXT_MARKERS.some((marker) => bodyText.includes(marker));
    }
    function getSelectedListingsTabText() {
        const candidates = safeQuerySelectorAll(document, '[role="tab"][aria-selected="true"], [aria-selected="true"]');
        const selected = candidates
            .map((element) => normalizeText(element.textContent))
            .find((text) => ["出品中", "取引中", "売却済み", "販売履歴"].some((label) => text.includes(label)));
        return selected ?? null;
    }
    function isOwnProductPage() {
        const bodyText = document.body?.innerText ?? "";
        if (OWN_PRODUCT_TEXT_MARKERS.some((marker) => bodyText.includes(marker))) {
            return true;
        }
        const editLink = document.querySelector('a[href*="/sell/edit"], a[href*="/items/edit"], a[href*="/item/edit"]');
        return editLink !== null;
    }
    function injectStyles() {
        if (document.getElementById("furimanager-action-button-style")) {
            return;
        }
        const style = document.createElement("style");
        style.id = "furimanager-action-button-style";
        style.textContent = `
      .furimanager-action-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        border: 0;
        background: transparent;
        box-shadow: none;
      }

      .furimanager-action-toolbar--media {
        width: fit-content;
        margin-top: 64px;
        margin-bottom: 34px;
        padding: 0;
        position: relative;
        z-index: 20;
      }

      .furimanager-action-toolbar--inline-end {
        position: absolute;
        top: 50%;
        right: 52px;
        z-index: 10;
        flex-wrap: nowrap;
        margin-top: 0;
        transform: translateY(-50%);
      }

      .furimanager-action-button {
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: #5B5FE8;
        color: #FFFFFF;
        font-size: 12px;
        font-weight: 600;
        line-height: 34px;
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.22);
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 140ms ease, transform 140ms ease;
      }

      .furimanager-action-button:hover {
        background: #4F46E5;
      }

      .furimanager-action-button:active {
        transform: translateY(1px);
      }

      @media (max-width: 900px) {
        .furimanager-action-toolbar--inline-end {
          position: static;
          transform: none;
          margin-top: 8px;
          flex-wrap: wrap;
        }
      }

      .furimanager-toast {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        border: 1px solid #5B5FE8;
        border-radius: 12px;
        background: #111827;
        color: #FFFFFF;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.5;
        box-shadow: 0 12px 28px rgba(17, 24, 39, 0.28);
      }
    `;
        document.documentElement.appendChild(style);
    }
    function injectButtons() {
        const pageKind = detectPageKind();
        cleanupToolbarsForPageKind(pageKind);
        if (pageKind === "unknown" || pageKind === "browsingHistory") {
            clearScheduledInjections();
            return;
        }
        const buttonDefinitions = BUTTONS_BY_KIND[pageKind];
        const targets = getInjectionTargets(pageKind);
        if (targets.length === 0) {
            scheduleRetryInjection();
            return;
        }
        retryCount = 0;
        injectStyles();
        targets.forEach((target) => {
            ensureToolbar(target, buttonDefinitions, pageKind);
        });
    }
    function getInjectionTargets(pageKind) {
        if (pageKind === "ownProduct" || pageKind === "otherProduct") {
            const target = getProductPageTarget(pageKind);
            return target ? [target] : [];
        }
        if (pageKind === "history" || pageKind === "activeListings") {
            return getListingTargets(pageKind);
        }
        return [];
    }
    function getProductPageTarget(pageKind) {
        const imageContainer = findProductImageContainer();
        if (imageContainer) {
            const mount = findProductImageToolbarMount(imageContainer);
            const root = mount.parentElement ?? mount;
            return buildActionContext(pageKind, root, mount, "after");
        }
        if (pageKind === "otherProduct") {
            return null;
        }
        const actionContainer = findProductActionContainer();
        const fallbackMain = document.querySelector("main");
        const mount = toHTMLElement(actionContainer) ?? toHTMLElement(fallbackMain);
        if (!mount) {
            return null;
        }
        const root = toHTMLElement(mount.closest("section, article, main, div")) ?? mount;
        return buildActionContext(pageKind, root, mount);
    }
    function findProductImageContainer() {
        const image = findLargestProductImage();
        if (!image) {
            return null;
        }
        const mediaArea = image.closest('[role="region"], [data-testid*="carousel"], [data-testid*="image"], [class*="carousel"]');
        if (mediaArea instanceof HTMLElement && isReasonableProductImageContainer(mediaArea, image)) {
            return mediaArea;
        }
        let current = image.parentElement;
        let best = image.parentElement;
        for (let depth = 0; current && depth < 6; depth += 1) {
            if (isReasonableProductImageContainer(current, image)) {
                best = current;
            }
            current = current.parentElement;
        }
        return best;
    }
    function findProductImageToolbarMount(imageContainer) {
        const main = document.querySelector("main");
        const baseRect = imageContainer.getBoundingClientRect();
        let current = imageContainer.parentElement;
        for (let depth = 0; current && depth < 4; depth += 1) {
            if (main && !main.contains(current)) {
                break;
            }
            const rect = current.getBoundingClientRect();
            const containsTitle = current.querySelector("h1") !== null;
            if (!containsTitle &&
                rect.width >= baseRect.width &&
                rect.height >= baseRect.height &&
                rect.width <= baseRect.width + 360 &&
                rect.height <= baseRect.height + 360) {
                return current;
            }
            current = current.parentElement;
        }
        return imageContainer;
    }
    function isReasonableProductImageContainer(container, image) {
        const rect = container.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const main = document.querySelector("main");
        if (main && !main.contains(container)) {
            return false;
        }
        if (rect.width < imageRect.width || rect.height < imageRect.height) {
            return false;
        }
        if (rect.width > Math.max(imageRect.width * 1.7, imageRect.width + 260)) {
            return false;
        }
        if (rect.height > Math.max(imageRect.height * 1.7, imageRect.height + 260)) {
            return false;
        }
        if (container.querySelectorAll("h1, button, [role='button']").length > 8) {
            return false;
        }
        return true;
    }
    function findLargestProductImage() {
        const images = safeQuerySelectorAll(document, 'main img[src], main picture img[src], img[src*="mercdn"], img[src*="mercari"]')
            .filter((element) => element instanceof HTMLImageElement)
            .filter((image) => {
            if (!isVisible(image)) {
                return false;
            }
            const rect = image.getBoundingClientRect();
            return rect.width >= 280 && rect.height >= 240;
        });
        return images.sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return bRect.width * bRect.height - aRect.width * aRect.height;
        })[0] ?? null;
    }
    function findProductActionContainer() {
        const directSelectors = [
            '[data-testid*="purchase"]',
            '[data-testid*="checkout"]',
            '[data-testid*="edit"]',
            '[data-testid*="delete"]',
            'button[type="button"]',
            'a[href*="/sell/edit"]',
            'a[href*="/items/edit"]',
            'a[href*="/item/edit"]',
        ];
        for (const selector of directSelectors) {
            const candidates = safeQuerySelectorAll(document, selector);
            const matched = candidates.find((element) => {
                const text = normalizeText(element.textContent);
                return (text.includes("購入") ||
                    text.includes("編集") ||
                    text.includes("停止") ||
                    text.includes("削除") ||
                    selector.includes("edit"));
            });
            const container = matched?.closest("div, section, article");
            if (container) {
                return container;
            }
        }
        const title = document.querySelector("h1");
        return title?.parentElement?.parentElement ?? title?.parentElement ?? null;
    }
    function getListingTargets(pageKind) {
        const root = pageKind === "activeListings" ? findActiveListingRoot() : findMainContentRoot();
        const selectors = [
            "table tbody tr",
            '[data-testid*="item-cell"]',
            '[data-testid*="item-card"]',
            'a[href*="/item/"]',
            'li:has(a[href*="/item/"])',
            'article:has(a[href*="/item/"])',
            'div:has(> a[href*="/item/"])',
            'div:has(a[href*="/item/"][data-testid])',
        ];
        const candidates = selectors.flatMap((selector) => safeQuerySelectorAll(root, selector));
        const uniqueCandidates = pickBestItemContainers(dedupeElements(candidates).filter((element) => isLikelyItemContainer(element)));
        return uniqueCandidates
            .map((element) => {
            const mount = getListingMountElement(element);
            const contextRoot = element instanceof HTMLAnchorElement ? mount : element;
            const placement = pageKind === "activeListings" ? "inlineEnd" : "append";
            return buildActionContext(pageKind, contextRoot, mount, placement);
        });
    }
    function pickBestItemContainers(elements) {
        const bestByUrl = new Map();
        elements.forEach((element) => {
            const itemUrl = getCandidateItemUrl(element);
            if (!itemUrl) {
                return;
            }
            const current = bestByUrl.get(itemUrl);
            if (!current || isBetterItemContainer(element, current)) {
                bestByUrl.set(itemUrl, element);
            }
        });
        return Array.from(bestByUrl.values());
    }
    function isBetterItemContainer(candidate, current) {
        if (candidate instanceof HTMLTableRowElement && !(current instanceof HTMLTableRowElement)) {
            return true;
        }
        if (candidate.tagName === "LI" && current.tagName !== "LI") {
            return true;
        }
        if (candidate.tagName === "ARTICLE" && !["LI", "TR"].includes(current.tagName)) {
            return true;
        }
        const candidateArea = getElementArea(candidate);
        const currentArea = getElementArea(current);
        return candidateArea > currentArea && candidateArea < currentArea * 8;
    }
    function getCandidateItemUrl(element) {
        const link = getItemLink(element);
        return normalizeItemUrl(link?.href ?? null);
    }
    function getElementArea(element) {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
    }
    function findMainContentRoot() {
        return document.querySelector("#my-page-main-content") ?? document.querySelector("main") ?? document.body;
    }
    function findActiveListingRoot() {
        return findMainContentRoot();
    }
    function getListingMountElement(root) {
        if (root instanceof HTMLTableRowElement) {
            const cells = Array.from(root.querySelectorAll(":scope > td"));
            return toHTMLElement(cells[0]) ?? root;
        }
        if (root instanceof HTMLAnchorElement) {
            return root.parentElement ?? root;
        }
        return root;
    }
    function isLikelyItemContainer(element) {
        if (!isVisible(element)) {
            return false;
        }
        if (element.closest(`[${TOOLBAR_ATTRIBUTE}="true"]`)) {
            return false;
        }
        if (element instanceof HTMLTableRowElement) {
            return element.querySelectorAll("td").length > 0;
        }
        const itemLinks = element.querySelectorAll('a[href*="/item/"]');
        const isItemLink = element instanceof HTMLAnchorElement && element.href.includes("/item/");
        if (!isItemLink && (itemLinks.length === 0 || itemLinks.length > 4)) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.height <= 420;
    }
    function ensureToolbar(context, buttonDefinitions, pageKind) {
        const existingToolbar = context.root.querySelector(`[${TOOLBAR_ATTRIBUTE}="true"]`);
        if (existingToolbar?.getAttribute(TOOLBAR_KIND_ATTRIBUTE) === pageKind) {
            return;
        }
        existingToolbar?.remove();
        const toolbar = document.createElement("div");
        toolbar.className = "furimanager-action-toolbar";
        applyToolbarPlacementClass(toolbar, context.placement);
        toolbar.setAttribute(TOOLBAR_ATTRIBUTE, "true");
        toolbar.setAttribute(TOOLBAR_KIND_ATTRIBUTE, pageKind);
        buttonDefinitions.forEach((definition) => {
            toolbar.appendChild(createActionButton(definition, context));
        });
        if (context.placement === "after") {
            context.mount.insertAdjacentElement("afterend", toolbar);
            return;
        }
        if (context.placement === "inlineEnd") {
            ensurePositionedContainer(context.mount);
        }
        context.mount.appendChild(toolbar);
    }
    function applyToolbarPlacementClass(toolbar, placement) {
        if (placement === "after") {
            toolbar.classList.add("furimanager-action-toolbar--media");
            return;
        }
        if (placement === "inlineEnd") {
            toolbar.classList.add("furimanager-action-toolbar--inline-end");
        }
    }
    function ensurePositionedContainer(element) {
        const position = window.getComputedStyle(element).position;
        if (position === "static") {
            element.style.position = "relative";
        }
    }
    function cleanupToolbarsForPageKind(pageKind) {
        if (pageKind === "browsingHistory" || pageKind === "unknown") {
            removeAllToolbars();
            return;
        }
        if (pageKind !== "otherProduct" && pageKind !== "ownProduct") {
            return;
        }
        const imageContainer = findProductImageContainer();
        const mount = imageContainer ? findProductImageToolbarMount(imageContainer) : null;
        const allowedRoot = mount?.parentElement ?? mount;
        safeQuerySelectorAll(document, `[${TOOLBAR_ATTRIBUTE}="true"]`).forEach((toolbar) => {
            if (!allowedRoot || !allowedRoot.contains(toolbar)) {
                toolbar.remove();
            }
        });
    }
    function removeAllToolbars() {
        safeQuerySelectorAll(document, `[${TOOLBAR_ATTRIBUTE}="true"]`).forEach((toolbar) => {
            toolbar.remove();
        });
    }
    function createActionButton(definition, context) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "furimanager-action-button";
        button.textContent = definition.label;
        button.dataset.furimanagerAction = definition.id;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleAction(definition, context);
        });
        return button;
    }
    async function handleAction(definition, context) {
        if (definition.action === "copyListing") {
            await handleCopyListing(context);
            return;
        }
        if (definition.action === "stopListing") {
            await handleStopListing(context);
            return;
        }
        if (definition.action === "deleteListing") {
            await handleDeleteListing(context);
            return;
        }
        if (definition.action === "relist") {
            await handleRelist(context);
            return;
        }
        if (definition.action === "saveDraft") {
            await handleSaveDraft(context);
            return;
        }
        await handleAdjustPrice(definition.amount ?? 0, context);
    }
    async function handleCopyListing(context) {
        await saveRelistPending(context, "copy");
    }
    async function handleRelist(context) {
        await saveRelistPending(context, "relist");
    }
    async function handleSaveDraft(context) {
        // TODO: 下書き保存と正式な再出品で保存先や後続動作を分ける場合は、mode='draft' を起点に分岐する。
        await saveRelistPending(context, "draft");
    }
    async function handleAdjustPrice(amount, context) {
        const item = await collectRelistData(context, "relist");
        if (typeof item.price !== "number") {
            showToast("価格が見つかりませんでした");
            return;
        }
        await sendRelistPending({
            ...item,
            price: Math.max(item.price + amount, 0),
        });
    }
    async function saveRelistPending(context, mode) {
        const item = await collectRelistData(context, mode);
        await sendRelistPending(item);
    }
    async function collectRelistData(context, mode) {
        const extractionRoot = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : context.root;
        const localItem = extractItemDataFromElement(extractionRoot, context.itemUrl, mode);
        if (!localItem.itemUrl || PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
            return {
                ...localItem,
                itemId: localItem.itemId ?? context.itemId,
            };
        }
        const remoteItem = await fetchItemData(localItem.itemUrl, mode);
        return {
            ...localItem,
            ...compactItem(remoteItem),
            itemId: localItem.itemId ?? remoteItem.itemId ?? context.itemId,
            itemUrl: localItem.itemUrl,
            mode,
        };
    }
    function extractItemDataFromElement(source, fallbackUrl, mode) {
        const itemUrl = normalizeItemUrl(getItemLink(source)?.href ?? fallbackUrl ?? window.location.href);
        const detailSource = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : source;
        const imageSource = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? findProductImageContainer() ?? source : source;
        const title = extractTitle(source);
        const price = extractPrice(source);
        const imageUrls = extractImageUrls(imageSource);
        const thumbnailUrl = imageUrls[0] ?? extractThumbnail(source);
        const description = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? extractDescription(document) : null;
        const categoryPath = extractCategoryPath(detailSource);
        // TODO: メルカリ側のフォーム仕様が変わった場合は、カテゴリ・配送方法の取得候補をここで増やす。
        return {
            itemId: extractMercariItemId(itemUrl),
            title,
            price,
            itemUrl,
            thumbnailUrl,
            imageUrls,
            description,
            categoryPath,
            condition: extractInfoValue(detailSource, ["商品の状態"]),
            brand: extractInfoValue(detailSource, ["ブランド"]),
            size: extractInfoValue(detailSource, ["商品のサイズ", "サイズ"]),
            shippingPayer: extractInfoValue(detailSource, ["配送料の負担"]),
            shippingMethod: extractInfoValue(detailSource, ["配送の方法"]),
            shippingFrom: extractInfoValue(detailSource, ["発送元の地域"]),
            shippingDays: extractInfoValue(detailSource, ["発送までの日数"]),
            mode,
        };
    }
    async function fetchItemData(itemUrl, mode) {
        try {
            const response = await fetch(itemUrl, {
                credentials: "include",
            });
            if (!response.ok) {
                return createEmptyRelistItem(mode, itemUrl);
            }
            const html = await response.text();
            const parsedDocument = new DOMParser().parseFromString(html, "text/html");
            return {
                itemId: extractMercariItemId(itemUrl),
                title: extractTitle(parsedDocument),
                price: extractPrice(parsedDocument),
                itemUrl,
                thumbnailUrl: extractThumbnail(parsedDocument),
                imageUrls: extractImageUrls(parsedDocument),
                description: extractDescription(parsedDocument),
                categoryPath: extractCategoryPath(parsedDocument),
                condition: extractInfoValue(parsedDocument, ["商品の状態"]),
                brand: extractInfoValue(parsedDocument, ["ブランド"]),
                size: extractInfoValue(parsedDocument, ["商品のサイズ", "サイズ"]),
                shippingPayer: extractInfoValue(parsedDocument, ["配送料の負担"]),
                shippingMethod: extractInfoValue(parsedDocument, ["配送の方法"]),
                shippingFrom: extractInfoValue(parsedDocument, ["発送元の地域"]),
                shippingDays: extractInfoValue(parsedDocument, ["発送までの日数"]),
                mode,
            };
        }
        catch {
            return createEmptyRelistItem(mode, itemUrl);
        }
    }
    function compactItem(item) {
        return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined && value !== ""));
    }
    function createEmptyRelistItem(mode, itemUrl = null) {
        return {
            itemId: extractMercariItemId(itemUrl),
            title: null,
            price: null,
            itemUrl,
            thumbnailUrl: null,
            imageUrls: [],
            description: null,
            categoryPath: [],
            condition: null,
            brand: null,
            size: null,
            shippingPayer: null,
            shippingMethod: null,
            shippingFrom: null,
            shippingDays: null,
            mode,
        };
    }
    function sendRelistPending(item) {
        return new Promise((resolve) => {
            if (!chromeApi?.runtime?.sendMessage) {
                showToast("拡張機能の保存処理を呼び出せませんでした");
                resolve();
                return;
            }
            chromeApi.runtime.sendMessage({
                type: "SET_RELIST_PENDING",
                payload: item,
            }, (response) => {
                if (chromeApi.runtime?.lastError) {
                    showToast("出品データの保存に失敗しました");
                    resolve();
                    return;
                }
                if (response?.success) {
                    showToast("新規出品ページを開きます");
                }
                else {
                    showToast(response?.message ?? "出品データの保存に失敗しました");
                }
                resolve();
            });
        });
    }
    async function handleStopListing(context) {
        if (!window.confirm("この商品を出品停止しますか？")) {
            return;
        }
        // メルカリ側のDOM文言に依存するため、複数候補から停止操作だけを慎重に探す。
        const stopTarget = await findActionElement(context.root, ["出品を停止", "公開停止", "停止する", "停止"], context.pageKind === "ownProduct");
        if (!stopTarget) {
            showToast("出品停止の操作対象が見つかりませんでした");
            return;
        }
        stopTarget.click();
        showToast("出品停止の操作を開始しました");
    }
    async function handleDeleteListing(context) {
        if (!window.confirm("この商品を削除しますか？この操作は取り消せない可能性があります")) {
            return;
        }
        // 削除は危険操作なので、最終確定ボタンが出た場合はユーザー自身に押してもらう。
        const deleteTarget = await findActionElement(context.root, ["商品を削除", "削除"], context.pageKind === "ownProduct");
        if (!deleteTarget) {
            showToast("削除操作の対象が見つかりませんでした");
            return;
        }
        if (isInsideDialog(deleteTarget) || isFinalDeleteElement(deleteTarget)) {
            showToast("削除確認画面を開きました。内容を確認してください");
            return;
        }
        deleteTarget.click();
        showToast("削除確認画面を開きました。内容を確認してください");
    }
    async function findActionElement(source, labels, includeDocumentFallback) {
        const directTarget = findVisibleActionElement(source, labels, includeDocumentFallback);
        if (directTarget) {
            return directTarget;
        }
        const menuButton = findMenuButton(source);
        if (menuButton) {
            menuButton.click();
            await sleep(250);
            return findVisibleActionElement(source, labels, true);
        }
        return null;
    }
    function findVisibleActionElement(source, labels, includeDocumentFallback) {
        const roots = includeDocumentFallback ? [source, document.body] : [source];
        const selectors = [
            "button",
            "a",
            '[role="button"]',
            '[data-testid*="button"]',
            '[data-testid*="menu"]',
            '[aria-label]',
        ];
        for (const root of roots) {
            for (const selector of selectors) {
                const candidates = safeQuerySelectorAll(root, selector);
                const matched = candidates.find((element) => {
                    if (element.closest(`[${TOOLBAR_ATTRIBUTE}="true"]`)) {
                        return false;
                    }
                    if (!isVisible(element)) {
                        return false;
                    }
                    const text = `${normalizeText(element.textContent)} ${element.getAttribute("aria-label") ?? ""}`;
                    return labels.some((label) => text.includes(label));
                });
                if (matched) {
                    return matched;
                }
            }
        }
        return null;
    }
    function findMenuButton(source) {
        const selectors = [
            'button[aria-label*="その他"]',
            'button[aria-label*="メニュー"]',
            'button[aria-label*="もっと"]',
            '[role="button"][aria-label*="その他"]',
            '[role="button"][aria-label*="メニュー"]',
            '[data-testid*="menu"]',
            "button",
        ];
        for (const selector of selectors) {
            const candidates = safeQuerySelectorAll(source, selector);
            const matched = candidates.find((element) => {
                if (element.closest(`[${TOOLBAR_ATTRIBUTE}="true"]`) || !isVisible(element)) {
                    return false;
                }
                const text = `${normalizeText(element.textContent)} ${element.getAttribute("aria-label") ?? ""}`;
                return ["その他", "メニュー", "もっと", "・・・", "...", "⋯"].some((label) => text.includes(label));
            });
            if (matched) {
                return matched;
            }
        }
        return null;
    }
    function isFinalDeleteElement(element) {
        const text = `${normalizeText(element.textContent)} ${element.getAttribute("aria-label") ?? ""}`;
        return text.includes("削除する") || text.includes("完全に削除") || text.includes("取り消せません");
    }
    function isInsideDialog(element) {
        return Boolean(element.closest('[role="dialog"], [aria-modal="true"]'));
    }
    function sleep(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }
    function buildActionContext(pageKind, root, source, placement = "append") {
        const link = getItemLink(root);
        const itemUrl = normalizeItemUrl(link?.href ?? (PRODUCT_PATH_PATTERN.test(window.location.pathname) ? window.location.href : null));
        return {
            pageKind,
            itemId: extractMercariItemId(itemUrl),
            itemUrl,
            sourcePath: window.location.pathname,
            root,
            mount: source,
            placement,
        };
    }
    function getItemLink(source) {
        if (source instanceof HTMLAnchorElement && source.href.includes("/item/")) {
            return source;
        }
        return source.querySelector('a[href*="/item/"]');
    }
    function extractMercariItemId(url) {
        if (!url) {
            return null;
        }
        const matched = url.match(/\/item\/([^/?#]+)/);
        return matched?.[1] ?? null;
    }
    function normalizeItemUrl(url) {
        if (!url) {
            return null;
        }
        try {
            return new URL(url, window.location.origin).toString();
        }
        catch {
            return url;
        }
    }
    function extractTitle(source) {
        const selectors = [
            "h1",
            '[data-testid*="name"]',
            '[data-testid*="title"]',
            'meta[property="og:title"]',
            'img[alt]',
            'a[href*="/item/"]',
        ];
        for (const selector of selectors) {
            const element = source.querySelector(selector);
            if (element instanceof HTMLMetaElement) {
                const content = sanitizeTitle(element.content);
                if (content) {
                    return content;
                }
            }
            if (element instanceof HTMLImageElement) {
                const alt = sanitizeTitle(element.alt);
                if (alt) {
                    return alt;
                }
            }
            const text = sanitizeTitle(element?.textContent ?? element?.getAttribute("aria-label") ?? "");
            if (text) {
                return text;
            }
        }
        return null;
    }
    function sanitizeTitle(value) {
        const text = normalizeText(value)
            .replace(/-?\s*メルカリ.*$/, "")
            .replace(/\s*\|\s*.*$/, "")
            .trim();
        return text || null;
    }
    function extractPrice(source) {
        const selectors = [
            '[data-testid*="price"]',
            '[aria-label*="価格"]',
            'meta[property="product:price:amount"]',
            'meta[property="og:price:amount"]',
        ];
        for (const selector of selectors) {
            const element = source.querySelector(selector);
            if (element instanceof HTMLMetaElement) {
                const price = parsePrice(element.content);
                if (price !== null) {
                    return price;
                }
            }
            const price = parsePrice(`${element?.textContent ?? ""} ${element?.getAttribute("aria-label") ?? ""}`);
            if (price !== null) {
                return price;
            }
        }
        const bodyText = source instanceof Document ? source.body?.innerText ?? "" : source.textContent ?? "";
        return parsePrice(bodyText);
    }
    function parsePrice(value) {
        const matched = value.match(/(?:¥|￥)\s*([0-9０-９,，]+)/);
        const raw = matched?.[1] ?? null;
        if (!raw) {
            return null;
        }
        const normalized = raw.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "");
        const price = Number.parseInt(normalized, 10);
        return Number.isFinite(price) ? price : null;
    }
    function extractThumbnail(source) {
        const selectors = [
            'meta[property="og:image"]',
            'img[src*="mercdn.net"]',
            "img[src]",
        ];
        for (const selector of selectors) {
            const element = source.querySelector(selector);
            if (element instanceof HTMLMetaElement && element.content) {
                return element.content;
            }
            if (element instanceof HTMLImageElement && element.src) {
                return element.src;
            }
        }
        return null;
    }
    function extractImageUrls(source) {
        const urls = new Set();
        const metaImage = source.querySelector('meta[property="og:image"]');
        if (metaImage instanceof HTMLMetaElement && metaImage.content) {
            urls.add(metaImage.content);
        }
        const allowUnknownImageSize = source instanceof Document;
        safeQuerySelectorAll(source, 'img[src*="mercdn"], img[src*="mercari"], img[src]').forEach((image) => {
            if (!(image instanceof HTMLImageElement)) {
                return;
            }
            const src = image.currentSrc || image.src;
            if (!src || (!allowUnknownImageSize && (image.width < 48 || image.height < 48))) {
                return;
            }
            urls.add(src);
        });
        return Array.from(urls).slice(0, 10);
    }
    function extractDescription(source) {
        const selectors = [
            '[data-testid*="description"]',
            '[aria-label*="商品説明"]',
            '[aria-label*="説明"]',
            'meta[property="og:description"]',
            'meta[name="description"]',
        ];
        for (const selector of selectors) {
            const element = source.querySelector(selector);
            if (element instanceof HTMLMetaElement) {
                const content = sanitizeDescription(element.content);
                if (content) {
                    return content;
                }
            }
            const text = sanitizeDescription(element?.textContent ?? element?.getAttribute("aria-label") ?? "");
            if (text) {
                return text;
            }
        }
        return null;
    }
    function extractCategoryPath(source) {
        const lines = getTextLines(source);
        const start = lines.findIndex((line) => line === "カテゴリー");
        if (start === -1) {
            return [];
        }
        const stopLabels = [
            "ブランド",
            "商品のサイズ",
            "サイズ",
            "商品の状態",
            "配送料の負担",
            "配送の方法",
            "発送元の地域",
            "発送までの日数",
            "商品説明",
            "商品の説明",
        ];
        const categoryLines = [];
        for (let index = start + 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (stopLabels.includes(line)) {
                break;
            }
            if (!line.startsWith("#") && !categoryLines.includes(line)) {
                categoryLines.push(line);
            }
        }
        return categoryLines.slice(0, 5);
    }
    function extractInfoValue(source, labels) {
        const lines = getTextLines(source);
        for (const label of labels) {
            const index = lines.findIndex((line) => line === label);
            if (index === -1) {
                continue;
            }
            const value = lines[index + 1];
            if (value && !labels.includes(value)) {
                return value;
            }
        }
        return null;
    }
    function getTextLines(source) {
        const text = source instanceof Document ? source.body?.innerText ?? "" : source.textContent ?? "";
        return text
            .split(/\n+/)
            .map((line) => normalizeText(line))
            .filter(Boolean);
    }
    function sanitizeDescription(value) {
        const text = value.replace(/\r\n/g, "\n").trim();
        return text || null;
    }
    function safeQuerySelectorAll(root, selector) {
        try {
            return Array.from(root.querySelectorAll(selector)).flatMap((element) => {
                const htmlElement = toHTMLElement(element);
                return htmlElement ? [htmlElement] : [];
            });
        }
        catch {
            return [];
        }
    }
    function dedupeElements(elements) {
        return Array.from(new Set(elements));
    }
    function toHTMLElement(element) {
        return element instanceof HTMLElement ? element : null;
    }
    function normalizeText(value) {
        return (value ?? "").replace(/\s+/g, " ").trim();
    }
    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }
    function showToast(message) {
        injectStyles();
        const existing = document.querySelector(".furimanager-toast");
        existing?.remove();
        const toast = document.createElement("div");
        toast.className = "furimanager-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => {
            toast.remove();
        }, 3600);
    }
    function scheduleInjection() {
        if (isBrowsingHistoryPage(window.location.pathname)) {
            clearScheduledInjections();
            cleanupToolbarsForPageKind("browsingHistory");
            return;
        }
        if (injectionTimer !== null) {
            return;
        }
        injectionTimer = window.setTimeout(() => {
            injectionTimer = null;
            injectButtons();
        }, OBSERVER_DEBOUNCE_MS);
    }
    function scheduleRetryInjection() {
        if (isBrowsingHistoryPage(window.location.pathname)) {
            clearScheduledInjections();
            return;
        }
        if (retryTimer !== null || retryCount >= 20) {
            return;
        }
        retryCount += 1;
        retryTimer = window.setTimeout(() => {
            retryTimer = null;
            injectButtons();
        }, 500);
    }
    function clearScheduledInjections() {
        if (injectionTimer !== null) {
            window.clearTimeout(injectionTimer);
            injectionTimer = null;
        }
        if (retryTimer !== null) {
            window.clearTimeout(retryTimer);
            retryTimer = null;
        }
        retryCount = 0;
    }
    function patchHistoryEvents() {
        const originalPushState = window.history.pushState;
        const originalReplaceState = window.history.replaceState;
        window.history.pushState = function pushState(...args) {
            const result = originalPushState.apply(this, args);
            scheduleInjection();
            return result;
        };
        window.history.replaceState = function replaceState(...args) {
            const result = originalReplaceState.apply(this, args);
            scheduleInjection();
            return result;
        };
        window.addEventListener("popstate", scheduleInjection);
    }
    patchHistoryEvents();
    injectButtons();
    const observer = new MutationObserver(scheduleInjection);
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
})();
