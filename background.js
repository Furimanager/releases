(() => {
    try {
        importScripts("config.js");
    }
    catch (error) {
        console.warn("[furimanager-extension] config.js import skipped", error);
    }
    const chromeApi = globalThis.chrome;
    const RELIST_PENDING_KEY = "relist_pending";
    const RAKURAKU_AUTO_POLL_KEY = "rakurakuAutoPollEnabledV2";
    const RAKURAKU_EXECUTION_MODE_KEY = "rakurakuExecutionMode";
    const RAKURAKU_ALARM_NAME = "rakurakuPoll";
    const RAKURAKU_AUTO_POLL_MIN_MINUTES = 10;
    const RAKURAKU_AUTO_POLL_JITTER_MINUTES = 3;
    const DEFAULT_APP_URL = "https://furimanager.com";
    const MERCARI_SELL_URL = "https://jp.mercari.com/sell";
    const MERCARI_ITEM_URL_BASE = "https://jp.mercari.com/item/";
    const MERCARI_EDIT_URL_BASE = "https://jp.mercari.com/sell/edit/";
    const MOCK_RELIST_PATH = "mock/mercari-relist.html";
    const REAL_RELIST_DETECTION_TIMEOUT_MS = 15000;
    const REAL_RELIST_DETECTION_RETRY_MS = 700;
    const REAL_RELIST_PENDING_CREATE_TIMEOUT_MS = 30000;
    const REAL_RELIST_SUBMIT_TIMEOUT_MS = 120000;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const AUTH_STORAGE_KEYS = [
        "supabaseAccessToken",
        "supabaseRefreshToken",
        "supabaseUser",
        "supabaseTokenExpiresAt"
    ];
    const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
    const MERCARI_DPOP_ANONYMOUS_UUID = "00000000-0000-0000-0000-000000000000";
    const authState = {
        accessToken: null,
        refreshToken: null,
        user: null,
        tokenExpiresAt: null
    };
    let isRunningRakurakuTask = false;
    let mercariDpopKeyPair = null;
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
    void setupRakurakuAlarm().catch((error) => console.warn("[rakuraku] alarm setup skipped", error));
    async function handleFetchImage(url, respond) {
        try {
            respond(await fetchImageAsDataUrl(url));
        }
        catch (error) {
            console.error("[furimanager-extension] fetch image request failed", error);
            respond({ success: false, message: "画像の取得に失敗しました" });
        }
    }
    async function handleFetchMercariItemDetail(message, respond) {
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
            const headers = {
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
        }
        catch (error) {
            console.warn("[furimanager-extension] mercari item detail fetch failed", error);
            respond({ success: false, message: "メルカリ商品情報の取得に失敗しました" });
        }
    }
    async function handleFetchMercariUserProfile(message, respond) {
        try {
            const userId = typeof message?.userId === "string" ? message.userId.trim() : "";
            if (!/^\d+$/.test(userId)) {
                respond({ success: false, message: "メルカリユーザーIDを確認できませんでした" });
                return;
            }
            const url = new URL("https://api.mercari.jp/users/get_profile");
            url.searchParams.set("id", userId);
            const headers = {
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
        }
        catch (error) {
            console.warn("[furimanager-extension] mercari user profile fetch failed", error);
            respond({ success: false, message: "メルカリユーザー情報の取得に失敗しました" });
        }
    }
    async function handleFetchMercariUserIdentityBadge(message, respond) {
        try {
            const userId = typeof message?.userId === "string" ? message.userId.trim() : "";
            if (!/^\d+$/.test(userId)) {
                respond({ success: false, message: "繝｡繝ｫ繧ｫ繝ｪ繝ｦ繝ｼ繧ｶ繝ｼID繧堤｢ｺ隱阪〒縺阪∪縺帙ｓ縺ｧ縺励◆" });
                return;
            }
            const url = new URL("https://api.mercari.jp/services/usersocialjp/v1/stats/has_identity_verified_badge");
            const headers = {
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
                respond({ success: false, message: `繝｡繝ｫ繧ｫ繝ｪ譛ｬ莠ｺ遒ｺ隱阪ヰ繝・ず縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆ (${response.status})` });
                return;
            }
            respond({ success: true, data: await response.json() });
        }
        catch (error) {
            console.warn("[furimanager-extension] mercari user identity badge fetch failed", error);
            respond({ success: false, message: "繝｡繝ｫ繧ｫ繝ｪ譛ｬ莠ｺ遒ｺ隱阪ヰ繝・ず縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆" });
        }
    }
    async function createMercariDpopProofJwt(htu, htm) {
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
            const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(unsignedToken));
            return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
        }
        catch (error) {
            console.warn("[furimanager-extension] mercari dpop proof skipped", error);
            return null;
        }
    }
    async function getMercariDpopKeyPair() {
        if (mercariDpopKeyPair) {
            return mercariDpopKeyPair;
        }
        mercariDpopKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        return mercariDpopKeyPair;
    }
    function base64UrlEncodeText(value) {
        return base64UrlEncodeBytes(new TextEncoder().encode(value));
    }
    function base64UrlEncodeBytes(bytes) {
        let binary = "";
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    function createFallbackUuid() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    async function handleSetRelistPending(payload, respond) {
        respond(await setRelistPending(payload));
    }
    async function handleOpenInventoryLink(payload, respond) {
        respond(await openInventoryLink(payload));
    }
    async function handleGetRakurakuAutoPollState(respond) {
        const enabled = await isRakurakuAutoPollEnabled();
        respond({ success: true, enabled, isRunningTask: isRunningRakurakuTask });
    }
    async function handleSetRakurakuAutoPollEnabled(enabled, respond) {
        await setLocalStorage({ [RAKURAKU_AUTO_POLL_KEY]: enabled === true });
        await setupRakurakuAlarm();
        respond({ success: true, enabled: enabled === true, isRunningTask: isRunningRakurakuTask });
    }
    async function handlePollRakurakuNow(respond) {
        try {
            const result = await pollNextRelistTask("manual", { ignoreAutoPollDisabled: true });
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
    async function setupRakurakuAlarm() {
        if (!chromeApi.alarms?.create) {
            return;
        }
        chromeApi.alarms.clear?.(RAKURAKU_ALARM_NAME);
        chromeApi.alarms.create(RAKURAKU_ALARM_NAME, { delayInMinutes: getNextRakurakuPollDelayMinutes() });
    }
    chromeApi.runtime.onInstalled?.addListener(() => {
        void setupRakurakuAlarm().catch((error) => console.warn("[rakuraku] alarm setup skipped", error));
    });
    chromeApi.runtime.onStartup?.addListener(() => {
        void setupRakurakuAlarm().catch((error) => console.warn("[rakuraku] alarm setup skipped", error));
    });
    chromeApi.alarms?.onAlarm?.addListener((alarm) => {
        if (alarm.name === RAKURAKU_ALARM_NAME) {
            void (async () => {
                try {
                    await pollNextRelistTask("alarm");
                }
                catch (error) {
                    console.warn("[rakuraku] alarm poll skipped", error);
                }
                finally {
                    await setupRakurakuAlarm();
                }
            })();
        }
    });
    async function pollNextRelistTask(reason, options = {}) {
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
                apiReason: next?.reason || "no_pending_task",
                diagnostics: next?.diagnostics || null
            });
            return { task: null, started: false, reason: next?.reason || "no_pending_task", diagnostics: next?.diagnostics || null };
        }
        console.log("[rakuraku] pending task found", {
            reason,
            taskId: task.id,
            status: task.status,
            targetType: task.targetType,
            targetId: task.targetId,
            action: task.action,
            title: task.payload?.title,
            mercariItemId: task.payload?.mercariItemId
        });
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
                await completeTask(task.id, false, error instanceof Error ? error.message : "relist failed");
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
            action: task.action,
            title: task.payload?.title,
            mercariItemId: task.payload?.mercariItemId
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
    async function executeDryRunRelistTask(task) {
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
    async function executeRealCopyListingTask(task) {
        const mercariItemId = normalizeMercariItemId(task.payload?.mercariItemId || task.payload?.itemId || task.target_item_id || task.targetItemId);
        if (!mercariItemId) {
            throw new Error("real-copy-listing: mercari item id is missing");
        }
        const itemUrl = buildMercariItemUrl(mercariItemId);
        const tab = await createTab({ url: itemUrl, active: true });
        if (typeof tab?.id !== "number") {
            throw new Error("real-copy-listing: item page tab could not be opened");
        }
        await waitForTabComplete(tab.id, REAL_RELIST_DETECTION_TIMEOUT_MS);
        await sleep(1200);
        const result = await sendTabMessageWithRetry(tab.id, {
            type: "CLICK_FURIMANE_COPY_LISTING_BUTTON",
            taskId: task.id,
            mercariItemId
        });
        console.log("[rakuraku] real relist action result", {
            taskId: task.id,
            mercariItemId,
            itemUrl,
            detected: result?.detected === true,
            clicked: result?.clicked === true,
            action: result?.action,
            reason: result?.reason
        });
        if (result?.action !== "relist") {
            throw new Error("real-copy-listing: relist button was not clicked");
        }
        await waitForRelistSubmitCompletion(mercariItemId);
        const completed = await completeTask(task.id, true, "relist: listing submit clicked");
        return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
    }
    async function executePriceDropTask(task) {
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
            taskId: task.id,
            mercariItemId,
            editUrl,
            currentPrice: result?.currentPrice,
            nextPrice: result?.nextPrice,
            submitted: result?.submitted === true,
            reason: result?.reason
        });
        if (result?.submitted === true) {
            const completed = await completeTask(task.id, true, `price-drop: changed price from ${result.currentPrice} to ${result.nextPrice}`);
            return completed?.task ? { ...task, ...completed.task, payload: completed.task.payload_json || task.payload } : { ...task, status: "succeeded" };
        }
        throw new Error(`price-drop: ${result?.reason || "price update failed"}`);
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
    function buildMercariItemUrl(itemId) {
        return `${MERCARI_ITEM_URL_BASE}${encodeURIComponent(itemId)}`;
    }
    function buildMercariEditUrl(itemId) {
        return `${MERCARI_EDIT_URL_BASE}${encodeURIComponent(itemId)}`;
    }
    function normalizeMercariItemId(value) {
        const text = String(value || "").trim();
        const matched = text.match(/m\d{6,}/i);
        return matched?.[0] ?? null;
    }
    function normalizePositiveInteger(value, fallback) {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
    }
    function normalizeNullableInteger(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const numberValue = Number(value);
        return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
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
    function waitForTabComplete(tabId, timeoutMs) {
        return new Promise((resolve, reject) => {
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
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo?.status === "complete") {
                    finish();
                }
            };
            chromeApi.tabs.onUpdated?.addListener(listener);
            chromeApi.tabs.get?.(tabId, (tab) => {
                if (chromeApi.runtime.lastError) {
                    return;
                }
                if (tab?.status === "complete") {
                    finish();
                }
            });
        });
    }
    async function sendTabMessageWithRetry(tabId, message) {
        let lastError = null;
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
            }
            catch (error) {
                lastError = error;
            }
            await sleep(REAL_RELIST_DETECTION_RETRY_MS);
        }
        throw lastError instanceof Error ? lastError : new Error("real-copy-listing: content script did not respond");
    }
    async function waitForRelistSubmitCompletion(mercariItemId) {
        const createStartedAt = Date.now();
        let matchedPending = false;
        while (Date.now() - createStartedAt < REAL_RELIST_PENDING_CREATE_TIMEOUT_MS) {
            if (matchesRelistPendingItem(await getRelistPendingItem(), mercariItemId)) {
                matchedPending = true;
                break;
            }
            await sleep(REAL_RELIST_DETECTION_RETRY_MS);
        }
        if (!matchedPending) {
            throw new Error("real-copy-listing: relist pending was not created");
        }
        const submitStartedAt = Date.now();
        while (Date.now() - submitStartedAt < REAL_RELIST_SUBMIT_TIMEOUT_MS) {
            if (!matchesRelistPendingItem(await getRelistPendingItem(), mercariItemId)) {
                return;
            }
            await sleep(REAL_RELIST_DETECTION_RETRY_MS);
        }
        throw new Error("real-copy-listing: listing submit did not finish");
    }
    async function getRelistPendingItem() {
        const items = await getLocalStorage([RELIST_PENDING_KEY]);
        return items[RELIST_PENDING_KEY] ?? null;
    }
    function matchesRelistPendingItem(item, mercariItemId) {
        if (!item || typeof item !== "object" || item.mode !== "relist") {
            return false;
        }
        const itemId = normalizeMercariItemId(item.itemId);
        const itemUrl = typeof item.itemUrl === "string" ? item.itemUrl : "";
        return itemId === mercariItemId || itemUrl.includes(mercariItemId);
    }
    function sendTabMessage(tabId, message) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.tabs.sendMessage(tabId, message, (response) => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message || "tab message failed"));
                        return;
                    }
                    resolve(response);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    function sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
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
        console.log("[rakuraku] app api response", {
            requestUrl,
            method: options.method || "GET",
            status: response.status,
            ok: response.ok,
            responseText
        });
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
        const latestStorage = await getLocalStorage(AUTH_STORAGE_KEYS);
        const latestRefreshToken = typeof latestStorage.supabaseRefreshToken === "string" ? latestStorage.supabaseRefreshToken : null;
        if (latestRefreshToken &&
            latestRefreshToken !== authState.refreshToken &&
            applyAuthStateFromStorage(latestStorage) &&
            !shouldRefreshAuthToken(authState.tokenExpiresAt)) {
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
            if (fallbackStorage.supabaseRefreshToken &&
                fallbackStorage.supabaseRefreshToken !== authState.refreshToken &&
                applyAuthStateFromStorage(fallbackStorage)) {
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
    async function ensureFreshAuthSession() {
        if (authState.refreshToken && (!authState.accessToken || shouldRefreshAuthToken(authState.tokenExpiresAt))) {
            return refreshSupabaseSession();
        }
        return Boolean(authState.accessToken && authState.user);
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
        const appUrl = String(globalThis.FurimanagerConfig?.APP_URL || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
        return appUrl;
    }
    async function getRakurakuExecutionMode() {
        return "real";
    }
    async function isRakurakuAutoPollEnabled() {
        return true;
    }
    function getNextRakurakuPollDelayMinutes() {
        return RAKURAKU_AUTO_POLL_MIN_MINUTES + Math.random() * RAKURAKU_AUTO_POLL_JITTER_MINUTES;
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
    async function openInventoryLink(payload) {
        if (!payload || typeof payload !== "object") {
            return { success: false, message: "連携する商品データが見つかりませんでした" };
        }
        const url = new URL(`${getAppBaseUrl()}/dashboard/inventory/link`);
        const params = {
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
        }
        catch (error) {
            console.error("[furimanager-extension] open inventory link failed", error);
            return {
                success: false,
                message: error instanceof Error ? error.message : "在庫連携ページを開けませんでした",
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
