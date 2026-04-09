const SCRAPE_STORAGE_KEYS = ["lastFetchDate", "lastItemId", "lastFetchedCount"];
const AUTH_STORAGE_KEYS = [
  "supabaseAccessToken",
  "supabaseRefreshToken",
  "supabaseUser",
  "supabaseTokenExpiresAt"
];

const statusText = document.getElementById("statusText");
const statusDetails = document.getElementById("statusDetails");
const pingButton = document.getElementById("pingButton");
const scrapeAllButton = document.getElementById("scrapeAllButton");
const resetDeltaStateButton = document.getElementById("resetDeltaStateButton");
const scrapeAndSendButton = document.getElementById("scrapeAndSendButton");

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const sessionPanel = document.getElementById("sessionPanel");
const sessionText = document.getElementById("sessionText");
const authStateText = document.getElementById("authStateText");
const authMessage = document.getElementById("authMessage");

const authState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  tokenExpiresAt: null
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(type, text, details = []) {
  statusText.textContent = text;
  statusText.className = `status-card__value status-card__value--${type}`;

  if (details.length === 0) {
    statusDetails.innerHTML = "";
    return;
  }

  statusDetails.innerHTML = details
    .map((detail) => {
      return `
        <div class="status-details__row">
          <dt>${escapeHtml(detail.label)}</dt>
          <dd>${escapeHtml(detail.value)}</dd>
        </div>
      `;
    })
    .join("");
}

function setAuthMessage(type, text) {
  authMessage.textContent = text;
  authMessage.className = `auth-message auth-message--${type}`;
}

function isLoggedIn() {
  return Boolean(authState.accessToken && authState.user);
}

function updateAuthUi() {
  const loggedIn = isLoggedIn();
  const userEmail = authState.user?.email || "メール不明";

  loginForm.hidden = loggedIn;
  sessionPanel.hidden = !loggedIn;
  scrapeAndSendButton.disabled = !loggedIn;

  authStateText.textContent = loggedIn ? "ログイン中" : "未ログイン";
  authStateText.className = loggedIn
    ? "auth-card__state auth-card__state--success"
    : "auth-card__state auth-card__state--idle";
  sessionText.textContent = loggedIn ? userEmail : "ログイン中";
}

function setActionButtonsDisabled(disabled) {
  if (pingButton) {
    pingButton.disabled = disabled;
  }

  if (scrapeAllButton) {
    scrapeAllButton.disabled = disabled;
  }

  if (resetDeltaStateButton) {
    resetDeltaStateButton.disabled = disabled;
  }

  if (scrapeAndSendButton) {
    scrapeAndSendButton.disabled = disabled || !isLoggedIn();
  }
}

function setAuthControlsDisabled(disabled) {
  emailInput.disabled = disabled;
  passwordInput.disabled = disabled;
  loginButton.disabled = disabled;
  logoutButton.disabled = disabled;
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const [tab] = tabs;

      if (!tab || typeof tab.id !== "number") {
        reject(new Error("アクティブなタブを取得できませんでした"));
        return;
      }

      resolve(tab);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function getLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result);
    });
  });
}

function setLocalStorage(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function removeLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function normalizeSupabaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getConfig() {
  const config = window.FurimanagerConfig;
  const url = normalizeSupabaseUrl(config?.SUPABASE_URL);
  const anonKey = String(config?.SUPABASE_ANON_KEY || "").trim();

  if (!url || !anonKey) {
    throw new Error("config.js の Supabase 設定が未入力です");
  }

  if (url.includes("YOUR_PROJECT") || anonKey.includes("YOUR_SUPABASE_ANON_KEY")) {
    throw new Error("config.js に Supabase の実値を入れてください");
  }

  return {
    url,
    anonKey
  };
}

async function runTabAction(action, extraMessage = {}) {
  const tab = await queryActiveTab();
  return sendMessageToTab(tab.id, { action, ...extraMessage });
}

function showActionError(title, response, fallbackMessage) {
  setStatus("error", title, [
    {
      label: "詳細",
      value: response?.message || fallbackMessage
    }
  ]);
}

function parseSupabaseError(data, fallbackMessage) {
  if (!data || typeof data !== "object") {
    return fallbackMessage;
  }

  return data.error_description || data.msg || data.message || data.error || fallbackMessage;
}

function applyAuthStateFromStorage(storageState) {
  const tokenExpiresAt =
    typeof storageState.supabaseTokenExpiresAt === "number"
      ? storageState.supabaseTokenExpiresAt
      : null;
  const hasExpired = tokenExpiresAt ? Date.now() >= tokenExpiresAt : false;

  if (hasExpired) {
    authState.accessToken = null;
    authState.refreshToken = null;
    authState.user = null;
    authState.tokenExpiresAt = null;
    return false;
  }

  authState.accessToken =
    typeof storageState.supabaseAccessToken === "string" ? storageState.supabaseAccessToken : null;
  authState.refreshToken =
    typeof storageState.supabaseRefreshToken === "string" ? storageState.supabaseRefreshToken : null;
  authState.user = storageState.supabaseUser && typeof storageState.supabaseUser === "object"
    ? storageState.supabaseUser
    : null;
  authState.tokenExpiresAt = tokenExpiresAt;

  return isLoggedIn();
}

async function restoreAuthState() {
  const storageState = await getLocalStorage(AUTH_STORAGE_KEYS);
  const hasSession = applyAuthStateFromStorage(storageState);

  if (!hasSession && storageState.supabaseAccessToken) {
    await removeLocalStorage(AUTH_STORAGE_KEYS);
  }

  updateAuthUi();
  setAuthMessage(hasSession ? "success" : "idle", hasSession ? "ログイン状態を復元しました" : "未ログインです");
}

async function loginToSupabase(email, password) {
  const { url, anonKey } = getConfig();

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(parseSupabaseError(data, "ログインに失敗しました"));
  }

  if (!data?.access_token || !data?.user) {
    throw new Error("ログイン結果の取得に失敗しました");
  }

  const tokenExpiresAt =
    typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : null;

  authState.accessToken = data.access_token;
  authState.refreshToken = data.refresh_token || null;
  authState.user = data.user;
  authState.tokenExpiresAt = tokenExpiresAt;

  await setLocalStorage({
    supabaseAccessToken: authState.accessToken,
    supabaseRefreshToken: authState.refreshToken,
    supabaseUser: authState.user,
    supabaseTokenExpiresAt: authState.tokenExpiresAt
  });
}

async function logoutFromSupabase() {
  authState.accessToken = null;
  authState.refreshToken = null;
  authState.user = null;
  authState.tokenExpiresAt = null;

  await removeLocalStorage(AUTH_STORAGE_KEYS);
}

function parseSoldAtTextToDate(soldAtText) {
  if (typeof soldAtText !== "string") {
    return null;
  }

  const matched = soldAtText.trim().match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

  if (!matched) {
    return null;
  }

  const [, year, month, day] = matched;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function convertItemToTransactionInsert(item) {
  if (typeof item?.soldPrice !== "number") {
    return null;
  }

  return {
    platform: "mercari",
    item_name: item.itemName || "",
    sold_price: item.soldPrice,
    platform_fee_rate: 0.1,
    sold_at: parseSoldAtTextToDate(item.soldAtText),
    external_id: item.mercariTransactionId || null
  };
}

function buildInsertPayload(items) {
  return items
    .map((item) => convertItemToTransactionInsert(item))
    .filter((record) => record !== null)
    .map((record) => {
      return {
        ...record,
        user_id: authState.user?.id || null
      };
    });
}

async function insertTransactions(records) {
  const { url, anonKey } = getConfig();

  if (!authState.accessToken) {
    throw new Error("ログインしてから送信してください");
  }

  const response = await fetch(`${url}/rest/v1/transactions`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${authState.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(records)
  });

  const rawText = await response.text();
  let parsed = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch (_error) {
      parsed = null;
    }
  }

  console.log("status:", response.status);
  console.log("raw:", rawText);

  if (parsed !== null) {
    console.log("json:", parsed);
  }

  if (response.ok) {
    return;
  }

  throw new Error(parseSupabaseError(parsed || rawText, "transactions 送信に失敗しました"));
}

async function saveScrapeState(lastItemId, count) {
  await setLocalStorage({
    lastFetchDate: new Date().toISOString(),
    lastItemId,
    lastFetchedCount: count
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    setAuthMessage("error", "メールアドレスとパスワードを入力してください");
    return;
  }

  setAuthControlsDisabled(true);
  setAuthMessage("idle", "ログイン中...");

  try {
    await loginToSupabase(email, password);
    passwordInput.value = "";
    updateAuthUi();
    setAuthMessage("success", "ログインしました");
  } catch (error) {
    updateAuthUi();
    setAuthMessage("error", error instanceof Error ? error.message : "ログインに失敗しました");
  } finally {
    setAuthControlsDisabled(false);
  }
}

async function handleLogout() {
  setAuthControlsDisabled(true);
  setAuthMessage("idle", "ログアウト中...");

  try {
    await logoutFromSupabase();
    updateAuthUi();
    setAuthMessage("idle", "ログアウトしました");
  } catch (error) {
    setAuthMessage("error", error instanceof Error ? error.message : "ログアウトに失敗しました");
  } finally {
    setAuthControlsDisabled(false);
  }
}

async function handlePing() {
  setActionButtonsDisabled(true);
  setStatus("idle", "確認中...");

  try {
    const response = await runTabAction("ping");

    if (!response || response.success !== true) {
      showActionError("接続失敗", response, "content script と通信できませんでした");
      return;
    }

    setStatus(
      response.isMercariSoldPage ? "success" : "error",
      response.isMercariSoldPage ? "接続OK" : "接続OK（対象外ページ）",
      [
        { label: "現在URL", value: response.currentUrl || "不明" },
        { label: "販売履歴ページ", value: response.isMercariSoldPage ? "はい" : "いいえ" },
        { label: "ページタイトル", value: response.title || "不明" }
      ]
    );
  } catch (error) {
    setStatus("error", "接続失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      },
      {
        label: "補足",
        value: "メルカリ販売履歴ページを開いた状態でお試しください"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleScrape() {
  setActionButtonsDisabled(true);
  setStatus("idle", "取得中...");

  try {
    const response = await runTabAction("scrape");

    if (!response || response.success !== true) {
      showActionError("取得失敗", response, "1ページ取得に失敗しました");
      return;
    }

    setStatus("success", "1ページ取得OK", [
      { label: "取得件数", value: response.count ?? 0 },
      { label: "先頭1件", value: response.items?.[0]?.itemName || "データなし" }
    ]);
  } catch (error) {
    setStatus("error", "取得失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      },
      {
        label: "補足",
        value: "メルカリ販売履歴ページを開いた状態でお試しください"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleScrapeAll() {
  setActionButtonsDisabled(true);
  setStatus("idle", "全ページ取得中...");

  try {
    const response = await runTabAction("scrapeAllPages");

    if (!response || response.success !== true) {
      showActionError("全ページ取得失敗", response, "全ページ取得に失敗しました");
      return;
    }

    setStatus("success", "全ページ取得OK", [
      { label: "総取得件数", value: response.count ?? 0 },
      { label: "先頭1件", value: response.items?.[0]?.itemName || "データなし" },
      { label: "読み込みページ数", value: response.pageCount ?? 0 },
      { label: "上限到達", value: response.reachedPageLimit ? "はい" : "いいえ" }
    ]);
  } catch (error) {
    setStatus("error", "全ページ取得失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      },
      {
        label: "補足",
        value: "メルカリ販売履歴ページを開いた状態でお試しください"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleScrapeDelta() {
  setActionButtonsDisabled(true);
  setStatus("idle", "差分取得中...");

  try {
    const storageState = await getLocalStorage(SCRAPE_STORAGE_KEYS);
    const previousLastItemId =
      typeof storageState.lastItemId === "string" && storageState.lastItemId.trim() !== ""
        ? storageState.lastItemId
        : null;

    const response = await runTabAction("scrapeDeltaPages", {
      lastItemId: previousLastItemId
    });

    if (!response || response.success !== true) {
      showActionError("差分取得失敗", response, "差分取得に失敗しました");
      return;
    }

    const nextLastItemId = response.newLastItemId || previousLastItemId || null;

    await saveScrapeState(nextLastItemId, response.count ?? 0);

    setStatus("success", "差分取得OK", [
      { label: "新規取得件数", value: response.count ?? 0 },
      { label: "先頭1件", value: response.items?.[0]?.itemName || "データなし" },
      { label: "読み込みページ数", value: response.pageCount ?? 0 },
      { label: "上限到達", value: response.reachedPageLimit ? "はい" : "いいえ" },
      { label: "保存lastItemId", value: nextLastItemId || "未設定" },
      { label: "取得モード", value: previousLastItemId ? "差分取得" : "初回取得" }
    ]);
  } catch (error) {
    setStatus("error", "差分取得失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      },
      {
        label: "補足",
        value: "メルカリ販売履歴ページを開いた状態でお試しください"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleResetDeltaState() {
  setActionButtonsDisabled(true);
  setStatus("idle", "差分状態をリセット中...");

  try {
    await removeLocalStorage(SCRAPE_STORAGE_KEYS);
    setStatus("success", "差分状態をリセットしました", [
      { label: "削除キー", value: SCRAPE_STORAGE_KEYS.join(", ") }
    ]);
  } catch (error) {
    setStatus("error", "リセット失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleScrapeAndSend() {
  if (!isLoggedIn()) {
    setStatus("error", "送信不可", [
      { label: "詳細", value: "Supabase にログインしてから送信してください" }
    ]);
    return;
  }

  setActionButtonsDisabled(true);
  setStatus("idle", "差分取得して送信中...");

  try {
    const storageState = await getLocalStorage(SCRAPE_STORAGE_KEYS);
    const previousLastItemId =
      typeof storageState.lastItemId === "string" && storageState.lastItemId.trim() !== ""
        ? storageState.lastItemId
        : null;

    const response = await runTabAction("scrapeDeltaPages", {
      lastItemId: previousLastItemId
    });

    if (!response || response.success !== true) {
      showActionError("送信失敗", response, "差分取得に失敗しました");
      return;
    }

    const nextLastItemId = response.newLastItemId || previousLastItemId || null;
    const records = buildInsertPayload(response.items || []);

    if (records.length > 0) {
      await insertTransactions(records);
    }

    await saveScrapeState(nextLastItemId, response.count ?? 0);

    setStatus("success", records.length > 0 ? "送信完了" : "送信対象なし", [
      { label: "差分取得件数", value: response.count ?? 0 },
      { label: "送信件数", value: records.length },
      { label: "先頭1件", value: response.items?.[0]?.itemName || "データなし" },
      { label: "読み込みページ数", value: response.pageCount ?? 0 },
      { label: "上限到達", value: response.reachedPageLimit ? "はい" : "いいえ" },
      { label: "保存lastItemId", value: nextLastItemId || "未設定" }
    ]);
  } catch (error) {
    // TODO: 送信失敗時の pendingItems 保持は今後の改善候補
    setStatus("error", "送信失敗", [
      {
        label: "詳細",
        value: error instanceof Error ? error.message : "不明なエラーが発生しました"
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function initializePopup() {
  setStatus("idle", "待機中");
  updateAuthUi();

  try {
    getConfig();
    setAuthMessage("idle", "ログイン情報を確認してください");
  } catch (error) {
    setAuthMessage("error", error instanceof Error ? error.message : "config.js を確認してください");
  }

  try {
    await restoreAuthState();
  } catch (error) {
    updateAuthUi();
    setAuthMessage("error", error instanceof Error ? error.message : "ログイン状態の復元に失敗しました");
  }
}

loginForm.addEventListener("submit", (event) => {
  void handleLoginSubmit(event);
});
logoutButton.addEventListener("click", () => {
  void handleLogout();
});
pingButton.addEventListener("click", () => {
  void handlePing();
});
scrapeAllButton?.addEventListener("click", () => {
  void handleScrapeAll();
});
resetDeltaStateButton?.addEventListener("click", () => {
  void handleResetDeltaState();
});
scrapeAndSendButton?.addEventListener("click", () => {
  void handleScrapeAndSend();
});

void initializePopup();
