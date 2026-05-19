(() => {
    try {
        importScripts("config.js");
    }
    catch (error) {
        console.warn("[furimanager-extension] config.js import skipped", error);
    }
    const chromeApi = globalThis.chrome;
    const RELIST_PENDING_KEY = "relist_pending";
    const RAKURAKU_AUTO_POLL_KEY = "rakurakuAutoPollEnabled";
    const RAKURAKU_EXECUTION_MODE_KEY = "rakurakuExecutionMode";
    const RAKURAKU_ALARM_NAME = "rakurakuPoll";
    const MERCARI_SELL_URL = "https://jp.mercari.com/sell";
    const MOCK_RELIST_PATH = "mock/mercari-relist.html";
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    const AUTH_STORAGE_KEYS = [
        "supabaseAccessToken",
        "supabaseRefreshToken",
        "supabaseUser",
        "supabaseTokenExpiresAt"
    ];
    const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
    const authState = {
        accessToken: null,
        refreshToken: null,
        user: null,
        tokenExpiresAt: null
    };
    let isRunningRakurakuTask = false;
    if (!chromeApi?.runtime?.onMessage) {
        return;
    }
    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        const respond = (response) => {
            try {
                sendResponse(response);
            }
            catch (error) {
                console.error("[furimanager-extension] sendResponse failed", error);
            }
        };
        if (message?.type === "FETCH_IMAGE_AS_DATA_URL") {
            void handleFetchImage(message.url, respond);
            return true;
        }
        if (message?.type === "SET_RELIST_PENDING") {
            void handleSetRelistPending(message.payload, respond);
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
    setupRakurakuAlarm();
    void pollNextRelistTask("startup").catch((error) => console.warn("[rakuraku] startup poll skipped", error));
    async function handleFetchImage(url, respond) {
        try {
            respond(await fetchImageAsDataUrl(url));
        }
        catch (error) {
            console.error("[furimanager-extension] fetch image request failed", error);
            respond({ success: false, message: "画像の取得に失敗しました" });
        }
    }
    async function handleSetRelistPending(payload, respond) {
        respond(await setRelistPending(payload));
    }
    async function handleGetRakurakuAutoPollState(respond) {
        const enabled = await isRakurakuAutoPollEnabled();
        respond({
            success: true,
            enabled,
            isRunningTask: isRunningRakurakuTask
        });
    }
    async function handleSetRakurakuAutoPollEnabled(enabled, respond) {
        await setLocalStorage({ [RAKURAKU_AUTO_POLL_KEY]: enabled });
        if (enabled) {
            setupRakurakuAlarm();
            void pollNextRelistTask("toggle_on").catch((error) => console.warn("[rakuraku] toggle poll skipped", error));
        }
        respond({ success: true, enabled, isRunningTask: isRunningRakurakuTask });
    }
    async function handlePollRakurakuNow(respond) {
        try {
            const result = await pollNextRelistTask("manual");
            respond({ success: true, ...result, isRunningTask: isRunningRakurakuTask });
        }
        catch (error) {
            respond({
                success: false,
                message: error instanceof Error ? error.message : "タスク確認に失敗しました",
                isRunningTask: isRunningRakurakuTask
            });
        }
    }
    function setupRakurakuAlarm() {
        if (!chromeApi.alarms?.create) {
            return;
        }
        chromeApi.alarms.create(RAKURAKU_ALARM_NAME, {
            periodInMinutes: 1
        });
    }
    chromeApi.runtime.onInstalled?.addListener(() => {
        setupRakurakuAlarm();
    });
    chromeApi.runtime.onStartup?.addListener(() => {
        setupRakurakuAlarm();
    });
    chromeApi.alarms?.onAlarm?.addListener((alarm) => {
        if (alarm.name === RAKURAKU_ALARM_NAME) {
            void pollNextRelistTask("alarm").catch((error) => console.warn("[rakuraku] alarm poll skipped", error));
        }
    });
    async function pollNextRelistTask(reason) {
        if (!(await isRakurakuAutoPollEnabled())) {
            return { task: null, started: false, reason: "auto_poll_disabled" };
        }
        if (isRunningRakurakuTask) {
            return { task: null, started: false, reason: "task_already_running" };
        }
        const hasSession = await restoreAuthState();
        if (!hasSession) {
            return { task: null, started: false, reason: "auth_required" };
        }
        const next = await fetchAppApi("/api/automation/tasks/next");
        const task = next?.task || null;
        if (!task) {
            return { task: null, started: false, reason: "no_pending_task" };
        }
        isRunningRakurakuTask = true;
        try {
            const started = await fetchAppApi(`/api/automation/tasks/${task.id}/start`, { method: "POST" });
            const startedTask = started?.task ? { ...task, status: started.task.status || "running" } : { ...task, status: "running" };
            const finalTask = await executeRelistTask(startedTask);
            console.log("[rakuraku] background task started", {
                reason,
                taskId: task.id,
                title: task.payload?.title,
                mode: task.payload?.mode
            });
            return { task: finalTask || startedTask, started: true, reason: "started" };
        }
        catch (error) {
            try {
                await completeTask(task.id, false, error instanceof Error ? error.message : "dry-run failed");
            }
            catch (completeError) {
                console.warn("[rakuraku] failed to mark task as failed", completeError);
            }
            throw error;
        }
        finally {
            isRunningRakurakuTask = false;
        }
    }
    async function executeRelistTask(task) {
        const executionMode = await getRakurakuExecutionMode();
        console.log("[rakuraku] executeRelistTask", {
            executionMode,
            taskId: task.id,
            title: task.payload?.title,
            mercariItemId: task.payload?.mercariItemId
        });
        if (executionMode !== "dry-run") {
            throw new Error("real mode is not implemented yet");
        }
        const mockUrl = buildMockRelistUrl(task);
        const detectionPromise = waitForMockRelistDetection(task.id);
        await createTab({ url: mockUrl, active: true });
        const detected = await detectionPromise;
        if (!detected) {
            throw new Error("dry-run: relist button not found on mock page");
        }
        const completed = await completeTask(task.id, true, "dry-run: relist button detected on mock page");
        return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
    }
    async function completeTask(taskId, success, message) {
        return fetchAppApi(`/api/automation/tasks/${taskId}/complete`, {
            method: "POST",
            body: JSON.stringify({ success, message })
        });
    }
    function buildMockRelistUrl(task) {
        const url = new URL(chromeApi.runtime.getURL(MOCK_RELIST_PATH));
        url.searchParams.set("taskId", task.id);
        if (task.payload?.title) {
            url.searchParams.set("title", task.payload.title);
        }
        if (task.payload?.mercariItemId) {
            url.searchParams.set("itemId", task.payload.mercariItemId);
        }
        return url.toString();
    }
    function waitForMockRelistDetection(taskId) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                chromeApi.runtime.onMessage.removeListener(listener);
                reject(new Error("dry-run: mock page detection timed out"));
            }, 5000);
            const listener = (message) => {
                if (message?.type !== "MOCK_RELIST_BUTTON_DETECTED" || message.taskId !== taskId) {
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
    async function fetchAppApi(path, options = {}) {
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
        if (!response.ok || data?.success === false) {
            throw new Error(`API failed: ${response.status} ${responseText || data?.error || "empty response"}`);
        }
        return data;
    }
    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        }
        catch {
            return null;
        }
    }
    async function restoreAuthState() {
        const storageState = await getLocalStorage(AUTH_STORAGE_KEYS);
        let hasSession = applyAuthStateFromStorage(storageState);
        if (authState.refreshToken && (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))) {
            hasSession = await refreshSupabaseSession();
        }
        if (!hasSession && (storageState.supabaseAccessToken || storageState.supabaseRefreshToken)) {
            await removeLocalStorage(AUTH_STORAGE_KEYS);
            authState.accessToken = null;
            authState.refreshToken = null;
            authState.user = null;
            authState.tokenExpiresAt = null;
        }
        return hasSession;
    }
    function applyAuthStateFromStorage(storageState) {
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
            return false;
        }
        await persistAuthSession(data, authState.refreshToken, authState.user);
        return Boolean(authState.accessToken && authState.user);
    }
    async function persistAuthSession(data, fallbackRefreshToken = null, fallbackUser = null) {
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
    function shouldRefreshAuthToken(expiresAt) {
        return typeof expiresAt === "number" && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
    }
    function getConfig() {
        const config = globalThis.FurimanagerConfig;
        const url = String(config?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
        const anonKey = String(config?.SUPABASE_ANON_KEY || "").trim();
        if (!url || !anonKey) {
            throw new Error("config.js の Supabase 設定が未入力です");
        }
        return { url, anonKey };
    }
    function getAppBaseUrl() {
        const appUrl = String(globalThis.FurimanagerConfig?.APP_URL || "").trim().replace(/\/+$/, "");
        if (!appUrl) {
            throw new Error("config.js の APP_URL が未設定です");
        }
        return appUrl;
    }
    async function isRakurakuAutoPollEnabled() {
        const storageState = await getLocalStorage([RAKURAKU_AUTO_POLL_KEY]);
        return storageState[RAKURAKU_AUTO_POLL_KEY] !== false;
    }
    async function getRakurakuExecutionMode() {
        const storageState = await getLocalStorage([RAKURAKU_EXECUTION_MODE_KEY]);
        return storageState[RAKURAKU_EXECUTION_MODE_KEY] === "real" ? "real" : "dry-run";
    }
    async function setRelistPending(payload) {
        if (!payload || typeof payload !== "object") {
            return { success: false, message: "保存する商品データが見つかりませんでした" };
        }
        const pendingItem = {
            itemId: payload.itemId ?? null,
            title: payload.title ?? null,
            price: typeof payload.price === "number" ? payload.price : null,
            itemUrl: payload.itemUrl ?? null,
            thumbnailUrl: payload.thumbnailUrl ?? null,
            imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls.filter((url) => typeof url === "string") : [],
            description: payload.description ?? null,
            categoryPath: Array.isArray(payload.categoryPath) ? payload.categoryPath.filter((category) => typeof category === "string") : [],
            condition: payload.condition ?? null,
            brand: payload.brand ?? null,
            size: payload.size ?? null,
            shippingPayer: payload.shippingPayer ?? null,
            shippingMethod: payload.shippingMethod ?? null,
            shippingFrom: payload.shippingFrom ?? null,
            shippingDays: payload.shippingDays ?? null,
            mode: payload.mode ?? "relist",
            savedAt: new Date().toISOString(),
        };
        try {
            await setLocalStorage({ [RELIST_PENDING_KEY]: pendingItem });
            await createTab({ url: MERCARI_SELL_URL, active: true });
            return { success: true };
        }
        catch (error) {
            console.error("[furimanager-extension] set relist pending failed", error);
            return {
                success: false,
                message: error instanceof Error ? error.message : "出品データの保存に失敗しました",
            };
        }
    }
    function getLocalStorage(keys) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.storage.local.get(keys, (result) => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message || "storage get failed"));
                        return;
                    }
                    resolve(result);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    function setLocalStorage(items) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.storage.local.set(items, () => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message || "storage set failed"));
                        return;
                    }
                    resolve();
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    function removeLocalStorage(keys) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.storage.local.remove(keys, () => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message || "storage remove failed"));
                        return;
                    }
                    resolve();
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    function createTab(createProperties) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.tabs.create(createProperties, (tab) => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error("新規出品ページを開けませんでした"));
                        return;
                    }
                    resolve(tab);
                });
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error("新規出品ページを開けませんでした"));
            }
        });
    }
    async function fetchImageAsDataUrl(url) {
        if (!url) {
            return { success: false, message: "画像URLが見つかりませんでした" };
        }
        try {
            const response = await fetch(url, {
                credentials: "include",
            });
            if (!response.ok) {
                return { success: false, message: "画像の取得に失敗しました" };
            }
            const contentLengthHeader = response.headers.get("content-length");
            const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
            if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
                return { success: false, message: "画像の取得に失敗しました" };
            }
            const type = response.headers.get("content-type") || "image/jpeg";
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > MAX_IMAGE_BYTES) {
                return { success: false, message: "画像の取得に失敗しました" };
            }
            return {
                success: true,
                dataUrl: `data:${type};base64,${arrayBufferToBase64(buffer)}`,
                type,
            };
        }
        catch {
            return { success: false, message: "画像の取得に失敗しました" };
        }
    }
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 8192;
        let binary = "";
        for (let index = 0; index < bytes.length; index += chunkSize) {
            const chunk = bytes.slice(index, index + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
    }
})();
