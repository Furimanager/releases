const FURIMANE_DEFAULT_APP_URL = "http://localhost:3000";
const FURIMANE_RESEARCH_API_TIMEOUT_MS = 30000;

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

async function getFurimaneAccessToken() {
  const storage = await getFurimaneChromeStorage(["supabaseAccessToken"]);
  const accessToken = storage.supabaseAccessToken;

  if (typeof accessToken === "string" && accessToken.trim()) {
    return accessToken.trim();
  }

  return null;
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

  return requestFurimaneResearchJsonSafe(`/api/research/purchase-price?${params.toString()}`, {
    method: "GET",
    signal: options.signal
  });
}

async function saveFurimaneResearchPurchasePrice(payload, options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/purchase-price", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(payload)
  });
}

async function getFurimaneResearchPurchasePricesBatch(platform, itemIds, options = {}) {
  return requestFurimaneResearchJsonSafe("/api/research/purchase-prices/batch", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ platform, itemIds })
  });
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
