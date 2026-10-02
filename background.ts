(() => {
  // 手動の一括値下げは既存の個別操作・定期処理から分離する。
  importScripts("src/mercari-bulk-policy.js", "src/mercari-bulk-background.js");
  try {
    importScripts("config.js");
  } catch {
    console.warn("[furimanager-extension] config.js import skipped");
  }

  const chromeApi = (globalThis as any).chrome;
  const RELIST_PENDING_KEY = "relist_pending";
  const MANUAL_CONFIRMATION_REQUIRED_KEY = "furimanager_manual_confirmation_required";
  const RAKURAKU_AUTO_POLL_KEY = "rakurakuAutoPollEnabledV2";
  const RAKURAKU_EXECUTION_MODE_KEY = "rakurakuExecutionMode";
  const RAKURAKU_ALARM_NAME = "rakurakuPoll";
  const RAKURAKU_AUTO_POLL_MIN_MINUTES = 10;
  const RAKURAKU_AUTO_POLL_JITTER_MINUTES = 3;
  let nextRakurakuPollDelayMinutesOverride: number | null = null;
  const DEFAULT_APP_URL = "https://furimanager.app.furimakaikei.com";
  const LEGACY_APP_URLS = new Set([
    "https://furimanager.com",
    "https://www.furimanager.com",
    "https://furimanager.furimakaikei.com"
  ]);
  const MERCARI_SELL_URL = "https://jp.mercari.com/sell";
  const MERCARI_ITEM_URL_BASE = "https://jp.mercari.com/item/";
  const MERCARI_EDIT_URL_BASE = "https://jp.mercari.com/sell/edit/";
  const MOCK_RELIST_PATH = "mock/mercari-relist.html";
  const REAL_RELIST_DETECTION_TIMEOUT_MS = 15000;
  const REAL_RELIST_DETECTION_RETRY_MS = 700;
  const REAL_RELIST_MANUAL_CONFIRMATION_TIMEOUT_MS = 120000;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const AUTH_STORAGE_KEYS = [
    "supabaseAccessToken",
    "supabaseRefreshToken",
    "supabaseUser",
    "supabaseTokenExpiresAt"
  ];
  const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
  // Web の連携ページ（/extension/connect）から externally_connectable 経由で届くメッセージ。
  const EXTENSION_CONNECT_MESSAGE_TYPE = "FURIMANE_EXTENSION_CONNECT";
  const EXTENSION_CONNECT_TOKEN_MAX_LENGTH = 512;
  const EXTENSION_CONNECT_NETWORK_ERROR = "ログインサービスに接続できませんでした。少し時間をおいて、もう一度お試しください。";
  const EXTENSION_CONNECT_RATE_ERROR = "連携の操作が続いています。少し時間をおいて、もう一度お試しください。";
  const EXTENSION_CONNECT_EXPIRED_ERROR = "ログイン情報の有効期限が切れました。拡張機能からもう一度ログインしてください。";
  // 連携成功後、ページに「完了」を見せてからタブを閉じるまでの猶予。
  const EXTENSION_CONNECT_AUTO_CLOSE_DELAY_MS = 1200;
  // 拡張ハートビート用。サーバー側の拡張バージョン検証に必要なヘッダ値。
  // manifest.json の version と揃えて更新する。
  const EXTENSION_FALLBACK_VERSION = "0.2.7";
  const EXTENSION_API_SCHEMA = "research-v1";
  const MERCARI_DPOP_ANONYMOUS_UUID = "00000000-0000-0000-0000-000000000000";
  const authState: {
    accessToken: string | null;
    refreshToken: string | null;
    user: Record<string, unknown> | null;
    tokenExpiresAt: number | null;
  } = {
    accessToken: null,
    refreshToken: null,
    user: null,
    tokenExpiresAt: null
  };
  let isRunningRakurakuTask = false;
  let mercariDpopKeyPair: CryptoKeyPair | null = null;

  if (!chromeApi?.runtime?.onMessage) {
    return;
  }

  chromeApi.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (response: any) => void) => {
    const respond = (response: any) => {
      try {
        sendResponse(response);
      } catch {
        console.error("[furimanager-extension] sendResponse failed");
      }
    };

    if (message?.type === "OPEN_YAHOO_RELIST") {
      void openYahooRelist(message.token, sender).then(respond).catch(() => respond({ success: false }));
      return true;
    }

    if (message?.type === "FETCH_YAHOO_IMAGE_AS_DATA_URL") {
      if (!isAllowedYahooSender(sender, true)) {
        respond({ success: false });
        return false;
      }
      void fetchImageAsDataUrl(message.url, "yahoo").then(respond);
      return true;
    }

    if (message?.type === "FETCH_IMAGE_AS_DATA_URL") {
      if (!isAllowedMercariPageSender(sender)) {
        respond({ success: false, message: "Image fetch is not allowed from this page." });
        return false;
      }
      void handleFetchImage(message.url, respond);
      return true;
    }

    if (message?.type === "FETCH_MERCARI_ITEM_DETAIL") {
      void handleFetchMercariItemDetail(message, respond);
      return true;
    }

    if (message?.type === "FETCH_MERCARI_USER_PROFILE") {
      void handleFetchMercariUserProfile(message, respond);
      return true;
    }

    if (message?.type === "FETCH_MERCARI_USER_IDENTITY_BADGE") {
      void handleFetchMercariUserIdentityBadge(message, respond);
      return true;
    }

    if (message?.type === "SET_RELIST_PENDING") {
      void handleSetRelistPending(message.payload, respond);
      return true;
    }

    if (message?.type === "OPEN_INVENTORY_LINK") {
      void handleOpenInventoryLink(message.payload, respond);
      return true;
    }

    if (message?.type === "OPEN_EXTENSION_LOGIN") {
      void handleOpenExtensionLogin(respond);
      return true;
    }

    if (message?.type === "GET_RAKURAKU_AUTO_POLL_STATE") {
      void handleGetRakurakuAutoPollState(respond);
      return true;
    }

    if (message?.type === "SET_RAKURAKU_AUTO_POLL_ENABLED") {
      void handleSetRakurakuAutoPollEnabled(message.enabled === true, respond);
      return true;
    }

    if (message?.type === "POLL_RAKURAKU_NOW") {
      void handlePollRakurakuNow(respond);
      return true;
    }

    if (message?.type === "MOCK_RELIST_BUTTON_DETECTED") {
      return false;
    }

    return false;
  });

  // Web の連携ページからの「Googleでログイン」連携を受け取る。
  // 送信元は manifest の externally_connectable で既に絞られているが、
  // ここでも sender のオリジンを許可リストと突き合わせて二重に確認する。
  if (chromeApi.runtime.onMessageExternal) {
    chromeApi.runtime.onMessageExternal.addListener(
      (message: any, sender: any, sendResponse: (response: any) => void) => {
        // 想定外のメッセージ型は無視する。
        if (message?.type !== EXTENSION_CONNECT_MESSAGE_TYPE) {
          return false;
        }

        const respondExternal = (response: any) => {
          try {
            sendResponse(response);
          } catch {
            console.error("[furimanager-extension] external sendResponse failed");
          }
        };

        if (!isAllowedConnectPageSender(sender)) {
          respondExternal({ ok: false, error: "このページからは拡張機能と連携できません。" });
          return false;
        }

        // 連携ページが開いているタブ。ページ側が autoClose を立てたときだけ、成功後に閉じる。
        const senderTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;

        void handleExtensionConnect(message, respondExternal, senderTabId);
        return true;
      }
    );
  }

  void setupRakurakuAlarm().catch(() => console.warn("[rakuraku] alarm setup skipped"));

  async function handleFetchImage(url: string | undefined, respond: (response: any) => void) {
    try {
      respond(await fetchImageAsDataUrl(url));
    } catch {
      console.error("[furimanager-extension] fetch image request failed");
      respond({ success: false, message: "画像の取得に失敗しました" });
    }
  }

  async function handleFetchMercariItemDetail(message: any, respond: (response: any) => void) {
    try {
      const itemId = typeof message?.itemId === "string" ? message.itemId.trim() : "";

      if (!/^m\d+$/.test(itemId)) {
        respond({ success: false, message: "メルカリ商品IDを確認できませんでした" });
        return;
      }

      const url = new URL("https://api.mercari.jp/items/get");
      url.searchParams.set("id", itemId);
      url.searchParams.set("_item_photo_format", "detail");
      url.searchParams.set("include_product_page_component", "true");

      const headers: Record<string, string> = {
        "x-platform": "web"
      };
      const accessToken = typeof message?.accessToken === "string" ? message.accessToken.trim() : "";

      if (accessToken) {
        headers.authorization = accessToken;
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        credentials: "omit"
      });

      if (!response.ok) {
        respond({ success: false, message: `メルカリ商品情報の取得に失敗しました (${response.status})` });
        return;
      }

      respond({ success: true, data: await response.json() });
    } catch {
      console.warn("[furimanager-extension] mercari item detail fetch failed");
      respond({ success: false, message: "メルカリ商品情報の取得に失敗しました" });
    }
  }

  async function handleFetchMercariUserProfile(message: any, respond: (response: any) => void) {
    try {
      const userId = typeof message?.userId === "string" ? message.userId.trim() : "";

      if (!/^\d+$/.test(userId)) {
        respond({ success: false, message: "メルカリユーザーIDを確認できませんでした" });
        return;
      }

      const url = new URL("https://api.mercari.jp/users/get_profile");
      url.searchParams.set("id", userId);

      const headers: Record<string, string> = {
        "x-platform": "web"
      };
      const accessToken = typeof message?.accessToken === "string" ? message.accessToken.trim() : "";

      if (accessToken) {
        headers.authorization = accessToken;
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        credentials: "omit"
      });

      if (!response.ok) {
        respond({ success: false, message: `メルカリユーザー情報の取得に失敗しました (${response.status})` });
        return;
      }

      respond({ success: true, data: await response.json() });
    } catch {
      console.warn("[furimanager-extension] mercari user profile fetch failed");
      respond({ success: false, message: "メルカリユーザー情報の取得に失敗しました" });
    }
  }

  async function handleFetchMercariUserIdentityBadge(message: any, respond: (response: any) => void) {
    try {
      const userId = typeof message?.userId === "string" ? message.userId.trim() : "";

      if (!/^\d+$/.test(userId)) {
        respond({ success: false, message: "メルカリユーザーIDを確認できませんでした" });
        return;
      }

      const url = new URL("https://api.mercari.jp/services/usersocialjp/v1/stats/has_identity_verified_badge");

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-platform": "web"
      };
      const dpopProof = await createMercariDpopProofJwt(url.toString(), "POST");

      if (dpopProof) {
        headers.DPoP = dpopProof;
      }

      const accessToken = typeof message?.accessToken === "string" ? message.accessToken.trim() : "";

      if (accessToken) {
        headers.authorization = accessToken;
      }

      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        respond({ success: false, message: `メルカリ本人確認バッジの取得に失敗しました (${response.status})` });
        return;
      }

      respond({ success: true, data: await response.json() });
    } catch {
      console.warn("[furimanager-extension] mercari user identity badge fetch failed");
      respond({ success: false, message: "メルカリ本人確認バッジの取得に失敗しました" });
    }
  }

  async function createMercariDpopProofJwt(htu: string, htm: string): Promise<string | null> {
    try {
      const keyPair = await getMercariDpopKeyPair();
      const exportedKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      const header = {
        typ: "dpop+jwt",
        alg: "ES256",
        jwk: {
          kty: exportedKey.kty,
          crv: exportedKey.crv,
          x: exportedKey.x,
          y: exportedKey.y
        }
      };
      const payload = {
        iat: Math.floor(Date.now() / 1000),
        jti: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : createFallbackUuid(),
        htu,
        htm,
        uuid: MERCARI_DPOP_ANONYMOUS_UUID
      };
      const unsignedToken = `${base64UrlEncodeText(JSON.stringify(header))}.${base64UrlEncodeText(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        new TextEncoder().encode(unsignedToken)
      );

      return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
    } catch (error) {
      console.warn("[furimanager-extension] mercari dpop proof skipped");
      return null;
    }
  }

  async function getMercariDpopKeyPair(): Promise<CryptoKeyPair> {
    if (mercariDpopKeyPair) {
      return mercariDpopKeyPair;
    }

    mercariDpopKeyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    return mercariDpopKeyPair;
  }

  function base64UrlEncodeText(value: string): string {
    return base64UrlEncodeBytes(new TextEncoder().encode(value));
  }

  function base64UrlEncodeBytes(bytes: Uint8Array): string {
    let binary = "";

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  function createFallbackUuid(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function handleSetRelistPending(payload: any, respond: (response: any) => void) {
    respond(await setRelistPending(payload));
  }

  async function handleOpenInventoryLink(payload: any, respond: (response: any) => void) {
    respond(await openInventoryLink(payload));
  }

  async function handleOpenExtensionLogin(respond: (response: any) => void) {
    try {
      await createTab({ url: chromeApi.runtime.getURL("popup.html?view=login"), active: true });
      respond({ success: true });
    } catch {
      respond({
        success: false,
        message: "拡張機能のログイン画面を開けませんでした"
      });
    }
  }

  /**
   * 連携ページから受け取った使い捨てトークンを、拡張専用の独立したセッションに交換する。
   *
   * Web 側のリフレッシュトークンをコピーしないのは、Supabase がリフレッシュトークンを
   * ローテーションするため。共有すると片方の更新でもう片方が無効化され、
   * 「拡張を使うと Web が勝手にログアウトされる」再現性の低い事故になる。
   *
   * サーバーが auth.admin.generateLink({ type: "magiclink" }) で発行した hashed_token を
   * POST /auth/v1/verify に { type: "magiclink", token_hash } で渡すと、
   * grant_type=password と同じ形のセッション JSON（access_token / refresh_token / user）が返る。
   */
  async function exchangeExtensionConnectToken(token: string) {
    const { url, anonKey } = getConfig();
    const controller = new AbortController();
    // Web側の応答待ち20秒より先に終了し、遅れてログインするのを防ぐ。
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${url}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "magiclink", token_hash: token }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (response.status === 429) throw new Error(EXTENSION_CONNECT_RATE_ERROR);
      if (response.status >= 500) throw new Error(EXTENSION_CONNECT_NETWORK_ERROR);
      if (!response.ok) {
        if (data?.code === "otp_expired" || data?.error_code === "otp_expired") {
          throw new Error(EXTENSION_CONNECT_EXPIRED_ERROR);
        }
        throw new Error("ログイン情報を確認できませんでした。拡張機能からもう一度ログインしてください。");
      }
      if (!data?.access_token || !data?.refresh_token || !data?.user?.id) {
        throw new Error(EXTENSION_CONNECT_NETWORK_ERROR);
      }
      return data;
    } catch (error) {
      // 内部の英語エラー・認証情報は表示しない。
      if (error instanceof Error && [
        EXTENSION_CONNECT_RATE_ERROR, EXTENSION_CONNECT_EXPIRED_ERROR,
        "ログイン情報を確認できませんでした。拡張機能からもう一度ログインしてください。"
      ].includes(error.message)) throw error;
      throw new Error(EXTENSION_CONNECT_NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleExtensionConnect(
    message: any,
    respond: (response: any) => void,
    senderTabId: number | null = null
  ) {
    try {
      const token = typeof message?.token === "string" ? message.token.trim() : "";

      if (!token || token.length > EXTENSION_CONNECT_TOKEN_MAX_LENGTH) {
        respond({ ok: false, error: "連携用のトークンを受け取れませんでした。" });
        return;
      }

      const session = await exchangeExtensionConnectToken(token);

      // 保存は既存のパスワードログインとまったく同じ経路（同じ chrome.storage.local のキー）を使う。
      await persistAuthSession(session);

      // メールは表示用にしか使わない。認証の判断はトークン交換の結果だけで行う。
      const verifiedEmail =
        typeof session?.user?.email === "string" && session.user.email
          ? session.user.email
          : typeof message?.email === "string" && message.email
            ? message.email
            : null;

      // 拡張セットアップ済みの記録。失敗しても連携そのものは成功扱いにする。
      void sendExtensionHeartbeat();

      respond({ ok: true, email: verifiedEmail });

      // ポップアップから開いた連携タブは、完了表示を見せてから自動で閉じる。
      // chrome.tabs.remove は "tabs" 権限なしで使える。閉じられなくても連携は成功している。
      if (message?.autoClose === true && senderTabId !== null) {
        setTimeout(() => {
          try {
            chromeApi.tabs?.remove?.(senderTabId, () => {
              // 既にユーザーが閉じていた場合などの lastError は握りつぶす。
              void chromeApi.runtime?.lastError;
            });
          } catch {
            // タブ操作に失敗しても何もしない。
          }
        }, EXTENSION_CONNECT_AUTO_CLOSE_DELAY_MS);
      }
    } catch (error) {
      // トークンやハッシュはログに残さない。
      console.warn("[furimanager-extension] extension connect failed");
      respond({
        ok: false,
        error:
          error instanceof Error && [
            EXTENSION_CONNECT_NETWORK_ERROR, EXTENSION_CONNECT_RATE_ERROR, EXTENSION_CONNECT_EXPIRED_ERROR,
            "ログイン情報を確認できませんでした。拡張機能からもう一度ログインしてください。"
          ].includes(error.message)
            ? error.message
            : "拡張機能へのログインに失敗しました。もう一度お試しください。"
      });
    }
  }

  /** manifest の externally_connectable に localhost が入っている開発用ビルドかどうか。 */
  function isDevConnectBuild() {
    const matches = chromeApi?.runtime?.getManifest?.()?.externally_connectable?.matches;

    if (!Array.isArray(matches)) {
      return false;
    }

    return matches.some(
      (pattern: unknown) =>
        typeof pattern === "string" &&
        (pattern.startsWith("http://localhost/") || pattern.startsWith("http://127.0.0.1/"))
    );
  }

  function isAllowedConnectPageSender(sender: any) {
    const rawOrigin =
      typeof sender?.origin === "string" && sender.origin
        ? sender.origin
        : typeof sender?.url === "string" && sender.url
          ? sender.url
          : "";

    if (!rawOrigin) {
      return false;
    }

    let origin: string;
    let hostname: string;
    let protocol: string;

    try {
      const parsed = new URL(rawOrigin);
      origin = parsed.origin;
      hostname = parsed.hostname;
      protocol = parsed.protocol;
    } catch {
      return false;
    }

    const allowedOrigins = new Set<string>();

    for (const candidate of [DEFAULT_APP_URL, getAppBaseUrl()]) {
      try {
        allowedOrigins.add(new URL(candidate).origin);
      } catch {
        // 設定値が URL として壊れている場合は無視する。
      }
    }

    if (allowedOrigins.has(origin)) {
      return true;
    }

    // 開発用 manifest のときだけ、ローカル開発サーバーからの連携を許可する。
    return (
      isDevConnectBuild() &&
      protocol === "http:" &&
      (hostname === "localhost" || hostname === "127.0.0.1")
    );
  }

  async function handleGetRakurakuAutoPollState(respond: (response: any) => void) {
    const enabled = await isRakurakuAutoPollEnabled();
    respond({ success: true, enabled, isRunningTask: isRunningRakurakuTask });
  }

  async function handleSetRakurakuAutoPollEnabled(enabled: boolean, respond: (response: any) => void) {
    await setLocalStorage({ [RAKURAKU_AUTO_POLL_KEY]: enabled === true });
    await setupRakurakuAlarm();
    respond({ success: true, enabled: enabled === true, isRunningTask: isRunningRakurakuTask });
  }

  async function handlePollRakurakuNow(respond: (response: any) => void) {
    try {
      const result = await pollNextRelistTask("manual", { ignoreAutoPollDisabled: true });
      respond({ success: true, ...result, isRunningTask: isRunningRakurakuTask });
    } catch (error) {
      respond({
        success: false,
        message: error instanceof Error ? error.message : "タスク確認に失敗しました",
        isRunningTask: isRunningRakurakuTask
      });
    }
  }

  async function setupRakurakuAlarm() {
    if (!chromeApi.alarms?.create) {
      return;
    }

    const delayInMinutes = nextRakurakuPollDelayMinutesOverride ?? getNextRakurakuPollDelayMinutes();
    nextRakurakuPollDelayMinutesOverride = null;
    chromeApi.alarms.clear?.(RAKURAKU_ALARM_NAME);
    chromeApi.alarms.create(RAKURAKU_ALARM_NAME, { delayInMinutes });
  }

  chromeApi.runtime.onInstalled?.addListener(() => {
    void setupRakurakuAlarm().catch(() => console.warn("[rakuraku] alarm setup skipped"));
    void sendExtensionHeartbeat();
  });

  chromeApi.runtime.onStartup?.addListener(() => {
    void setupRakurakuAlarm().catch(() => console.warn("[rakuraku] alarm setup skipped"));
    void sendExtensionHeartbeat();
  });

  chromeApi.alarms?.onAlarm?.addListener((alarm: { name: string }) => {
    if (alarm.name === RAKURAKU_ALARM_NAME) {
      void (async () => {
        try {
          const result = await pollNextRelistTask("alarm");
          nextRakurakuPollDelayMinutesOverride = normalizeNextPollDelayMinutes(result?.nextPollAfterSec);
        } catch {
          console.warn("[rakuraku] alarm poll skipped");
        } finally {
          await setupRakurakuAlarm();
        }
      })();
    }
  });

  async function pollNextRelistTask(reason: string, options: { ignoreAutoPollDisabled?: boolean } = {}) {
    if (isRunningRakurakuTask) {
      return { task: null, started: false, reason: "task_already_running" };
    }

    const hasSession = await restoreAuthState();

    if (!hasSession) {
      console.log("[rakuraku] poll skipped", { reason, result: "auth_required" });
      return { task: null, started: false, reason: "auth_required" };
    }

    if (options.ignoreAutoPollDisabled !== true && !(await isRakurakuAutoPollEnabled())) {
      return { task: null, started: false, reason: "full_auto_disabled" };
    }

    const next = await fetchAppApi("/api/automation/tasks/next");
    const task = next?.task || null;

    if (!task) {
      console.log("[rakuraku] no pending task", {
        reason,
        apiReason: next?.reason || "no_pending_task"
      });
      return { task: null, started: false, reason: next?.reason || "no_pending_task", diagnostics: next?.diagnostics || null, nextPollAfterSec: next?.nextPollAfterSec };
    }

    console.log("[rakuraku] pending task found", {
      reason,
      status: task.status,
      targetType: task.targetType,
      action: task.action
    });

    isRunningRakurakuTask = true;

    try {
      const started = await fetchAppApi(`/api/automation/tasks/${task.id}/start`, { method: "POST" });
      const startedTask = started?.task ? { ...task, status: started.task.status || "running" } : { ...task, status: "running" };
      const finalTask = await executeRelistTask(startedTask);
      console.log("[rakuraku] background task started", {
        reason,
        mode: task.payload?.mode
      });
      return { task: finalTask || startedTask, started: true, reason: "started", nextPollAfterSec: next?.nextPollAfterSec };
    } catch (error) {
      try {
        await completeTask(task.id, false, "task_failed");
      } catch {
        console.warn("[rakuraku] failed to mark task as failed");
      }
      throw error;
    } finally {
      isRunningRakurakuTask = false;
    }
  }

  async function executeRelistTask(task: any) {
    const executionMode = await getRakurakuExecutionMode();
    console.log("[rakuraku] executeRelistTask", {
      executionMode,
      action: task.action
    });

    if (task.action === "price_drop") {
      return executePriceDropTask(task);
    }

    if (executionMode === "real") {
      return executeRealCopyListingTask(task);
    }
    if (executionMode !== "dry-run") {
      throw new Error("unknown relist execution mode");
    }
    return executeDryRunRelistTask(task);
  }

  async function executeDryRunRelistTask(task: any) {
    const mockPage = buildMockRelistUrl();
    const detectionPromise = waitForMockRelistDetection(mockPage.nonce);
    await createTab({ url: mockPage.url, active: true });
    const detected = await detectionPromise;

    if (!detected) {
      throw new Error("dry-run: relist button not found on mock page");
    }

    const completed = await completeTask(task.id, true, "relist_completed");
    return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
  }
  async function executeRealCopyListingTask(task: any) {
    const mercariItemId = normalizeMercariItemId(task.payload?.mercariItemId || task.payload?.itemId || task.target_item_id || task.targetItemId);
    if (!mercariItemId) {
      throw new Error("real-copy-listing: mercari item id is missing");
    }
    const itemUrl = buildMercariItemUrl(mercariItemId);
    const tab = await createTab({ url: itemUrl, active: true });
    if (typeof tab?.id !== "number") {
      throw new Error("real-copy-listing: item page tab could not be opened");
    }
    await removeLocalStorage([MANUAL_CONFIRMATION_REQUIRED_KEY]);
    const manualConfirmationStartedAt = Date.now();
    await waitForTabComplete(tab.id, REAL_RELIST_DETECTION_TIMEOUT_MS);
    await sleep(1200);

    const result = await sendTabMessageWithRetry(tab.id, {
      type: "CLICK_FURIMANE_COPY_LISTING_BUTTON",
      taskId: task.id,
      mercariItemId
    });

    console.log("[rakuraku] real relist action result", {
      detected: result?.detected === true,
      clicked: result?.clicked === true,
      action: result?.action,
      reason: result?.reason
    });

    if (result?.action !== "relist" && result?.action !== "copy-listing") {
      throw new Error("real-copy-listing: relist action button was not clicked");
    }

    await waitForManualConfirmationRequired(mercariItemId, ["relist", "copy"], manualConfirmationStartedAt, task.id);

    const completed = await completeTask(task.id, true, "manual_confirmation_required", { requiresAttention: true });
    return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
  }

  async function executePriceDropTask(task: any) {
    const mercariItemId = normalizeMercariItemId(task.payload?.mercariItemId || task.payload?.itemId || task.target_item_id || task.targetItemId);
    if (!mercariItemId) {
      throw new Error("price-drop: mercari item id is missing");
    }

    const amount = normalizePositiveInteger(task.payload?.priceDropAmount ?? task.payload?.settings?.priceDropAmount, 100);
    const minimumPrice = normalizeNullableInteger(task.payload?.minimumPrice ?? task.payload?.settings?.minimumPrice);
    const editUrl = buildMercariEditUrl(mercariItemId);
    const tab = await createTab({ url: editUrl, active: true });

    if (typeof tab?.id !== "number") {
      throw new Error("price-drop: edit page tab could not be opened");
    }
    await removeLocalStorage([MANUAL_CONFIRMATION_REQUIRED_KEY]);

    await waitForTabComplete(tab.id, REAL_RELIST_DETECTION_TIMEOUT_MS);
    await sleep(1200);

    const result = await sendTabMessageWithRetry(tab.id, {
      type: "APPLY_FURIMANE_PRICE_DROP_ON_EDIT",
      taskId: task.id,
      mercariItemId,
      amount,
      minimumPrice
    });

    console.log("[rakuraku] price drop action result", {
      submitted: result?.submitted === true,
      reason: result?.reason
    });

    if (result?.manualConfirmationRequired === true) {
      const completed = await completeTask(task.id, true, "manual_confirmation_required", { requiresAttention: true, result });
      return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
    }

    throw new Error("price_drop_failed");
  }

  async function completeTask(taskId: string, success: boolean, message: string, extra: Record<string, unknown> = {}) {
    return fetchAppApi(`/api/automation/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ success, message, ...extra })
    });
  }

  function buildMockRelistUrl() {
    const url = new URL(chromeApi.runtime.getURL(MOCK_RELIST_PATH));
    const nonce = crypto.randomUUID ? crypto.randomUUID() : createFallbackUuid();
    url.searchParams.set("nonce", nonce);
    return { url: url.toString(), nonce };
  }
  function buildMercariItemUrl(itemId: string) {
    return `${MERCARI_ITEM_URL_BASE}${encodeURIComponent(itemId)}`;
  }

  function buildMercariEditUrl(itemId: string) {
    return `${MERCARI_EDIT_URL_BASE}${encodeURIComponent(itemId)}`;
  }

  function normalizeMercariItemId(value: unknown) {
    const text = String(value || "").trim();
    const matched = text.match(/m\d{6,}/i);
    return matched?.[0] ?? null;
  }

  function normalizePositiveInteger(value: unknown, fallback: number) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
  }

  function normalizeNullableInteger(value: unknown) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
  }

  function waitForMockRelistDetection(nonce: string) {
    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        chromeApi.runtime.onMessage.removeListener(listener);
        reject(new Error("dry-run: mock page detection timed out"));
      }, 5000);

      const listener = (message: any) => {
        if (message?.type !== "MOCK_RELIST_BUTTON_DETECTED" || message.nonce !== nonce) {
          return false;
        }

        clearTimeout(timeoutId);
        chromeApi.runtime.onMessage.removeListener(listener);
        resolve(message.detected === true);
        return false;
      };

      chromeApi.runtime.onMessage.addListener(listener);
    });
  }
  function waitForTabComplete(tabId: number, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        chromeApi.tabs.onUpdated?.removeListener(listener);
        resolve();
      };
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        chromeApi.tabs.onUpdated?.removeListener(listener);
        reject(new Error("real-copy-listing: item page load timed out"));
      }, timeoutMs);
      const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId === tabId && changeInfo?.status === "complete") {
          finish();
        }
      };
      chromeApi.tabs.onUpdated?.addListener(listener);
      chromeApi.tabs.get?.(tabId, (tab: { status?: string }) => {
        if (chromeApi.runtime.lastError) {
          return;
        }
        if (tab?.status === "complete") {
          finish();
        }
      });
    });
  }

  async function sendTabMessageWithRetry(tabId: number, message: Record<string, unknown>) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await sendTabMessage(tabId, message);
        if (response?.success && (message.type !== "CLICK_FURIMANE_COPY_LISTING_BUTTON" || response.clicked === true)) {
          return response;
        }

        if (message.type === "APPLY_FURIMANE_PRICE_DROP_ON_EDIT" && response?.success === false) {
          return response;
        }

        lastError = new Error(response?.message || "content script returned empty response");
      } catch (error) {
        lastError = error;
      }
      await sleep(REAL_RELIST_DETECTION_RETRY_MS);
    }
    throw lastError instanceof Error ? lastError : new Error("real-copy-listing: content script did not respond");
  }

  async function waitForManualConfirmationRequired(mercariItemId: string, actions: string[], startedAt: number, taskId: string) {
    const waitStartedAt = Date.now();

    while (Date.now() - waitStartedAt < REAL_RELIST_MANUAL_CONFIRMATION_TIMEOUT_MS) {
      const items = await getLocalStorage([MANUAL_CONFIRMATION_REQUIRED_KEY]);
      const confirmation = items[MANUAL_CONFIRMATION_REQUIRED_KEY];

      if (matchesManualConfirmationRequired(confirmation, mercariItemId, actions, startedAt, taskId)) {
        return confirmation;
      }

      await sleep(REAL_RELIST_DETECTION_RETRY_MS);
    }

    throw new Error("manual confirmation was not detected");
  }

  function matchesManualConfirmationRequired(item: any, mercariItemId: string, actions: string[], startedAt: number, taskId: string) {
    if (!item || typeof item !== "object" || item.status !== "manual_confirmation_required") {
      return false;
    }

    if (typeof item.savedAt !== "number" || item.savedAt < startedAt) {
      return false;
    }

    if (item.taskId !== taskId) {
      return false;
    }

    const itemId = normalizeMercariItemId(item.itemId);
    const itemUrlId = normalizeMercariItemId(item.itemUrl);
    return actions.includes(String(item.action || "")) && (itemId === mercariItemId || itemUrlId === mercariItemId);
  }

  function sendTabMessage(tabId: number, message: Record<string, unknown>) {
    return new Promise<any>((resolve, reject) => {
      try {
        chromeApi.tabs.sendMessage(tabId, message, (response: any) => {
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message || "tab message failed"));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function fetchAppApi(path: string, options: RequestInit = {}) {
    if (!(await ensureFreshAuthSession())) {
      authState.accessToken = null;
    }

    if (!authState.accessToken) {
      throw new Error("ログインしてから操作してください");
    }

    const requestUrl = `${getAppBaseUrl()}${path}`;
    const response = await fetch(requestUrl, {
      ...options,
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authState.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const responseText = await response.text();
    const data = responseText.trim() ? safeJsonParse(responseText) : null;

    console.log("[rakuraku] app api response", {
      path: getSafeApiLogPath(path),
      method: options.method || "GET",
      status: response.status,
      ok: response.ok
    });

    if (!response.ok || data?.success === false) {
      const errorReason = typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : "empty response";
      throw new Error(`API failed: ${response.status} ${errorReason}`);
    }

    return data;
  }

  function getExtensionVersion() {
    return chromeApi?.runtime?.getManifest?.().version || EXTENSION_FALLBACK_VERSION;
  }

  // ログイン済みのまま拡張を使っていない人も拾うため、起動時に1回だけ記録する。
  // 未ログインや通信失敗のときは何もしない（バックグラウンド処理を止めない）。
  async function sendExtensionHeartbeat() {
    try {
      const hasSession = await restoreAuthState();

      if (!hasSession) {
        return;
      }

      await fetchAppApi("/api/extension/heartbeat", {
        method: "POST",
        headers: {
          "X-Furimane-Client": "chrome-extension",
          "X-Furimane-Extension-Version": getExtensionVersion(),
          "X-Furimane-Extension-Id": chromeApi?.runtime?.id || "unknown",
          "X-Furimane-Api-Schema": EXTENSION_API_SCHEMA
        }
      });
    } catch {
      console.warn("[furimane] extension heartbeat skipped");
    }
  }

  function getSafeApiLogPath(path: string) {
    return path
      .replace(/\/api\/automation\/tasks\/[^/]+/g, "/api/automation/tasks/[id]")
      .replace(/\/api\/rakuraku\/relist-candidates\/[^/]+/g, "/api/rakuraku/relist-candidates/[id]");
  }

  function safeJsonParse(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function restoreAuthState() {
    const storageState = await getLocalStorage(AUTH_STORAGE_KEYS);
    let hasSession = applyAuthStateFromStorage(storageState);

    if (authState.refreshToken && (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))) {
      hasSession = await refreshSupabaseSession();
    }

    return hasSession;
  }

  function applyAuthStateFromStorage(storageState: Record<string, any>) {
    authState.accessToken = typeof storageState.supabaseAccessToken === "string" ? storageState.supabaseAccessToken : null;
    authState.refreshToken = typeof storageState.supabaseRefreshToken === "string" ? storageState.supabaseRefreshToken : null;
    authState.user = storageState.supabaseUser && typeof storageState.supabaseUser === "object" ? storageState.supabaseUser : null;
    authState.tokenExpiresAt = typeof storageState.supabaseTokenExpiresAt === "number" ? storageState.supabaseTokenExpiresAt : null;
    return Boolean(authState.accessToken && authState.user);
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

    return Boolean(authState.accessToken && authState.user);
  }

  async function persistAuthSession(data: any, fallbackRefreshToken: string | null = null, fallbackUser: Record<string, unknown> | null = null) {
    authState.accessToken = data.access_token;
    authState.refreshToken = data.refresh_token || fallbackRefreshToken || null;
    authState.user = data.user || fallbackUser || null;
    authState.tokenExpiresAt = typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : null;
    await setLocalStorage({
      supabaseAccessToken: authState.accessToken,
      supabaseRefreshToken: authState.refreshToken,
      supabaseUser: authState.user,
      supabaseTokenExpiresAt: authState.tokenExpiresAt
    });
  }

  async function ensureFreshAuthSession() {
    if (authState.refreshToken && (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))) {
      return refreshSupabaseSession();
    }

    return Boolean(authState.accessToken && authState.user);
  }

  function shouldRefreshAuthToken(expiresAt: number | null) {
    return typeof expiresAt === "number" && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
  }

  function getConfig() {
    const config = (globalThis as any).FurimanagerConfig;
    const url = String(config?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const anonKey = String(config?.SUPABASE_ANON_KEY || "").trim();

    if (!url || !anonKey) {
      throw new Error("config.js の Supabase 設定が未入力です");
    }

    return { url, anonKey };
  }

  function getAppBaseUrl() {
    const configuredAppUrl = String((globalThis as any).FurimanagerConfig?.APP_URL || "").trim().replace(/\/+$/, "");
    const appUrl = !configuredAppUrl || LEGACY_APP_URLS.has(configuredAppUrl) ? DEFAULT_APP_URL : configuredAppUrl;
    return appUrl;
  }

  async function getRakurakuExecutionMode() {
    const state = await getLocalStorage([RAKURAKU_EXECUTION_MODE_KEY]);
    return state[RAKURAKU_EXECUTION_MODE_KEY] === "dry-run" ? "dry-run" : "real";
  }

  async function isRakurakuAutoPollEnabled() {
    const state = await getLocalStorage([RAKURAKU_AUTO_POLL_KEY]);
    return state[RAKURAKU_AUTO_POLL_KEY] !== false;
  }

  function getNextRakurakuPollDelayMinutes() {
    return RAKURAKU_AUTO_POLL_MIN_MINUTES + Math.random() * RAKURAKU_AUTO_POLL_JITTER_MINUTES;
  }

  function normalizeNextPollDelayMinutes(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > 60 * 60) {
      return null;
    }

    return seconds / 60;
  }

  async function setRelistPending(payload: any) {
    if (!payload || typeof payload !== "object") {
      return { success: false, message: "保存する商品データが見つかりませんでした" };
    }

    const pendingItem = {
      itemId: payload.itemId ?? null,
      title: payload.title ?? null,
      price: typeof payload.price === "number" ? payload.price : null,
      itemUrl: payload.itemUrl ?? null,
      thumbnailUrl: payload.thumbnailUrl ?? null,
      imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls.filter((url: unknown) => typeof url === "string") : [],
      description: payload.description ?? null,
      categoryPath: Array.isArray(payload.categoryPath) ? payload.categoryPath.filter((category: unknown) => typeof category === "string") : [],
      condition: payload.condition ?? null,
      brand: payload.brand ?? null,
      size: payload.size ?? null,
      shippingPayer: payload.shippingPayer ?? null,
      shippingMethod: payload.shippingMethod ?? null,
      shippingFrom: payload.shippingFrom ?? null,
      shippingDays: payload.shippingDays ?? null,
      taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
      mode: payload.mode ?? "relist",
      savedAt: new Date().toISOString(),
    };

    try {
      await setLocalStorage({ [RELIST_PENDING_KEY]: pendingItem });
      await createTab({ url: MERCARI_SELL_URL, active: true });
      return { success: true };
    } catch {
      console.error("[furimanager-extension] set relist pending failed");
      return {
        success: false,
        message: "出品データの保存に失敗しました",
      };
    }
  }

  async function openInventoryLink(payload: any) {
    if (!payload || typeof payload !== "object") {
      return { success: false, message: "連携する商品データが見つかりませんでした" };
    }

    const url = new URL(`${getAppBaseUrl()}/dashboard/inventory/link`);
    const params: Record<string, string | null> = {
      platform: payload.platform ?? "mercari",
      mercari_item_id: payload.mercariItemId ?? null,
      listing_url: payload.listingUrl ?? null,
      listing_title: payload.listingTitle ?? null,
      listing_price: typeof payload.listingPrice === "number" ? String(payload.listingPrice) : null,
      listing_status: payload.listingStatus ?? null,
      image_url: payload.imageUrl ?? null,
      captured_at: payload.capturedAt ?? new Date().toISOString(),
    };

    Object.entries(params).forEach(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        url.searchParams.set(key, value);
      }
    });

    try {
      await createTab({ url: url.toString(), active: true });
      return { success: true };
    } catch {
      console.error("[furimanager-extension] open inventory link failed");
      return {
        success: false,
        message: "在庫連携ページを開けませんでした",
      };
    }
  }

  function getLocalStorage(keys: string[]) {
    return new Promise<Record<string, any>>((resolve, reject) => {
      try {
        chromeApi.storage.local.get(keys, (result: Record<string, any>) => {
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message || "storage get failed"));
            return;
          }

          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function setLocalStorage(items: Record<string, unknown>) {
    return new Promise<void>((resolve, reject) => {
      try {
        chromeApi.storage.local.set(items, () => {
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message || "storage set failed"));
            return;
          }

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function removeLocalStorage(keys: string[]) {
    return new Promise<void>((resolve, reject) => {
      try {
        chromeApi.storage.local.remove(keys, () => {
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message || "storage remove failed"));
            return;
          }

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function createTab(createProperties: { url: string; active?: boolean }) {
    return new Promise<{ id?: number }>((resolve, reject) => {
      try {
        chromeApi.tabs.create(createProperties, (tab: { id?: number }) => {
          if (chromeApi.runtime.lastError) {
            reject(new Error("新規出品ページを開けませんでした"));
            return;
          }

          resolve(tab);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("新規出品ページを開けませんでした"));
      }
    });
  }

  async function openYahooRelist(token: unknown, sender: any) {
    if (!isAllowedYahooSender(sender) || (sender.frameId != null && sender.frameId !== 0) || !Number.isInteger(sender.tab?.id) || typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token)) return { success: false };
    const key = `furimanager_yahoo_relist_${token}`;
    const state = await getLocalStorage([key]);
    const job = state[key];
    // SPAで編集→商品へ戻るとsender.urlが編集画面のままの場合がある。
    // メッセージの自己申告ではなく、Chromeが持つ現在のタブURLで商品を照合する。
    const tab = await new Promise<{ url?: string }>((resolve, reject) => {
      chromeApi.tabs.get(sender.tab.id, (current: { url?: string }) => {
        if (chromeApi.runtime.lastError || !current) reject(new Error("元の商品ページを確認できませんでした"));
        else resolve(current);
      });
    });
    const source = new URL(tab.url || "");
    if (source.origin !== "https://paypayfleamarket.yahoo.co.jp") return { success: false };
    const sourceId = source.pathname.match(/^\/item\/(z\d+)$/)?.[1];
    if (!sourceId || job?.item?.itemId !== sourceId || !["relist", "draft"].includes(job?.mode) ||
      typeof job.savedAt !== "number" || Date.now() < job.savedAt || Date.now() - job.savedAt > 120000) return { success: false };
    await createTab({ url: `https://paypayfleamarket-sec.yahoo.co.jp/item/add#furimanager-yahoo=${token}`, active: true });
    return { success: true };
  }

  function isAllowedYahooSender(sender: any, sellOnly = false): boolean {
    try {
      const url = new URL(sender?.url ?? sender?.tab?.url);
      return sellOnly
        ? url.origin === "https://paypayfleamarket-sec.yahoo.co.jp" && url.pathname === "/item/add"
        : url.origin === "https://paypayfleamarket.yahoo.co.jp";
    } catch { return false; }
  }

  function getAllowedYahooImageUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return url.origin === "https://auctions.c.yimg.jp" && url.pathname.startsWith("/images.auctions.yahoo.co.jp/") && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  async function fetchImageAsDataUrl(url: string | undefined, platform: "mercari" | "yahoo" = "mercari") {
    const parsedUrl = platform === "yahoo" ? getAllowedYahooImageUrl(url) : getAllowedImageUrl(url);
    if (!parsedUrl) {
      return { success: false, message: "画像URLが見つかりませんでした" };
    }

    try {
      const response = await fetch(parsedUrl, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;

      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      const declaredType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
      // Yahooの実商品画像はimage/jpgを返すことがある。Fileには標準のJPEG名で渡す。
      const type = platform === "yahoo" && declaredType === "image/jpg" ? "image/jpeg" : declaredType;
      if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      const bytes = await readResponseBodyWithLimit(response, MAX_IMAGE_BYTES);
      if (!bytes) return { success: false, message: "画像の取得に失敗しました" };

      return {
        success: true,
        dataUrl: `data:${type};base64,${bytesToBase64(bytes)}`,
        type,
      };
    } catch {
      return { success: false, message: "画像の取得に失敗しました" };
    }
  }

  function isAllowedMercariPageSender(sender: any) {
    try {
      return new URL(sender?.url ?? sender?.tab?.url).origin === "https://jp.mercari.com";
    } catch {
      return false;
    }
  }

  function getAllowedImageUrl(value: unknown) {
    if (typeof value !== "string") return null;
    try {
      const parsedUrl = new URL(value);
      const allowedHost = parsedUrl.hostname === "jp.mercari.com" || parsedUrl.hostname.endsWith(".mercdn.net");
      return parsedUrl.protocol === "https:" && allowedHost ? parsedUrl.toString() : null;
    } catch {
      return null;
    }
  }

  async function readResponseBodyWithLimit(response: Response, maxBytes: number) {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 8192;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.slice(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }
})();
