(() => {
    const chromeApi = globalThis.chrome;
    const RELIST_PENDING_KEY = "relist_pending";
    const MERCARI_SELL_URL = "https://jp.mercari.com/sell";
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
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
        if (message?.type !== "SET_RELIST_PENDING") {
            return false;
        }
        void handleSetRelistPending(message.payload, respond);
        return true;
    });
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
    async function setRelistPending(payload) {
        if (!payload || typeof payload !== "object") {
            return { success: false, message: "保存する出品データが見つかりませんでした" };
        }
        const pendingItem = {
            itemId: payload.itemId ?? null,
            title: payload.title ?? null,
            price: typeof payload.price === "number" ? payload.price : null,
            itemUrl: payload.itemUrl ?? null,
            thumbnailUrl: payload.thumbnailUrl ?? null,
            imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls.filter((url) => typeof url === "string") : [],
            description: payload.description ?? null,
            categoryPath: Array.isArray(payload.categoryPath)
                ? payload.categoryPath.filter((category) => typeof category === "string")
                : [],
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
    function setLocalStorage(items) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.storage.local.set(items, () => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error("出品データの保存に失敗しました"));
                        return;
                    }
                    resolve();
                });
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error("出品データの保存に失敗しました"));
            }
        });
    }
    function createTab(createProperties) {
        return new Promise((resolve, reject) => {
            try {
                chromeApi.tabs.create(createProperties, () => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error("新規出品ページを開けませんでした"));
                        return;
                    }
                    resolve();
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
