(() => {
  type MercariPageKind = "otherProduct" | "ownProduct" | "history" | "activeListings" | "browsingHistory" | "unknown";
  type RelistMode = "relist" | "draft" | "copy";
  type ActionName = "copyListing" | "stopListing" | "deleteListing" | "relist" | "saveDraft" | "adjustPrice" | "linkInventory";

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
    transactionUrl?: string | null;
    sourcePath: string;
    root: HTMLElement;
    mount: HTMLElement;
    placement?: ToolbarPlacement;
  };

  type PriceAdjustPendingItem = {
    itemId: string;
    delta: number;
    savedAt: number;
    stage: "openItem" | "openEdit";
  };

  type ListingManagementPendingItem = {
    itemId: string;
    action: "stop" | "delete";
    savedAt: number;
  };

  type ProductPageRelistPendingItem = {
    itemId: string;
    mode: "relist" | "draft";
    savedAt: number;
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

  type ListingDateInfo = {
    listedAt: Date | null;
    updatedAt: Date | null;
  };

  type ListingDateCacheEntry = {
    savedAt: number;
    data: ListingDateInfo;
  };

  type SellerInfo = {
    itemId: string;
    sellerId: string | null;
    name: string | null;
    avatarUrl: string | null;
    profileUrl: string | null;
    ratingScore: number | null;
    reviewCount: number | null;
    goodCount: number | null;
    normalCount: number | null;
    badCount: number | null;
    verified: boolean | null;
    levelText: string | null;
  };

  type SellerRatingCounts = {
    good: number | null;
    normal: number | null;
    bad: number | null;
  };

  type SellerIdentityBadgeInfo = {
    hasBadge: boolean | null;
    isBadgeHidden: boolean | null;
  };

  type SellerInfoCacheEntry = {
    savedAt: number;
    data: SellerInfo | null;
  };

  type ListingSellerTarget = {
    itemId: string;
    itemUrl: string;
    card: HTMLElement;
    compact: boolean;
    isShop: boolean;
  };

  type RuntimeResponse = {
    success?: boolean;
    message?: string;
    data?: unknown;
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
  const LISTING_DATE_PANEL_ATTRIBUTE = "data-furimanager-listing-date-panel";
  const LISTING_SELLER_PANEL_ATTRIBUTE = "data-furimanager-listing-seller-panel";
  const LISTING_SELLER_PANEL_VERSION_ATTRIBUTE = "data-furimanager-listing-seller-version";
  const LISTING_SELLER_PENDING_ATTRIBUTE = "data-furimanager-listing-seller-pending";
  const LISTING_SELLER_PANEL_VERSION = "compact-overlay-v17";
  const PRICE_ADJUST_PENDING_KEY = "furimanager_price_adjust_pending";
  const LISTING_MANAGEMENT_PENDING_KEY = "furimanager_listing_management_pending";
  const PRODUCT_PAGE_RELIST_PENDING_KEY = "furimanager_product_page_relist_pending";
  const MERCARI_ITEM_DETAIL_MESSAGE_TYPE = "FETCH_MERCARI_ITEM_DETAIL";
  const MERCARI_USER_PROFILE_MESSAGE_TYPE = "FETCH_MERCARI_USER_PROFILE";
  const MERCARI_USER_IDENTITY_BADGE_MESSAGE_TYPE = "FETCH_MERCARI_USER_IDENTITY_BADGE";
  const LISTING_DATE_API_CACHE_MS = 5 * 60 * 1000;
  const LISTING_DATE_API_EMPTY_CACHE_MS = 10 * 1000;
  const LISTING_SELLER_API_CACHE_MS = 10 * 60 * 1000;
  const LISTING_SELLER_API_EMPTY_CACHE_MS = 30 * 1000;
  const SELLER_IDENTITY_BADGE_API_CACHE_MS = 10 * 60 * 1000;
  const SELLER_IDENTITY_BADGE_API_EMPTY_CACHE_MS = 30 * 1000;
  const LISTING_SELLER_MAX_ITEMS_PER_PASS = 24;
  const COPY_LISTING_BUTTON_WAIT_TIMEOUT_MS = 10000;
  const COPY_LISTING_BUTTON_WAIT_INTERVAL_MS = 300;
  const OBSERVER_DEBOUNCE_MS = 250;
  const listingDateApiCache = new Map<string, ListingDateCacheEntry>();
  const listingDateApiRequests = new Map<string, Promise<ListingDateInfo>>();
  const listingSellerApiCache = new Map<string, SellerInfoCacheEntry>();
  const listingSellerApiRequests = new Map<string, Promise<SellerInfo | null>>();
  const sellerIdentityBadgeApiCache = new Map<string, { savedAt: number; data: SellerIdentityBadgeInfo | null }>();
  const sellerIdentityBadgeApiRequests = new Map<string, Promise<SellerIdentityBadgeInfo | null>>();

  const PRODUCT_PATH_PATTERN = /^\/item\//;
  const TRANSACTION_PATH_PATTERN = /^\/transaction\//;
  const HISTORY_PATH_MARKERS = [
    "/mypage/listings/sold",
    "/mypage/listings/completed",
    "/mypage/listings/trading",
    "/mypage/listings/history",
  ];
  const BROWSING_HISTORY_PATH_MARKERS = [
    "/mypage/browsing_history",
  ];
  const PURCHASE_PATH_MARKERS = [
    "/mypage/purchase",
    "/mypage/purchases",
    "/mypage/purchased",
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
  const INVENTORY_LINK_BUTTON: ActionButtonDefinition = { id: "link-inventory", label: "在庫連携", action: "linkInventory" };
  const RELIST_ONLY_BUTTONS: ActionButtonDefinition[] = [
    { id: "relist", label: "再出品", action: "relist" },
    INVENTORY_LINK_BUTTON,
  ];

  const BUTTONS_BY_KIND: Record<Exclude<MercariPageKind, "unknown" | "browsingHistory">, ActionButtonDefinition[]> = {
    otherProduct: [
      { id: "copy-listing", label: "コピー出品", action: "copyListing" },
      { id: "copy-draft", label: "下書き", action: "saveDraft" },
    ],
    ownProduct: [
      { id: "relist", label: "再出品", action: "relist" },
      { id: "decrease-price", label: "-100", action: "adjustPrice", amount: -100 },
      { id: "increase-price", label: "+100", action: "adjustPrice", amount: 100 },
      { id: "save-draft", label: "下書き", action: "saveDraft" },
      { id: "stop-listing", label: "停止", action: "stopListing" },
      { id: "delete-listing", label: "削除", action: "deleteListing" },
      INVENTORY_LINK_BUTTON,
    ],
    history: [
      { id: "relist", label: "再出品", action: "relist" },
    ],
    activeListings: [
      { id: "decrease-price", label: "-100", action: "adjustPrice", amount: -100 },
      { id: "increase-price", label: "+100", action: "adjustPrice", amount: 100 },
      { id: "relist", label: "再出品", action: "relist" },
      INVENTORY_LINK_BUTTON,
      { id: "save-draft", label: "下書き", action: "saveDraft" },
      { id: "stop-listing", label: "停止", action: "stopListing" },
      { id: "delete-listing", label: "削除", action: "deleteListing" },
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
        void clickFurimaneCopyListingButton(message.mercariItemId ?? null)
          .then((result) => {
            sendResponse({
              success: true,
              ...result,
            });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              message: error instanceof Error ? error.message : "copy listing action failed",
            });
          });
        return true;
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
    if (isBrowsingHistoryPage(path) || isHistoryPage(path) || isPurchasePage(path)) {
      return false;
    }

    if (ACTIVE_LISTING_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker))) {
      const selectedTab = getSelectedListingsTabText();
      return selectedTab ? ["出品中", "取引中"].some((label) => selectedTab.includes(label)) : true;
    }

    if (!path.includes("/mypage")) {
      return false;
    }

    const bodyText = document.body?.innerText ?? "";
    return ACTIVE_LISTING_TEXT_MARKERS.some((marker) => bodyText.includes(marker));
  }

  function isPurchasePage(path: string): boolean {
    return PURCHASE_PATH_MARKERS.some((marker) => matchesPathMarker(path, marker));
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
        top: 46%;
        right: 52px;
        z-index: 10;
        display: grid;
        grid-template-columns: repeat(4, max-content);
        gap: 6px;
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

      .furimanager-listing-date-panel {
        margin-top: 14px;
        padding: 12px 14px;
        border: 1px solid rgba(236, 72, 153, 0.24);
        border-left: 4px solid #ec4899;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(236, 72, 153, 0.10), rgba(225, 29, 72, 0.06));
        color: #be123c;
        font-size: 13px;
        line-height: 1.45;
      }

      .furimanager-listing-date-panel__title {
        margin-bottom: 8px;
        color: #be123c;
        font-size: 12px;
        font-weight: 700;
      }

      .furimanager-listing-date-panel__row {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        padding: 4px 0;
      }

      .furimanager-listing-date-panel__label {
        color: #be123c;
        font-weight: 700;
      }

      .furimanager-listing-date-panel__value {
        min-width: 0;
      }

      .furimanager-listing-date-panel__absolute {
        display: block;
        color: #e11d48;
        font-weight: 600;
      }

      .furimanager-listing-date-panel__relative {
        display: block;
        margin-top: 2px;
        color: #ec4899;
        font-size: 12px;
        font-weight: 700;
      }

      .furimanager-listing-seller-panel {
        box-sizing: border-box;
        width: 100%;
        min-height: 51px;
        margin-top: 7px;
        padding: 0 2px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #222222;
        font-size: 12px;
        line-height: 1.2;
      }

      .furimanager-listing-seller-panel--loading,
      .furimanager-listing-seller-panel--empty {
        min-height: 51px;
        color: #6b7280;
        font-weight: 700;
      }

      .furimanager-listing-seller-panel__content {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        min-width: 0;
        min-height: 44px;
      }

      .furimanager-listing-seller-panel__avatar,
      .furimanager-listing-seller-panel__avatar-placeholder {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        border-radius: 999px;
        object-fit: cover;
        background: #e5e7eb;
      }

      .furimanager-listing-seller-panel__avatar-placeholder {
        display: flex;
        justify-content: center;
        color: #9ca3af;
        font-size: 17px;
        font-weight: 800;
        line-height: 38px;
      }

      .furimanager-listing-seller-panel__body {
        display: grid;
        gap: 1px;
        min-width: 0;
        flex: 1 1 auto;
        padding-top: 1px;
      }

      .furimanager-listing-seller-panel__placeholder-line {
        display: block;
        width: 88px;
        height: 10px;
        border-radius: 999px;
        background: #e5e7eb;
      }

      .furimanager-listing-seller-panel__placeholder-line--rating {
        width: 94px;
        margin-top: 2px;
      }

      .furimanager-listing-seller-panel__placeholder-line--breakdown {
        width: 58px;
        margin-top: 2px;
      }

      .furimanager-listing-seller-panel__name {
        position: relative;
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        color: #222222;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .furimanager-listing-seller-panel__name-text {
        min-width: 0;
        overflow: hidden;
        flex: 0 1 auto;
        text-overflow: ellipsis;
      }

      .furimanager-listing-seller-panel__rating {
        display: flex;
        align-items: center;
        gap: 3px;
        min-width: 0;
        white-space: nowrap;
      }

      .furimanager-listing-seller-panel__stars {
        display: inline-flex;
        align-items: center;
        gap: 0;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0;
        line-height: 1;
      }

      .furimanager-listing-seller-panel__star {
        color: #fbbf24;
      }

      .furimanager-listing-seller-panel__star--empty {
        color: #d1d5db;
      }

      .furimanager-listing-seller-panel__star--half {
        color: transparent;
        background: linear-gradient(90deg, #fbbf24 50%, #d1d5db 50%);
        -webkit-background-clip: text;
        background-clip: text;
      }

      .furimanager-listing-seller-panel__review-count {
        overflow: hidden;
        color: #1a73e8;
        font-size: 12px;
        font-weight: 700;
        text-overflow: ellipsis;
      }

      .furimanager-listing-seller-panel__breakdown {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }

      .furimanager-listing-seller-panel__breakdown-item,
      .furimanager-listing-seller-panel__verified {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        color: #333333;
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.15;
        white-space: nowrap;
      }

      .furimanager-listing-seller-panel__breakdown-icon {
        width: 13px;
        height: 13px;
        flex: 0 0 13px;
        color: currentColor;
      }

      .furimanager-listing-seller-panel__breakdown-icon--good {
        color: #ff4f91;
      }

      .furimanager-listing-seller-panel__breakdown-icon--bad {
        color: #60a5fa;
      }

      .furimanager-listing-seller-panel__verified {
        flex: 0 0 auto;
        gap: 0;
      }

      .furimanager-listing-seller-panel__verified--ok {
        color: #10b981;
      }

      .furimanager-listing-seller-panel__verified--before {
        color: #9ca3af;
      }

      .furimanager-listing-seller-panel__verified-icon {
        width: 12px;
        height: 12px;
        flex: 0 0 12px;
        border-radius: 3px 3px 5px 5px;
        background: #10b981;
        clip-path: polygon(50% 0, 94% 18%, 82% 82%, 50% 100%, 18% 82%, 6% 18%);
      }

      .furimanager-listing-seller-panel__verified--before .furimanager-listing-seller-panel__verified-icon {
        background: #c7c7c7;
      }

      .furimanager-listing-seller-panel--compact {
        position: absolute;
        top: 0;
        left: 4px;
        z-index: 4;
        width: auto;
        max-width: min(198px, calc(100% - 8px));
        min-height: 26px;
        margin-top: 0;
        padding: 2px 5px 3px 2px;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 3px 9px rgba(0, 0, 0, 0.16);
        pointer-events: auto;
      }

      .furimanager-listing-seller-panel--compact.furimanager-listing-seller-panel--loading,
      .furimanager-listing-seller-panel--compact.furimanager-listing-seller-panel--empty {
        min-height: 26px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__content {
        align-items: center;
        gap: 3px;
        min-height: 24px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__avatar,
      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__avatar-placeholder {
        width: 20px;
        height: 20px;
        flex-basis: 20px;
        font-size: 10px;
        line-height: 20px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__body {
        display: grid;
        grid-template-columns: max-content max-content;
        gap: 2px;
        align-items: start;
        overflow: visible;
        padding-top: 0;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__name {
        flex: 0 1 auto;
        grid-column: 1 / -1;
        width: auto;
        max-width: 146px;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.05;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__name-text {
        white-space: normal;
        word-break: break-word;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__stars {
        font-size: 11px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__review-count,
      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__breakdown-item,
      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__verified {
        font-size: 9.8px;
        font-weight: 600;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__rating,
      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__breakdown {
        flex: 0 0 auto;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__breakdown {
        flex-wrap: nowrap;
        gap: 2px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__breakdown-icon {
        width: 10px;
        height: 10px;
        flex-basis: 10px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__verified-icon {
        width: 10px;
        height: 10px;
        flex-basis: 10px;
      }

      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__placeholder-line--rating,
      .furimanager-listing-seller-panel--compact .furimanager-listing-seller-panel__placeholder-line--breakdown {
        height: 8px;
        margin-top: 1px;
      }

      @media (max-width: 900px) {
        .furimanager-action-toolbar--inline-end {
          position: static;
          transform: none;
          margin-top: 8px;
          grid-template-columns: repeat(3, max-content);
        }

        .furimanager-listing-date-panel__row {
          grid-template-columns: 76px minmax(0, 1fr);
        }

        .furimanager-listing-seller-panel {
          margin-top: 6px;
          padding: 0 1px;
          font-size: 11px;
        }

        .furimanager-listing-seller-panel__content {
          gap: 6px;
        }

        .furimanager-listing-seller-panel__avatar,
        .furimanager-listing-seller-panel__avatar-placeholder {
          width: 34px;
          height: 34px;
          flex-basis: 34px;
          line-height: 34px;
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
    if (continuePendingRelistFromProductPage()) {
      return;
    }

    if (continuePendingRelistFromTransactionPage()) {
      return;
    }

    if (continuePendingListingManagementFromProductPage()) {
      return;
    }

    if (continuePendingListingManagementFromTransactionPage()) {
      return;
    }

    if (continuePendingPriceAdjustFromProductPage()) {
      return;
    }

    if (continuePendingPriceAdjustFromTransactionPage()) {
      return;
    }

    const pageKind = detectPageKind();

    const handledListingSellers = ensureSellerPanelsForListingPage(pageKind);

    cleanupToolbarsForPageKind(pageKind, handledListingSellers);

    if (pageKind === "unknown" || pageKind === "browsingHistory") {
      if (!handledListingSellers) {
        clearScheduledInjections();
      }
      return;
    }

    if (pageKind === "ownProduct" || pageKind === "otherProduct") {
      injectStyles();
      void ensureListingDatePanel();
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

  function ensureSellerPanelsForListingPage(pageKind: MercariPageKind): boolean {
    if (!isMercariListingPage(pageKind)) {
      return false;
    }

    const targets = getListingSellerTargets();

    if (targets.length === 0) {
      cleanupStaleListingSellerPanels([]);
      return false;
    }

    injectStyles();
    cleanupStaleListingSellerPanels(targets);

    const pendingTargets = targets.filter((target) => {
      const existingPanel = target.card.querySelector(`[${LISTING_SELLER_PANEL_ATTRIBUTE}="true"]`);
      const existingItemId = existingPanel?.getAttribute("data-furimanager-item-id") ?? null;
      const existingVersion = existingPanel?.getAttribute(LISTING_SELLER_PANEL_VERSION_ATTRIBUTE) ?? null;
      const needsReposition = existingPanel instanceof HTMLElement && !isSellerPanelMountedInExpectedPlace(target, existingPanel);

      return (
        (!existingPanel || existingItemId !== target.itemId || existingVersion !== LISTING_SELLER_PANEL_VERSION || needsReposition)
        && target.card.getAttribute(LISTING_SELLER_PENDING_ATTRIBUTE) !== target.itemId
      );
    });

    // 一覧ページは件数が多いので、未処理カードだけを少しずつ取得する。
    pendingTargets.slice(0, LISTING_SELLER_MAX_ITEMS_PER_PASS).forEach((target) => {
      ensureSellerPanel(target);
    });

    return true;
  }

  function cleanupStaleListingSellerPanels(targets: ListingSellerTarget[]): void {
    const activeCards = new Set(targets.map((target) => target.card));

    safeQuerySelectorAll(document, '[data-testid="item-cell"]').forEach((element) => {
      if (!(element instanceof HTMLElement) || activeCards.has(element)) {
        return;
      }

      element.removeAttribute(LISTING_SELLER_PENDING_ATTRIBUTE);
      element.querySelectorAll(`[${LISTING_SELLER_PANEL_ATTRIBUTE}="true"]`).forEach((panel) => panel.remove());
      clearSellerPanelCardSizing(element);
    });
  }

  function isMercariListingPage(pageKind: MercariPageKind): boolean {
    const path = window.location.pathname;

    if (path.startsWith("/mypage") || path.startsWith("/sell") || path.startsWith("/user/profile")) {
      return false;
    }

    if (PRODUCT_PATH_PATTERN.test(path)) {
      return getListingCardCandidateCount() >= 3;
    }

    if (pageKind !== "unknown") {
      return false;
    }

    return getListingCardCandidateCount() >= 3;
  }

  function getListingCardCandidateCount(): number {
    const itemCells = document.querySelectorAll('[data-testid="item-cell"]').length;

    if (itemCells > 0) {
      return itemCells;
    }

    return document.querySelectorAll('a[href*="/item/m"]').length;
  }

  function getListingSellerTargets(): ListingSellerTarget[] {
    const seenCards = new Set<HTMLElement>();
    const targets: ListingSellerTarget[] = [];
    const compact = PRODUCT_PATH_PATTERN.test(window.location.pathname);

    safeQuerySelectorAll(document, '[data-testid="item-cell"]').forEach((element) => {
      if (!(element instanceof HTMLElement) || seenCards.has(element)) {
        return;
      }

      const link = element.querySelector('a[href*="/item/m"]');
      const itemUrl = link instanceof HTMLAnchorElement ? normalizeItemUrl(link.href) : null;
      const itemId = extractMercariItemId(itemUrl) ?? extractListingCardItemId(element);
      const isShop = isMercariShopListingCard(element, link instanceof HTMLAnchorElement ? link : null);
      const isPromoted = link instanceof HTMLAnchorElement && isPromotedListingLink(link);

      if (!itemId || (!itemUrl && !isShop)) {
        return;
      }

      seenCards.add(element);
      targets.push({ itemId, itemUrl: itemUrl ?? "", card: element, compact: compact || isPromoted, isShop });
    });

    safeQuerySelectorAll(document, 'a[href*="/item/m"]').forEach((element) => {
      const link = element instanceof HTMLAnchorElement ? element : null;
      const itemUrl = normalizeItemUrl(link?.href ?? null);
      const itemId = extractMercariItemId(itemUrl);

      if (!link || !itemUrl || !itemId) {
        return;
      }

      const card = findListingItemCard(link);

      if (!card || seenCards.has(card)) {
        return;
      }

      seenCards.add(card);
      targets.push({ itemId, itemUrl, card, compact: compact || isPromotedListingLink(link), isShop: isMercariShopListingCard(card, link) });
    });

    return targets;
  }

  function extractListingCardItemId(card: HTMLElement): string | null {
    const thumbnail = card.querySelector('[itemtype][id], .merItemThumbnail[id], [class*="merItemThumbnail"][id]');
    const id = thumbnail?.getAttribute("id")?.trim();
    return id || null;
  }

  function isPromotedListingLink(link: HTMLAnchorElement): boolean {
    try {
      const url = new URL(link.href, window.location.href);
      return url.searchParams.has("ad_id")
        || url.searchParams.has("ad_auction_id")
        || url.searchParams.has("ad_auction_unit_id");
    } catch {
      return link.href.includes("ad_id=") || link.href.includes("ad_auction_id=") || link.href.includes("ad_auction_unit_id=");
    }
  }

  function isMercariShopListingCard(card: HTMLElement, link: HTMLAnchorElement | null): boolean {
    const href = link?.href.toLowerCase() ?? "";

    if (href.includes("/shops/") || href.includes("/shop/")) {
      return true;
    }

    const itemType = card.querySelector("[itemtype]")?.getAttribute("itemtype")?.toUpperCase() ?? "";

    if (itemType && itemType !== "ITEM_TYPE_MERCARI") {
      return true;
    }

    return Boolean(card.querySelector('[itemtype*="SHOP"], [itemtype*="shop"], a[href*="/shops/"], a[href*="/shop/"]'));
  }

  function findListingItemCard(link: HTMLAnchorElement): HTMLElement | null {
    const testIdCard = link.closest('[data-testid="item-cell"]');

    if (testIdCard instanceof HTMLElement) {
      return testIdCard;
    }

    const semanticCard = link.closest("li, article");

    if (semanticCard instanceof HTMLElement && isLikelyListingItemCard(semanticCard)) {
      return semanticCard;
    }

    let current = link.parentElement;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (isLikelyListingItemCard(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function isLikelyListingItemCard(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const itemLinkCount = new Set(
      safeQuerySelectorAll(element, 'a[href*="/item/m"]')
        .map((link) => link instanceof HTMLAnchorElement ? extractMercariItemId(link.href) : null)
        .filter(Boolean)
    ).size;

    return itemLinkCount === 1 && rect.width >= 96 && rect.width <= 360 && rect.height >= 120 && rect.height <= 620;
  }

  function ensureSellerPanel(target: ListingSellerTarget): void {
    const existingPanel = target.card.querySelector(`[${LISTING_SELLER_PANEL_ATTRIBUTE}="true"]`);

    if (
      existingPanel?.getAttribute("data-furimanager-item-id") === target.itemId
      && existingPanel.getAttribute(LISTING_SELLER_PANEL_VERSION_ATTRIBUTE) === LISTING_SELLER_PANEL_VERSION
    ) {
      if (existingPanel instanceof HTMLElement) {
        mountSellerPanel(target, existingPanel);
      }
      return;
    }

    if (target.card.getAttribute(LISTING_SELLER_PENDING_ATTRIBUTE) === target.itemId) {
      return;
    }

    existingPanel?.remove();
    target.card.setAttribute(LISTING_SELLER_PENDING_ATTRIBUTE, target.itemId);

    if (target.isShop) {
      target.card.removeAttribute(LISTING_SELLER_PENDING_ATTRIBUTE);
      renderSellerPanel(target, null, "shop");
      return;
    }

    renderSellerPanel(target, null, "loading");

    void getSellerInfoForListingItem(target.itemId)
      .then((sellerInfo) => {
        if (target.card.getAttribute(LISTING_SELLER_PENDING_ATTRIBUTE) !== target.itemId) {
          return;
        }

        target.card.removeAttribute(LISTING_SELLER_PENDING_ATTRIBUTE);
        renderSellerPanel(target, sellerInfo, sellerInfo ? "ready" : "empty");
      })
      .catch((error) => {
        console.debug("[furimanager] listing seller info skipped", error);

        if (target.card.getAttribute(LISTING_SELLER_PENDING_ATTRIBUTE) !== target.itemId) {
          return;
        }

        target.card.removeAttribute(LISTING_SELLER_PENDING_ATTRIBUTE);
        renderSellerPanel(target, null, "empty");
      });
  }

  async function getSellerInfoForListingItem(itemId: string): Promise<SellerInfo | null> {
    const cached = listingSellerApiCache.get(itemId);
    const cacheMs = cached && cached.data ? LISTING_SELLER_API_CACHE_MS : LISTING_SELLER_API_EMPTY_CACHE_MS;

    if (cached && Date.now() - cached.savedAt < cacheMs) {
      return cached.data;
    }

    const runningRequest = listingSellerApiRequests.get(itemId);

    if (runningRequest) {
      return runningRequest;
    }

    const request = requestMercariItemDetail(itemId)
      .then(async (payload) => {
        const sellerInfo = extractSellerInfoFromApiPayload(payload, itemId);
        const sellerInfoWithBadge = await supplementSellerIdentityBadge(sellerInfo);
        listingSellerApiCache.set(itemId, { savedAt: Date.now(), data: sellerInfoWithBadge });
        return sellerInfoWithBadge;
      })
      .catch((error) => {
        console.debug("[furimanager] mercari seller fetch skipped", error);
        listingSellerApiCache.set(itemId, { savedAt: Date.now(), data: null });
        return null;
      })
      .finally(() => {
        listingSellerApiRequests.delete(itemId);
      });

    listingSellerApiRequests.set(itemId, request);
    return request;
  }

  async function supplementSellerIdentityBadge(sellerInfo: SellerInfo | null): Promise<SellerInfo | null> {
    if (!sellerInfo?.sellerId) {
      return sellerInfo;
    }

    const badgeInfo = await getSellerIdentityBadgeInfo(sellerInfo.sellerId);

    if (!badgeInfo) {
      return { ...sellerInfo, verified: null };
    }

    if (badgeInfo.hasBadge === true) {
      return { ...sellerInfo, verified: true };
    }

    return { ...sellerInfo, verified: null };
  }

  function getSellerIdentityBadgeInfo(sellerId: string): Promise<SellerIdentityBadgeInfo | null> {
    const cached = sellerIdentityBadgeApiCache.get(sellerId);
    const cacheMs = cached && cached.data ? SELLER_IDENTITY_BADGE_API_CACHE_MS : SELLER_IDENTITY_BADGE_API_EMPTY_CACHE_MS;

    if (cached && Date.now() - cached.savedAt < cacheMs) {
      return Promise.resolve(cached.data);
    }

    const runningRequest = sellerIdentityBadgeApiRequests.get(sellerId);

    if (runningRequest) {
      return runningRequest;
    }

    const request = requestMercariUserIdentityBadge(sellerId)
      .then((payload) => {
        const badgeInfo = extractSellerIdentityBadgeInfo(payload);
        sellerIdentityBadgeApiCache.set(sellerId, { savedAt: Date.now(), data: badgeInfo });
        return badgeInfo;
      })
      .catch(() => {
        sellerIdentityBadgeApiCache.set(sellerId, { savedAt: Date.now(), data: null });
        return null;
      })
      .finally(() => {
        sellerIdentityBadgeApiRequests.delete(sellerId);
      });

    sellerIdentityBadgeApiRequests.set(sellerId, request);
    return request;
  }

  function extractSellerInfoFromApiPayload(payload: unknown, itemId: string): SellerInfo | null {
    const root = toRecord(payload);
    const item = toRecord(root?.data) ?? root;
    const seller = getSellerRecord(item);

    if (!seller) {
      return null;
    }

    const sellerId = extractStringValue(seller, ["id", "userId", "user_id", "sellerId", "seller_id"]);
    const name = extractStringValue(seller, ["name", "nickname", "displayName", "display_name"]);
    const avatarUrl = extractUrlValue(seller, ["photoThumbnailUrl", "photo_thumbnail_url", "photoUrl", "photo_url", "imageUrl", "image_url", "avatarUrl", "avatar_url", "thumbnail"]);
    const ratingCounts = extractSellerRatingCounts(seller);
    const reviewCount = extractNumberValue(seller, ["numRatings", "num_ratings", "ratingCount", "rating_count", "reviewCount", "review_count", "reviewsCount", "reviews_count"]);
    const goodCount = ratingCounts.good ?? extractNumberValue(seller, ["goodCount", "good_count", "ratingsGood", "ratings_good"]);
    const normalCount = ratingCounts.normal ?? extractNumberValue(seller, ["normalCount", "normal_count", "ratingsNormal", "ratings_normal"]);
    const badCount = ratingCounts.bad ?? extractNumberValue(seller, ["badCount", "bad_count", "ratingsBad", "ratings_bad"]);

    return {
      itemId,
      sellerId,
      name,
      avatarUrl,
      profileUrl: sellerId ? `https://jp.mercari.com/user/profile/${sellerId}` : null,
      ratingScore: extractNumberValue(seller, ["starRatingScore", "star_rating_score", "ratingScore", "rating_score", "score", "star", "rating"]),
      reviewCount: reviewCount ?? sumKnownCounts([goodCount, normalCount, badCount]),
      goodCount,
      normalCount,
      badCount,
      verified: null,
      levelText: extractSellerLevelText(seller),
    };
  }

  function getSellerRecord(item: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!item) {
      return null;
    }

    for (const key of ["seller", "sellerInfo", "seller_info", "owner", "user"]) {
      const seller = toRecord(item[key]);

      if (seller) {
        return seller;
      }
    }

    const nestedSeller = findJsonRecordByKey(item, ["seller", "sellerInfo", "seller_info"], 0);
    return nestedSeller;
  }

  function findJsonRecordByKey(source: unknown, keys: string[], depth: number): Record<string, unknown> | null {
    if (depth > 4 || source === null || source === undefined || typeof source !== "object") {
      return null;
    }

    if (!Array.isArray(source)) {
      const objectValue = source as Record<string, unknown>;

      for (const key of keys) {
        const matched = toRecord(objectValue[key]);

        if (matched) {
          return matched;
        }
      }
    }

    const children = Array.isArray(source) ? source : Object.values(source as Record<string, unknown>);

    for (const child of children) {
      const matched = findJsonRecordByKey(child, keys, depth + 1);

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  function renderSellerPanel(target: ListingSellerTarget, sellerInfo: SellerInfo | null, state: "loading" | "ready" | "empty" | "shop"): void {
    const existingPanel = target.card.querySelector(`[${LISTING_SELLER_PANEL_ATTRIBUTE}="true"]`);
    const panel = existingPanel instanceof HTMLElement ? existingPanel : document.createElement("div");
    panel.className = `furimanager-listing-seller-panel furimanager-listing-seller-panel--${state}`;
    panel.classList.toggle("furimanager-listing-seller-panel--compact", target.compact);
    panel.setAttribute(LISTING_SELLER_PANEL_ATTRIBUTE, "true");
    panel.setAttribute(LISTING_SELLER_PANEL_VERSION_ATTRIBUTE, LISTING_SELLER_PANEL_VERSION);
    panel.setAttribute("data-furimanager-item-id", target.itemId);
    panel.innerHTML = "";

    if (state === "loading") {
      panel.appendChild(createSellerPanelPlaceholder("セラー情報を取得中"));
    } else if (state === "shop") {
      panel.appendChild(createShopPanelContent());
    } else if (!sellerInfo) {
      panel.appendChild(createSellerPanelPlaceholder("セラー情報なし"));
    } else {
      panel.appendChild(createSellerPanelContent(sellerInfo));
    }

    mountSellerPanel(target, panel);
  }

  function mountSellerPanel(target: ListingSellerTarget, panel: HTMLElement): void {
    clearSellerPanelCardSizing(target.card);

    if (target.compact) {
      const compactMount = findCompactSellerPanelMount(target.card);

      if (compactMount) {
        if (getComputedStyle(compactMount).position === "static") {
          compactMount.style.position = "relative";
        }

        compactMount.appendChild(panel);
        return;
      }
    }

    const itemContent = findListingCardItemContent(target.card);

    if (itemContent) {
      itemContent.after(panel);
    } else {
      target.card.appendChild(panel);
    }
  }

  function clearSellerPanelCardSizing(card: HTMLElement): void {
    card.style.removeProperty("margin-bottom");
    card.style.removeProperty("height");
    card.style.removeProperty("min-height");
  }

  function isSellerPanelMountedInExpectedPlace(target: ListingSellerTarget, panel: HTMLElement): boolean {
    if (target.compact) {
      return panel.parentElement === findCompactSellerPanelMount(target.card);
    }

    const itemContent = findListingCardItemContent(target.card);
    return !itemContent || itemContent.nextElementSibling === panel;
  }

  function findCompactSellerPanelMount(card: HTMLElement): HTMLElement | null {
    const directLink = Array.from(card.children).find((child): child is HTMLAnchorElement => {
      if (!(child instanceof HTMLAnchorElement)) {
        return false;
      }

      return isListingProductLink(child);
    });

    if (directLink) {
      return directLink;
    }

    const thumbnailLink = card.querySelector('a[data-testid="thumbnail-link"], a[href*="/item/"], a[href*="/shops/product/"]');
    return thumbnailLink instanceof HTMLElement ? thumbnailLink : null;
  }

  function isListingProductLink(link: HTMLAnchorElement): boolean {
    const href = link.getAttribute("href") ?? "";
    return href.includes("/item/") || href.includes("/shops/product/");
  }

  function findListingCardItemContent(card: HTMLElement): HTMLElement | null {
    return Array.from(card.children).find((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }

      return child.getAttribute(LISTING_SELLER_PANEL_ATTRIBUTE) !== "true";
    }) ?? null;
  }

  function createSellerPanelPlaceholder(label: string): HTMLElement {
    const fragment = document.createElement("div");
    fragment.className = "furimanager-listing-seller-panel__content";

    const avatar = document.createElement("div");
    avatar.className = "furimanager-listing-seller-panel__avatar-placeholder";
    fragment.appendChild(avatar);

    const body = document.createElement("div");
    body.className = "furimanager-listing-seller-panel__body";

    const message = document.createElement("div");
    message.className = "furimanager-listing-seller-panel__name";
    message.textContent = label;
    body.appendChild(message);

    const ratingLine = document.createElement("span");
    ratingLine.className = "furimanager-listing-seller-panel__placeholder-line furimanager-listing-seller-panel__placeholder-line--rating";
    body.appendChild(ratingLine);

    const breakdownLine = document.createElement("span");
    breakdownLine.className = "furimanager-listing-seller-panel__placeholder-line furimanager-listing-seller-panel__placeholder-line--breakdown";
    body.appendChild(breakdownLine);

    fragment.appendChild(body);
    return fragment;
  }

  function createShopPanelContent(): HTMLElement {
    const fragment = document.createElement("div");
    fragment.className = "furimanager-listing-seller-panel__content";

    const avatar = document.createElement("div");
    avatar.className = "furimanager-listing-seller-panel__avatar-placeholder";
    avatar.textContent = "S";
    fragment.appendChild(avatar);

    const body = document.createElement("div");
    body.className = "furimanager-listing-seller-panel__body";

    const name = document.createElement("div");
    name.className = "furimanager-listing-seller-panel__name";
    name.textContent = "メルカリショップ";
    body.appendChild(name);

    fragment.appendChild(body);
    return fragment;
  }

  function createSellerPanelContent(sellerInfo: SellerInfo): HTMLElement {
    const fragment = document.createElement("div");
    fragment.className = "furimanager-listing-seller-panel__content";

    if (sellerInfo.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "furimanager-listing-seller-panel__avatar";
      avatar.src = sellerInfo.avatarUrl;
      avatar.alt = sellerInfo.name ? `${sellerInfo.name}の画像` : "セラー画像";
      avatar.loading = "lazy";
      fragment.appendChild(avatar);
    } else {
      const avatar = document.createElement("div");
      avatar.className = "furimanager-listing-seller-panel__avatar-placeholder";
      avatar.textContent = sellerInfo.name ? sellerInfo.name.slice(0, 1).toUpperCase() : "";
      fragment.appendChild(avatar);
    }

    const body = document.createElement("div");
    body.className = "furimanager-listing-seller-panel__body";
    body.appendChild(createSellerNameRow(sellerInfo));
    body.appendChild(createSellerRatingRow(sellerInfo));

    const breakdown = createSellerBreakdownRow(sellerInfo);

    if (breakdown) {
      body.appendChild(breakdown);
    }

    fragment.appendChild(body);
    return fragment;
  }

  function createSellerNameRow(sellerInfo: SellerInfo): HTMLElement {
    const row = document.createElement("div");
    row.className = "furimanager-listing-seller-panel__name";

    const name = document.createElement("span");
    name.className = "furimanager-listing-seller-panel__name-text";
    name.textContent = sellerInfo.name ?? "セラー名なし";
    row.appendChild(name);

    const displayName = name.textContent ?? sellerInfo.name ?? "Seller";
    row.dataset.fullName = displayName;
    row.setAttribute("aria-label", displayName);

    if (sellerInfo.verified === true) {
      row.appendChild(createSellerVerifiedBadge());
    }

    return row;
  }

  function createSellerRatingRow(sellerInfo: SellerInfo): HTMLElement {
    const row = document.createElement("div");
    row.className = "furimanager-listing-seller-panel__rating";

    const stars = document.createElement("span");
    stars.className = "furimanager-listing-seller-panel__stars";
    appendSellerStars(stars, sellerInfo.ratingScore, sellerInfo.reviewCount);

    const reviewCount = document.createElement("span");
    reviewCount.className = "furimanager-listing-seller-panel__review-count";
    reviewCount.textContent = String(sellerInfo.reviewCount ?? 0);

    row.append(stars, reviewCount);
    return row;
  }

  function appendSellerStars(container: HTMLElement, ratingScore: number | null, reviewCount: number | null): void {
    const hasReviews = (reviewCount ?? 0) > 0;
    const roundedScore = hasReviews && ratingScore !== null ? Math.max(0, Math.min(5, Math.round(ratingScore * 2) / 2)) : 0;

    for (let index = 1; index <= 5; index += 1) {
      const star = document.createElement("span");
      star.className = "furimanager-listing-seller-panel__star";
      star.textContent = "★";

      if (roundedScore >= index) {
        star.classList.add("furimanager-listing-seller-panel__star--full");
      } else if (roundedScore >= index - 0.5) {
        star.classList.add("furimanager-listing-seller-panel__star--half");
      } else {
        star.classList.add("furimanager-listing-seller-panel__star--empty");
      }

      container.appendChild(star);
    }
  }

  function createSellerBreakdownRow(sellerInfo: SellerInfo): HTMLElement | null {
    const counts = [
      { type: "good", value: sellerInfo.goodCount },
      { type: "bad", value: sellerInfo.badCount },
    ].filter((item) => item.value !== null);

    if (counts.length === 0) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "furimanager-listing-seller-panel__breakdown";

    counts.forEach((item) => {
      const element = document.createElement("span");
      element.className = "furimanager-listing-seller-panel__breakdown-item";

      const icon = createSellerFaceIcon(item.type);
      icon.setAttribute("class", `furimanager-listing-seller-panel__breakdown-icon furimanager-listing-seller-panel__breakdown-icon--${item.type}`);

      const count = document.createElement("span");
      count.textContent = String(item.value);

      element.append(icon, count);
      row.appendChild(element);
    });

    return row;
  }

  function createSellerFaceIcon(type: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.4");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    svg.appendChild(circle);

    const leftEye = document.createElementNS("http://www.w3.org/2000/svg", "path");
    leftEye.setAttribute("d", "M9 9h.01");
    svg.appendChild(leftEye);

    const rightEye = document.createElementNS("http://www.w3.org/2000/svg", "path");
    rightEye.setAttribute("d", "M15 9h.01");
    svg.appendChild(rightEye);

    const mouth = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mouth.setAttribute("d", type === "good" ? "M8 14s1.5 2 4 2 4-2 4-2" : "M16 16s-1.5-2-4-2-4 2-4 2");
    svg.appendChild(mouth);

    return svg;
  }

  function createSellerVerifiedBadge(): HTMLElement {
    const row = document.createElement("div");
    row.className = "furimanager-listing-seller-panel__verified";
    row.classList.add("furimanager-listing-seller-panel__verified--ok");

    const icon = document.createElement("span");
    icon.className = "furimanager-listing-seller-panel__verified-icon";

    row.title = "本人確認済";
    row.setAttribute("aria-label", "本人確認済");
    row.appendChild(icon);
    return row;
  }

  async function ensureListingDatePanel(): Promise<void> {
    if (!PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
      return;
    }

    const itemId = extractMercariItemId(window.location.href);
    const existingPanel = document.querySelector(`[${LISTING_DATE_PANEL_ATTRIBUTE}="true"]`);

    if (!itemId) {
      existingPanel?.remove();
      return;
    }

    const dateInfo = extractListingDateInfo(document);

    if (hasListingDateInfo(dateInfo)) {
      renderListingDatePanel(dateInfo, itemId);
    } else if (existingPanel?.getAttribute("data-furimanager-item-id") !== itemId) {
      existingPanel?.remove();
    }

    const apiDateInfo = await getListingDateInfoFromMercariApi(itemId);

    if (extractMercariItemId(window.location.href) !== itemId) {
      return;
    }

    const latestDateInfo = mergeListingDateInfo(apiDateInfo, dateInfo);

    if (!hasListingDateInfo(latestDateInfo)) {
      existingPanel?.remove();
      return;
    }

    renderListingDatePanel(latestDateInfo, itemId);
  }

  function renderListingDatePanel(dateInfo: ListingDateInfo, itemId: string): void {
    const existingPanel = document.querySelector(`[${LISTING_DATE_PANEL_ATTRIBUTE}="true"]`);

    const mount = findListingDatePanelMount();

    if (!mount) {
      return;
    }

    const panel = existingPanel instanceof HTMLElement ? existingPanel : document.createElement("div");
    panel.className = "furimanager-listing-date-panel";
    panel.setAttribute(LISTING_DATE_PANEL_ATTRIBUTE, "true");
    panel.setAttribute("data-furimanager-item-id", itemId);
    panel.innerHTML = "";

    const title = document.createElement("div");
    title.className = "furimanager-listing-date-panel__title";
    title.textContent = "フリマネ日時チェック";
    panel.appendChild(title);

    if (dateInfo.listedAt) {
      panel.appendChild(createListingDateRow("出品日時", dateInfo.listedAt));
    }

    if (dateInfo.updatedAt) {
      panel.appendChild(createListingDateRow("更新日時", dateInfo.updatedAt));
    }

    const policyCard = findListingDatePanelAnchor();

    if (policyCard?.parentElement) {
      policyCard.parentElement.insertBefore(panel, policyCard);
      return;
    }

    if (panel.parentElement !== mount) {
      mount.appendChild(panel);
    }
  }

  function hasListingDateInfo(dateInfo: ListingDateInfo): boolean {
    return dateInfo.listedAt !== null || dateInfo.updatedAt !== null;
  }

  function mergeListingDateInfo(primary: ListingDateInfo, fallback: ListingDateInfo): ListingDateInfo {
    return {
      listedAt: primary.listedAt ?? fallback.listedAt,
      updatedAt: primary.updatedAt ?? fallback.updatedAt,
    };
  }

  async function getListingDateInfoFromMercariApi(itemId: string): Promise<ListingDateInfo> {
    const cached = listingDateApiCache.get(itemId);

    const cacheMs = cached && hasListingDateInfo(cached.data) ? LISTING_DATE_API_CACHE_MS : LISTING_DATE_API_EMPTY_CACHE_MS;

    if (cached && Date.now() - cached.savedAt < cacheMs) {
      return cached.data;
    }

    const runningRequest = listingDateApiRequests.get(itemId);

    if (runningRequest) {
      return runningRequest;
    }

    const request = requestMercariItemDetail(itemId)
      .then((payload) => {
        const dateInfo = extractListingDateInfoFromApiPayload(payload);
        listingDateApiCache.set(itemId, { savedAt: Date.now(), data: dateInfo });
        return dateInfo;
      })
      .catch((error) => {
        console.debug("[furimanager] mercari item date fetch skipped", error);
        return { listedAt: null, updatedAt: null };
      })
      .finally(() => {
        listingDateApiRequests.delete(itemId);
      });

    listingDateApiRequests.set(itemId, request);
    return request;
  }

  function requestMercariItemDetail(itemId: string): Promise<unknown> {
    return new Promise((resolve) => {
      if (!chromeApi?.runtime?.sendMessage) {
        resolve(null);
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: MERCARI_ITEM_DETAIL_MESSAGE_TYPE,
          itemId,
          accessToken: readMercariAccessToken(),
        },
        (response) => {
          if (chromeApi.runtime?.lastError || !response?.success) {
            resolve(null);
            return;
          }

          resolve(response.data ?? null);
        }
      );
    });
  }

  function requestMercariUserProfile(userId: string): Promise<unknown> {
    return new Promise((resolve) => {
      if (!chromeApi?.runtime?.sendMessage) {
        resolve(null);
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: MERCARI_USER_PROFILE_MESSAGE_TYPE,
          userId,
          accessToken: readMercariAccessToken(),
        },
        (response) => {
          if (chromeApi.runtime?.lastError || !response?.success) {
            resolve(null);
            return;
          }

          resolve(response.data ?? null);
        }
      );
    });
  }

  function requestMercariUserIdentityBadge(userId: string): Promise<unknown> {
    return new Promise((resolve) => {
      if (!chromeApi?.runtime?.sendMessage) {
        resolve(null);
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: MERCARI_USER_IDENTITY_BADGE_MESSAGE_TYPE,
          userId,
          accessToken: readMercariAccessToken(),
        },
        (response) => {
          if (chromeApi.runtime?.lastError || !response?.success) {
            resolve(null);
            return;
          }

          resolve(response.data ?? null);
        }
      );
    });
  }

  function readMercariAccessToken(): string | null {
    try {
      const rawValue = localStorage.getItem("authTokenData");

      if (!rawValue) {
        return null;
      }

      const parsed = JSON.parse(rawValue) as { accessToken?: unknown };
      return typeof parsed.accessToken === "string" && parsed.accessToken ? parsed.accessToken : null;
    } catch {
      return null;
    }
  }

  function extractListingDateInfoFromApiPayload(payload: unknown): ListingDateInfo {
    const root = toRecord(payload);
    const item = toRecord(root?.data) ?? root;

    return {
      listedAt: extractApiDateValue(item, ["created", "created_at", "createdAt", "createTime", "createdTime"]),
      updatedAt: extractApiDateValue(item, ["updated", "updated_at", "updatedAt", "updateTime", "updatedTime"]),
    };
  }

  function extractApiDateValue(source: Record<string, unknown> | null, keys: string[]): Date | null {
    if (!source) {
      return null;
    }

    for (const key of keys) {
      const date = parseMercariDateValue(source[key]);

      if (date) {
        return date;
      }
    }

    return extractJsonDateValue(source, keys);
  }

  function toRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function extractStringValue(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = findJsonValueByKey(source, key);

      if (typeof value === "string" && normalizeText(value)) {
        return normalizeText(value);
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }

    return null;
  }

  function extractUrlValue(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = findJsonValueByKey(source, key);

      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        return value;
      }

      const imageUrl = getImageUrlFromJsonValue(value);

      if (imageUrl) {
        return imageUrl;
      }
    }

    return null;
  }

  function getImageUrlFromJsonValue(value: unknown, depth = 0): string | null {
    if (depth > 4 || value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      return /^https?:\/\//.test(value) && /mercdn|mercari|\.(?:jpe?g|png|webp)(?:\?|$)/i.test(value) ? value : null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = getImageUrlFromJsonValue(item, depth + 1);

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

    for (const key of ["url", "src", "thumbnail", "thumbnailUrl", "thumbnail_url"]) {
      const matched = getImageUrlFromJsonValue(objectValue[key], depth + 1);

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  function extractNumberValue(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const numberValue = normalizeNumberValue(findJsonValueByKey(source, key));

      if (numberValue !== null) {
        return numberValue;
      }
    }

    return null;
  }

  function normalizeNumberValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const numberValue = Number(value.replace(/,/g, ""));
      return Number.isFinite(numberValue) ? numberValue : null;
    }

    return null;
  }

  function extractSellerRatingCounts(source: Record<string, unknown>): SellerRatingCounts {
    const counts: SellerRatingCounts = { good: null, normal: null, bad: null };

    for (const key of ["ratings", "rating_counts", "ratingCounts", "ratings_count", "ratingsCount", "review_ratings", "reviewRatings"]) {
      mergeSellerRatingCounts(counts, findJsonValueByKey(source, key));
    }

    return counts;
  }

  function mergeSellerRatingCounts(counts: SellerRatingCounts, value: unknown, depth = 0): void {
    if (depth > 3 || value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => mergeSellerRatingCounts(counts, item, depth + 1));
      return;
    }

    const record = toRecord(value);

    if (!record) {
      return;
    }

    setSellerRatingCount(counts, "good", extractRatingCountValue(record.good) ?? extractRatingCountValue(record.goodCount) ?? extractRatingCountValue(record.good_count));
    setSellerRatingCount(counts, "normal", extractRatingCountValue(record.normal) ?? extractRatingCountValue(record.normalCount) ?? extractRatingCountValue(record.normal_count));
    setSellerRatingCount(counts, "bad", extractRatingCountValue(record.bad) ?? extractRatingCountValue(record.badCount) ?? extractRatingCountValue(record.bad_count));

    const kind = getSellerRatingKind(record);
    const count = getSellerRatingCount(record);

    if (kind && count !== null) {
      setSellerRatingCount(counts, kind, count);
    }

    for (const key of ["items", "data", "counts", "summary", "ratings", "rating_counts", "ratingCounts"]) {
      mergeSellerRatingCounts(counts, record[key], depth + 1);
    }
  }

  function setSellerRatingCount(counts: SellerRatingCounts, kind: keyof SellerRatingCounts, value: number | null): void {
    if (counts[kind] === null && value !== null) {
      counts[kind] = value;
    }
  }

  function extractRatingCountValue(value: unknown): number | null {
    const direct = normalizeNumberValue(value);

    if (direct !== null) {
      return direct;
    }

    const record = toRecord(value);
    return record ? getSellerRatingCount(record) : null;
  }

  function getSellerRatingCount(source: Record<string, unknown>): number | null {
    for (const key of ["count", "num", "number", "value", "total", "totalCount", "total_count", "ratingCount", "rating_count"]) {
      const value = normalizeNumberValue(source[key]);

      if (value !== null) {
        return value;
      }
    }

    return null;
  }

  function getSellerRatingKind(source: Record<string, unknown>): keyof SellerRatingCounts | null {
    const text = ["type", "key", "name", "label", "displayName", "display_name", "text", "icon"]
      .map((key) => {
        const value = source[key];
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
      })
      .join(" ")
      .toLowerCase();

    if (/(^|[_\-\s])(bad|poor|negative|sad)($|[_\-\s])|残念|悪い|悪かった/.test(text)) {
      return "bad";
    }

    if (/(^|[_\-\s])(normal|neutral|ordinary)($|[_\-\s])|普通/.test(text)) {
      return "normal";
    }

    if (/(^|[_\-\s])(good|positive|smile)($|[_\-\s])|良い|良かった|よかった/.test(text)) {
      return "good";
    }

    return null;
  }

  function extractBooleanValue(source: Record<string, unknown>, keys: string[]): boolean | null {
    for (const key of keys) {
      const value = findJsonValueByKey(source, key);

      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number" && (value === 0 || value === 1)) {
        return value === 1;
      }

      if (typeof value === "string") {
        const normalized = normalizeText(value).toLowerCase();

        if (["true", "1", "yes", "verified", "certificated"].includes(normalized)) {
          return true;
        }

        if (["false", "0", "no"].includes(normalized)) {
          return false;
        }
      }
    }

    return null;
  }

  function extractSellerIdentityBadgeInfo(payload: unknown): SellerIdentityBadgeInfo | null {
    const root = toRecord(payload);
    const data = toRecord(root?.data) ?? root;

    if (!data) {
      return null;
    }

    const hasBadge = extractDirectBooleanValue(data, ["hasBadge", "has_badge"]);
    const isBadgeHidden = extractDirectBooleanValue(data, ["isBadgeHidden", "is_badge_hidden"]);

    if (hasBadge === null && isBadgeHidden === null) {
      return null;
    }

    return { hasBadge, isBadgeHidden };
  }

  function extractDirectBooleanValue(source: Record<string, unknown>, keys: string[]): boolean | null {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }

      const value = source[key];

      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number" && (value === 0 || value === 1)) {
        return value === 1;
      }

      if (typeof value === "string") {
        const normalized = normalizeText(value).toLowerCase();

        if (normalized === "true" || normalized === "1") {
          return true;
        }

        if (normalized === "false" || normalized === "0") {
          return false;
        }
      }
    }

    return null;
  }

  function extractSellerSmsConfirmationValue(source: Record<string, unknown>): boolean | null {
    for (const key of ["register_sms_confirmation", "registerSmsConfirmation"]) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }

      const value = source[key];

      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number" && (value === 0 || value === 1)) {
        return value === 1;
      }

      if (typeof value === "string") {
        const normalized = normalizeText(value).toLowerCase();

        if (normalized === "yes") {
          return true;
        }

        if (normalized === "no") {
          return false;
        }
      }
    }

    return null;
  }

  function extractSellerVerifiedValue(source: Record<string, unknown>): boolean | null {
    const directValue = extractBooleanValue(source, [
      "isVerified",
      "is_verified",
      "isCertificated",
      "is_certificated",
      "isIdentityVerified",
      "is_identity_verified",
      "identityVerified",
      "identity_verified",
      "registerSmsConfirmation",
      "register_sms_confirmation",
      "smsConfirmation",
      "sms_confirmation",
    ]);

    if (directValue !== null) {
      return directValue;
    }

    for (const key of ["identityVerificationStatus", "identity_verification_status", "verificationStatus", "verification_status"]) {
      const status = normalizeSellerVerificationText(findJsonValueByKey(source, key));

      if (status !== null) {
        return status;
      }
    }

    for (const key of ["userBadge", "user_badge", "badges", "badge", "verificationBadge", "verification_badge", "identityVerification", "identity_verification", "verification"]) {
      const verified = getSellerVerificationFromKnownValue(findJsonValueByKey(source, key));

      if (verified !== null) {
        return verified;
      }
    }

    return null;
  }

  function getSellerVerificationFromKnownValue(value: unknown, depth = 0): boolean | null {
    if (depth > 3 || value === null || value === undefined) {
      return null;
    }

    const direct = normalizeSellerVerificationText(value);

    if (direct !== null) {
      return direct;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = getSellerVerificationFromKnownValue(item, depth + 1);

        if (matched !== null) {
          return matched;
        }
      }

      return null;
    }

    const record = toRecord(value);

    if (!record) {
      return null;
    }

    for (const key of [
      "isVerified",
      "is_verified",
      "isCertificated",
      "is_certificated",
      "verified",
      "certificated",
      "status",
      "state",
      "type",
      "key",
      "code",
      "name",
      "label",
      "displayName",
      "display_name",
      "displayText",
      "display_text",
      "text",
      "title",
    ]) {
      const matched = getSellerVerificationFromKnownValue(record[key], depth + 1);

      if (matched !== null) {
        return matched;
      }
    }

    return null;
  }

  function normalizeSellerVerificationText(value: unknown): boolean | null {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number" && (value === 0 || value === 1)) {
      return value === 1;
    }

    if (typeof value !== "string") {
      return null;
    }

    const text = normalizeText(value).toLowerCase().replace(/\s+/g, "");

    if (!text) {
      return null;
    }

    if (text === "1" || text === "true" || text === "yes") {
      return true;
    }

    if (text === "0" || text === "false" || text === "no") {
      return false;
    }

    if (/本人確認前|未確認|未認証|unverified|not_verified|notverified|notcertificated|un-certificated|uncertificated|beforeverification|unconfirmed/.test(text)) {
      return false;
    }

    if (/本人確認済|確認済み|verified|certificated|identity_verified|identityverified|completed|complete|approved|accepted/.test(text)) {
      return true;
    }

    return null;
  }

  function extractSellerLevelText(source: Record<string, unknown>): string | null {
    const rawLevel = extractStringValue(source, ["sellerLevel", "seller_level", "level", "rank"]);

    if (!rawLevel) {
      return null;
    }

    return /^出品者レベル/.test(rawLevel) ? rawLevel : `Lv ${rawLevel}`;
  }

  function sumKnownCounts(values: Array<number | null>): number | null {
    const knownValues = values.filter((value): value is number => value !== null);
    return knownValues.length > 0 ? knownValues.reduce((total, value) => total + value, 0) : null;
  }

  function findListingDatePanelMount(): HTMLElement | null {
    const itemInfo = document.querySelector("#item-info, #product-info");

    if (itemInfo instanceof HTMLElement) {
      return itemInfo;
    }

    const detailBody = findMercariDetailBody(document, "商品の状態") ?? findMercariDetailBody(document, "配送の方法");
    const detailRow = detailBody?.closest("mer-display-row, .merDisplayRow, dl, tr");
    let current = (detailRow instanceof HTMLElement ? detailRow.parentElement : detailBody?.parentElement) ?? null;

    for (let depth = 0; current && depth < 5; depth += 1) {
      const text = normalizeText(current.textContent ?? "");

      if (text.includes("商品の情報") || text.includes("商品の状態")) {
        return current;
      }

      current = current.parentElement;
    }

    const heading = safeQuerySelectorAll(document, "main h2, main h3, main mer-heading, main .merHeading, main span, main p")
      .find((element) => normalizeText(element.textContent) === "商品の情報");
    const headingMount = heading?.closest("section, div");

    return headingMount instanceof HTMLElement ? headingMount : null;
  }

  function findListingDatePanelAnchor(): HTMLElement | null {
    return toHTMLElement(document.querySelector('[data-testid="user-protection-policy"]'));
  }

  function createListingDateRow(labelText: string, date: Date): HTMLElement {
    const row = document.createElement("div");
    row.className = "furimanager-listing-date-panel__row";

    const label = document.createElement("div");
    label.className = "furimanager-listing-date-panel__label";
    label.textContent = labelText;

    const value = document.createElement("div");
    value.className = "furimanager-listing-date-panel__value";

    const absolute = document.createElement("span");
    absolute.className = "furimanager-listing-date-panel__absolute";
    absolute.textContent = formatListingDate(date);

    const relative = document.createElement("span");
    relative.className = "furimanager-listing-date-panel__relative";
    relative.textContent = formatRelativeDate(date);

    value.append(absolute, relative);
    row.append(label, value);
    return row;
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
      '[data-testid="listed-item"][href*="/transaction/"]',
      'a[href*="/item/"]',
      'a[href*="/transaction/"]',
      'li:has(a[href*="/item/"])',
      'li:has(a[href*="/transaction/"])',
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
    const link = getItemLink(element) ?? getTransactionLink(element);
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

    const itemLinks = element.querySelectorAll('a[href*="/item/"], a[href*="/transaction/"]');
    const isItemLink = element instanceof HTMLAnchorElement && (element.href.includes("/item/") || element.href.includes("/transaction/"));

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

  function cleanupToolbarsForPageKind(pageKind: MercariPageKind, keepListingSellerPanels = false): void {
    if (pageKind === "browsingHistory" || (pageKind === "unknown" && !keepListingSellerPanels)) {
      removeAllToolbars();
      return;
    }

    if (!keepListingSellerPanels) {
      removeAllListingSellerPanels();
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
    safeQuerySelectorAll(document, `[${LISTING_DATE_PANEL_ATTRIBUTE}="true"]`).forEach((panel) => {
      panel.remove();
    });
    removeAllListingSellerPanels();
  }

  function removeAllListingSellerPanels(): void {
    safeQuerySelectorAll(document, `[${LISTING_SELLER_PANEL_ATTRIBUTE}="true"]`).forEach((panel) => {
      panel.remove();
    });
    safeQuerySelectorAll(document, `[${LISTING_SELLER_PENDING_ATTRIBUTE}]`).forEach((card) => {
      card.removeAttribute(LISTING_SELLER_PENDING_ATTRIBUTE);
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

    if (definition.action === "linkInventory") {
      await handleInventoryLink(context);
      return;
    }

    await handleAdjustPrice(definition.amount ?? 0, context);
  }

  async function handleCopyListing(context: ActionContext): Promise<void> {
    await saveRelistPending(context, "copy");
  }

  async function handleRelist(context: ActionContext): Promise<void> {
    await runRelistFromProductPage(context, "relist");
  }

  async function handleSaveDraft(context: ActionContext): Promise<void> {
    await runRelistFromProductPage(context, "draft");
  }

  async function runRelistFromProductPage(context: ActionContext, mode: "relist" | "draft"): Promise<void> {
    if (PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
      await saveRelistPending(context, mode);
      return;
    }

    const itemId = context.itemId ?? extractMercariItemId(context.itemUrl);
    const itemLink = getItemLink(context.root) ?? getTransactionLink(context.root);

    if (!itemId || !itemLink) {
      showToast("商品ページを開く場所が見つかりませんでした");
      return;
    }

    const pending: ProductPageRelistPendingItem = {
      itemId,
      mode,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(PRODUCT_PAGE_RELIST_PENDING_KEY, JSON.stringify(pending));

    // 一覧ではデータを作らず、商品行を押して商品ページ用の処理へ一本化する。
    clickLinkAndFallback(itemLink);
  }

  function continuePendingRelistFromTransactionPage(): boolean {
    if (!TRANSACTION_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingProductPageRelistItem();

    if (!pending || extractMercariTransactionItemId(window.location.href) !== pending.itemId) {
      return false;
    }

    const itemLink = findTransactionProductLink(document, pending.itemId);

    if (!itemLink) {
      return false;
    }

    clickLinkAndFallback(itemLink);
    return true;
  }

  function continuePendingRelistFromProductPage(): boolean {
    if (!PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingProductPageRelistItem();

    if (!pending) {
      return false;
    }

    const currentItemId = extractMercariItemId(window.location.href);

    if (currentItemId !== pending.itemId) {
      sessionStorage.removeItem(PRODUCT_PAGE_RELIST_PENDING_KEY);
      return false;
    }

    const pageKind = detectPageKind();

    if (pageKind !== "ownProduct") {
      return false;
    }

    const context = getProductPageTarget(pageKind);

    if (!context) {
      return false;
    }

    // observerによる再実行で二重送信しないよう、商品データ取得前に受け渡しを消す。
    sessionStorage.removeItem(PRODUCT_PAGE_RELIST_PENDING_KEY);
    void saveRelistPending(context, pending.mode);
    return true;
  }

  function getPendingProductPageRelistItem(): ProductPageRelistPendingItem | null {
    try {
      const raw = sessionStorage.getItem(PRODUCT_PAGE_RELIST_PENDING_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<ProductPageRelistPendingItem>;
      const isFresh = typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt <= 120000;

      if (
        typeof parsed.itemId !== "string" ||
        !/^m\d{8,}$/.test(parsed.itemId) ||
        (parsed.mode !== "relist" && parsed.mode !== "draft") ||
        !isFresh
      ) {
        sessionStorage.removeItem(PRODUCT_PAGE_RELIST_PENDING_KEY);
        return null;
      }

      return {
        itemId: parsed.itemId,
        mode: parsed.mode,
        savedAt: parsed.savedAt,
      };
    } catch {
      sessionStorage.removeItem(PRODUCT_PAGE_RELIST_PENDING_KEY);
      return null;
    }
  }

  async function handleAdjustPrice(amount: number, context: ActionContext): Promise<void> {
    const itemId = context.itemId ?? extractMercariItemId(context.itemUrl) ?? extractMercariItemId(window.location.href);

    if (!itemId) {
      showToast("商品の編集ページを特定できませんでした");
      return;
    }

    const pending: PriceAdjustPendingItem = {
      itemId,
      delta: amount,
      savedAt: Date.now(),
      stage: context.pageKind === "activeListings" ? "openItem" : "openEdit",
    };
    savePendingPriceAdjustItem(pending);

    if (context.pageKind === "activeListings") {
      const itemLink = getItemLink(context.root) ?? getTransactionLink(context.root);

      if (!itemLink) {
        clearPendingPriceAdjustItem();
        showToast("商品ページを開く場所が見つかりませんでした");
        return;
      }

      // 一覧では、先に商品行のリンクを押して商品詳細へ進む。取引中は取引画面を1回経由する。
      clickLinkAndFallback(itemLink);
      return;
    }

    if (!openProductEditPage(itemId)) {
      clearPendingPriceAdjustItem();
      showToast("「商品の編集」が見つかりませんでした");
    }
  }

  function continuePendingPriceAdjustFromProductPage(): boolean {
    if (!PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingPriceAdjustItem();

    if (!pending || pending.stage !== "openItem") {
      return false;
    }

    const currentItemId = extractMercariItemId(window.location.href);

    if (currentItemId !== pending.itemId) {
      clearPendingPriceAdjustItem();
      return false;
    }

    const editLink = findProductEditLink(document, pending.itemId);

    if (!editLink) {
      return false;
    }

    savePendingPriceAdjustItem({
      ...pending,
      stage: "openEdit",
    });
    clickEditLinkAndEnsureReload(editLink, pending.itemId);
    return true;
  }

  function continuePendingPriceAdjustFromTransactionPage(): boolean {
    if (!TRANSACTION_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingPriceAdjustItem();

    if (!pending || pending.stage !== "openItem" || extractMercariTransactionItemId(window.location.href) !== pending.itemId) {
      return false;
    }

    const itemLink = findTransactionProductLink(document, pending.itemId);

    if (!itemLink) {
      return false;
    }

    clickLinkAndFallback(itemLink);
    return true;
  }

  function openProductEditPage(itemId: string): boolean {
    const editLink = findProductEditLink(document, itemId);

    if (!editLink) {
      return false;
    }

    clickEditLinkAndEnsureReload(editLink, itemId);
    return true;
  }

  function clickLinkAndFallback(link: HTMLAnchorElement): void {
    const startUrl = window.location.href;
    link.click();

    window.setTimeout(() => {
      if (window.location.href === startUrl) {
        window.location.assign(link.href);
      }
    }, 800);
  }

  function clickEditLinkAndEnsureReload(link: HTMLAnchorElement, itemId: string): void {
    const startUrl = window.location.href;
    link.click();

    window.setTimeout(() => {
      const editItemId = window.location.pathname.match(/\/sell\/edit\/(m\d{8,})/)?.[1] ?? null;

      if (editItemId === itemId) {
        // SPA遷移では編集画面用スクリプトが追加読込されないため、一度だけ通常読込へ切り替える。
        window.location.reload();
        return;
      }

      if (window.location.href === startUrl) {
        window.location.assign(link.href);
      }
    }, 800);
  }

  function savePendingPriceAdjustItem(item: PriceAdjustPendingItem): void {
    sessionStorage.setItem(PRICE_ADJUST_PENDING_KEY, JSON.stringify(item));
  }

  function getPendingPriceAdjustItem(): PriceAdjustPendingItem | null {
    try {
      const raw = sessionStorage.getItem(PRICE_ADJUST_PENDING_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<PriceAdjustPendingItem>;

      if (
        typeof parsed.itemId !== "string" ||
        !/^m\d{8,}$/.test(parsed.itemId) ||
        typeof parsed.delta !== "number" ||
        !Number.isFinite(parsed.delta)
      ) {
        clearPendingPriceAdjustItem();
        return null;
      }

      return {
        itemId: parsed.itemId,
        delta: parsed.delta,
        savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
        stage: parsed.stage === "openItem" ? "openItem" : "openEdit",
      };
    } catch {
      clearPendingPriceAdjustItem();
      return null;
    }
  }

  function clearPendingPriceAdjustItem(): void {
    sessionStorage.removeItem(PRICE_ADJUST_PENDING_KEY);
  }

  function findProductEditLink(source: ParentNode, itemId: string): HTMLAnchorElement | null {
    const links = Array.from(source.querySelectorAll(`
      a[href="/sell/edit/${itemId}"][data-testid="checkout-link"],
      a[href="/sell/edit/${itemId}"],
      a[href*="/sell/edit/${itemId}"],
      a[href*="/sell/edit/"][data-testid="checkout-link"],
      a[href*="/sell/edit/"]
    `)).filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links.find((link) => {
      const hrefItemId = extractMercariItemId(link.href.replace("/sell/edit/", "/item/"));
      const text = normalizeText(link.textContent);
      return (!hrefItemId || hrefItemId === itemId) && (text.includes("商品の編集") || text.includes("編集") || link.dataset.testid === "checkout-link");
    }) ?? links[0] ?? null;
  }

  function findTransactionProductLink(source: ParentNode, itemId: string): HTMLAnchorElement | null {
    const links = Array.from(source.querySelectorAll(`
      a[data-testid="transaction-information-for-seller:item-object"][href*="/item/"],
      a[href="/item/${itemId}"],
      a[href*="/item/${itemId}"],
      a[href*="/item/"]
    `)).filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links.find((link) => extractMercariItemId(link.href) === itemId) ?? links[0] ?? null;
  }

  async function saveRelistPending(context: ActionContext, mode: RelistMode): Promise<void> {
    const item = await collectRelistData(context, mode);

    if (typeof item.price !== "number") {
      showToast("価格を取得できなかったため、新規出品ページを開きませんでした");
      return;
    }

    await sendRelistPending(item);
  }

  async function handleInventoryLink(context: ActionContext): Promise<void> {
    const item = await collectRelistData(context, "relist");

    await sendInventoryLinkPending({
      platform: "mercari",
      mercariItemId: item.itemId ?? context.itemId,
      listingUrl: item.itemUrl ?? context.itemUrl,
      listingTitle: item.title,
      listingPrice: item.price,
      listingStatus: getInventoryListingStatus(context.pageKind),
      imageUrl: item.thumbnailUrl ?? item.imageUrls[0] ?? null,
      capturedAt: new Date().toISOString(),
    });
  }

  function getInventoryListingStatus(pageKind: MercariPageKind) {
    if (pageKind === "history" || isSoldProductPage()) {
      return "sold";
    }

    if (pageKind === "activeListings" || pageKind === "ownProduct") {
      return "active";
    }

    return "unknown";
  }

  async function collectRelistData(context: ActionContext, mode: RelistMode): Promise<RelistPendingItem> {
    const extractionRoot: ParentNode = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : context.root;
    const localItem = extractItemDataFromElement(extractionRoot, context.itemUrl, mode);

    if (!localItem.itemUrl) {
      return {
        ...localItem,
        itemId: localItem.itemId ?? context.itemId,
      };
    }

    if (PRODUCT_PATH_PATTERN.test(window.location.pathname) && !isRelistItemMissingRequiredData(localItem)) {
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

  function isRelistItemMissingRequiredData(item: RelistPendingItem): boolean {
    return typeof item.price !== "number";
  }

  function extractItemDataFromElement(source: ParentNode, fallbackUrl: string | null, mode: RelistMode): RelistPendingItem {
    const itemUrl = normalizeItemUrl(getItemLink(source)?.href ?? fallbackUrl ?? window.location.href);
    const itemId = extractMercariItemId(itemUrl);
    const detailSource: ParentNode = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : source;
    const imageSource = PRODUCT_PATH_PATTERN.test(window.location.pathname) ? document : source;
    const jsonItem = itemId && detailSource instanceof Document ? findCurrentItemJsonObject(detailSource, itemId) : null;
    const title = extractTitle(source);
    const price = extractJsonPrice(jsonItem) ?? extractPrice(source);
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
        price: extractJsonPrice(jsonItem) ?? extractPrice(parsedDocument),
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

  function sendInventoryLinkPending(item: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      if (!chromeApi?.runtime?.sendMessage) {
        showToast("在庫連携ページを開けませんでした");
        resolve();
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: "OPEN_INVENTORY_LINK",
          payload: item,
        },
        (response) => {
          if (chromeApi.runtime?.lastError) {
            showToast("在庫連携ページを開けませんでした");
            resolve();
            return;
          }

          if (response?.success) {
            showToast("在庫連携ページを開きます");
          } else {
            showToast(response?.message ?? "在庫連携ページを開けませんでした");
          }

          resolve();
        }
      );
    });
  }

  async function handleStopListing(context: ActionContext): Promise<void> {
    startListingManagementAction("stop", context);
  }

  async function handleDeleteListing(context: ActionContext): Promise<void> {
    startListingManagementAction("delete", context);
  }

  function startListingManagementAction(action: "stop" | "delete", context: ActionContext): void {
    const itemId = context.itemId ?? extractMercariItemId(context.itemUrl) ?? extractMercariItemId(window.location.href);

    if (!itemId) {
      showToast("商品の編集ページを特定できませんでした");
      return;
    }

    const pending: ListingManagementPendingItem = {
      itemId,
      action,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(LISTING_MANAGEMENT_PENDING_KEY, JSON.stringify(pending));

    if (context.pageKind === "activeListings") {
      const itemLink = getItemLink(context.root) ?? getTransactionLink(context.root);

      if (!itemLink) {
        sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
        showToast("商品ページを開く場所が見つかりませんでした");
        return;
      }

      clickLinkAndFallback(itemLink);
      return;
    }

    if (!openProductEditPage(itemId)) {
      sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
      showToast("「商品の編集」が見つかりませんでした");
    }
  }

  function continuePendingListingManagementFromProductPage(): boolean {
    if (!PRODUCT_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingListingManagementForProductPage();

    if (!pending) {
      return false;
    }

    const currentItemId = extractMercariItemId(window.location.href);

    if (currentItemId !== pending.itemId) {
      sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
      return false;
    }

    if (!openProductEditPage(pending.itemId)) {
      return false;
    }

    return true;
  }

  function continuePendingListingManagementFromTransactionPage(): boolean {
    if (!TRANSACTION_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }

    const pending = getPendingListingManagementForProductPage();

    if (!pending || extractMercariTransactionItemId(window.location.href) !== pending.itemId) {
      return false;
    }

    const itemLink = findTransactionProductLink(document, pending.itemId);

    if (!itemLink) {
      return false;
    }

    clickLinkAndFallback(itemLink);
    return true;
  }

  function getPendingListingManagementForProductPage(): ListingManagementPendingItem | null {
    try {
      const raw = sessionStorage.getItem(LISTING_MANAGEMENT_PENDING_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<ListingManagementPendingItem>;
      const isFresh = typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt <= 120000;

      if (
        typeof parsed.itemId !== "string" ||
        !/^m\d{8,}$/.test(parsed.itemId) ||
        (parsed.action !== "stop" && parsed.action !== "delete") ||
        !isFresh
      ) {
        sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
        return null;
      }

      return {
        itemId: parsed.itemId,
        action: parsed.action,
        savedAt: parsed.savedAt,
      };
    } catch {
      sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
      return null;
    }
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

  async function clickFurimaneCopyListingButton(expectedItemId: string | null) {
    const detection = await waitForFurimaneCopyListingButton(expectedItemId);

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
    console.log("[furimanager-extension] relist action button clicked", {
      expectedItemId: detection.expectedItemId,
      currentItemId: detection.currentItemId,
      pageUrl: detection.pageUrl,
      action: detection.action,
    });

    return {
      clicked: true,
      detected: true,
      action: detection.action,
      reason: `${detection.action || "relist_action"}_button_clicked`,
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

    const buttons = safeQuerySelectorAll(document, '[data-furimanager-action="relist"], [data-furimanager-action="copy-listing"]')
      .filter((element) => element instanceof HTMLButtonElement && isVisible(element));
    const button = buttons.find((element) => element.dataset.furimanagerAction === "relist") ?? buttons[0] ?? null;
    const action = button?.dataset.furimanagerAction ?? null;

    return {
      detected: Boolean(button),
      action,
      reason: button ? `${action}_button_found` : "relist_action_button_not_found",
      itemIdMatch,
      expectedItemId,
      currentItemId,
      pageUrl: window.location.href,
      button,
    };
  }

  async function waitForFurimaneCopyListingButton(expectedItemId: string | null) {
    const startedAt = Date.now();
    let detection = detectFurimaneCopyListingButton(expectedItemId);

    while (!detection.detected && detection.reason !== "item_id_mismatch" && Date.now() - startedAt < COPY_LISTING_BUTTON_WAIT_TIMEOUT_MS) {
      await sleep(COPY_LISTING_BUTTON_WAIT_INTERVAL_MS);
      detection = detectFurimaneCopyListingButton(expectedItemId);
    }

    return detection;
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
    const itemLink = getItemLink(root);
    const transactionLink = getTransactionLink(root);
    const itemUrl = normalizeItemUrl(itemLink?.href ?? (PRODUCT_PATH_PATTERN.test(window.location.pathname) ? window.location.href : null));
    const transactionUrl = normalizeItemUrl(transactionLink?.href ?? (TRANSACTION_PATH_PATTERN.test(window.location.pathname) ? window.location.href : null));

    return {
      pageKind,
      itemId: extractMercariItemId(itemUrl) ?? extractMercariTransactionItemId(transactionUrl),
      itemUrl,
      transactionUrl,
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

  function getTransactionLink(source: ParentNode): HTMLAnchorElement | null {
    if (source instanceof HTMLAnchorElement && source.href.includes("/transaction/")) {
      return source;
    }

    return source.querySelector('a[href*="/transaction/"]');
  }

  function extractMercariItemId(url: string | null): string | null {
    if (!url) {
      return null;
    }

    const matched = url.match(/\/item\/([^/?#]+)/);
    return matched?.[1] ?? null;
  }

  function extractMercariTransactionItemId(url: string | null): string | null {
    if (!url) {
      return null;
    }

    const matched = url.match(/\/transaction\/(m\d{8,})/);
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
      '[itemprop="price"]',
      'meta[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
    ];

    for (const selector of selectors) {
      const elements = Array.from(source.querySelectorAll(selector));

      for (const element of elements) {
        if (element instanceof HTMLMetaElement) {
          const price = parsePrice(element.content);

          if (price !== null) {
            return price;
          }
        }

        const price = parsePrice(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("content") ?? ""}`);

        if (price !== null) {
          return price;
        }
      }
    }

    const bodyText = source instanceof Document ? `${source.body?.innerText ?? ""} ${source.body?.textContent ?? ""}` : source.textContent ?? "";
    return parsePrice(bodyText);
  }

  function extractJsonPrice(source: Record<string, unknown> | null): number | null {
    if (!source) {
      return null;
    }

    for (const key of ["price", "itemPrice", "item_price", "sellingPrice", "selling_price", "salePrice", "sale_price", "priceValue", "price_value"]) {
      const price = normalizeJsonPriceValue(findJsonValueByKey(source, key));

      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  function normalizeJsonPriceValue(value: unknown): number | null {
    const directNumber = normalizeNumberValue(value);

    if (directNumber !== null && directNumber > 0) {
      return Math.round(directNumber);
    }

    if (typeof value === "string") {
      return parsePrice(value);
    }

    const record = toRecord(value);

    if (!record) {
      return null;
    }

    for (const key of ["value", "amount", "price", "numericValue", "numeric_value"]) {
      const price = normalizeJsonPriceValue(record[key]);

      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  function parsePrice(value: string): number | null {
    const matched = value.match(/(?:[¥￥]\s*([0-9０-９,，]+)|([0-9０-９,，]+)\s*円)/);
    const raw = matched?.[1] ?? matched?.[2] ?? (/^[\s0-9０-９,，]+$/.test(value) ? value : null);

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

  function extractListingDateInfo(source: Document): ListingDateInfo {
    const itemId = extractMercariItemId(window.location.href);
    const jsonItem = itemId ? findCurrentItemJsonObject(source, itemId) : null;

    return {
      listedAt: extractJsonDateValue(jsonItem, [
        "created",
        "createdAt",
        "created_at",
        "createdTime",
        "created_time",
        "createdDate",
        "created_date",
        "createdTimestamp",
        "created_timestamp",
        "datePublished",
        "date_published",
        "listedAt",
        "listed_at",
        "listingCreatedAt",
        "listing_created_at",
        "itemCreatedAt",
        "item_created_at",
      ]),
      updatedAt: extractJsonDateValue(jsonItem, [
        "updated",
        "updatedAt",
        "updated_at",
        "updatedTime",
        "updated_time",
        "updatedDate",
        "updated_date",
        "updatedTimestamp",
        "updated_timestamp",
        "dateModified",
        "date_modified",
        "modifiedAt",
        "modified_at",
        "lastUpdatedAt",
        "last_updated_at",
        "itemUpdatedAt",
        "item_updated_at",
      ]),
    };
  }

  function extractJsonDateValue(source: Record<string, unknown> | null, keys: string[]): Date | null {
    if (!source) {
      return null;
    }

    const normalizedKeys = keys.map(normalizeJsonDateKey);
    return findJsonDateValue(source, normalizedKeys);
  }

  function findJsonDateValue(source: unknown, normalizedKeys: string[], depth = 0, parentKey = ""): Date | null {
    if (depth > 6 || source === null || source === undefined || typeof source !== "object") {
      return null;
    }

    if (/seller|user|profile|avatar|shop|owner/i.test(parentKey)) {
      return null;
    }

    if (Array.isArray(source)) {
      for (const item of source) {
        const matched = findJsonDateValue(item, normalizedKeys, depth + 1, parentKey);

        if (matched) {
          return matched;
        }
      }

      return null;
    }

    const objectValue = source as Record<string, unknown>;

    for (const [key, value] of Object.entries(objectValue)) {
      if (!normalizedKeys.includes(normalizeJsonDateKey(key))) {
        continue;
      }

      const date = parseMercariDateValue(value);

      if (date) {
        return date;
      }
    }

    for (const [key, value] of Object.entries(objectValue)) {
      const matched = findJsonDateValue(value, normalizedKeys, depth + 1, key);

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  function normalizeJsonDateKey(value: string): string {
    return value.replace(/[_\-\s]/g, "").toLowerCase();
  }

  function parseMercariDateValue(value: unknown): Date | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      const timestamp = value > 100000000000 ? value : value * 1000;
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const objectValue = value as Record<string, unknown>;
      const seconds = objectValue.seconds ?? objectValue._seconds;

      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        return parseMercariDateValue(seconds);
      }
    }

    if (typeof value !== "string") {
      return null;
    }

    const text = value.trim();

    if (!text) {
      return null;
    }

    if (/^\d{10,13}$/.test(text)) {
      return parseMercariDateValue(Number(text));
    }

    const matched = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);

    if (matched) {
      const [, year, month, day, hour = "0", minute = "0", second = "0"] = matched;
      const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatListingDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatRelativeDate(date: Date): string {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

    if (elapsedSeconds < 60) {
      return "たった今";
    }

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);

    if (elapsedMinutes < 60) {
      return `${elapsedMinutes}分前`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);

    if (elapsedHours < 24) {
      return `${elapsedHours}時間前`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);

    if (elapsedDays < 31) {
      return `${elapsedDays}日前`;
    }

    const elapsedMonths = Math.floor(elapsedDays / 30);

    if (elapsedMonths < 12) {
      return `${elapsedMonths}ヶ月前`;
    }

    return `${Math.floor(elapsedDays / 365)}年前`;
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
