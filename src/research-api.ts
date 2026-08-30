type ResearchPlatform = "mercari" | "mercari_shops";

type ResearchSellerPayload = {
  platform: ResearchPlatform;
  seller_id: string;
  seller_name: string | null;
  seller_url: string;
};

type ResearchListingPayload = {
  item_id: string;
  title: string;
  price: number;
  sold_at: string | null;
  period_date?: string | null;
  period_date_source?: string | null;
  period_date_estimated?: boolean;
  period_key?: "period1" | "period2" | "period3" | null;
  thumbnail_url: string | null;
  item_url: string | null;
  status?: string;
  platform?: ResearchPlatform;
};

type ResearchSiteConfig = {
  version: number;
  platform: string;
  config: {
    listingLinkSelectors: Record<string, string>;
    pricePattern: string;
    soldTabTexts: string[];
    domTextMaxLength: number;
    maxItems: number;
    autoMore: { maxClicks: number };
  };
};

type ResearchAnalyzePayload = {
  seller: ResearchSellerPayload;
  source: "page_api" | "dom";
  rawItems?: Record<string, unknown>[];
  domItems?: ResearchDomAnalyzeItem[];
};

type ResearchAnalyzeResponse = {
  success: boolean;
  seller: unknown;
  listings: ResearchListingPayload[];
  stats?: unknown;
  periodAnalysis?: unknown;
  usage?: ResearchUsageState | null;
};

type ResearchDomAnalyzeItem = {
  item_url: string;
  text: string;
  image_alt: string | null;
  aria_label: string | null;
  thumbnail_url: string | null;
};

type ResearchSimulatorPayload = {
  platform: ResearchPlatform;
  sellPrice: number;
  purchasePrice: number;
  shippingFee: number;
  monthlySalesCount: number;
};

type ResearchSimulatorResponse = {
  feeRate: number;
  fee: number;
  netProfit: number;
  profitRate: number;
  monthlyExpectedProfit: number;
};

type ResearchBookmark = {
  id: string;
  bookmark_type?: "item" | "seller";
  platform: string;
  item_id: string | null;
  target_key?: string | null;
  title: string;
  price: number | null;
  thumbnail_url: string | null;
  item_url: string | null;
  created_at?: string;
  period_sales?: ResearchBookmarkPeriodSales;
};

type ResearchBookmarkPeriodStats = {
  count: number;
  revenue: number;
};

type ResearchBookmarkPeriodSales = {
  period1: ResearchBookmarkPeriodStats;
  period2: ResearchBookmarkPeriodStats;
  period3: ResearchBookmarkPeriodStats;
  total: ResearchBookmarkPeriodStats;
};

type ResearchBookmarkPayload = {
  platform: ResearchPlatform;
  item_id: string;
  title: string;
  price: number;
  thumbnail_url: string | null;
  item_url: string | null;
  period_sales?: ResearchBookmarkPeriodSales;
};

type ResearchRequestOptions = {
  signal?: AbortSignal;
};

type ResearchAccessResponse = {
  canUse?: boolean;
  canUseResearch: boolean;
  hasAddon?: boolean;
  expiresAt?: string | null;
  usage?: ResearchUsageState;
};

type ResearchUsageState = {
  allowed?: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetAt?: string;
  unlimited?: boolean;
  /** 紹介チケットの残り回数（月枠とは別枠）。 */
  ticketRemaining?: number;
  /** 残っているチケットのうち、最も早い失効日時（ISO文字列）。 */
  ticketExpiresAt?: string | null;
  /** 直前の1回をどちらから引いたか。 */
  consumedFrom?: "monthly" | "ticket";
};

type ResearchCacheResponse = {
  cached: boolean;
  expiresAt?: string;
  seller?: ResearchSellerPayload;
  listings?: ResearchListingPayload[];
  data?: {
    seller: ResearchSellerPayload;
    listings: ResearchListingPayload[];
  };
};

type ResearchImportResponse = {
  success: boolean;
  listingCount: number;
  usage?: ResearchUsageState;
};

type ResearchSellerSaveResponse = {
  success: boolean;
  saved: boolean;
};

type ResearchBookmarksResponse = {
  items: ResearchBookmark[];
  count: number;
  limit: number;
};

type ResearchBookmarkMutationResponse = {
  success: boolean;
  item?: ResearchBookmark;
  bookmark?: ResearchBookmark;
  count: number;
  limit: number;
};

type ResearchPurchasePrice = {
  purchasePrice: number | null;
  shippingFee: number | null;
  savedAt?: string;
};

type ResearchPurchasePriceMap = Record<string, ResearchPurchasePrice>;

type ResearchPurchasePricePayload = {
  platform: ResearchPlatform;
  itemId: string;
  purchasePrice: number;
  shippingFee: number;
};

type FurimanagerConfig = {
  APP_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

type MinimalChromeApi = {
  storage?: {
    local?: {
      get: (keys: string[], callback: (result: Record<string, unknown>) => void) => void;
      set: (values: Record<string, unknown>, callback: () => void) => void;
      remove: (keys: string[], callback: () => void) => void;
    };
  };
  runtime?: {
    id?: string;
    lastError?: {
      message?: string;
    };
    getManifest?: () => {
      version?: string;
    };
  };
};

declare global {
  interface Window {
    FurimanagerConfig?: FurimanagerConfig;
    FurimanagerResearchApi?: {
      getAppUrl: () => string;
      checkAccess: (options?: ResearchRequestOptions) => Promise<ResearchAccessResponse>;
      checkCache: (
        sellerId: string,
        platform?: ResearchPlatform,
        options?: ResearchRequestOptions
      ) => Promise<ResearchCacheResponse>;
      saveResearchData: (
        seller: ResearchSellerPayload,
        listings: ResearchListingPayload[],
        options?: ResearchRequestOptions
      ) => Promise<ResearchImportResponse>;
      getSiteConfig: (platform?: ResearchPlatform, options?: ResearchRequestOptions) => Promise<ResearchSiteConfig>;
      analyzeResearchData: (payload: ResearchAnalyzePayload, options?: ResearchRequestOptions) => Promise<ResearchAnalyzeResponse>;
      simulateProfit: (payload: ResearchSimulatorPayload, options?: ResearchRequestOptions) => Promise<ResearchSimulatorResponse>;
      trimRawItemsForAnalyze: (rawItems: unknown[]) => Record<string, unknown>[];
      buildDomItemForAnalyze: (input: Partial<ResearchDomAnalyzeItem>, maxTextLength?: number) => ResearchDomAnalyzeItem;
      saveSeller: (seller: ResearchSellerPayload, options?: ResearchRequestOptions) => Promise<ResearchSellerSaveResponse>;
      getBookmarks: (options?: ResearchRequestOptions) => Promise<ResearchBookmarksResponse>;
      addBookmark: (
        item: ResearchBookmarkPayload,
        options?: ResearchRequestOptions
      ) => Promise<ResearchBookmarkMutationResponse>;
      removeBookmark: (bookmarkId: string, options?: ResearchRequestOptions) => Promise<ResearchBookmarkMutationResponse>;
      getPurchasePrice: (
        platform: ResearchPlatform,
        itemId: string,
        options?: ResearchRequestOptions
      ) => Promise<ResearchPurchasePrice>;
      savePurchasePrice: (
        payload: ResearchPurchasePricePayload,
        options?: ResearchRequestOptions
      ) => Promise<{ success: boolean; localOnly?: boolean }>;
      getPurchasePricesBatch: (
        platform: ResearchPlatform,
        itemIds: string[],
        options?: ResearchRequestOptions
      ) => Promise<ResearchPurchasePriceMap>;
    };
    chrome?: MinimalChromeApi;
  }
}

const DEFAULT_APP_URL = "https://furimanager.app.furimakaikei.com";
const LEGACY_APP_URLS = new Set([
  "https://furimanager.com",
  "https://www.furimanager.com",
  "https://furimanager.furimakaikei.com"
]);
// chrome.runtime.getManifest() が取れない環境向けのフォールバック。ここを "unknown" に
// すると、サーバ側の最小バージョン検証 (compareVersions) が必ず負になり 426
// extension_update_required で固定的に弾かれるため、実バージョンを埋めておく。
// manifest.json の version と揃えて更新する。
const EXTENSION_FALLBACK_VERSION = "0.2.5";
const RESEARCH_API_TIMEOUT_MS = 30000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const LOCAL_PURCHASE_PRICE_STORAGE_KEY = "furimaneResearchPurchasePrices";
const SITE_CONFIG_STORAGE_KEY = "furimaneResearchSiteConfig";
const RESEARCH_SESSION_STORAGE_KEY = "furimaneResearchSessionId";
const SITE_CONFIG_TTL_MS = 24 * 60 * 60 * 1000;
const RESEARCH_API_SCHEMA = "research-v1";
const DEFAULT_SITE_CONFIG: ResearchSiteConfig = {
  version: 0,
  platform: "mercari",
  config: {
    listingLinkSelectors: {
      mercari: 'a[href*="/item/"]',
      mercari_shops: 'a[href*="/shops/product/"]'
    },
    pricePattern: "(?:[¥￥]\\s*([\\d,]+)|([\\d,]+)\\s*円)",
    soldTabTexts: ["販売済み", "売り切れ", "売却済み", "sold"],
    domTextMaxLength: 500,
    maxItems: 1000,
    autoMore: { maxClicks: 5 }
  }
};
const ANALYZE_RAW_ITEM_KEYS = [
  "id", "item_id", "itemId", "name", "title", "item_name", "itemName",
  "price", "amount", "sold_price", "soldPrice",
  "status", "item_status", "itemStatus", "__furimane_request_status",
  "created", "created_at", "createdAt", "updated", "updated_at", "updatedAt",
  "sold_at", "soldAt", "purchased_at", "purchasedAt",
  "thumbnails", "photos", "images",
  "thumbnail_url", "thumbnailUrl", "image_url", "imageUrl", "photo_url", "photoUrl",
  "item_url", "itemUrl", "url", "webUrl",
  "seller_id", "sellerId", "seller_name", "sellerName",
  "pager_id", "pagerId"
] as const;
const ANALYZE_NESTED_KEYS = ["item", "itemData", "item_data", "itemDetail", "item_detail", "listing", "product"] as const;
const ANALYZE_IMAGE_KEYS = ["url", "src", "thumbnail_url", "thumbnailUrl"] as const;

function hasSavedPurchasePrice(price: ResearchPurchasePrice | undefined) {
  return price?.purchasePrice != null || price?.shippingFee != null;
}

function getAppUrl() {
  const configuredUrl = String(window.FurimanagerConfig?.APP_URL ?? "").trim().replace(/\/+$/, "");
  return !configuredUrl || LEGACY_APP_URLS.has(configuredUrl) ? DEFAULT_APP_URL : configuredUrl;
}

function getChromeStorage(keys: string[]) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    if (!window.chrome?.storage?.local) {
      resolve({});
      return;
    }

    window.chrome.storage.local.get(keys, (result) => {
      if (window.chrome?.runtime?.lastError) {
        reject(new Error(window.chrome.runtime.lastError.message));
        return;
      }

      resolve(result);
    });
  });
}

function setChromeStorage(values: Record<string, unknown>) {
  return new Promise<void>((resolve, reject) => {
    if (!window.chrome?.storage?.local) {
      resolve();
      return;
    }

    window.chrome.storage.local.set(values, () => {
      if (window.chrome?.runtime?.lastError) {
        reject(new Error(window.chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function getLocalPurchasePriceKey(platform: ResearchPlatform, itemId: string) {
  return `${platform}:${itemId}`;
}

function normalizeLocalPurchasePrice(value: unknown): ResearchPurchasePrice | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<ResearchPurchasePrice>;
  const purchasePrice = typeof item.purchasePrice === "number" && Number.isFinite(item.purchasePrice)
    ? Math.round(item.purchasePrice)
    : null;
  const shippingFee = typeof item.shippingFee === "number" && Number.isFinite(item.shippingFee)
    ? Math.round(item.shippingFee)
    : null;

  if (purchasePrice === null) {
    return null;
  }

  return {
    purchasePrice,
    shippingFee: shippingFee ?? 0,
    savedAt: typeof item.savedAt === "string" ? item.savedAt : undefined
  };
}

async function getLocalPurchasePriceStore() {
  const storage = await getChromeStorage([LOCAL_PURCHASE_PRICE_STORAGE_KEY]);
  const rawStore = storage[LOCAL_PURCHASE_PRICE_STORAGE_KEY];

  return rawStore && typeof rawStore === "object" && !Array.isArray(rawStore)
    ? rawStore as Record<string, unknown>
    : {};
}

async function getLocalPurchasePrice(platform: ResearchPlatform, itemId: string) {
  const store = await getLocalPurchasePriceStore();
  return normalizeLocalPurchasePrice(store[getLocalPurchasePriceKey(platform, itemId)]);
}

async function saveLocalPurchasePrice(payload: ResearchPurchasePricePayload) {
  const store = await getLocalPurchasePriceStore();
  store[getLocalPurchasePriceKey(payload.platform, payload.itemId)] = {
    purchasePrice: payload.purchasePrice,
    shippingFee: payload.shippingFee,
    savedAt: new Date().toISOString()
  };

  await setChromeStorage({
    [LOCAL_PURCHASE_PRICE_STORAGE_KEY]: store
  });
}

async function getLocalPurchasePricesBatch(platform: ResearchPlatform, itemIds: string[]) {
  const store = await getLocalPurchasePriceStore();
  const result: ResearchPurchasePriceMap = {};

  for (const itemId of itemIds) {
    const value = normalizeLocalPurchasePrice(store[getLocalPurchasePriceKey(platform, itemId)]);

    if (value) {
      result[itemId] = value;
    }
  }

  return result;
}

function getSupabaseConfig() {
  const supabaseUrl = String(window.FurimanagerConfig?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supabaseAnonKey = String(window.FurimanagerConfig?.SUPABASE_ANON_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("auth_required");
  }

  return { supabaseUrl, supabaseAnonKey };
}

function shouldRefreshToken(expiresAt: unknown) {
  return typeof expiresAt === "number" && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

async function refreshAccessToken(storage: Record<string, unknown>) {
  const refreshToken = typeof storage.supabaseRefreshToken === "string" ? storage.supabaseRefreshToken : null;

  if (!refreshToken) {
    return null;
  }

  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: unknown;
  } | null;

  if (!response.ok || !data?.access_token) {
    const latestStorage = await getChromeStorage([
      "supabaseAccessToken",
      "supabaseRefreshToken",
      "supabaseUser",
      "supabaseTokenExpiresAt"
    ]);
    const latestAccessToken =
      typeof latestStorage.supabaseAccessToken === "string" ? latestStorage.supabaseAccessToken.trim() : "";
    const latestRefreshToken =
      typeof latestStorage.supabaseRefreshToken === "string" ? latestStorage.supabaseRefreshToken : null;

    if (latestAccessToken && !shouldRefreshToken(latestStorage.supabaseTokenExpiresAt)) {
      return latestAccessToken;
    }

    if (latestRefreshToken && latestRefreshToken !== refreshToken) {
      return refreshAccessToken(latestStorage);
    }

    return null;
  }

  const tokenExpiresAt =
    typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : null;

  await setChromeStorage({
    supabaseAccessToken: data.access_token,
    supabaseRefreshToken: data.refresh_token || refreshToken,
    supabaseUser: data.user || storage.supabaseUser || null,
    supabaseTokenExpiresAt: tokenExpiresAt
  });

  return data.access_token;
}

async function getAccessToken() {
  const storage = await getChromeStorage([
    "supabaseAccessToken",
    "supabaseRefreshToken",
    "supabaseUser",
    "supabaseTokenExpiresAt"
  ]);
  const accessToken = storage.supabaseAccessToken;

  if (shouldRefreshToken(storage.supabaseTokenExpiresAt)) {
    return refreshAccessToken(storage);
  }

  if (typeof accessToken === "string" && accessToken.trim()) {
    return accessToken.trim();
  }

  return refreshAccessToken(storage);
}

function createResearchRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createResearchSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getExtensionVersion() {
  return window.chrome?.runtime?.getManifest?.().version ?? EXTENSION_FALLBACK_VERSION;
}

function getExtensionId() {
  return window.chrome?.runtime?.id ?? "unknown";
}

async function getResearchSessionId() {
  const storage = await getChromeStorage([RESEARCH_SESSION_STORAGE_KEY]);
  const currentSessionId = storage[RESEARCH_SESSION_STORAGE_KEY];

  if (typeof currentSessionId === "string" && currentSessionId.trim()) {
    return currentSessionId.trim();
  }

  const sessionId = createResearchSessionId();
  await setChromeStorage({ [RESEARCH_SESSION_STORAGE_KEY]: sessionId });
  return sessionId;
}

async function buildResearchRequestHeaders(accessToken: string, inputHeaders?: HeadersInit) {
  const headers = new Headers(inputHeaders);
  headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  headers.set("Accept", headers.get("Accept") || "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("X-Furimane-Client", "chrome-extension");
  headers.set("X-Furimane-Extension-Version", getExtensionVersion());
  headers.set("X-Furimane-Extension-Id", getExtensionId());
  headers.set("X-Furimane-Request-Id", createResearchRequestId());
  headers.set("X-Furimane-Api-Schema", RESEARCH_API_SCHEMA);
  headers.set("X-Furimane-Session-Id", await getResearchSessionId());

  return headers;
}

async function requestJson<T>(path: string, options: RequestInit & ResearchRequestOptions = {}) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("auth_required");
  }

  const headers = await buildResearchRequestHeaders(accessToken, options.headers);

  const response = await fetch(`${getAppUrl()}${path}`, {
    ...options,
    headers,
    credentials: "omit"
  });

  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    throw createResearchApiError(response, data, "リサーチAPIの呼び出しに失敗しました。");
  }

  return data as T;
}

async function requestJsonSafe<T>(path: string, options: RequestInit & ResearchRequestOptions = {}) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("auth_required");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RESEARCH_API_TIMEOUT_MS);
  const abortHandler = () => controller.abort();

  options.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const headers = await buildResearchRequestHeaders(accessToken, options.headers);
    const response = await fetch(`${getAppUrl()}${path}`, {
      ...options,
      headers,
      credentials: "omit",
      signal: controller.signal
    });

    const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

    if (!response.ok) {
      const apiError = createResearchApiError(response, data, "api_request_failed");
      console.error("[furimane-research] api request failed", {
        path,
        status: response.status,
        error: apiError.message
      });
      throw apiError;
    }

    return data as T;
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "ResearchApiError"
    ) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      console.error("[furimane-research] api timeout", { path });
      throw new Error("api_timeout");
    }

    console.error("[furimane-research] api request error", { path, error });
    throw new Error("network_error");
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortHandler);
  }
}

function getApiErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object" || !("error" in data)) {
    return fallback;
  }

  const error = (data as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function getApiErrorCode(response: Response, data: unknown, fallback: string) {
  const message = getApiErrorMessage(data, fallback);

  if (response.status === 401) {
    return "auth_required";
  }

  if (response.status === 403) {
    return "plan_required";
  }

  if (response.status === 413) {
    return "payload_too_large";
  }

  if (response.status === 426) {
    return "extension_update_required";
  }

  if (response.status === 429) {
    return message === "research_monthly_limit_exceeded" ? message : "rate_limited";
  }

  if (response.status === 503) {
    return "research_temporarily_disabled";
  }

  return message;
}

function createResearchApiError(response: Response, data: unknown, fallback: string) {
  const apiError = new Error(getApiErrorCode(response, data, fallback)) as Error & {
    status?: number;
    retryAfter?: number | null;
  };
  const retryAfter = Number(response.headers.get("retry-after"));
  apiError.name = "ResearchApiError";
  apiError.status = response.status;
  apiError.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
  return apiError;
}

async function checkAccess(options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchAccessResponse>("/api/research/check-access", {
    method: "GET",
    signal: options.signal
  });
}

async function checkCache(
  sellerId: string,
  platform: ResearchPlatform = "mercari",
  options: ResearchRequestOptions = {}
) {
  const params = new URLSearchParams({
    platform,
    sellerId
  });

  return requestJsonSafe<ResearchCacheResponse>(`/api/research/cache?${params.toString()}`, {
    method: "GET",
    signal: options.signal
  });
}

async function saveResearchData(
  seller: ResearchSellerPayload,
  listings: ResearchListingPayload[],
  options: ResearchRequestOptions = {}
) {
  return requestJsonSafe<ResearchImportResponse>("/api/research/import", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ seller, listings })
  });
}

async function getSiteConfig(platform: ResearchPlatform = "mercari", options: ResearchRequestOptions = {}) {
  try {
    const storage = await getChromeStorage([SITE_CONFIG_STORAGE_KEY]);
    const store = storage[SITE_CONFIG_STORAGE_KEY] && typeof storage[SITE_CONFIG_STORAGE_KEY] === "object"
      ? storage[SITE_CONFIG_STORAGE_KEY] as Record<string, { fetchedAt?: unknown; data?: ResearchSiteConfig }>
      : {};
    const cached = store[platform];

    if (cached?.data && typeof cached.fetchedAt === "number" && Date.now() - cached.fetchedAt < SITE_CONFIG_TTL_MS) {
      return cached.data;
    }

    const params = new URLSearchParams({ platform });
    const data = await requestJsonSafe<ResearchSiteConfig>(`/api/research/site-config?${params.toString()}`, {
      method: "GET",
      signal: options.signal
    });

    await setChromeStorage({
      [SITE_CONFIG_STORAGE_KEY]: {
        ...store,
        [platform]: {
          fetchedAt: Date.now(),
          data
        }
      }
    });

    return data;
  } catch (error) {
    console.warn("[furimane-research] site config fetch failed; using default", error);
    return DEFAULT_SITE_CONFIG;
  }
}

async function analyzeResearchData(payload: ResearchAnalyzePayload, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchAnalyzeResponse>("/api/research/analyze", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(payload)
  });
}

async function simulateProfit(payload: ResearchSimulatorPayload, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchSimulatorResponse>("/api/research/simulate", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(payload)
  });
}

function trimImageValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return ANALYZE_IMAGE_KEYS.reduce<Record<string, unknown>>((result, key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      result[key] = (value as Record<string, unknown>)[key];
    }

    return result;
  }, {});
}

function trimRawItemForAnalyze(rawItem: unknown, includeNested = true): Record<string, unknown> | null {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return null;
  }

  const source = rawItem as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of ANALYZE_RAW_ITEM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    if (["thumbnails", "photos", "images"].includes(key) && Array.isArray(source[key])) {
      result[key] = source[key].slice(0, 3).map(trimImageValue).filter(Boolean);
      continue;
    }

    result[key] = source[key];
  }

  // 現在のメルカリ API (data[]) の確定キーを、フリマネ側の正規形にもそろえる。
  // 元キーも残すため、旧形式と既存の解析処理はそのまま利用できる。
  if (!Object.prototype.hasOwnProperty.call(result, "item_id") && Object.prototype.hasOwnProperty.call(source, "id")) {
    result.item_id = source.id;
  }

  if (!Object.prototype.hasOwnProperty.call(result, "title") && Object.prototype.hasOwnProperty.call(source, "name")) {
    result.title = source.name;
  }

  if (includeNested) {
    for (const key of ANALYZE_NESTED_KEYS) {
      const nested = source[key];

      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        result[key] = trimRawItemForAnalyze(nested, false);
      }
    }
  }

  return result;
}

function trimRawItemsForAnalyze(rawItems: unknown[]) {
  return Array.isArray(rawItems)
    ? rawItems.slice(0, 1000).map((item) => trimRawItemForAnalyze(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function buildDomItemForAnalyze(input: Partial<ResearchDomAnalyzeItem>, maxTextLength = 500): ResearchDomAnalyzeItem {
  return {
    item_url: String(input?.item_url ?? ""),
    text: String(input?.text ?? "").slice(0, maxTextLength),
    image_alt: input?.image_alt ?? null,
    aria_label: input?.aria_label ?? null,
    thumbnail_url: input?.thumbnail_url ?? null
  };
}

async function saveSeller(seller: ResearchSellerPayload, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchSellerSaveResponse>("/api/research/sellers/save", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ seller })
  });
}

async function getBookmarks(options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchBookmarksResponse>("/api/research/bookmark", {
    method: "GET",
    signal: options.signal
  });
}

async function addBookmark(item: ResearchBookmarkPayload, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchBookmarkMutationResponse>("/api/research/bookmark", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(item)
  });
}

async function removeBookmark(bookmarkId: string, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<ResearchBookmarkMutationResponse>(`/api/research/bookmark/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
    signal: options.signal
  });
}

async function getPurchasePrice(platform: ResearchPlatform, itemId: string, options: ResearchRequestOptions = {}) {
  const params = new URLSearchParams({
    platform,
    itemId
  });

  try {
    return await requestJsonSafe<ResearchPurchasePrice>(`/api/research/purchase-price?${params.toString()}`, {
      method: "GET",
      signal: options.signal
    });
  } catch (error) {
    console.warn("[furimane-research] purchase price API fetch failed; using local fallback", error);
    return await getLocalPurchasePrice(platform, itemId) ?? { purchasePrice: null, shippingFee: null };
  }
}

async function savePurchasePrice(payload: ResearchPurchasePricePayload, options: ResearchRequestOptions = {}) {
  try {
    return await requestJsonSafe<{ success: boolean }>("/api/research/purchase-price", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("[furimane-research] purchase price API save failed; saved locally", error);
    await saveLocalPurchasePrice(payload);
    return { success: true, localOnly: true };
  }
}

async function getPurchasePricesBatch(
  platform: ResearchPlatform,
  itemIds: string[],
  options: ResearchRequestOptions = {}
) {
  let serverPrices: ResearchPurchasePriceMap = {};

  try {
    serverPrices = await requestJsonSafe<ResearchPurchasePriceMap>("/api/research/purchase-prices/batch", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ platform, itemIds })
    });
  } catch (error) {
    console.warn("[furimane-research] purchase prices batch API failed; using local fallback", error);
  }

  const localPrices = await getLocalPurchasePricesBatch(platform, itemIds);

  return itemIds.reduce<ResearchPurchasePriceMap>((result, itemId) => {
    const serverPrice = serverPrices[itemId];
    const localPrice = localPrices[itemId];
    result[itemId] = hasSavedPurchasePrice(serverPrice)
      ? serverPrice
      : localPrice ?? serverPrice ?? { purchasePrice: null, shippingFee: null };
    return result;
  }, {});
}

window.FurimanagerResearchApi = {
  getAppUrl,
  checkAccess,
  checkCache,
  saveResearchData,
  getSiteConfig,
  analyzeResearchData,
  simulateProfit,
  trimRawItemsForAnalyze,
  buildDomItemForAnalyze,
  saveSeller,
  getBookmarks,
  addBookmark,
  removeBookmark,
  getPurchasePrice,
  savePurchasePrice,
  getPurchasePricesBatch
};

export {};
