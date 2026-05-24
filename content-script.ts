(() => {
  type MercariPageKind = "otherProduct" | "ownProduct" | "history" | "activeListings" | "browsingHistory" | "unknown";
  type RelistMode = "relist" | "draft" | "copy";
  type ActionName = "copyListing" | "stopListing" | "deleteListing" | "relist" | "saveDraft" | "adjustPrice";

  type ActionButtonDefinition = {
    id: string;
    label: string;
    action: ActionName;
    amount?: number;
  };

  type ToolbarPlacement = "append" | "after" | "inlineEnd";

  type ActionContext = {
    pageKind: MercariPageKind;
    itemId: string | null;
    itemUrl: string | null;
    sourcePath: string;
    root: HTMLElement;
    mount: HTMLElement;
    placement?: ToolbarPlacement;
  };

  type RelistPendingItem = {
    itemId: string | null;
    title: string | null;
    price: number | null;
    itemUrl: string | null;
    thumbnailUrl: string | null;
    imageUrls: string[];
    description: string | null;
    categoryPath: string[];
    condition: string | null;
    brand: string | null;
    size: string | null;
    shippingPayer: string | null;
    shippingMethod: string | null;
    shippingFrom: string | null;
    shippingDays: string | null;
    savedAt?: string;
    mode: RelistMode;
  };

  type RuntimeResponse = {
    success?: boolean;
    message?: string;
  };

  type ChromeLike = {
    runtime?: {
      lastError?: {
        message?: string;
      };
      sendMessage: (message: unknown, response?: (result?: RuntimeResponse) => void) => void;
      onMessage?: {
        addListener: (
          listener: (message: any, sender: unknown, sendResponse: (response: any) => void) => boolean | void
        ) => void;
      };
    };
  };

  const mountedWindow = window as Window & {
    __furimanagerMercariActionButtonsMounted?: boolean;
  };
  const chromeApi = (globalThis as unknown as { chrome?: ChromeLike }).chrome;

  if (mountedWindow.__furimanagerMercariActionButtonsMounted) {
    return;
  }

  mountedWindow.__furimanagerMercariActionButtonsMounted = true;

  const TOOLBAR_ATTRIBUTE = "data-furimanager-action-toolbar";
  const TOOLBAR_KIND_ATTRIBUTE = "data-furimanager-action-kind";
  const TOOLBAR_BUTTONS_ATTRIBUTE = "data-furimanager-action-buttons";
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
  const SOLD_PRODUCT_TEXT_MARKERS = [
    "SOLD",
    "取引画面を表示する",
    "売却済み",
    "売れた商品",
  ];
  const RELIST_ONLY_BUTTONS: ActionButtonDefinition[] = [
    { id: "relist", label: "再出品", action: "relist" },
  ];

  const BUTTONS_BY_KIND: Record<Exclude<MercariPageKind, "unknown" | "browsingHistory">, ActionButtonDefinition[]> = {
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
    ],
    activeListings: [
      { id: "relist", label: "再出品", action: "relist" },
      { id: "save-draft", label: "下書き", action: "saveDraft" },
      { id: "increase-price", label: "+100", action: "adjustPrice", amount: 100 },
      { id: "decrease-price", label: "-100", action: "adjustPrice", amount: -100 },
    ],
  };

  BUTTONS_BY_KIND.otherProduct = BUTTONS_BY_KIND.otherProduct.filter((definition) => definition.action === "copyListing");

  const RELIST_DETECTION_TEXT_MARKERS = [
    "\u518d\u51fa\u54c1",
    "\u518d\u51fa\u54c1\u3059\u308b",
    "\u3082\u3046\u4e00\u5ea6\u51fa\u54c1",
    "\u30b3\u30d4\u30fc\u51fa\u54c1",
    "\u30b3\u30d4\u30fc\u3057\u3066\u51fa\u54c1",
  ];

  chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "DETECT_MERCARI_RELIST_BUTTON") {
        sendResponse({
          success: true,
          ...detectRelistButtonCandidate(message.mercariItemId ?? null),
        });
        return false;
      }

      if (message?.type === "CLICK_FURIMANE_COPY_LISTING_BUTTON") {
        sendResponse({
          success: true,
          ...clickFurimaneCopyListingButton(message.mercariItemId ?? null),
        });
        return false;
      }
    } catch (error) {
      sendResponse({
        success: false,
        message: error instanceof Error ? error.message : "relist button action failed",
      });
      return false;
    }

    return false;
  });

  let injectionTimer: number | null = null;
  let retryTimer: number | null = null;
  let retryCount = 0;

  function detectPageKind(): MercariPageKind {
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

  function matchesPathMarker(path: string, marker: string): boolean {
    return path === marker || path.startsWith(`${marker}/`);
  }

  function isBrowsingHistoryPage(path: string): boolean {
    return BROWSING_HISTORY_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker));
  }

  function isHistoryPage(path: string): boolean {
    return HISTORY_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker));
  }

  function isActiveListingsPage(path: string): boolean {
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

  function getSelectedListingsTabText(): string | null {
    const candidates = safeQuerySelectorAll(document, '[role="tab"][aria-selected="true"], [aria-selected="true"]');
    const selected = candidates
      .map((element) => normalizeText(element.textContent))
      .find((text) => ["出品中", "取引中", "売却済み", "販売履歴"].some((label) => text.includes(label)));

    return selected ?? null;
  }

  function isOwnProductPage(): boolean {
    const bodyText = document.body?.innerText ?? "";

    if (OWN_PRODUCT_TEXT_MARKERS.some((marker) => bodyText.includes(marker))) {
      return true;
    }

    const editLink = document.querySelector('a[href*="/sell/edit"], a[href*="/items/edit"], a[href*="/item/edit"]');
    return editLink !== null;
  }

  function isSoldProductPage(): boolean {
    const bodyText = document.body?.innerText ?? "";
    return SOLD_PRODUCT_TEXT_MARKERS.some((marker) => bodyText.includes(marker));
  }

  function injectStyles(): void {
    const existingStyle = document.getElementById("furimanager-action-button-style");
    const style = existingStyle ?? document.createElement("style");
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
        width: 100%;
        max-width: 100%;
        margin-top: 0;
        margin-left: 0;
        margin-bottom: 0;
        box-sizing: border-box;
        padding: 8px 14px 8px 104px;
        position: relative;
        z-index: 0;
        background: #ffd8eb !important;
        border-radius: 0 !important;
        overflow: hidden;
        pointer-events: none;
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
        background: #ff4fa3;
        color: #FFFFFF;
        font-size: 12px;
        font-weight: 600;
        line-height: 34px;
        box-shadow: 0 4px 12px rgba(255, 79, 163, 0.24);
        cursor: pointer;
        pointer-events: auto;
        white-space: nowrap;
        transition: background-color 140ms ease, transform 140ms ease;
      }

      .furimanager-action-button:hover {
        background: #f13d94;
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

    if (!existingStyle) {
      document.documentElement.appendChild(style);
    }
  }

  function injectButtons(): void {
    const pageKind = detectPageKind();

    cleanupToolbarsForPageKind(pageKind);

    if (pageKind === "unknown" || pageKind === "browsingHistory") {
      clearScheduledInjections();
      return;
    }

    const buttonDefinitions = getButtonDefinitions(pageKind);
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

  function getInjectionTargets(pageKind: MercariPageKind): ActionContext[] {
    if (pageKind === "ownProduct" || pageKind === "otherProduct") {
      const target = getProductPageTarget(pageKind);
      return target ? [target] : [];
    }

    if (pageKind === "history" || pageKind === "activeListings") {
      return getListingTargets(pageKind);
    }

    return [];
  }

  function getButtonDefinitions(pageKind: Exclude<MercariPageKind, "unknown" | "browsingHistory">): ActionButtonDefinition[] {
    if (pageKind === "history") {
      return RELIST_ONLY_BUTTONS;
    }

    if (pageKind === "ownProduct" && isSoldProductPage()) {
      return RELIST_ONLY_BUTTONS;
    }

    return BUTTONS_BY_KIND[pageKind];
  }

  function getProductPageTarget(pageKind: MercariPageKind): ActionContext | null {
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

  function findProductImageContainer(): HTMLElement | null {
    const image = findLargestProductImage();

    if (!image) {
      return null;
    }

    const mediaArea = image.closest('[role="region"], [data-testid*="carousel"], [data-testid*="image"], [class*="carousel"]');

    if (mediaArea instanceof HTMLElement && isReasonableProductImageContainer(mediaArea, image)) {
      return mediaArea;
    }

    let current = image.parentElement;
    let best: HTMLElement | null = image.parentElement;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (isReasonableProductImageContainer(current, image)) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function findProductImageToolbarMount(imageContainer: HTMLElement): HTMLElement {
    const main = document.querySelector("main");
    const baseRect = imageContainer.getBoundingClientRect();
    let current = imageContainer.parentElement;

    for (let depth = 0; current && depth < 4; depth += 1) {
      if (main && !main.contains(current)) {
        break;
      }

      const rect = current.getBoundingClientRect();
      const containsTitle = current.querySelector("h1") !== null;

      if (
        !containsTitle &&
        rect.width >= baseRect.width &&
        rect.height >= baseRect.height &&
        rect.width <= baseRect.width + 360 &&
        rect.height <= baseRect.height + 360
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return imageContainer;
  }

  function isReasonableProductImageContainer(container: HTMLElement, image: HTMLImageElement): boolean {
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

  function findLargestProductImage(): HTMLImageElement | null {
    const images = safeQuerySelectorAll(document, 'main img[src], main picture img[src], img[src*="mercdn"], img[src*="mercari"]')
      .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement)
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

  function findProductActionContainer(): Element | null {
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
        return (
          text.includes("購入") ||
          text.includes("編集") ||
          text.includes("停止") ||
          text.includes("削除") ||
          selector.includes("edit")
        );
      });

      const container = matched?.closest("div, section, article");

      if (container) {
        return container;
      }
    }

    const title = document.querySelector("h1");
    return title?.parentElement?.parentElement ?? title?.parentElement ?? null;
  }

  function getListingTargets(pageKind: "history" | "activeListings"): ActionContext[] {
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
        const placement: ToolbarPlacement = pageKind === "activeListings" ? "inlineEnd" : "append";
        return buildActionContext(pageKind, contextRoot, mount, placement);
      });
  }

  function pickBestItemContainers(elements: HTMLElement[]): HTMLElement[] {
    const bestByUrl = new Map<string, HTMLElement>();

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

  function isBetterItemContainer(candidate: HTMLElement, current: HTMLElement): boolean {
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

  function getCandidateItemUrl(element: HTMLElement): string | null {
    const link = getItemLink(element);
    return normalizeItemUrl(link?.href ?? null);
  }

  function getElementArea(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function findMainContentRoot(): ParentNode {
    return document.querySelector("#my-page-main-content") ?? document.querySelector("main") ?? document.body;
  }

  function findActiveListingRoot(): ParentNode {
    return findMainContentRoot();
  }

  function getListingMountElement(root: HTMLElement): HTMLElement {
    if (root instanceof HTMLTableRowElement) {
      const cells = Array.from(root.querySelectorAll(":scope > td"));
      return toHTMLElement(cells[0]) ?? root;
    }

    if (root instanceof HTMLAnchorElement) {
      return root.parentElement ?? root;
    }

    return root;
  }

  function isLikelyItemContainer(element: HTMLElement): boolean {
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

  function ensureToolbar(context: ActionContext, buttonDefinitions: ActionButtonDefinition[], pageKind: MercariPageKind): void {
    const existingToolbar = context.root.querySelector(`[${TOOLBAR_ATTRIBUTE}="true"]`);
    const buttonSignature = buttonDefinitions.map((definition) => definition.id).join(",");

    if (
      existingToolbar?.getAttribute(TOOLBAR_KIND_ATTRIBUTE) === pageKind &&
      existingToolbar.getAttribute(TOOLBAR_BUTTONS_ATTRIBUTE) === buttonSignature
    ) {
      return;
    }

    existingToolbar?.remove();

    const toolbar = document.createElement("div");
    toolbar.className = "furimanager-action-toolbar";
    applyToolbarPlacementClass(toolbar, context.placement);
    toolbar.setAttribute(TOOLBAR_ATTRIBUTE, "true");
    toolbar.setAttribute(TOOLBAR_KIND_ATTRIBUTE, pageKind);
    toolbar.setAttribute(TOOLBAR_BUTTONS_ATTRIBUTE, buttonSignature);

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

  function applyToolbarPlacementClass(toolbar: HTMLElement, placement: ToolbarPlacement | undefined): void {
    if (placement === "after") {
      toolbar.classList.add("furimanager-action-toolbar--media");
      return;
    }

    if (placement === "inlineEnd") {
      toolbar.classList.add("furimanager-action-toolbar--inline-end");
    }
  }

  function ensurePositionedContainer(element: HTMLElement): void {
    const position = window.getComputedStyle(element).position;

    if (position === "static") {
      element.style.position = "relative";
    }
  }

  function cleanupToolbarsForPageKind(pageKind: MercariPageKind): void {
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

  function removeAllToolbars(): void {
    safeQuerySelectorAll(document, `[${TOOLBAR_ATTRIBUTE}="true"]`).forEach((toolbar) => {
      toolbar.remove();
    });
  }

  function createActionButton(definition: ActionButtonDefinition, context: ActionContext): HTMLButtonElement {
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

  async function handleAction(definition: ActionButtonDefinition, context: ActionContext): Promise<void> {
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

  async function handleCopyListing(context: ActionContext): Promise<void> {
    await saveRelistPending(context, "copy");
  }

  async function handleRelist(context: ActionContext): Promise<void> {
    await saveRelistPending(context, "relist");
  }

  async function handleSaveDraft(context: ActionContext): Promise<void> {
    // TODO: 下書き保存と正式な再出品で保存先や後続動作を分ける場合は、mode='draft' を起点に分岐する。
    await saveRelistPending(context, "draft");
  }

  async function handleAdjustPrice(amount: number, context: ActionContext): Promise<void> {
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

  async function saveRelistPending(context: ActionContext, mode: RelistMode): Promise<void> {
    const item = await collectRelistData(context, mode);
    await sendRelistPending(item);
  }

  async function collectRelistData(context: ActionContext, mode: RelistMode): Promise<RelistPendingItem> {
    const extractionRoot: ParentNode = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : context.root;
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

  function extractItemDataFromElement(source: ParentNode, fallbackUrl: string | null, mode: RelistMode): RelistPendingItem {
    const itemUrl = normalizeItemUrl(getItemLink(source)?.href ?? fallbackUrl ?? window.location.href);
    const itemId = extractMercariItemId(itemUrl);
    const detailSource: ParentNode = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : source;
    const imageSource = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : source;
    const jsonItem = itemId && detailSource instanceof Document ? findCurrentItemJsonObject(detailSource, itemId) : null;
    const title = extractTitle(source);
    const price = extractPrice(source);
    const imageUrls = extractImageUrls(imageSource, itemId);
    const thumbnailUrl = imageUrls[0] ?? extractThumbnail(source);
    const description = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? extractDescription(document) : null;
    const textCategoryPath = extractCategoryPath(detailSource);
    const categoryPath = textCategoryPath.length > 0 ? textCategoryPath : extractCategoryPathFromJson(jsonItem) ?? [];

    // TODO: メルカリ側のフォーム仕様が変わった場合は、カテゴリ・配送方法の取得候補をここで増やす。
    return {
      itemId,
      title,
      price,
      itemUrl,
      thumbnailUrl,
      imageUrls,
      description,
      categoryPath,
      condition: extractCondition(detailSource, jsonItem),
      brand: extractNamedJsonValue(jsonItem, ["brand"]) ?? extractInfoValue(detailSource, ["ブランド"]),
      size: extractNamedJsonValue(jsonItem, ["size"]) ?? extractInfoValue(detailSource, ["商品のサイズ", "サイズ"]),
      shippingPayer: extractNamedJsonValue(jsonItem, ["shippingPayer", "shipping_payer", "shippingFeePayer", "shipping_fee_payer"]) ?? extractInfoValue(detailSource, ["配送料の負担"]),
      shippingMethod: extractNamedJsonValue(jsonItem, ["shippingMethod", "shipping_method", "deliveryMethod", "delivery_method"]) ?? extractInfoValue(detailSource, ["配送の方法"]),
      shippingFrom: extractNamedJsonValue(jsonItem, ["shippingFrom", "shipping_from", "shippingFromArea", "shipping_from_area"]) ?? extractInfoValue(detailSource, ["発送元の地域", "発送元地域"]),
      shippingDays: extractNamedJsonValue(jsonItem, ["shippingDays", "shipping_days", "shippingDuration", "shipping_duration"]) ?? extractInfoValue(detailSource, ["発送までの日数"]),
      mode,
    };
  }

  async function fetchItemData(itemUrl: string, mode: RelistMode): Promise<RelistPendingItem> {
    try {
      const response = await fetch(itemUrl, {
        credentials: "include",
      });

      if (!response.ok) {
        return createEmptyRelistItem(mode, itemUrl);
      }

      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, "text/html");
      const itemId = extractMercariItemId(itemUrl);
      const jsonItem = itemId ? findCurrentItemJsonObject(parsedDocument, itemId) : null;
      const imageUrls = extractImageUrls(parsedDocument, itemId);
      const textCategoryPath = extractCategoryPath(parsedDocument);

      return {
        itemId,
        title: extractTitle(parsedDocument),
        price: extractPrice(parsedDocument),
        itemUrl,
        thumbnailUrl: imageUrls[0] ?? extractThumbnail(parsedDocument),
        imageUrls,
        description: extractDescription(parsedDocument),
        categoryPath: textCategoryPath.length > 0 ? textCategoryPath : extractCategoryPathFromJson(jsonItem) ?? [],
        condition: extractCondition(parsedDocument, jsonItem),
        brand: extractNamedJsonValue(jsonItem, ["brand"]) ?? extractInfoValue(parsedDocument, ["ブランド"]),
        size: extractNamedJsonValue(jsonItem, ["size"]) ?? extractInfoValue(parsedDocument, ["商品のサイズ", "サイズ"]),
        shippingPayer: extractNamedJsonValue(jsonItem, ["shippingPayer", "shipping_payer", "shippingFeePayer", "shipping_fee_payer"]) ?? extractInfoValue(parsedDocument, ["配送料の負担"]),
        shippingMethod: extractNamedJsonValue(jsonItem, ["shippingMethod", "shipping_method", "deliveryMethod", "delivery_method"]) ?? extractInfoValue(parsedDocument, ["配送の方法"]),
        shippingFrom: extractNamedJsonValue(jsonItem, ["shippingFrom", "shipping_from", "shippingFromArea", "shipping_from_area"]) ?? extractInfoValue(parsedDocument, ["発送元の地域", "発送元地域"]),
        shippingDays: extractNamedJsonValue(jsonItem, ["shippingDays", "shipping_days", "shippingDuration", "shipping_duration"]) ?? extractInfoValue(parsedDocument, ["発送までの日数"]),
        mode,
      };
    } catch {
      return createEmptyRelistItem(mode, itemUrl);
    }
  }

  function compactItem(item: RelistPendingItem): Partial<RelistPendingItem> {
    return Object.fromEntries(
      Object.entries(item).filter(([, value]) => value !== null && value !== undefined && value !== "")
    ) as Partial<RelistPendingItem>;
  }

  function createEmptyRelistItem(mode: RelistMode, itemUrl: string | null = null): RelistPendingItem {
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

  function sendRelistPending(item: RelistPendingItem): Promise<void> {
    return new Promise((resolve) => {
      if (!chromeApi?.runtime?.sendMessage) {
        showToast("拡張機能の保存処理を呼び出せませんでした");
        resolve();
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: "SET_RELIST_PENDING",
          payload: item,
        },
        (response) => {
          if (chromeApi.runtime?.lastError) {
            showToast("出品データの保存に失敗しました");
            resolve();
            return;
          }

          if (response?.success) {
            showToast("新規出品ページを開きます");
          } else {
            showToast(response?.message ?? "出品データの保存に失敗しました");
          }

          resolve();
        }
      );
    });
  }

  async function handleStopListing(context: ActionContext): Promise<void> {
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

  async function handleDeleteListing(context: ActionContext): Promise<void> {
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

  function detectRelistButtonCandidate(expectedItemId: string | null) {
    const currentItemId = extractMercariItemId(window.location.href);
    const itemIdMatch = !expectedItemId || !currentItemId || expectedItemId === currentItemId;
    if (expectedItemId && currentItemId && expectedItemId !== currentItemId) {
      console.log("[furimanager-extension] relist detection", {
        item_id_match: false,
        relist_button_candidate_count: 0,
        candidate_text: [],
        candidate_selector_hint: [],
        detected: false,
        reason: "item_id_mismatch",
        expectedItemId,
        currentItemId,
      });
      return {
        detected: false,
        reason: "item_id_mismatch",
        itemIdMatch,
        expectedItemId,
        currentItemId,
        pageUrl: window.location.href,
        candidates: [],
      };
    }
    const selectors = [
      "button",
      "a",
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      "[aria-label]",
      "[data-testid]",
    ];
    const candidates = safeQuerySelectorAll(document, selectors.join(","))
      .filter((element) => {
        if (element.closest(`[${TOOLBAR_ATTRIBUTE}="true"]`) || !isVisible(element)) {
          return false;
        }
        const text = getRelistDetectionText(element);
        return RELIST_DETECTION_TEXT_MARKERS.some((marker) => text.includes(marker));
      })
      .slice(0, 5)
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        text: getRelistDetectionText(element).slice(0, 120),
        selectorHint: getSelectorHint(element),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        ariaLabel: element.getAttribute("aria-label"),
        testId: element.getAttribute("data-testid"),
      }));
    const detected = candidates.length === 1;
    console.log("[furimanager-extension] relist detection", {
      item_id_match: itemIdMatch,
      relist_button_candidate_count: candidates.length,
      candidate_text: candidates.map((candidate) => candidate.text),
      candidate_selector_hint: candidates.map((candidate) => candidate.selectorHint),
      detected,
    });
    return {
      detected,
      reason: candidates.length === 1 ? "candidate_found" : candidates.length > 1 ? "multiple_candidates_found" : "candidate_not_found",
      itemIdMatch,
      expectedItemId,
      currentItemId,
      pageUrl: window.location.href,
      candidates,
    };
  }

  function clickFurimaneCopyListingButton(expectedItemId: string | null) {
    const detection = detectFurimaneCopyListingButton(expectedItemId);

    if (!detection.detected || !detection.button) {
      return {
        clicked: false,
        detected: false,
        reason: detection.reason,
        itemIdMatch: detection.itemIdMatch,
        expectedItemId: detection.expectedItemId,
        currentItemId: detection.currentItemId,
        pageUrl: detection.pageUrl,
      };
    }

    detection.button.click();
    console.log("[furimanager-extension] copy listing button clicked", {
      expectedItemId: detection.expectedItemId,
      currentItemId: detection.currentItemId,
      pageUrl: detection.pageUrl,
    });

    return {
      clicked: true,
      detected: true,
      reason: "copy_listing_button_clicked",
      itemIdMatch: detection.itemIdMatch,
      expectedItemId: detection.expectedItemId,
      currentItemId: detection.currentItemId,
      pageUrl: detection.pageUrl,
    };
  }

  function detectFurimaneCopyListingButton(expectedItemId: string | null) {
    const currentItemId = extractMercariItemId(window.location.href);
    const itemIdMatch = !expectedItemId || !currentItemId || expectedItemId === currentItemId;

    if (expectedItemId && currentItemId && expectedItemId !== currentItemId) {
      return {
        detected: false,
        reason: "item_id_mismatch",
        itemIdMatch,
        expectedItemId,
        currentItemId,
        pageUrl: window.location.href,
        button: null,
      };
    }

    const button = safeQuerySelectorAll(document, '[data-furimanager-action="copy-listing"]')
      .find((element) => element instanceof HTMLButtonElement && isVisible(element)) ?? null;

    return {
      detected: Boolean(button),
      reason: button ? "copy_listing_button_found" : "copy_listing_button_not_found",
      itemIdMatch,
      expectedItemId,
      currentItemId,
      pageUrl: window.location.href,
      button,
    };
  }

  function getSelectorHint(element: HTMLElement): string {
    const parts = [element.tagName.toLowerCase()];
    const testId = element.getAttribute("data-testid");
    const ariaLabel = element.getAttribute("aria-label");

    if (element.id) {
      parts.push(`#${element.id}`);
    }
    if (testId) {
      parts.push(`[data-testid="${testId}"]`);
    }
    if (ariaLabel) {
      parts.push(`[aria-label="${ariaLabel.slice(0, 40)}"]`);
    }

    return parts.join("");
  }

  function getRelistDetectionText(element: HTMLElement) {
    const value = element instanceof HTMLInputElement ? element.value : "";
    return normalizeText([
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      value,
    ].filter(Boolean).join(" "));
  }

  async function findActionElement(source: HTMLElement, labels: string[], includeDocumentFallback: boolean): Promise<HTMLElement | null> {
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

  function findVisibleActionElement(source: HTMLElement, labels: string[], includeDocumentFallback: boolean): HTMLElement | null {
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

  function findMenuButton(source: HTMLElement): HTMLElement | null {
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

  function isFinalDeleteElement(element: HTMLElement): boolean {
    const text = `${normalizeText(element.textContent)} ${element.getAttribute("aria-label") ?? ""}`;
    return text.includes("削除する") || text.includes("完全に削除") || text.includes("取り消せません");
  }

  function isInsideDialog(element: HTMLElement): boolean {
    return Boolean(element.closest('[role="dialog"], [aria-modal="true"]'));
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function buildActionContext(
    pageKind: MercariPageKind,
    root: HTMLElement,
    source: HTMLElement,
    placement: ActionContext["placement"] = "append"
  ): ActionContext {
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

  function getItemLink(source: ParentNode): HTMLAnchorElement | null {
    if (source instanceof HTMLAnchorElement && source.href.includes("/item/")) {
      return source;
    }

    return source.querySelector('a[href*="/item/"]');
  }

  function extractMercariItemId(url: string | null): string | null {
    if (!url) {
      return null;
    }

    const matched = url.match(/\/item\/([^/?#]+)/);
    return matched?.[1] ?? null;
  }

  function normalizeItemUrl(url: string | null): string | null {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return url;
    }
  }

  function extractTitle(source: ParentNode): string | null {
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

  function sanitizeTitle(value: string): string | null {
    const text = normalizeText(value)
      .replace(/-?\s*メルカリ.*$/, "")
      .replace(/\s*\|\s*.*$/, "")
      .trim();

    return text || null;
  }

  function extractPrice(source: ParentNode): number | null {
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

  function parsePrice(value: string): number | null {
    const matched = value.match(/(?:¥|￥)\s*([0-9０-９,，]+)/);
    const raw = matched?.[1] ?? null;

    if (!raw) {
      return null;
    }

    const normalized = raw.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, "");
    const price = Number.parseInt(normalized, 10);
    return Number.isFinite(price) ? price : null;
  }

  function extractThumbnail(source: ParentNode): string | null {
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

  function extractImageUrls(source: ParentNode, itemId: string | null = null): string[] {
    const urls = new Set<string>();
    const seenImageKeys = new Set<string>();
    const addUrl = (url: string | null | undefined): void => {
      const normalizedUrl = normalizeImageUrl(url);

      if (!normalizedUrl || urls.size >= 10 || !isLikelyProductImageUrl(normalizedUrl)) {
        return;
      }

      const imageKey = getImageDedupeKey(normalizedUrl);

      if (seenImageKeys.has(imageKey)) {
        return;
      }

      seenImageKeys.add(imageKey);
      urls.add(normalizedUrl);
    };

    if (source instanceof Document) {
      collectImageUrlsFromMercariThumbnails(source, addUrl);

      if (urls.size === 0) {
        const productMedia = source === document ? findProductImageGalleryScope() : findStaticProductImageContainer(source);

        if (productMedia) {
          collectImageUrlsFromDom(productMedia, addUrl, true);
        }
      }

      if (urls.size === 0 && itemId) {
        collectImageUrlsFromCurrentItemJson(source, itemId, addUrl);
      }

      if (urls.size === 0) {
        const metaImage = source.querySelector('meta[property="og:image"]');

        if (metaImage instanceof HTMLMetaElement && metaImage.content) {
          addUrl(metaImage.content);
        }
      }

      return Array.from(urls).slice(0, 10);
    }

    collectImageUrlsFromDom(source, addUrl, false);
    return Array.from(urls).slice(0, 10);
  }

  function collectImageUrlsFromMercariThumbnails(source: ParentNode, addUrl: (url: string | null | undefined) => void): void {
    const roots = safeQuerySelectorAll(source, `
      .sticky-inner-wrapper,
      [data-testid="vertical-thumbnail-scroll"] .slick-track,
      [data-testid="carousel"] .slick-track
    `);
    const imageSelector = `
      mer-item-thumbnail [class*="imageContainer"] img,
      .merItemThumbnail [class*="imageContainer"] img,
      [data-index] mer-item-thumbnail [class*="imageContainer"] img,
      [data-index] .merItemThumbnail [class*="imageContainer"] img
    `;

    roots.forEach((root) => {
      safeQuerySelectorAll(root, imageSelector).forEach((image) => {
        if (image instanceof HTMLImageElement) {
          addUrl(image.getAttribute("src") || image.getAttribute("data-src") || image.currentSrc || image.src);
        }
      });
    });
  }

  function findProductImageGalleryScope(): HTMLElement | null {
    const imageContainer = findProductImageContainer();

    if (!imageContainer) {
      return null;
    }

    return findProductImageToolbarMount(imageContainer);
  }

  function collectImageUrlsFromDom(source: ParentNode, addUrl: (url: string | null | undefined) => void, allowUnknownImageSize: boolean): void {
    safeQuerySelectorAll(source, 'picture source[srcset], source[srcset], img[src], img[data-src], img[data-lazy-src], img[srcset]').forEach((element) => {
      if (element instanceof HTMLSourceElement) {
        collectSrcSetUrls(element.srcset, addUrl);
        return;
      }

      if (!(element instanceof HTMLImageElement)) {
        return;
      }

      if (!allowUnknownImageSize && !isUsableImageElement(element)) {
        return;
      }

      [
        element.currentSrc,
        element.src,
        element.getAttribute("data-src"),
        element.getAttribute("data-lazy-src"),
        element.getAttribute("data-original"),
      ].forEach(addUrl);
      collectSrcSetUrls(element.srcset, addUrl);
    });
  }

  function findStaticProductImageContainer(source: ParentNode): HTMLElement | null {
    return safeQuerySelectorAll(source, `
      main [data-testid*="carousel"],
      main [class*="swiper"],
      main [class*="carousel"],
      main [class*="slick"],
      #item-photo,
      #item-photo-container
    `)[0] ?? null;
  }

  function collectSrcSetUrls(srcset: string | null | undefined, addUrl: (url: string | null | undefined) => void): void {
    if (!srcset) {
      return;
    }

    srcset.split(",").forEach((entry) => {
      const url = entry.trim().split(/\s+/)[0];
      addUrl(url);
    });
  }

  function isUsableImageElement(image: HTMLImageElement): boolean {
    const rect = image.getBoundingClientRect();
    const width = Math.max(image.width, image.naturalWidth, rect.width);
    const height = Math.max(image.height, image.naturalHeight, rect.height);
    return width >= 48 && height >= 48;
  }

  function normalizeImageUrl(url: string | null | undefined): string | null {
    const trimmedUrl = normalizeText(url);

    if (!trimmedUrl || trimmedUrl.startsWith("data:")) {
      return null;
    }

    try {
      return new URL(trimmedUrl, window.location.href).href;
    } catch {
      return null;
    }
  }

  function getImageDedupeKey(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const photoMatch = parsedUrl.pathname.match(/\/photos\/([^/?#]+)/i);

      if (photoMatch?.[1]) {
        return `photo:${photoMatch[1].replace(/\.(?:jpe?g|png|webp)$/i, "")}`;
      }

      return `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      return url;
    }
  }

  function collectImageUrlsFromCurrentItemJson(source: Document, itemId: string, addUrl: (url: string | null | undefined) => void): void {
    safeQuerySelectorAll(source, 'script[type="application/json"], script:not([src])').forEach((script) => {
      const text = script.textContent?.trim();

      if (!text || (!text.startsWith("{") && !text.startsWith("["))) {
        return;
      }

      try {
        collectImageUrlsFromCurrentItemJsonValue(JSON.parse(text), itemId, addUrl);
      } catch {
        // JSON以外のscriptは無視する。
      }
    });
  }

  function findCurrentItemJsonObject(source: Document, itemId: string): Record<string, unknown> | null {
    for (const script of safeQuerySelectorAll(source, 'script[type="application/json"], script:not([src])')) {
      const text = script.textContent?.trim();

      if (!text || (!text.startsWith("{") && !text.startsWith("["))) {
        continue;
      }

      try {
        const item = findCurrentItemJsonValue(JSON.parse(text), itemId);

        if (item) {
          return item;
        }
      } catch {
        // JSON以外のscriptは無視する。
      }
    }

    return null;
  }

  function findCurrentItemJsonValue(value: unknown, itemId: string, depth = 0): Record<string, unknown> | null {
    if (depth > 10 || value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = findCurrentItemJsonValue(item, itemId, depth + 1);

        if (matched) {
          return matched;
        }
      }

      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    const objectValue = value as Record<string, unknown>;

    if (hasDirectItemId(objectValue, itemId)) {
      return objectValue;
    }

    for (const childValue of Object.values(objectValue)) {
      const matched = findCurrentItemJsonValue(childValue, itemId, depth + 1);

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  function extractNamedJsonValue(source: Record<string, unknown> | null, keys: string[]): string | null {
    if (!source) {
      return null;
    }

    for (const key of keys) {
      const value = findJsonValueByKey(source, key);
      const name = getJsonDisplayName(value);

      if (name) {
        return name;
      }
    }

    return null;
  }

  function findJsonValueByKey(source: unknown, key: string, depth = 0): unknown {
    if (depth > 5 || source === null || source === undefined || typeof source !== "object") {
      return null;
    }

    if (!Array.isArray(source)) {
      const objectValue = source as Record<string, unknown>;

      if (Object.prototype.hasOwnProperty.call(objectValue, key)) {
        return objectValue[key];
      }
    }

    const children = Array.isArray(source) ? source : Object.values(source as Record<string, unknown>);

    for (const child of children) {
      const matched = findJsonValueByKey(child, key, depth + 1);

      if (matched !== null && matched !== undefined) {
        return matched;
      }
    }

    return null;
  }

  function getJsonDisplayName(value: unknown): string | null {
    if (typeof value === "string") {
      return normalizeText(value) || null;
    }

    if (value === null || value === undefined || typeof value !== "object") {
      return null;
    }

    const objectValue = value as Record<string, unknown>;

    for (const key of ["name", "label", "displayName", "display_name", "text"]) {
      if (typeof objectValue[key] === "string") {
        return normalizeText(objectValue[key] as string) || null;
      }
    }

    return null;
  }

  function extractCategoryPathFromJson(source: Record<string, unknown> | null): string[] | null {
    if (!source) {
      return null;
    }

    for (const key of ["categoryPath", "category_path", "categories", "category", "itemCategory", "item_category"]) {
      const path = getCategoryPathFromJsonValue(findJsonValueByKey(source, key));

      if (path.length > 0) {
        return path;
      }
    }

    return null;
  }

  function getCategoryPathFromJsonValue(value: unknown): string[] {
    if (typeof value === "string") {
      return [normalizeText(value)].filter(Boolean);
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => getCategoryPathFromJsonValue(item)).filter((item, index, items) => item && items.indexOf(item) === index);
    }

    if (value === null || value === undefined || typeof value !== "object") {
      return [];
    }

    const objectValue = value as Record<string, unknown>;

    for (const key of ["path", "breadcrumbs", "parents", "parentCategories", "parent_categories"]) {
      const path = getCategoryPathFromJsonValue(objectValue[key]);

      if (path.length > 0) {
        const ownName = getJsonDisplayName(objectValue);
        return ownName && !path.includes(ownName) ? [...path, ownName] : path;
      }
    }

    const parent = objectValue.parentCategory ?? objectValue.parent_category ?? objectValue.parent;
    const parentPath = getCategoryPathFromJsonValue(parent);
    const ownName = getJsonDisplayName(objectValue);

    return ownName ? [...parentPath, ownName].filter((item, index, items) => items.indexOf(item) === index) : parentPath;
  }

  function collectImageUrlsFromCurrentItemJsonValue(value: unknown, itemId: string, addUrl: (url: string | null | undefined) => void, depth = 0): void {
    if (depth > 10 || value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectImageUrlsFromCurrentItemJsonValue(item, itemId, addUrl, depth + 1));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const objectValue = value as Record<string, unknown>;

    if (hasDirectItemId(objectValue, itemId)) {
      collectImageUrlsFromCurrentItemObject(objectValue, addUrl);
      return;
    }

    Object.values(objectValue).forEach((childValue) => {
      collectImageUrlsFromCurrentItemJsonValue(childValue, itemId, addUrl, depth + 1);
    });
  }

  function hasDirectItemId(value: Record<string, unknown>, itemId: string): boolean {
    return ["id", "itemId", "item_id", "productId", "product_id"].some((key) => value[key] === itemId);
  }

  function collectImageUrlsFromCurrentItemObject(value: Record<string, unknown>, addUrl: (url: string | null | undefined) => void): void {
    Object.entries(value).forEach(([key, childValue]) => {
      if (isCurrentItemImageKey(key)) {
        collectImageUrlsFromJsonValue(childValue, addUrl, key);
      }
    });

    ["item", "product", "itemData", "itemInfo", "itemDetail", "itemDetails", "productInfo"].forEach((key) => {
      const childValue = value[key];

      if (childValue && typeof childValue === "object" && !Array.isArray(childValue)) {
        collectImageUrlsFromCurrentItemObject(childValue as Record<string, unknown>, addUrl);
      }
    });
  }

  function collectImageUrlsFromJsonValue(value: unknown, addUrl: (url: string | null | undefined) => void, key = "", depth = 0): void {
    if (depth > 10 || value === null || value === undefined) {
      return;
    }

    if (typeof value === "string") {
      if (isLikelyImageUrl(value) && (isImageKey(key) || value.includes("mercdn"))) {
        addUrl(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectImageUrlsFromJsonValue(item, addUrl, key, depth + 1));
      return;
    }

    if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
        collectImageUrlsFromJsonValue(childValue, addUrl, key ? `${key}.${childKey}` : childKey, depth + 1);
      });
    }
  }

  function isImageKey(key: string): boolean {
    return /image|photo|thumbnail|picture/i.test(key);
  }

  function isCurrentItemImageKey(key: string): boolean {
    return isImageKey(key) && !/related|recommend|seller|similar|avatar|profile|icon|logo/i.test(key);
  }

  function isLikelyImageUrl(value: string): boolean {
    return isLikelyProductImageUrl(value);
  }

  function isLikelyProductImageUrl(value: string): boolean {
    return /^https?:\/\//.test(value) && /mercdn|mercari|\.(?:jpe?g|png|webp)(?:\?|$)/i.test(value) && !/logo|icon|avatar|profile|badge|app-store|google-play/i.test(value);
  }

  function extractDescription(source: ParentNode): string | null {
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

  function extractCategoryPath(source: ParentNode): string[] {
    const body = findMercariDetailBody(source, "カテゴリー");

    if (body) {
      const breadcrumbItems = safeQuerySelectorAll(body, "mer-breadcrumb-item a, .merBreadcrumbItem a")
        .map((item) => normalizeText(item.textContent))
        .filter(Boolean);

      if (breadcrumbItems.length > 0) {
        return breadcrumbItems.slice(0, 6);
      }
    }

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
    const categoryLines: string[] = [];

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

  function extractInfoValue(source: ParentNode, labels: string[]): string | null {
    const displayRowValue = extractMercariDetailBodyText(source, labels);

    if (displayRowValue) {
      return displayRowValue;
    }

    const labeledValue = extractLabeledInfoValue(source, labels);

    if (labeledValue) {
      return labeledValue;
    }

    const nearbyValue = extractNearbyInfoValue(source, labels);

    if (nearbyValue) {
      return nearbyValue;
    }

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

  function extractCondition(source: ParentNode, jsonItem: Record<string, unknown> | null): string | null {
    const values = [
      extractInfoValue(source, ["商品の状態"]),
      extractInfoValue(source, ["状態"]),
      extractTextNearLabel(source, "商品の状態"),
      extractNamedJsonValue(jsonItem, ["condition", "itemCondition", "item_condition", "itemStatus", "item_status"]),
    ];

    for (const value of values) {
      const condition = normalizeMercariCondition(value);

      if (condition) {
        return condition;
      }
    }

    return null;
  }

  function extractTextNearLabel(source: ParentNode, label: string): string | null {
    const text = normalizeText(source instanceof Document ? source.body?.innerText || source.body?.textContent || "" : source.textContent ?? "");
    const index = text.indexOf(label);
    return index === -1 ? null : text.slice(index, index + 160);
  }

  function extractMercariDetailBodyText(source: ParentNode, labels: string[]): string | null {
    for (const label of labels) {
      const body = findMercariDetailBody(source, label);
      const text = normalizeText(body?.textContent ?? "");

      if (text) {
        return text;
      }
    }

    return null;
  }

  function extractLabeledInfoValue(source: ParentNode, labels: string[]): string | null {
    const labelElements = safeQuerySelectorAll(source, "mer-text, .merText, dt, th, span, p, div")
      .filter((element) => labels.includes(normalizeText(element.textContent)));

    for (const element of labelElements) {
      const siblingValue = getNextSiblingTextValue(element, labels);

      if (siblingValue) {
        return siblingValue;
      }

      let current: HTMLElement | null = element.parentElement;

      for (let depth = 0; current && depth < 3; depth += 1) {
        const lines = getTextLines(current);
        const labelIndex = lines.findIndex((line) => labels.includes(line));

        if (labelIndex !== -1 && lines.length <= 6) {
          const value = lines.slice(labelIndex + 1).find((line) => line && !labels.includes(line));

          if (value) {
            return value;
          }
        }

        current = current.parentElement;
      }
    }

    return null;
  }

  function getNextSiblingTextValue(element: HTMLElement, labels: string[]): string | null {
    let sibling = element.nextElementSibling;
    let checkedCount = 0;

    while (sibling && checkedCount < 4) {
      const text = normalizeText(sibling.textContent);

      if (text && !labels.includes(text) && text.length <= 120) {
        return text;
      }

      sibling = sibling.nextElementSibling;
      checkedCount += 1;
    }

    return null;
  }

  function findMercariDetailBody(source: ParentNode, label: string): HTMLElement | null {
    const rows = safeQuerySelectorAll(source, `
      #item-info mer-display-row,
      #item-info .merDisplayRow,
      #product-info mer-display-row,
      #product-info .merDisplayRow,
      main mer-display-row,
      main .merDisplayRow,
      mer-display-row,
      .merDisplayRow,
      dl,
      tr
    `);

    const row = rows.find((candidate) => {
      const title = candidate.querySelector('span[slot="title"], [slot="title"], [class*="title__"], dt, th');
      const titleText = normalizeText(title?.textContent ?? "");
      return titleText === label || new RegExp(label).test(titleText);
    });

    const body = row?.querySelector('[slot="body"], [class*="body__"], dd, td');
    return body instanceof HTMLElement ? body : null;
  }

  function extractNearbyInfoValue(source: ParentNode, labels: string[]): string | null {
    const candidates = safeQuerySelectorAll(source, "div, li, dl, tr, section").flatMap((element) => {
      if (!isVisible(element)) {
        return [];
      }

      const lines = getTextLines(element);
      const labelIndex = lines.findIndex((line) => labels.includes(line));

      if (labelIndex === -1 || lines.length > 8) {
        return [];
      }

      const value = lines.slice(labelIndex + 1).find((line) => line && !labels.includes(line));

      if (!value) {
        return [];
      }

      return [{ value, score: lines.length * 100 + normalizeText(element.textContent).length }];
    });

    return candidates.sort((a, b) => a.score - b.score)[0]?.value ?? null;
  }

  function getTextLines(source: ParentNode): string[] {
    const text = source instanceof Document ? source.body?.innerText || source.body?.textContent || "" : source.textContent ?? "";
    return text
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean);
  }

  function sanitizeDescription(value: string): string | null {
    const text = value.replace(/\r\n/g, "\n").trim();
    return text || null;
  }

  function safeQuerySelectorAll(root: ParentNode, selector: string): HTMLElement[] {
    try {
      return Array.from(root.querySelectorAll(selector)).flatMap((element) => {
        const htmlElement = toHTMLElement(element);
        return htmlElement ? [htmlElement] : [];
      });
    } catch {
      return [];
    }
  }

  function dedupeElements(elements: HTMLElement[]): HTMLElement[] {
    return Array.from(new Set(elements));
  }

  function toHTMLElement(element: Element | null | undefined): HTMLElement | null {
    return element instanceof HTMLElement ? element : null;
  }

  function normalizeText(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeMercariCondition(value: string | null): string | null {
    const compactValue = normalizeText(value).replace(/[\s、，,・/／()（）\[\]【】]/g, "");

    if (!compactValue) {
      return null;
    }

    const conditions = [
      "新品、未使用",
      "未使用に近い",
      "目立った傷や汚れなし",
      "やや傷や汚れあり",
      "傷や汚れあり",
      "全体的に状態が悪い",
    ];

    return conditions.find((condition) => {
      const compactCondition = normalizeText(condition).replace(/[\s、，,・/／()（）\[\]【】]/g, "");
      return compactCondition === compactValue || compactValue.includes(compactCondition);
    }) ?? null;
  }

  function isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function showToast(message: string): void {
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

  function scheduleInjection(): void {
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

  function scheduleRetryInjection(): void {
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

  function clearScheduledInjections(): void {
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

  function patchHistoryEvents(): void {
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
