const SCRAPE_STORAGE_KEYS = ["lastFetchDate", "lastItemId", "lastFetchedCount"];
const AUTH_STORAGE_KEYS = [
  "supabaseAccessToken",
  "supabaseRefreshToken",
  "supabaseUser",
  "supabaseTokenExpiresAt"
];
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_APP_URL = "https://furimanager.com";

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
const rakurakuTaskState = document.getElementById("rakurakuTaskState");
const rakurakuModeText = document.getElementById("rakurakuModeText");
const rakurakuModeBadge = document.getElementById("rakurakuModeBadge");
const rakurakuEmptyState = document.getElementById("rakurakuEmptyState");
const rakurakuAutoPollState = document.getElementById("rakurakuAutoPollState");
const rakurakuAutoPollToggleButton = document.getElementById("rakurakuAutoPollToggleButton");
const rakurakuExecutionModeSelect = document.getElementById("rakurakuExecutionModeSelect");
const rakurakuTaskCheckButton = document.getElementById("rakurakuTaskCheckButton");
const rakurakuTaskPanel = document.getElementById("rakurakuTaskPanel");
const rakurakuTaskTitle = document.getElementById("rakurakuTaskTitle");
const rakurakuTaskPrice = document.getElementById("rakurakuTaskPrice");
const rakurakuTaskStatus = document.getElementById("rakurakuTaskStatus");
const rakurakuTaskStartButton = document.getElementById("rakurakuTaskStartButton");
const rakurakuWebOpenButton = document.getElementById("rakurakuWebOpenButton");

const authState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  tokenExpiresAt: null
};
let currentRakurakuTask = null;
let currentRakurakuApprovalCandidate = null;
let rakurakuAutoPollEnabled = true;
let currentRakurakuMode = null;
const RAKURAKU_EXECUTION_MODE_KEY = "rakurakuExecutionMode";

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
  const hasRakurakuAction = Boolean(currentRakurakuTask || currentRakurakuApprovalCandidate);

  loginForm.hidden = loggedIn;
  sessionPanel.hidden = !loggedIn;
  scrapeAndSendButton.disabled = !loggedIn;
  if (rakurakuTaskCheckButton) {
    rakurakuTaskCheckButton.disabled = !loggedIn;
  }
  if (rakurakuTaskStartButton) {
    rakurakuTaskStartButton.disabled = !loggedIn || !hasRakurakuAction;
  }

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

  if (rakurakuTaskCheckButton) {
    rakurakuTaskCheckButton.disabled = disabled || !isLoggedIn();
  }

  if (rakurakuTaskStartButton) {
    rakurakuTaskStartButton.disabled = disabled || !isLoggedIn() || !(currentRakurakuTask || currentRakurakuApprovalCandidate);
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

function getAppBaseUrl() {
  const appUrl = String(window.FurimanagerConfig?.APP_URL || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
  return appUrl;
}

function formatYen(value) {
  if (typeof value !== "number") {
    return "金額未取得";
  }

  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(value);
}

function formatRakurakuMode(mode) {
  return mode === "full_auto" ? "全自動モード" : "半自動モード";
}

function renderRakurakuMode(mode) {
  if (mode !== "full_auto" && mode !== "semi_auto") {
    currentRakurakuMode = null;

    if (rakurakuModeText) {
      rakurakuModeText.textContent = "未確認";
    }

    if (rakurakuModeBadge) {
      rakurakuModeBadge.textContent = "-";
    }

    return;
  }

  currentRakurakuMode = mode;

  if (rakurakuModeText) {
    rakurakuModeText.textContent = formatRakurakuMode(currentRakurakuMode);
  }

  if (rakurakuModeBadge) {
    rakurakuModeBadge.textContent = currentRakurakuMode === "full_auto" ? "全自動" : "半自動";
  }
}

function setRakurakuEmptyState(text) {
  currentRakurakuTask = null;
  currentRakurakuApprovalCandidate = null;

  if (rakurakuTaskState) {
    rakurakuTaskState.textContent = "待機中 0件";
  }

  if (rakurakuTaskPanel) {
    rakurakuTaskPanel.hidden = true;
  }

  if (rakurakuEmptyState) {
    rakurakuEmptyState.hidden = false;
    rakurakuEmptyState.textContent = text;
  }

  if (rakurakuTaskStartButton) {
    rakurakuTaskStartButton.hidden = true;
    rakurakuTaskStartButton.disabled = true;
  }
}

function renderRakurakuTask(task) {
  currentRakurakuTask = task || null;
  currentRakurakuApprovalCandidate = null;

  if (!rakurakuTaskState || !rakurakuTaskPanel) {
    return;
  }

  if (!task) {
    setRakurakuEmptyState(currentRakurakuMode === "full_auto" ? "自動処理待ちタスクはありません。" : "承認待ち候補はありません。");
    return;
  }

  const payload = task.payload || {};
  rakurakuTaskState.textContent = task.status === "pending" ? "待機中 1件" : `最新タスク：${task.status || "状態不明"}`;
  rakurakuTaskPanel.hidden = false;

  if (rakurakuEmptyState) {
    rakurakuEmptyState.hidden = true;
  }

  if (rakurakuTaskTitle) {
    rakurakuTaskTitle.textContent = payload.title || "商品名未取得";
  }

  if (rakurakuTaskPrice) {
    rakurakuTaskPrice.textContent = formatYen(payload.soldPrice);
  }

  if (rakurakuTaskStatus) {
    rakurakuTaskStatus.textContent = task.status || "pending";
  }

  if (rakurakuTaskStartButton) {
    rakurakuTaskStartButton.hidden = true;
    rakurakuTaskStartButton.disabled = !isLoggedIn();
  }
}

function renderRakurakuApprovalCandidate(candidate) {
  currentRakurakuTask = null;
  currentRakurakuApprovalCandidate = candidate || null;

  if (!rakurakuTaskState || !rakurakuTaskPanel) {
    return;
  }

  if (!candidate) {
    renderRakurakuTask(null);
    return;
  }

  rakurakuTaskState.textContent = "承認待ち 1件";
  rakurakuTaskPanel.hidden = false;

  if (rakurakuEmptyState) {
    rakurakuEmptyState.hidden = true;
  }

  if (rakurakuTaskTitle) {
    rakurakuTaskTitle.textContent = candidate.title || "商品名未取得";
  }

  if (rakurakuTaskPrice) {
    rakurakuTaskPrice.textContent = formatYen(candidate.sold_price);
  }

  if (rakurakuTaskStatus) {
    rakurakuTaskStatus.textContent = "承認待ち";
  }

  if (rakurakuTaskStartButton) {
    rakurakuTaskStartButton.hidden = false;
    rakurakuTaskStartButton.textContent = "許可して開始";
    rakurakuTaskStartButton.disabled = !isLoggedIn();
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function renderRakurakuAutoPollState(enabled, isRunningTask = false) {
  rakurakuAutoPollEnabled = enabled !== false;

  if (rakurakuAutoPollState) {
    rakurakuAutoPollState.textContent = isRunningTask
      ? "自動チェック：実行中"
      : `自動チェック：${rakurakuAutoPollEnabled ? "ON" : "OFF"}`;
  }

  if (rakurakuAutoPollToggleButton) {
    rakurakuAutoPollToggleButton.textContent = rakurakuAutoPollEnabled ? "OFFにする" : "ONにする";
    rakurakuAutoPollToggleButton.disabled = false;
  }
}

async function loadRakurakuAutoPollState() {
  try {
    const response = await sendRuntimeMessage({ type: "GET_RAKURAKU_AUTO_POLL_STATE" });
    renderRakurakuAutoPollState(response?.enabled !== false, response?.isRunningTask === true);
  } catch (error) {
    if (rakurakuAutoPollState) {
      rakurakuAutoPollState.textContent = "自動チェック：確認失敗";
    }
    console.warn("[furimane-rakuraku] auto poll state failed", error);
  }
}

async function handleRakurakuAutoPollToggle() {
  if (rakurakuAutoPollToggleButton) {
    rakurakuAutoPollToggleButton.disabled = true;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "SET_RAKURAKU_AUTO_POLL_ENABLED",
      enabled: !rakurakuAutoPollEnabled
    });
    renderRakurakuAutoPollState(response?.enabled !== false, response?.isRunningTask === true);
  } catch (error) {
    if (rakurakuAutoPollState) {
      rakurakuAutoPollState.textContent = "自動チェック：切替失敗";
    }
    console.warn("[furimane-rakuraku] auto poll toggle failed", error);
  } finally {
    if (rakurakuAutoPollToggleButton) {
      rakurakuAutoPollToggleButton.disabled = false;
    }
  }
}

async function loadRakurakuExecutionMode() {
  try {
    if (rakurakuExecutionModeSelect) {
      rakurakuExecutionModeSelect.value = "real";
    }
    await setLocalStorage({ [RAKURAKU_EXECUTION_MODE_KEY]: "real" });
  } catch (error) {
    console.warn("[furimane-rakuraku] execution mode load failed", error);
  }
}

async function handleRakurakuExecutionModeChange() {
  await setLocalStorage({ [RAKURAKU_EXECUTION_MODE_KEY]: "real" });
}

async function fetchAppApi(path, options = {}) {
  if (!(await ensureFreshAuthSession())) {
    authState.accessToken = null;
  }

  if (!authState.accessToken) {
    throw new Error("ログインしてから操作してください");
  }

  const requestUrl = `${getAppBaseUrl()}${path}`;
  const credentialsMode = "include";
  let response;

  try {
    response = await fetch(requestUrl, {
      ...options,
      credentials: credentialsMode,
      headers: {
        Authorization: `Bearer ${authState.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    console.error("[furimane-rakuraku] api request exception", {
      requestUrl,
      credentials: credentialsMode,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : null
    });
    throw error;
  }

  const responseText = await response.text();
  let data = null;

  if (responseText.trim()) {
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      data = null;
    }
  }

  console.log("[furimane-rakuraku] api response", {
    requestUrl,
    status: response.status,
    ok: response.ok,
    credentials: credentialsMode,
    responseText
  });

  if (!response.ok || data?.success === false) {
    throw new Error(`API failed: ${response.status} ${responseText || data?.error || "empty response"}`);
  }

  return data;
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

function isDuplicateSyncErrorMessage(message) {
  const normalizedMessage = String(message || "").toLowerCase();

  return (
    normalizedMessage.includes("duplicate key value violates unique constraint") ||
    normalizedMessage.includes("transactions_user_external_unique")
  );
}

function getUserFacingSyncErrorMessage(error) {
  const defaultMessage = "不明なエラーが発生しました";
  const message = error instanceof Error ? error.message : defaultMessage;

  if (isDuplicateSyncErrorMessage(message)) {
    return "すでに全て取得済みです。これ以上取得できません。";
  }

  return message;
}

function getTokenExpiresAt(expiresIn) {
  return typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : null;
}

function shouldRefreshAuthToken(expiresAt) {
  return typeof expiresAt === "number" && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

async function persistAuthSession(data, fallbackRefreshToken = null, fallbackUser = null) {
  const tokenExpiresAt = getTokenExpiresAt(data.expires_in);

  authState.accessToken = data.access_token;
  authState.refreshToken = data.refresh_token || fallbackRefreshToken || null;
  authState.user = data.user || fallbackUser || null;
  authState.tokenExpiresAt = tokenExpiresAt;

  await setLocalStorage({
    supabaseAccessToken: authState.accessToken,
    supabaseRefreshToken: authState.refreshToken,
    supabaseUser: authState.user,
    supabaseTokenExpiresAt: authState.tokenExpiresAt
  });
}

async function refreshSupabaseSession() {
  if (!authState.refreshToken) {
    return false;
  }

  const latestStorage = await getLocalStorage(AUTH_STORAGE_KEYS);
  const latestRefreshToken =
    typeof latestStorage.supabaseRefreshToken === "string" ? latestStorage.supabaseRefreshToken : null;
  if (
    latestRefreshToken &&
    latestRefreshToken !== authState.refreshToken &&
    applyAuthStateFromStorage(latestStorage) &&
    !shouldRefreshAuthToken(authState.tokenExpiresAt)
  ) {
    return true;
  }
  if (latestRefreshToken && latestRefreshToken !== authState.refreshToken) {
    applyAuthStateFromStorage(latestStorage);
  }

  const { url, anonKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: authState.refreshToken })
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    const fallbackStorage = await getLocalStorage(AUTH_STORAGE_KEYS);
    if (
      fallbackStorage.supabaseRefreshToken &&
      fallbackStorage.supabaseRefreshToken !== authState.refreshToken &&
      applyAuthStateFromStorage(fallbackStorage)
    ) {
      if (!shouldRefreshAuthToken(authState.tokenExpiresAt)) {
        return true;
      }

      return refreshSupabaseSession();
    }

    return false;
  }

  await persistAuthSession(data, authState.refreshToken, authState.user);

  return isLoggedIn();
}

async function ensureFreshAuthSession() {
  if (authState.refreshToken && (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))) {
    return refreshSupabaseSession();
  }

  return isLoggedIn();
}

function applyAuthStateFromStorage(storageState) {
  const tokenExpiresAt =
    typeof storageState.supabaseTokenExpiresAt === "number"
      ? storageState.supabaseTokenExpiresAt
      : null;

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
  let hasSession = applyAuthStateFromStorage(storageState);

  if (
    authState.refreshToken &&
    (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))
  ) {
    hasSession = await refreshSupabaseSession();
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

  await persistAuthSession(data);
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

function resolveShippingCostForInsert(item) {
  const shippingFee =
    typeof item?.shippingFee === "number"
      ? item.shippingFee
      : typeof item?.shippingCost === "number"
        ? item.shippingCost
        : null;
  const classification =
    typeof item?.shippingFeeClassification === "string" && item.shippingFeeClassification
      ? item.shippingFeeClassification
      : shippingFee !== null
        ? "unknown_numeric"
        : "unknown";

  if (classification === "buyer_paid" || classification === "buyer_cash_on_delivery") {
    return 0;
  }

  if (
    classification === "seller_paid" ||
    classification === "seller_included" ||
    classification === "unknown_numeric"
  ) {
    return shippingFee ?? 0;
  }

  return 0;
}

function convertItemToTransactionInsert(item) {
  if (typeof item?.soldPrice !== "number") {
    return null;
  }

  return {
    platform: "mercari",
    item_name: item.itemName || "",
    sold_price: item.soldPrice,
    shipping_cost: resolveShippingCostForInsert(item),
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

  if (!(await ensureFreshAuthSession())) {
    authState.accessToken = null;
  }

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
        value: getUserFacingSyncErrorMessage(error)
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function loadRakurakuPendingTaskPreview() {
  if (!isLoggedIn()) {
    renderRakurakuMode(null);
    setRakurakuEmptyState("ログイン後に状態を確認します。");
    return;
  }

  try {
    const settingsData = await fetchAppApi("/api/rakuraku/settings");
    const mode = settingsData?.settings?.automationMode === "full_auto" ? "full_auto" : "semi_auto";
    renderRakurakuMode(mode);

    const data = await fetchAppApi("/api/automation/tasks/next");
    if (data?.task) {
      renderRakurakuTask(data.task);
      return;
    }

    if (mode === "semi_auto") {
      const approvalCandidate = await loadRakurakuApprovalCandidatePreview();

      if (!approvalCandidate) {
        setRakurakuEmptyState("承認待ち候補はありません。");
      }

      return;
    }

    setRakurakuEmptyState("自動処理待ちタスクはありません。");
  } catch (error) {
    setRakurakuEmptyState("状態の取得に失敗しました。時間をおいてもう一度開いてください。");
    console.warn("[furimane-rakuraku] pending task preview failed", error);
  }
}

async function loadRakurakuApprovalCandidatePreview() {
  const data = await fetchAppApi("/api/rakuraku/relist-candidates?status=pending");
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  renderRakurakuApprovalCandidate(candidate || null);
  return candidate || null;
}

async function handleRakurakuTaskCheck() {
  setActionButtonsDisabled(true);

  if (rakurakuTaskState) {
    rakurakuTaskState.textContent = "確認中";
  }

  try {
    const backgroundResult = await sendRuntimeMessage({ type: "POLL_RAKURAKU_NOW" });

    console.log("[furimane-rakuraku] background poll result", backgroundResult);

    if (!backgroundResult?.success) {
      throw new Error(backgroundResult?.message || "background poll failed");
    }

    renderRakurakuAutoPollState(rakurakuAutoPollEnabled, backgroundResult?.isRunningTask === true);
    renderRakurakuTask(backgroundResult.task || null);

    if (backgroundResult.task) {
      const payload = backgroundResult.task.payload || {};
      console.log("[furimane-rakuraku] pending task", {
        id: backgroundResult.task.id,
        title: payload.title,
        soldPrice: payload.soldPrice,
        status: backgroundResult.task.status
      });
    } else {
      const approvalCandidate = await loadRakurakuApprovalCandidatePreview();

      if (approvalCandidate) {
        setStatus("success", "承認待ち候補あり", [
          { label: "商品名", value: approvalCandidate.title || "商品名未取得" },
          { label: "価格", value: formatYen(approvalCandidate.sold_price) },
          { label: "操作", value: "許可して開始を押すと再出品タスクを作成します" }
        ]);
        return;
      }

      const diagnostics = backgroundResult.diagnostics || {};
      const latestTask = diagnostics.latestTask || null;
      const statusCounts = Object.entries(diagnostics.statusCounts || {})
        .map(([status, count]) => `${status}:${count}`)
        .join(", ");

      setStatus("success", "待機中タスクなし", [
        { label: "理由", value: backgroundResult.reason || "no_pending_task" },
        { label: "認証ユーザー", value: diagnostics.authenticatedUserId || authState.user?.id || "不明" },
        { label: "状態別件数", value: statusCounts || "relistタスクなし" },
        { label: "最新タスク", value: latestTask ? `${latestTask.status || "状態不明"} / ${latestTask.id}` : "なし" }
      ]);
    }
  } catch (error) {
    renderRakurakuTask(null);
    if (rakurakuTaskState) {
      rakurakuTaskState.textContent = "取得失敗";
    }
    setStatus("error", "タスク取得に失敗", [
      { label: "詳細", value: error instanceof Error ? error.message : "不明なエラーが発生しました" }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleRakurakuTaskStart() {
  if (!currentRakurakuTask?.id && !currentRakurakuApprovalCandidate?.id) {
    return;
  }

  setActionButtonsDisabled(true);

  try {
    if (currentRakurakuApprovalCandidate?.id) {
      const candidate = currentRakurakuApprovalCandidate;
      await fetchAppApi(`/api/rakuraku/relist-candidates/${candidate.id}/approve`, { method: "POST" });

      const backgroundResult = await sendRuntimeMessage({ type: "POLL_RAKURAKU_NOW" });

      if (!backgroundResult?.success) {
        throw new Error(backgroundResult?.message || "background poll failed");
      }

      renderRakurakuTask(backgroundResult.task || null);
      setStatus("success", "許可して実行しました", [
        { label: "候補ID", value: candidate.id },
        { label: "結果", value: backgroundResult.reason || "started" }
      ]);
      return;
    }

    const backgroundResult = await sendRuntimeMessage({ type: "POLL_RAKURAKU_NOW" });

    if (!backgroundResult?.success) {
      throw new Error(backgroundResult?.message || "background poll failed");
    }

    renderRakurakuTask(backgroundResult.task || {
      ...currentRakurakuTask,
      status: "running"
    });
    setStatus("success", "タスクを実行しました", [
      { label: "タスクID", value: currentRakurakuTask.id },
      { label: "実行モード", value: rakurakuExecutionModeSelect?.value || "dry-run" }
    ]);
  } catch (error) {
    setStatus("error", "タスク開始に失敗", [
      { label: "詳細", value: error instanceof Error ? error.message : "不明なエラーが発生しました" }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

function handleOpenRakurakuWeb() {
  chrome.tabs.create({ url: `${getAppBaseUrl()}/dashboard/rakuraku/relist-candidates`, active: true });
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
    await loadRakurakuAutoPollState();
    await loadRakurakuExecutionMode();
    await loadRakurakuPendingTaskPreview();
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
rakurakuTaskCheckButton?.addEventListener("click", () => {
  void handleRakurakuTaskCheck();
});
rakurakuTaskStartButton?.addEventListener("click", () => {
  void handleRakurakuTaskStart();
});
rakurakuWebOpenButton?.addEventListener("click", () => {
  handleOpenRakurakuWeb();
});
rakurakuAutoPollToggleButton?.addEventListener("click", () => {
  void handleRakurakuAutoPollToggle();
});
rakurakuExecutionModeSelect?.addEventListener("change", () => {
  void handleRakurakuExecutionModeChange();
});

void initializePopup();
