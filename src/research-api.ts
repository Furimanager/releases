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
  thumbnail_url: string | null;
  item_url: string | null;
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
};

type ResearchBookmarkPayload = {
  platform: ResearchPlatform;
  item_id: string;
  title: string;
  price: number;
  thumbnail_url: string | null;
  item_url: string | null;
};

type ResearchRequestOptions = {
  signal?: AbortSignal;
};

type ResearchAccessResponse = {
  canUse?: boolean;
  canUseResearch: boolean;
  hasAddon?: boolean;
  expiresAt?: string | null;
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
    lastError?: {
      message?: string;
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
      ) => Promise<{ success: boolean }>;
      getPurchasePricesBatch: (
        platform: ResearchPlatform,
        itemIds: string[],
        options?: ResearchRequestOptions
      ) => Promise<ResearchPurchasePriceMap>;
    };
    chrome?: MinimalChromeApi;
  }
}

const DEFAULT_APP_URL = "https://furimanager.com";
const RESEARCH_API_TIMEOUT_MS = 30000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function getAppUrl() {
  return (window.FurimanagerConfig?.APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "");
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

async function requestJson<T>(path: string, options: RequestInit & ResearchRequestOptions = {}) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("auth_required");
  }

  const response = await fetch(`${getAppUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {})
    },
    credentials: "omit"
  });

  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    const message = data && "error" in data && data.error ? data.error : "リサーチAPIの呼び出しに失敗しました。";
    throw new Error(message);
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
    const response = await fetch(`${getAppUrl()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers ?? {})
      },
      credentials: "omit",
      signal: controller.signal
    });

    const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

    if (!response.ok) {
      const message = data && "error" in data && data.error ? data.error : "api_request_failed";
      const errorCode = response.status === 401 ? "auth_required" : response.status === 403 ? "plan_required" : message;
      console.error("[furimane-research] api request failed", {
        path,
        status: response.status,
        error: message
      });
      const apiError = new Error(errorCode);
      apiError.name = "ResearchApiError";
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

  return requestJsonSafe<ResearchPurchasePrice>(`/api/research/purchase-price?${params.toString()}`, {
    method: "GET",
    signal: options.signal
  });
}

async function savePurchasePrice(payload: ResearchPurchasePricePayload, options: ResearchRequestOptions = {}) {
  return requestJsonSafe<{ success: boolean }>("/api/research/purchase-price", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(payload)
  });
}

async function getPurchasePricesBatch(
  platform: ResearchPlatform,
  itemIds: string[],
  options: ResearchRequestOptions = {}
) {
  return requestJsonSafe<ResearchPurchasePriceMap>("/api/research/purchase-prices/batch", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ platform, itemIds })
  });
}

window.FurimanagerResearchApi = {
  getAppUrl,
  checkAccess,
  checkCache,
  saveResearchData,
  saveSeller,
  getBookmarks,
  addBookmark,
  removeBookmark,
  getPurchasePrice,
  savePurchasePrice,
  getPurchasePricesBatch
};

export {};
