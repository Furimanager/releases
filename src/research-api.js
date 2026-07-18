(() => {
  const DEFAULT_APP_URL = "https://furimanager.com";
  const RESEARCH_API_TIMEOUT_MS = 3e4;
  const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1e3;
  const LOCAL_PURCHASE_PRICE_STORAGE_KEY = "furimaneResearchPurchasePrices";
  const SITE_CONFIG_STORAGE_KEY = "furimaneResearchSiteConfig";
  const RESEARCH_SESSION_STORAGE_KEY = "furimaneResearchSessionId";
  const SITE_CONFIG_TTL_MS = 24 * 60 * 60 * 1e3;
  const RESEARCH_API_SCHEMA = "research-v1";
  const DEFAULT_SITE_CONFIG = {
    version: 0,
    platform: "mercari",
    config: {
      listingLinkSelectors: {
        mercari: 'a[href*="/item/"]',
        mercari_shops: 'a[href*="/shops/product/"]'
      },
      pricePattern: "(?:[\xA5\uFFE5]\\s*([\\d,]+)|([\\d,]+)\\s*\u5186)",
      soldTabTexts: ["\u8CA9\u58F2\u6E08\u307F", "\u58F2\u308A\u5207\u308C", "\u58F2\u5374\u6E08\u307F", "sold"],
      domTextMaxLength: 500,
      maxItems: 1e3,
      autoMore: { maxClicks: 5 }
    }
  };
  const ANALYZE_RAW_ITEM_KEYS = [
    "id",
    "item_id",
    "itemId",
    "name",
    "title",
    "item_name",
    "itemName",
    "price",
    "amount",
    "sold_price",
    "soldPrice",
    "status",
    "item_status",
    "itemStatus",
    "__furimane_request_status",
    "created",
    "created_at",
    "createdAt",
    "updated",
    "updated_at",
    "updatedAt",
    "sold_at",
    "soldAt",
    "purchased_at",
    "purchasedAt",
    "thumbnails",
    "photos",
    "images",
    "thumbnail_url",
    "thumbnailUrl",
    "image_url",
    "imageUrl",
    "photo_url",
    "photoUrl",
    "item_url",
    "itemUrl",
    "url",
    "webUrl",
    "seller_id",
    "sellerId",
    "seller_name",
    "sellerName",
    "pager_id",
    "pagerId"
  ];
  const ANALYZE_NESTED_KEYS = ["item", "itemData", "item_data", "itemDetail", "item_detail", "listing", "product"];
  const ANALYZE_IMAGE_KEYS = ["url", "src", "thumbnail_url", "thumbnailUrl"];
  function hasSavedPurchasePrice(price) {
    return price?.purchasePrice != null || price?.shippingFee != null;
  }
  function getAppUrl() {
    return (window.FurimanagerConfig?.APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "");
  }
  function getChromeStorage(keys) {
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
  function setChromeStorage(values) {
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
  function getLocalPurchasePriceKey(platform, itemId) {
    return `${platform}:${itemId}`;
  }
  function normalizeLocalPurchasePrice(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const item = value;
    const purchasePrice = typeof item.purchasePrice === "number" && Number.isFinite(item.purchasePrice) ? Math.round(item.purchasePrice) : null;
    const shippingFee = typeof item.shippingFee === "number" && Number.isFinite(item.shippingFee) ? Math.round(item.shippingFee) : null;
    if (purchasePrice === null) {
      return null;
    }
    return {
      purchasePrice,
      shippingFee: shippingFee ?? 0,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : void 0
    };
  }
  async function getLocalPurchasePriceStore() {
    const storage = await getChromeStorage([LOCAL_PURCHASE_PRICE_STORAGE_KEY]);
    const rawStore = storage[LOCAL_PURCHASE_PRICE_STORAGE_KEY];
    return rawStore && typeof rawStore === "object" && !Array.isArray(rawStore) ? rawStore : {};
  }
  async function getLocalPurchasePrice(platform, itemId) {
    const store = await getLocalPurchasePriceStore();
    return normalizeLocalPurchasePrice(store[getLocalPurchasePriceKey(platform, itemId)]);
  }
  async function saveLocalPurchasePrice(payload) {
    const store = await getLocalPurchasePriceStore();
    store[getLocalPurchasePriceKey(payload.platform, payload.itemId)] = {
      purchasePrice: payload.purchasePrice,
      shippingFee: payload.shippingFee,
      savedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setChromeStorage({
      [LOCAL_PURCHASE_PRICE_STORAGE_KEY]: store
    });
  }
  async function getLocalPurchasePricesBatch(platform, itemIds) {
    const store = await getLocalPurchasePriceStore();
    const result = {};
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
  function shouldRefreshToken(expiresAt) {
    return typeof expiresAt === "number" && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
  }
  async function refreshAccessToken(storage) {
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
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      const latestStorage = await getChromeStorage([
        "supabaseAccessToken",
        "supabaseRefreshToken",
        "supabaseUser",
        "supabaseTokenExpiresAt"
      ]);
      const latestAccessToken = typeof latestStorage.supabaseAccessToken === "string" ? latestStorage.supabaseAccessToken.trim() : "";
      const latestRefreshToken = typeof latestStorage.supabaseRefreshToken === "string" ? latestStorage.supabaseRefreshToken : null;
      if (latestAccessToken && !shouldRefreshToken(latestStorage.supabaseTokenExpiresAt)) {
        return latestAccessToken;
      }
      if (latestRefreshToken && latestRefreshToken !== refreshToken) {
        return refreshAccessToken(latestStorage);
      }
      return null;
    }
    const tokenExpiresAt = typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1e3 : null;
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
    return window.chrome?.runtime?.getManifest?.().version ?? "unknown";
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
  async function buildResearchRequestHeaders(accessToken, inputHeaders) {
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
  async function requestJsonSafe(path, options = {}) {
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
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = createResearchApiError(response, data, "api_request_failed");
        console.error("[furimane-research] api request failed", {
          path,
          status: response.status,
          error: apiError.message
        });
        throw apiError;
      }
      return data;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      if (error instanceof Error && error.name === "ResearchApiError") {
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
  function getApiErrorMessage(data, fallback) {
    if (!data || typeof data !== "object" || !("error" in data)) {
      return fallback;
    }
    const error = data.error;
    return typeof error === "string" && error.trim() ? error : fallback;
  }
  function getApiErrorCode(response, data, fallback) {
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
  function createResearchApiError(response, data, fallback) {
    const apiError = new Error(getApiErrorCode(response, data, fallback));
    const retryAfter = Number(response.headers.get("retry-after"));
    apiError.name = "ResearchApiError";
    apiError.status = response.status;
    apiError.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    return apiError;
  }
  async function checkAccess(options = {}) {
    return requestJsonSafe("/api/research/check-access", {
      method: "GET",
      signal: options.signal
    });
  }
  async function checkCache(sellerId, platform = "mercari", options = {}) {
    const params = new URLSearchParams({
      platform,
      sellerId
    });
    return requestJsonSafe(`/api/research/cache?${params.toString()}`, {
      method: "GET",
      signal: options.signal
    });
  }
  async function saveResearchData(seller, listings, options = {}) {
    return requestJsonSafe("/api/research/import", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ seller, listings })
    });
  }
  async function getSiteConfig(platform = "mercari", options = {}) {
    try {
      const storage = await getChromeStorage([SITE_CONFIG_STORAGE_KEY]);
      const store = storage[SITE_CONFIG_STORAGE_KEY] && typeof storage[SITE_CONFIG_STORAGE_KEY] === "object" ? storage[SITE_CONFIG_STORAGE_KEY] : {};
      const cached = store[platform];
      if (cached?.data && typeof cached.fetchedAt === "number" && Date.now() - cached.fetchedAt < SITE_CONFIG_TTL_MS) {
        return cached.data;
      }
      const params = new URLSearchParams({ platform });
      const data = await requestJsonSafe(`/api/research/site-config?${params.toString()}`, {
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
  async function analyzeResearchData(payload, options = {}) {
    return requestJsonSafe("/api/research/analyze", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(payload)
    });
  }
  async function simulateProfit(payload, options = {}) {
    return requestJsonSafe("/api/research/simulate", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(payload)
    });
  }
  function trimImageValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return ANALYZE_IMAGE_KEYS.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        result[key] = value[key];
      }
      return result;
    }, {});
  }
  function trimRawItemForAnalyze(rawItem, includeNested = true) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return null;
    }
    const source = rawItem;
    const result = {};
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
  function trimRawItemsForAnalyze(rawItems) {
    return Array.isArray(rawItems) ? rawItems.slice(0, 1e3).map((item) => trimRawItemForAnalyze(item)).filter((item) => Boolean(item)) : [];
  }
  function buildDomItemForAnalyze(input, maxTextLength = 500) {
    return {
      item_url: String(input?.item_url ?? ""),
      text: String(input?.text ?? "").slice(0, maxTextLength),
      image_alt: input?.image_alt ?? null,
      aria_label: input?.aria_label ?? null,
      thumbnail_url: input?.thumbnail_url ?? null
    };
  }
  async function saveSeller(seller, options = {}) {
    return requestJsonSafe("/api/research/sellers/save", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ seller })
    });
  }
  async function getBookmarks(options = {}) {
    return requestJsonSafe("/api/research/bookmark", {
      method: "GET",
      signal: options.signal
    });
  }
  async function addBookmark(item, options = {}) {
    return requestJsonSafe("/api/research/bookmark", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(item)
    });
  }
  async function removeBookmark(bookmarkId, options = {}) {
    return requestJsonSafe(`/api/research/bookmark/${encodeURIComponent(bookmarkId)}`, {
      method: "DELETE",
      signal: options.signal
    });
  }
  async function getPurchasePrice(platform, itemId, options = {}) {
    const params = new URLSearchParams({
      platform,
      itemId
    });
    try {
      return await requestJsonSafe(`/api/research/purchase-price?${params.toString()}`, {
        method: "GET",
        signal: options.signal
      });
    } catch (error) {
      console.warn("[furimane-research] purchase price API fetch failed; using local fallback", error);
      return await getLocalPurchasePrice(platform, itemId) ?? { purchasePrice: null, shippingFee: null };
    }
  }
  async function savePurchasePrice(payload, options = {}) {
    try {
      return await requestJsonSafe("/api/research/purchase-price", {
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
  async function getPurchasePricesBatch(platform, itemIds, options = {}) {
    let serverPrices = {};
    try {
      serverPrices = await requestJsonSafe("/api/research/purchase-prices/batch", {
        method: "POST",
        signal: options.signal,
        body: JSON.stringify({ platform, itemIds })
      });
    } catch (error) {
      console.warn("[furimane-research] purchase prices batch API failed; using local fallback", error);
    }
    const localPrices = await getLocalPurchasePricesBatch(platform, itemIds);
    return itemIds.reduce((result, itemId) => {
      const serverPrice = serverPrices[itemId];
      const localPrice = localPrices[itemId];
      result[itemId] = hasSavedPurchasePrice(serverPrice) ? serverPrice : localPrice ?? serverPrice ?? { purchasePrice: null, shippingFee: null };
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
})();
