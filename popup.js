const SCRAPE_STORAGE_KEYS = [
  "lastFetchDate",
  "lastItemId",
  "lastFetchedCount",
  "lastSyncedExternalIds",
  "gapSuspected"
];
const AUTH_STORAGE_KEYS = [
  "supabaseAccessToken",
  "supabaseRefreshToken",
  "supabaseUser",
  "supabaseTokenExpiresAt"
];
const TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000;
// Web 側の拡張連携ページ。Googleでログインした人はここ経由で拡張にログインする。
const EXTENSION_CONNECT_PATH = "/extension/connect";
const DEFAULT_APP_URL = "https://furimanager.app.furimakaikei.com";
const LEGACY_APP_URLS = new Set([
  "https://furimanager.com",
  "https://www.furimanager.com",
  "https://furimanager.furimakaikei.com"
]);
const RESEARCH_FEATURE_ENABLED_KEY = "furimaneResearchEnabled";
// 拡張ハートビート用。サーバー側の拡張バージョン検証に必要なヘッダ値。
// manifest.json の version と揃えて更新する。
const EXTENSION_FALLBACK_VERSION = "0.2.5";
const EXTENSION_API_SCHEMA = "research-v1";
const SALES_RECIPE_STORAGE_KEY = "mercariSalesRecipeCache";
const SYNC_ANCHOR_EXTERNAL_ID_LIMIT = 50;
const isLoginView = new URLSearchParams(window.location.search).get("view") === "login";

document.body.classList.toggle("login-view", isLoginView);
document.title = isLoginView ? "フリマネにログイン" : "フリマネージャー";

const statusText = document.getElementById("statusText");
const statusDetails = document.getElementById("statusDetails");
const statusHelpLink = document.getElementById("statusHelpLink");
const usageGuideLink = document.getElementById("usageGuideLink");
const pingButton = document.getElementById("pingButton");
const scrapeAllButton = document.getElementById("scrapeAllButton");
const resetDeltaStateButton = document.getElementById("resetDeltaStateButton");
const scrapeAndSendButton = document.getElementById("scrapeAndSendButton");

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("loginButton");
const googleLoginBlock = document.getElementById("googleLoginBlock");
const googleLoginButton = document.getElementById("googleLoginButton");
const logoutButton = document.getElementById("logoutButton");
const sessionPanel = document.getElementById("sessionPanel");
const sessionText = document.getElementById("sessionText");
const authStateText = document.getElementById("authStateText");
const authMessage = document.getElementById("authMessage");
const loginViewAuthTitle = document.getElementById("loginViewAuthTitle");
const loginViewAuthDescription = document.getElementById("loginViewAuthDescription");
const loginViewLoggedOutIcon = document.getElementById("loginViewLoggedOutIcon");
const loginViewLoggedInIcon = document.getElementById("loginViewLoggedInIcon");
const signupPrompt = document.getElementById("signupPrompt");
const signupLink = document.getElementById("signupLink");
const researchFeatureState = document.getElementById("researchFeatureState");
const researchFeatureToggle = document.getElementById("researchFeatureToggle");
const researchFeatureMessage = document.getElementById("researchFeatureMessage");
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
let rakurakuAutoPollEnabled = false;
let currentRakurakuMode = null;
let researchFeatureEnabled = false;
let isAuthStateReady = false;
const RAKURAKU_EXECUTION_MODE_KEY = "rakurakuExecutionMode";
const USER_FACING_SYSTEM_CODE_MESSAGES = {
  auth_required: "ログインが必要です。拡張機能にログインしてからもう一度お試しください。",
  full_auto_disabled: "全自動モードがOFFのため、自動実行は待機中です。",
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません。",
  no_pending_task: "待機中のタスクはありません。",
  plan_required: "この機能を使うにはプランの確認が必要です。",
  research_monthly_limit_exceeded: "今月の無料枠（20回）を使い切りました。友達紹介で+30回もらえます。",
  started: "処理を開始しました。",
  task_already_running: "別のタスクを実行中です。完了してからもう一度お試しください。"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 困ったときの案内先。マニュアル（/manual）はログインなしで読める公開ページ。
const MANUAL_SYNC_GUIDE_PATH = "/manual#setup/step-3";
const MANUAL_IMPORT_HELP = { label: "取り込めないときの確認方法", path: "/manual#faq/import" };
const MANUAL_LOGIN_HELP = { label: "ログインできないときは", path: "/manual#faq/login" };

function setStatusHelp(help) {
  if (!statusHelpLink) {
    return;
  }

  if (!help) {
    statusHelpLink.hidden = true;
    statusHelpLink.removeAttribute("href");
    statusHelpLink.textContent = "";
    return;
  }

  statusHelpLink.href = `${getAppBaseUrl()}${help.path}`;
  statusHelpLink.textContent = `${help.label} →`;
  statusHelpLink.hidden = false;
}

function setStatus(type, text, details = [], help = null) {
  statusText.textContent = text;
  statusText.className = `status-card__value status-card__value--${type}`;
  setStatusHelp(help);

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

function getRawErrorMessage(error, fallbackMessage = "不明なエラーが発生しました") {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  if (typeof error === "string") {
    return error || fallbackMessage;
  }

  return fallbackMessage;
}

function containsJapaneseText(value) {
  return /[ぁ-んァ-ヶ一-龠々]/.test(String(value || ""));
}

function getUserFacingSystemCodeMessage(value) {
  return USER_FACING_SYSTEM_CODE_MESSAGES[String(value || "")] || null;
}

function getUserFacingErrorMessage(error, fallbackMessage = "不明なエラーが発生しました") {
  const rawMessage = getRawErrorMessage(error, fallbackMessage);
  const normalizedMessage = rawMessage.toLowerCase();
  const systemCodeMessage = getUserFacingSystemCodeMessage(rawMessage);

  if (systemCodeMessage) {
    return systemCodeMessage;
  }

  if (
    normalizedMessage.includes("could not establish connection") ||
    normalizedMessage.includes("receiving end does not exist") ||
    normalizedMessage.includes("content script")
  ) {
    return "メルカリ販売履歴ページと通信できませんでした。";
  }

  if (normalizedMessage.includes("message port closed")) {
    return "ページとの通信が途中で切れました。メルカリ画面を再読み込みしてからもう一度お試しください。";
  }

  if (normalizedMessage.includes("extension context invalidated")) {
    return "拡張機能が更新されました。ポップアップを開き直してください。";
  }

  if (normalizedMessage.includes("no tab with id")) {
    return "操作中のタブを確認できませんでした。メルカリ販売履歴ページを開き直してください。";
  }

  if (normalizedMessage.includes("cannot access contents of url") || normalizedMessage.includes("chrome://")) {
    return "このページでは拡張機能を使えません。メルカリ販売履歴ページでお試しください。";
  }

  if (normalizedMessage.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "メール認証が完了していません。受信メールを確認してください。";
  }

  if (normalizedMessage.includes("failed to fetch") || normalizedMessage.includes("network")) {
    return "サーバーに接続できませんでした。通信状態を確認してからもう一度お試しください。";
  }

  if (normalizedMessage.includes("background poll failed")) {
    return "タスク確認処理が応答しませんでした。少し待ってからもう一度お試しください。";
  }

  if (!containsJapaneseText(rawMessage) && /[a-z]/i.test(rawMessage)) {
    return fallbackMessage;
  }

  return rawMessage;
}

function isLoggedIn() {
  return Boolean(authState.accessToken && authState.user);
}

function updateAuthUi() {
  const loggedIn = isLoggedIn();
  const userEmail = authState.user?.email || "メール不明";
  const hasRakurakuAction = Boolean(currentRakurakuTask || currentRakurakuApprovalCandidate);

  loginForm.hidden = loggedIn;

  if (googleLoginBlock) {
    googleLoginBlock.hidden = loggedIn;
  }

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
  signupPrompt.hidden = loggedIn || !isAuthStateReady;

  if (isLoginView) {
    loginViewLoggedOutIcon.hidden = loggedIn;
    loginViewLoggedInIcon.hidden = !loggedIn;
    loginViewAuthTitle.textContent = loggedIn ? "拡張機能にログイン済み" : "フリマネにログイン";
    loginViewAuthDescription.textContent = loggedIn
      ? "このアカウントでリサーチ機能を利用できます"
      : "登録済みアカウントでサインイン";
  }
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

  if (googleLoginButton) {
    googleLoginButton.disabled = disabled;
  }
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
    throw new Error("config.js のログイン設定が未入力です");
  }

  if (url.includes("YOUR_PROJECT") || anonKey.includes("YOUR_SUPABASE_ANON_KEY")) {
    throw new Error("config.js にログイン設定の実値を入れてください");
  }

  return {
    url,
    anonKey
  };
}

function getAppBaseUrl() {
  const configuredAppUrl = String(window.FurimanagerConfig?.APP_URL || "").trim().replace(/\/+$/, "");
  return !configuredAppUrl || LEGACY_APP_URLS.has(configuredAppUrl) ? DEFAULT_APP_URL : configuredAppUrl;
}

function isMercariSoldPageUrl(url) {
  if (typeof url !== "string") {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === "jp.mercari.com" && parsedUrl.pathname.startsWith("/mypage/listings/sold");
  } catch (_error) {
    return false;
  }
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

function formatRakurakuTaskStatus(status) {
  const statusLabels = {
    pending: "待機中",
    running: "実行中",
    manual_confirmation_required: "手動確認待ち",
    completed: "完了",
    succeeded: "完了",
    failed: "失敗",
    cancelled: "キャンセル済み"
  };

  return statusLabels[String(status || "")] || "状態不明";
}

function formatRakurakuTaskAction(action) {
  const actionLabels = {
    price_drop: "値下げ",
    relist: "再出品"
  };

  return actionLabels[String(action || "")] || "操作不明";
}

function formatRakurakuExecutionMode(mode) {
  const modeLabels = {
    "dry-run": "確認のみ",
    real: "実行"
  };

  return modeLabels[String(mode || "")] || "未設定";
}

function formatRakurakuReason(reason) {
  const systemCodeMessage = getUserFacingSystemCodeMessage(reason);

  if (systemCodeMessage) {
    return systemCodeMessage;
  }

  if (!reason) {
    return "理由を確認できませんでした。";
  }

  if (!containsJapaneseText(reason) && /[a-z]/i.test(String(reason))) {
    return "理由を確認できませんでした。";
  }

  return String(reason);
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

function renderResearchFeatureSetting() {
  if (researchFeatureToggle) {
    researchFeatureToggle.checked = researchFeatureEnabled;
  }

  if (researchFeatureState) {
    researchFeatureState.textContent = researchFeatureEnabled ? "ON" : "OFF";
    researchFeatureState.className = researchFeatureEnabled
      ? "research-card__state research-card__state--on"
      : "research-card__state research-card__state--off";
  }

  if (researchFeatureMessage) {
    researchFeatureMessage.textContent = researchFeatureEnabled
      ? "出品者ページを開くとリサーチを自動で起動します。"
      : "出品者ページを開いてもリサーチは自動起動しません。";
  }
}

async function loadResearchFeatureSetting() {
  const storage = await getLocalStorage([RESEARCH_FEATURE_ENABLED_KEY]);
  const savedValue = storage[RESEARCH_FEATURE_ENABLED_KEY];
  researchFeatureEnabled = savedValue === false ? false : true;

  if (savedValue !== true && savedValue !== false) {
    await setLocalStorage({ [RESEARCH_FEATURE_ENABLED_KEY]: true });
  }

  renderResearchFeatureSetting();
}

async function handleResearchFeatureToggleChange() {
  researchFeatureEnabled = researchFeatureToggle?.checked !== false;
  renderResearchFeatureSetting();
  await setLocalStorage({
    [RESEARCH_FEATURE_ENABLED_KEY]: researchFeatureEnabled
  });
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

  rakurakuTaskState.textContent = task.status === "pending" ? "待機中 1件" : `最新タスク：${formatRakurakuTaskStatus(task.status)}`;
  rakurakuTaskPanel.hidden = false;

  if (rakurakuEmptyState) {
    rakurakuEmptyState.hidden = true;
  }

  if (rakurakuTaskTitle) {
    rakurakuTaskTitle.textContent = task.action === "price_drop" ? "値下げタスク" : "再出品タスク";
  }

  if (rakurakuTaskPrice) {
    rakurakuTaskPrice.textContent = "詳細はWebで確認してください";
  }

  if (rakurakuTaskStatus) {
    rakurakuTaskStatus.textContent = formatRakurakuTaskStatus(task.status || "pending");
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
    rakurakuTaskTitle.textContent = "承認待ち候補";
  }

  if (rakurakuTaskPrice) {
    rakurakuTaskPrice.textContent = "詳細はWebで確認してください";
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
  rakurakuAutoPollEnabled = enabled === true;

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
    renderRakurakuAutoPollState(response?.enabled === true, response?.isRunningTask === true);
  } catch {
    if (rakurakuAutoPollState) {
      rakurakuAutoPollState.textContent = "自動チェック：確認失敗";
    }
    console.warn("[furimane-rakuraku] auto poll state failed");
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
    renderRakurakuAutoPollState(response?.enabled === true, response?.isRunningTask === true);
  } catch {
    if (rakurakuAutoPollState) {
      rakurakuAutoPollState.textContent = "自動チェック：切替失敗";
    }
    console.warn("[furimane-rakuraku] auto poll toggle failed");
  } finally {
    if (rakurakuAutoPollToggleButton) {
      rakurakuAutoPollToggleButton.disabled = false;
    }
  }
}

async function loadRakurakuExecutionMode() {
  try {
    const storage = await getLocalStorage([RAKURAKU_EXECUTION_MODE_KEY]);
    const mode = storage[RAKURAKU_EXECUTION_MODE_KEY] === "dry-run" ? "dry-run" : "real";
    if (rakurakuExecutionModeSelect) {
      rakurakuExecutionModeSelect.value = mode;
    }
  } catch {
    console.warn("[furimane-rakuraku] execution mode load failed");
  }
}

async function handleRakurakuExecutionModeChange() {
  const mode = rakurakuExecutionModeSelect?.value === "dry-run" ? "dry-run" : "real";
  await setLocalStorage({ [RAKURAKU_EXECUTION_MODE_KEY]: mode });
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
      path: getSafeApiLogPath(path),
      credentials: credentialsMode,
      errorName: error instanceof Error ? error.name : "Error"
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
    path: getSafeApiLogPath(path),
    status: response.status,
    ok: response.ok,
    credentials: credentialsMode
  });

  if (!response.ok || data?.success === false) {
    const errorReason = typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : "empty response";
    throw new Error(errorReason);
  }

  return data;
}

function getExtensionVersion() {
  return chrome.runtime?.getManifest?.().version || EXTENSION_FALLBACK_VERSION;
}

// 「拡張をセットアップ済み」であることをサーバー側に記録する。
// 失敗してもログインUXは止めないので、ここでは握りつぶす。
async function sendExtensionHeartbeat() {
  try {
    await fetchAppApi("/api/extension/heartbeat", {
      method: "POST",
      headers: {
        "X-Furimane-Client": "chrome-extension",
        "X-Furimane-Extension-Version": getExtensionVersion(),
        "X-Furimane-Extension-Id": chrome.runtime?.id || "unknown",
        "X-Furimane-Api-Schema": EXTENSION_API_SCHEMA
      }
    });
  } catch (error) {
    console.warn("[furimane] extension heartbeat skipped", error);
  }
}

function normalizeSalesRecipe(value) {
  const recipe = value?.recipe && typeof value.recipe === "object" ? value.recipe : value;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
    return null;
  }

  if (!Number.isInteger(Number(recipe.recipeVersion))) {
    return null;
  }

  if (!Array.isArray(recipe.rootSelectors) || !Array.isArray(recipe?.table?.rowLinkSelectors)) {
    return null;
  }

  return recipe;
}

async function getCachedSalesRecipe() {
  const storage = await getLocalStorage([SALES_RECIPE_STORAGE_KEY]);
  return normalizeSalesRecipe(storage[SALES_RECIPE_STORAGE_KEY]?.recipe);
}

async function fetchSalesRecipe() {
  try {
    const recipe = normalizeSalesRecipe(await fetchAppApi("/api/scrape-recipes/mercari-sales"));
    if (!recipe) {
      throw new Error("invalid sales recipe");
    }

    await setLocalStorage({
      [SALES_RECIPE_STORAGE_KEY]: {
        recipe,
        fetchedAt: new Date().toISOString()
      }
    });
    return recipe;
  } catch (error) {
    const cachedRecipe = await getCachedSalesRecipe();
    if (cachedRecipe) {
      console.warn("[furimanager-extension] sales recipe fetch failed; using cached recipe");
      return cachedRecipe;
    }

    throw new Error("サーバーに接続できません");
  }
}

async function fetchLatestSalesAnchor() {
  try {
    const data = await fetchAppApi("/api/sales/latest-anchor");
    return data?.anchor || null;
  } catch {
    console.warn("[furimanager-extension] latest sales anchor failed");
    return null;
  }
}

function getSafeApiLogPath(path) {
  return path
    .replace(/\/api\/automation\/tasks\/[^/]+/g, "/api/automation/tasks/[id]")
    .replace(/\/api\/rakuraku\/relist-candidates\/[^/]+/g, "/api/rakuraku/relist-candidates/[id]");
}

async function runTabAction(action, extraMessage = {}) {
  const tab = await queryActiveTab();

  if (action !== "ping" && !isMercariSoldPageUrl(tab.url)) {
    throw new Error("メルカリ販売履歴ページを開いてから同期してください");
  }

  const recipe = action === "ping" ? null : await fetchSalesRecipe();
  return sendMessageToTab(tab.id, { action, ...extraMessage, ...(recipe ? { recipe } : {}) });
}

function showActionError(title, response, fallbackMessage, help = null) {
  setStatus(
    "error",
    title,
    [
      {
        label: "原因",
        value: getUserFacingErrorMessage(response?.message || fallbackMessage, fallbackMessage)
      }
    ],
    help
  );
}

function parseSupabaseError(data, fallbackMessage) {
  if (!data || typeof data !== "object") {
    return fallbackMessage;
  }

  return data.error_description || data.msg || data.message || data.error || fallbackMessage;
}

function isInvalidRefreshSessionError(data) {
  const normalizedMessage = parseSupabaseError(data, "").toLowerCase();

  return (
    normalizedMessage.includes("invalid_grant") ||
    (normalizedMessage.includes("refresh token") &&
      (normalizedMessage.includes("not found") ||
        normalizedMessage.includes("invalid") ||
        normalizedMessage.includes("expired") ||
        normalizedMessage.includes("already used")))
  );
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

  return getUserFacingErrorMessage(message, defaultMessage);
}

function normalizeAnchorExternalId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue.includes("|")) {
    return null;
  }

  return normalizedValue;
}

function normalizeAnchorExternalIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const anchorExternalIds = [];
  const seen = new Set();

  for (const value of values) {
    const externalId = normalizeAnchorExternalId(value);

    if (!externalId || seen.has(externalId)) {
      continue;
    }

    seen.add(externalId);
    anchorExternalIds.push(externalId);

    if (anchorExternalIds.length >= SYNC_ANCHOR_EXTERNAL_ID_LIMIT) {
      break;
    }
  }

  return anchorExternalIds;
}

function getPreviousAnchorExternalIds(storageState) {
  const anchorExternalIds = normalizeAnchorExternalIds(storageState.lastSyncedExternalIds);
  const legacyLastItemId = normalizeAnchorExternalId(storageState.lastItemId);

  if (legacyLastItemId && !anchorExternalIds.includes(legacyLastItemId)) {
    anchorExternalIds.push(legacyLastItemId);
  }

  return anchorExternalIds.slice(0, SYNC_ANCHOR_EXTERNAL_ID_LIMIT);
}

function getResponseAnchorExternalIds(response) {
  return normalizeAnchorExternalIds(response?.anchorExternalIds);
}

function getGapSuspected(response) {
  return response?.gapSuspected === true;
}

function getGapWarningDetails(response) {
  if (!getGapSuspected(response)) {
    return [];
  }

  return [
    {
      label: "注意",
      value: "前回の同期位置が確認できなかったため、安全のため多めに取得しました"
    },
    {
      label: "注意点",
      value: "重複は自動で除外されます。ページ上限より古い履歴は未確認です"
    }
  ];
}

function getTokenExpiresAt(expiresIn) {
  return typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : null;
}

function shouldRefreshAuthToken(expiresAt) {
  return typeof expiresAt !== "number" || Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
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

    if (isInvalidRefreshSessionError(data)) {
      await logoutFromSupabase();
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

  isAuthStateReady = true;
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

async function saveScrapeState(lastItemId, count, options = {}) {
  const lastSyncedExternalIds = normalizeAnchorExternalIds(options.lastSyncedExternalIds);

  await setLocalStorage({
    lastFetchDate: new Date().toISOString(),
    lastItemId,
    lastFetchedCount: count,
    lastSyncedExternalIds,
    gapSuspected: options.gapSuspected === true
  });
}

async function restoreScrapeWarningState() {
  const storageState = await getLocalStorage(SCRAPE_STORAGE_KEYS);

  if (storageState.gapSuspected !== true) {
    return;
  }

  setStatus("error", "未確認区間があります", [
    {
      label: "内容",
      value: "前回の同期位置が確認できなかったため、ページ上限より古い履歴は未確認です"
    },
    {
      label: "前回同期",
      value: storageState.lastFetchDate ? new Date(storageState.lastFetchDate).toLocaleString("ja-JP") : "不明"
    },
    {
      label: "注意点",
      value: "通常の同期は継続できます。重複は自動で除外されます"
    }
  ]);
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
    isAuthStateReady = true;
    passwordInput.value = "";
    updateAuthUi();
    setAuthMessage("success", "ログインしました");
    // 拡張セットアップ済みの記録。await せずに投げっぱなしにする。
    void sendExtensionHeartbeat();
  } catch (error) {
    updateAuthUi();
    setAuthMessage("error", getUserFacingErrorMessage(error, "ログインに失敗しました"));
  } finally {
    setAuthControlsDisabled(false);
  }
}

/**
 * Googleでログインするための連携ページ URL。
 *
 * 拡張の入力欄で Google の資格情報を扱うことは技術的にできないうえ、
 * フィッシング扱いになるためストアから削除される。
 * そこで Web の連携ページを新しいタブで開き、そちらでログインしてもらう。
 * 拡張IDはページ側の許可リストと突き合わせて検証される。
 */
function getExtensionConnectUrl() {
  const connectUrl = new URL(`${getAppBaseUrl()}${EXTENSION_CONNECT_PATH}`);
  const extensionId = chrome.runtime?.id;

  if (typeof extensionId === "string" && extensionId) {
    connectUrl.searchParams.set("ext_id", extensionId);
  }

  return connectUrl.toString();
}

function handleGoogleLoginClick() {
  try {
    chrome.tabs.create({ url: getExtensionConnectUrl(), active: true });
    setAuthMessage(
      "idle",
      "開いたページで、使用するアカウントを確認してください。"
    );
  } catch (error) {
    setAuthMessage("error", getUserFacingErrorMessage(error, "連携ページを開けませんでした"));
  }
}

/**
 * 連携ページ経由でログインが完了すると background 側が chrome.storage.local を更新する。
 * ポップアップを開いたままでも、その変化を拾ってログイン済み表示に切り替える。
 */
async function handleAuthStorageChanged() {
  try {
    const wasLoggedIn = isLoggedIn();
    const storageState = await getLocalStorage(AUTH_STORAGE_KEYS);
    const nowLoggedIn = applyAuthStateFromStorage(storageState);

    isAuthStateReady = true;
    updateAuthUi();

    // ログアウト時のメッセージを上書きしないよう、未ログイン→ログインのときだけ知らせる。
    if (!wasLoggedIn && nowLoggedIn) {
      setAuthControlsDisabled(false);
      setAuthMessage("success", "連携が完了しました。ログイン状態になりました");
    }
  } catch (error) {
    setAuthMessage("error", getUserFacingErrorMessage(error, "ログイン状態の更新に失敗しました"));
  }
}

async function handleLogout() {
  setAuthControlsDisabled(true);
  setAuthMessage("idle", "ログアウト中...");

  try {
    await logoutFromSupabase();
    isAuthStateReady = true;
    updateAuthUi();
    setAuthMessage("idle", "ログアウトしました");
  } catch (error) {
    setAuthMessage("error", getUserFacingErrorMessage(error, "ログアウトに失敗しました"));
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
      showActionError("接続失敗", response, "メルカリ販売履歴ページと通信できませんでした", MANUAL_IMPORT_HELP);
      return;
    }

    setStatus(
      response.isMercariSoldPage ? "success" : "error",
      response.isMercariSoldPage ? "接続OK" : "接続OK（対象外ページ）",
      response.isMercariSoldPage
        ? [{ label: "次の操作", value: "「販売履歴を同期」を押してください" }]
        : [{ label: "対応方法", value: "メルカリ販売履歴ページを開いてください" }],
      response.isMercariSoldPage ? null : MANUAL_IMPORT_HELP
    );
  } catch (error) {
    setStatus(
      "error",
      "接続失敗",
      [
        {
          label: "原因",
          value: getUserFacingErrorMessage(error)
        },
        {
          label: "対応方法",
          value: "メルカリ販売履歴ページを開いた状態でお試しください"
        }
      ],
      MANUAL_IMPORT_HELP
    );
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
      { label: "取得件数", value: response.count ?? 0 }
    ]);
  } catch (error) {
    setStatus("error", "取得失敗", [
      {
        label: "原因",
        value: getUserFacingErrorMessage(error)
      },
      {
        label: "対応方法",
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
      { label: "読み込みページ数", value: response.pageCount ?? 0 },
      { label: "上限到達", value: response.reachedPageLimit ? "はい" : "いいえ" }
    ]);
  } catch (error) {
    setStatus("error", "全ページ取得失敗", [
      {
        label: "原因",
        value: getUserFacingErrorMessage(error)
      },
      {
        label: "対応方法",
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
    const localAnchorExternalIds = getPreviousAnchorExternalIds(storageState);
    const hasLocalSalesAnchor = Boolean(normalizeAnchorExternalId(storageState.lastItemId) || localAnchorExternalIds.length > 0);
    const databaseAnchor = await fetchLatestSalesAnchor();
    const databaseLastItemId = normalizeAnchorExternalId(databaseAnchor?.lastItemId);
    const previousAnchorExternalIds = normalizeAnchorExternalIds([
      ...(hasLocalSalesAnchor ? [databaseLastItemId] : []),
      ...localAnchorExternalIds
    ]);
    const previousLastItemId = hasLocalSalesAnchor ? databaseLastItemId || normalizeAnchorExternalId(storageState.lastItemId) : null;

    const response = await runTabAction("scrapeDeltaPages", {
      lastItemId: previousLastItemId,
      lastSyncedExternalIds: previousAnchorExternalIds,
      lastSoldAt: typeof databaseAnchor?.lastSoldAt === "string" ? databaseAnchor.lastSoldAt : null
    });

    if (!response || response.success !== true) {
      showActionError("差分取得失敗", response, "差分取得に失敗しました");
      return;
    }

    const nextAnchorExternalIds = normalizeAnchorExternalIds([
      ...getResponseAnchorExternalIds(response),
      ...previousAnchorExternalIds
    ]);
    const nextLastItemId = nextAnchorExternalIds[0] || null;
    const gapSuspected = getGapSuspected(response) || storageState.gapSuspected === true;

    await saveScrapeState(nextLastItemId, response.count ?? 0, {
      lastSyncedExternalIds: nextAnchorExternalIds,
      gapSuspected
    });

    setStatus("success", gapSuspected ? "差分取得OK（未確認あり）" : "差分取得OK", [
      ...getGapWarningDetails(response),
      { label: "新規取得件数", value: response.count ?? 0 },
      { label: "読み込みページ数", value: response.pageCount ?? 0 },
      { label: "上限到達", value: response.reachedPageLimit ? "はい" : "いいえ" },
      { label: "保存アンカー数", value: nextAnchorExternalIds.length },
      { label: "取得モード", value: previousAnchorExternalIds.length > 0 || databaseAnchor?.lastSoldAt ? "差分取得" : "初回取得" }
    ]);
  } catch (error) {
    setStatus("error", "差分取得失敗", [
      {
        label: "原因",
        value: getUserFacingErrorMessage(error)
      },
      {
        label: "対応方法",
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
      { label: "リセット内容", value: "前回の同期位置・取得件数を削除しました" }
    ]);
  } catch (error) {
    setStatus("error", "リセット失敗", [
      {
        label: "原因",
        value: getUserFacingErrorMessage(error)
      }
    ]);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleScrapeAndSend() {
  if (!isLoggedIn()) {
    setStatus("error", "送信不可", [{ label: "対応方法", value: "ログインしてから送信してください" }], MANUAL_LOGIN_HELP);
    return;
  }

  setActionButtonsDisabled(true);
  setStatus("idle", "差分取得して送信中...", [
    { label: "お願い", value: "完了するまでこのポップアップを閉じないでください" }
  ]);

  try {
    const storageState = await getLocalStorage(SCRAPE_STORAGE_KEYS);
    const localAnchorExternalIds = getPreviousAnchorExternalIds(storageState);
    const hasLocalSalesAnchor = Boolean(normalizeAnchorExternalId(storageState.lastItemId) || localAnchorExternalIds.length > 0);
    const databaseAnchor = await fetchLatestSalesAnchor();
    const databaseLastItemId = normalizeAnchorExternalId(databaseAnchor?.lastItemId);
    const previousAnchorExternalIds = normalizeAnchorExternalIds([
      ...(hasLocalSalesAnchor ? [databaseLastItemId] : []),
      ...localAnchorExternalIds
    ]);
    const previousLastItemId = hasLocalSalesAnchor ? databaseLastItemId || normalizeAnchorExternalId(storageState.lastItemId) : null;

    const response = await runTabAction("scrapeDeltaPages", {
      lastItemId: previousLastItemId,
      lastSyncedExternalIds: previousAnchorExternalIds,
      lastSoldAt: typeof databaseAnchor?.lastSoldAt === "string" ? databaseAnchor.lastSoldAt : null
    });

    if (!response || response.success !== true) {
      showActionError("送信失敗", response, "差分取得に失敗しました", MANUAL_IMPORT_HELP);
      return;
    }

    const importResult = await fetchAppApi("/api/sales/import", {
      method: "POST",
      body: JSON.stringify(response)
    });
    const nextAnchorExternalIds = normalizeAnchorExternalIds([
      ...getResponseAnchorExternalIds(importResult),
      ...previousAnchorExternalIds
    ]);
    const nextLastItemId = nextAnchorExternalIds[0] || null;
    const gapSuspected = getGapSuspected(importResult) || storageState.gapSuspected === true;
    const savedCount = (importResult?.insertedCount ?? 0) + (importResult?.updatedCount ?? 0);
    const normalizedCount = importResult?.normalizedCount ?? 0;
    const invalidCount = importResult?.invalidCount ?? 0;
    const hasSendTarget = gapSuspected || savedCount > 0 || invalidCount > 0;

    await saveScrapeState(nextLastItemId, importResult?.checkedCount ?? response.count ?? 0, {
      lastSyncedExternalIds: nextAnchorExternalIds,
      gapSuspected
    });

    setStatus(
      "success",
      gapSuspected ? "送信完了（未確認あり）" : savedCount > 0 ? "送信完了" : "送信対象なし",
      hasSendTarget
        ? [
            ...getGapWarningDetails(importResult),
            { label: "差分取得件数", value: importResult?.checkedCount ?? response.count ?? 0 },
            { label: "保存対象件数", value: normalizedCount },
            { label: "保存件数", value: savedCount },
            { label: "確認待ち件数", value: invalidCount },
            { label: "読み込みページ数", value: importResult?.pageCount ?? response.pageCount ?? 0 },
            { label: "上限到達", value: importResult?.reachedPageLimit ? "はい" : "いいえ" },
            { label: "保存アンカー数", value: nextAnchorExternalIds.length }
          ]
        : [],
      // 「未確認あり」「送信対象なし」は、どちらもFAQの「取り込まれないとき」に説明がある
      gapSuspected || savedCount === 0 ? MANUAL_IMPORT_HELP : null
    );
  } catch (error) {
    // TODO: 送信失敗時の pendingItems 保持は今後の改善候補
    setStatus(
      "error",
      "送信失敗",
      [
        {
          label: "原因",
          value: getUserFacingSyncErrorMessage(error)
        }
      ],
      MANUAL_IMPORT_HELP
    );
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
  } catch {
    setRakurakuEmptyState("状態の取得に失敗しました。時間をおいてもう一度開いてください。");
    console.warn("[furimane-rakuraku] pending task preview failed");
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

    console.log("[furimane-rakuraku] background poll result", {
      success: backgroundResult?.success === true,
      reason: backgroundResult?.reason || null,
      hasTask: Boolean(backgroundResult?.task)
    });

    if (!backgroundResult?.success) {
      throw new Error(backgroundResult?.message || "background poll failed");
    }

    renderRakurakuAutoPollState(rakurakuAutoPollEnabled, backgroundResult?.isRunningTask === true);
    renderRakurakuTask(backgroundResult.task || null);

    if (backgroundResult.task) {
      console.log("[furimane-rakuraku] pending task", {
        action: backgroundResult.task.action,
        status: backgroundResult.task.status
      });
    } else {
      const approvalCandidate = await loadRakurakuApprovalCandidatePreview();

      if (approvalCandidate) {
        setStatus("success", "承認待ち候補あり", [
          { label: "操作", value: "許可して開始を押すと再出品タスクを作成します" }
        ]);
        return;
      }

      const diagnostics = backgroundResult.diagnostics || {};
      const latestTask = Array.isArray(diagnostics.safeTasks) ? diagnostics.safeTasks[0] : null;
      const statusCounts = Object.entries(diagnostics.statusCounts || {})
        .map(([status, count]) => `${formatRakurakuTaskStatus(status)}:${count}`)
        .join(", ");

      setStatus("success", "待機中タスクなし", [
        { label: "理由", value: formatRakurakuReason(backgroundResult.reason || "no_pending_task") },
        { label: "状態別件数", value: statusCounts || "再出品タスクなし" },
        { label: "最新タスク", value: latestTask ? `${formatRakurakuTaskStatus(latestTask.status)} / ${formatRakurakuTaskAction(latestTask.action)}` : "なし" }
      ]);
    }
  } catch (error) {
    renderRakurakuTask(null);
    if (rakurakuTaskState) {
      rakurakuTaskState.textContent = "取得失敗";
    }
    setStatus("error", "タスク取得に失敗", [
      { label: "原因", value: getUserFacingErrorMessage(error) }
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
        { label: "結果", value: formatRakurakuReason(backgroundResult.reason || "started") }
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
      { label: "実行モード", value: formatRakurakuExecutionMode(rakurakuExecutionModeSelect?.value || "dry-run") }
    ]);
  } catch (error) {
    setStatus("error", "タスク開始に失敗", [
      { label: "原因", value: getUserFacingErrorMessage(error) }
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

  if (signupLink) {
    signupLink.href = `${getAppBaseUrl()}/signup`;
  }

  if (usageGuideLink) {
    usageGuideLink.href = `${getAppBaseUrl()}${MANUAL_SYNC_GUIDE_PATH}`;
  }

  try {
    getConfig();
    setAuthMessage("idle", "ログイン情報を確認してください");
  } catch (error) {
    setAuthMessage("error", getUserFacingErrorMessage(error, "config.js を確認してください"));
  }

  try {
    await loadResearchFeatureSetting();
    await restoreAuthState();
    await restoreScrapeWarningState();
    if (rakurakuTaskState || rakurakuTaskPanel) {
      await loadRakurakuExecutionMode();
      await loadRakurakuPendingTaskPreview();
    }
  } catch (error) {
    isAuthStateReady = true;
    updateAuthUi();
    setAuthMessage("error", getUserFacingErrorMessage(error, "ログイン状態の復元に失敗しました"));
  }
}

googleLoginButton?.addEventListener("click", () => {
  handleGoogleLoginClick();
});
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const hasAuthChange = AUTH_STORAGE_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(changes, key)
    );

    if (!hasAuthChange) {
      return;
    }

    void handleAuthStorageChanged();
  });
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
researchFeatureToggle?.addEventListener("change", () => {
  void handleResearchFeatureToggleChange();
});
rakurakuExecutionModeSelect?.addEventListener("change", () => {
  void handleRakurakuExecutionModeChange();
});

void initializePopup();
