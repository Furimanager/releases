const FURIMANE_DEFAULT_APP_URL = "https://furimanager.com";
const FURIMANE_RESEARCH_API_TIMEOUT_MS = 30000;
const FURIMANE_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FURIMANE_LOCAL_PURCHASE_PRICE_STORAGE_KEY = "furimaneResearchPurchasePrices";

function getFurimaneAppUrl() {
  return (window.FurimanagerConfig?.APP_URL ?? FURIMANE_DEFAULT_APP_URL).replace(/\/$/, "");
}

function getFurimaneChromeStorage(keys) {
  return new Promise((resolve, reject) => {
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

function setFurimaneChromeStorage(values) {
  return new Promise((resolve, reject) => {
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

function getFurimaneLocalPurchasePriceKey(platform, itemId) {
  return `${platform}:${itemId}`;
}

function normalizeFurimaneLocalPurchasePrice(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const purchasePrice = typeof value.purchasePrice === "number" && Number.isFinite(value.purchasePrice)
    ? Math.round(value.purchasePrice)
    : null;
  const shippingFee = typeof value.shippingFee === "number" && Number.isFinite(value.shippingFee)
    ? Math.round(value.shippingFee)
    : null;

  if (purchasePrice === null) {
    return null;
  }

  return {
    purchasePrice,
    shippingFee: shippingFee ?? 0,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : undefined
  };
}

async function getFurimaneLocalPurchasePriceStore() {
  const storage = await getFurimaneChromeStorage([FURIMANE_LOCAL_PURCHASE_PRICE_STORAGE_KEY]);
  const rawStore = storage[FURIMANE_LOCAL_PURCHASE_PRICE_STORAGE_KEY];

  return rawStore && typeof rawStore === "object" && !Array.isArray(rawStore)
    ? rawStore
    : {};
}

async function getFurimaneLocalPurchasePrice(platform, itemId) {
  const store = await getFurimaneLocalPurchasePriceStore();
  return normalizeFurimaneLocalPurchasePrice(store[getFurimaneLocalPurchasePriceKey(platform, itemId)]);
}

async function saveFurimaneLocalPurchasePrice(payload) {
  const store = await getFurimaneLocalPurchasePriceStore();
  store[getFurimaneLocalPurchasePriceKey(payload.platform, payload.itemId)] = {
    purchasePrice: payload.purchasePrice,
    shippingFee: payload.shippingFee,
    savedAt: new Date().toISOString()
  };

  await setFurimaneChromeStorage({
    [FURIMANE_LOCAL_PURCHASE_PRICE_STORAGE_KEY]: store
  });
}

async function getFurimaneLocalPurchasePricesBatch(platform, itemIds) {
  const store = await getFurimaneLocalPurchasePriceStore();
  const result = {};

  for (const itemId of itemIds) {
    const value = normalizeFurimaneLocalPurchasePrice(store[getFurimaneLocalPurchasePriceKey(platform, itemId)]);

    if (value) {
      result[itemId] = value;
    }
  }

  return result;
}

function getFurimaneSupabaseConfig() {
  const supabaseUrl = String(window.FurimanagerConfig?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supabaseAnonKey = String(window.FurimanagerConfig?.SUPABASE_ANON_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("auth_required");
  }

  return { supabaseUrl, supabaseAnonKey };
}

function shouldRefreshFurimaneToken(expiresAt) {
  return typeof expiresAt === "number" && Date.now() >= expiresAt - FURIMANE_TOKEN_REFRESH_MARGIN_MS;
}

async function refreshFurimaneAccessToken(storage) {
  const refreshToken = typeof storage.supabaseRefreshToken === "string" ? storage.supabaseRefreshToken : null;

  if (!refreshToken) {
    return null;
  }

  const { supabaseUrl, supabaseAnonKey } = getFurimaneSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    const latestStorage = await getFurimaneChromeStorage([
      "supabaseAccessToken",
      "supabaseRefreshToken",
      "supabaseUser",
      "supabaseTokenExpiresAt"
    ]);
    const latestAccessToken =
      typeof latestStorage.supabaseAccessToken === "string" ? latestStorage.supabaseAccessToken.trim() : "";
    const latestRefreshToken =
      typeof latestStorage.supabaseRefreshToken === "string" ? latestStorage.supabaseRefreshToken : null;

    if (latestAccessToken && !shouldRefreshFurimaneToken(latestStorage.supabaseTokenExpiresAt)) {
      return latestAccessToken;
    }

    if (latestRefreshToken && latestRefreshToken !== refreshToken) {
      return refreshFurimaneAccessToken(latestStorage);
    }

    return null;
  }

  const tokenExpiresAt =
    typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : null;

  await setFurimaneChromeStorage({
    supabaseAccessToken: data.access_token,
    supabaseRefreshToken: data.refresh_token || refreshToken,
    supabaseUser: data.user || storage.supabaseUser || null,
    supabaseTokenExpiresAt: tokenExpiresAt
  });

  return data.access_token;
}

async function getFurimaneAccessToken() {
  const storage = await getFurimaneChromeStorage([
    "supabaseAccessToken",
    "supabaseRefreshToken",
    "supabaseUser",
    "supabaseTokenExpiresAt"
  ]);
  const accessToken = storage.supabaseAccessToken;
  const expiresAt = storage.supabaseTokenExpiresAt;

  if (shouldRefreshFurimaneToken(expiresAt)) {
    return refreshFurimaneAccessToken(storage);
  }

  if (typeof accessToken === "string" && accessToken.trim()) {
    return accessToken.trim();
  }

  return refreshFurimaneAccessToken(storage);
}

async function requestFurimaneResearchJson(path, options = {}) {
  const accessToken = await getFurimaneAccessToken();

  if (!accessToken) {
    throw new Error("auth_required");
  }

  const response = await fetch(`${getFurimaneAppUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {})
    },
    credentials: "omit"
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error || "リサーチAPIの呼び出しに失敗しました。";
    throw new Error(message);
  }

  return data;
}

async function requestFurimaneResearchJsonSafe(path, options = {}) {
  const accessToken = await getFurimaneAccessToken();

  if (!accessToken) {
    throw new Error("auth_required");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FURIMANE_RESEARCH_API_TIMEOUT_MS);
  const abortHandler = () => controller.abort();

  options.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(`${getFurimaneAppUrl()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers ?? {})
      },
      credentials: "omit",
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = data?.error || "api_request_failed";
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

    return data;
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

async function checkFurimaneResearchAccess(options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/check-access", {
    method: "GET",
    signal: options.signal
  });
}

function resolveFurimaneResearchPlatformAndOptions(platformOrOptions, maybeOptions) {
  if (typeof platformOrOptions === "string") {
    return {
      platform: platformOrOptions,
      options: maybeOptions ?? {}
    };
  }

  return {
    platform: "mercari",
    options: platformOrOptions ?? {}
  };
}

async function checkFurimaneResearchCache(sellerId, platformOrOptions = "mercari", maybeOptions = {}) {
  const { platform, options } = resolveFurimaneResearchPlatformAndOptions(platformOrOptions, maybeOptions);
  const params = new URLSearchParams({
    platform,
    sellerId
  });

  return requestFurimaneResearchJsonSafe(`/api/research/cache?${params.toString()}`, {
    method: "GET",
    signal: options.signal
  });
}

async function saveFurimaneResearchData(seller, listings, options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/import", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ seller, listings })
  });
}

async function saveFurimaneResearchSeller(seller, options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/sellers/save", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ seller })
  });
}

async function getFurimaneResearchBookmarks(options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/bookmark", {
    method: "GET",
    signal: options.signal
  });
}

async function addFurimaneResearchBookmark(item, options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/bookmark", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(item)
  });
}

async function removeFurimaneResearchBookmark(bookmarkId, options = {}) {
  return requestFurimaneResearchJsonSafe(`/api/research/bookmark/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
    signal: options.signal
  });
}

async function getFurimaneResearchPurchasePrice(platform, itemId, options = {}) {
  const params = new URLSearchParams({
    platform,
    itemId
  });

  try {
    return await requestFurimaneResearchJsonSafe(`/api/research/purchase-price?${params.toString()}`, {
      method: "GET",
      signal: options.signal
    });
  } catch (error) {
    console.warn("[furimane-research] purchase price API fetch failed; using local fallback", error);
    return await getFurimaneLocalPurchasePrice(platform, itemId) ?? { purchasePrice: null, shippingFee: null };
  }
}

async function saveFurimaneResearchPurchasePrice(payload, options = {}) {
  try {
    return await requestFurimaneResearchJsonSafe("/api/research/purchase-price", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("[furimane-research] purchase price API save failed; saved locally", error);
    await saveFurimaneLocalPurchasePrice(payload);
    return { success: true, localOnly: true };
  }
}

async function getFurimaneResearchPurchasePricesBatch(platform, itemIds, options = {}) {
  let serverPrices = {};

  try {
    serverPrices = await requestFurimaneResearchJsonSafe("/api/research/purchase-prices/batch", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ platform, itemIds })
    });
  } catch (error) {
    console.warn("[furimane-research] purchase prices batch API failed; using local fallback", error);
  }

  return {
    ...serverPrices,
    ...await getFurimaneLocalPurchasePricesBatch(platform, itemIds)
  };
}

window.FurimanagerResearchApi = {
  getAppUrl: getFurimaneAppUrl,
  checkAccess: checkFurimaneResearchAccess,
  checkCache: checkFurimaneResearchCache,
  saveResearchData: saveFurimaneResearchData,
  saveSeller: saveFurimaneResearchSeller,
  getBookmarks: getFurimaneResearchBookmarks,
  addBookmark: addFurimaneResearchBookmark,
  removeBookmark: removeFurimaneResearchBookmark,
  getPurchasePrice: getFurimaneResearchPurchasePrice,
  savePurchasePrice: saveFurimaneResearchPurchasePrice,
  getPurchasePricesBatch: getFurimaneResearchPurchasePricesBatch
};
