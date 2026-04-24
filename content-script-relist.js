(() => {
    const mountedWindow = window;
    const chromeApi = globalThis.chrome;
    const RELIST_PENDING_KEY = "relist_pending";
    const MAX_WAIT_MS = 12000;
    const RETRY_INTERVAL_MS = 500;
    let imageFillAttempted = false;
    if (mountedWindow.__furimanagerRelistAutofillMounted) {
        return;
    }
    mountedWindow.__furimanagerRelistAutofillMounted = true;
    function boot() {
        if (!window.location.pathname.startsWith("/sell")) {
            return;
        }
        getPendingItem((item) => {
            if (!item) {
                return;
            }
            void waitForFormAndFill(item);
        });
    }
    function getPendingItem(callback) {
        if (!chromeApi?.storage?.local) {
            callback(null);
            return;
        }
        chromeApi.storage.local.get(RELIST_PENDING_KEY, (items) => {
            if (chromeApi.runtime?.lastError) {
                callback(null);
                return;
            }
            const item = items[RELIST_PENDING_KEY];
            callback(isRelistPendingItem(item) ? item : null);
        });
    }
    async function waitForFormAndFill(item) {
        const startedAt = Date.now();
        let hasFilledAnyField = false;
        while (Date.now() - startedAt < MAX_WAIT_MS) {
            const result = await fillAvailableFields(item);
            hasFilledAnyField = result.filled || hasFilledAnyField;
            if (result.complete) {
                showToast(getToastMessage(item.mode));
                clearPendingItem();
                return;
            }
            await sleep(RETRY_INTERVAL_MS);
        }
        if (hasFilledAnyField) {
            showToast(getToastMessage(item.mode));
            clearPendingItem();
            return;
        }
        showToast("フリマネの出品データを読み込みましたが、入力できる欄が見つかりませんでした");
        clearPendingItem();
    }
    async function fillAvailableFields(item) {
        let targetCount = 0;
        let filledCount = 0;
        if ((item.imageUrls?.length ?? 0) > 0) {
            targetCount += 1;
            filledCount += await fillImageField(item.imageUrls) ? 1 : 0;
        }
        if (item.title) {
            targetCount += 1;
            filledCount += setFieldValue(findTitleField(), item.title) ? 1 : 0;
        }
        if (typeof item.price === "number") {
            targetCount += 1;
            filledCount += setFieldValue(findPriceField(), String(item.price)) ? 1 : 0;
        }
        if (item.description) {
            targetCount += 1;
            filledCount += setFieldValue(findDescriptionField(), item.description) ? 1 : 0;
        }
        fillMetadataFields(item);
        return {
            filled: filledCount > 0,
            complete: targetCount > 0 && filledCount === targetCount,
        };
    }
    async function fillImageField(imageUrls) {
        if (imageFillAttempted) {
            return false;
        }
        const input = findImageField();
        if (!input) {
            return false;
        }
        imageFillAttempted = true;
        const files = await fetchImageFiles(imageUrls);
        if (files.length === 0) {
            imageFillAttempted = false;
            return false;
        }
        const dataTransfer = new DataTransfer();
        files.forEach((file) => dataTransfer.items.add(file));
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }
    function findImageField() {
        const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
        return input instanceof HTMLInputElement ? input : null;
    }
    async function fetchImageFiles(imageUrls) {
        const uniqueUrls = Array.from(new Set(imageUrls)).slice(0, 10);
        const files = [];
        for (let index = 0; index < uniqueUrls.length; index += 1) {
            const file = await fetchImageFile(uniqueUrls[index], index);
            if (file) {
                files.push(file);
            }
        }
        return files;
    }
    async function fetchImageFile(url, index) {
        try {
            const image = await fetchImageThroughBackground(url);
            if (!image) {
                return null;
            }
            const blob = dataUrlToBlob(image.dataUrl, image.type);
            if (!blob) {
                return null;
            }
            const extension = getImageExtension(blob.type, url);
            return new File([blob], `furimanager-copy-${index + 1}.${extension}`, {
                type: blob.type || "image/jpeg",
            });
        }
        catch {
            return null;
        }
    }
    function fetchImageThroughBackground(url) {
        return new Promise((resolve, reject) => {
            if (!chromeApi?.runtime?.sendMessage) {
                reject(new Error("background unavailable"));
                return;
            }
            chromeApi.runtime.sendMessage({
                type: "FETCH_IMAGE_AS_DATA_URL",
                url,
            }, (response) => {
                if (chromeApi.runtime?.lastError || !response?.success || !response.dataUrl) {
                    reject(new Error(response?.message ?? "image fetch failed"));
                    return;
                }
                resolve({
                    dataUrl: response.dataUrl,
                    type: response.type ?? "image/jpeg",
                });
            });
        });
    }
    function dataUrlToBlob(dataUrl, fallbackType) {
        const commaIdx = dataUrl.indexOf(",");
        if (!dataUrl.startsWith("data:") || commaIdx === -1) {
            return null;
        }
        const meta = dataUrl.slice(0, commaIdx);
        const base64 = dataUrl.slice(commaIdx + 1);
        const type = meta.match(/data:([^;]+)/)?.[1] ?? fallbackType;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Blob([bytes], { type });
    }
    function getImageExtension(type, url) {
        if (type.includes("png")) {
            return "png";
        }
        if (type.includes("webp")) {
            return "webp";
        }
        const matched = url.match(/\.(jpe?g|png|webp)(?:\?|$)/i);
        return matched?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
    }
    function clearPendingItem() {
        chromeApi?.storage?.local.remove(RELIST_PENDING_KEY);
    }
    function fillMetadataFields(item) {
        setOptionalField(findCategoryField(), item.categoryPath?.join(" > ") ?? null);
        setOptionalField(findConditionField(), item.condition);
        setOptionalField(findBrandField(), item.brand);
        setOptionalField(findSizeField(), item.size);
        setOptionalField(findShippingPayerField(), item.shippingPayer);
        setOptionalField(findShippingMethodField(), item.shippingMethod);
        setOptionalField(findShippingFromField(), item.shippingFrom);
        setOptionalField(findShippingDaysField(), item.shippingDays);
    }
    function setOptionalField(field, value) {
        if (!value) {
            return;
        }
        setFieldValue(field, value);
    }
    function findTitleField() {
        return findInputLike([
            'input[name="name"]',
            'input[name="title"]',
            'textarea[name="name"]',
            '[data-testid*="name"] input',
            '[data-testid*="title"] input',
            'input[aria-label*="商品名"]',
            'textarea[aria-label*="商品名"]',
        ]);
    }
    function findCategoryField() {
        return findInputLike([
            'select[name*="category"]',
            'input[name*="category"]',
            '[data-testid*="category"] select',
            '[data-testid*="category"] input',
            'input[aria-label*="カテゴリー"]',
        ]);
    }
    function findConditionField() {
        return findInputLike([
            'select[name*="condition"]',
            'input[name*="condition"]',
            '[data-testid*="condition"] select',
            '[data-testid*="condition"] input',
            'select[aria-label*="商品の状態"]',
            'input[aria-label*="商品の状態"]',
        ]);
    }
    function findBrandField() {
        return findInputLike([
            'input[name*="brand"]',
            '[data-testid*="brand"] input',
            'input[aria-label*="ブランド"]',
        ]);
    }
    function findSizeField() {
        return findInputLike([
            'select[name*="size"]',
            'input[name*="size"]',
            '[data-testid*="size"] select',
            '[data-testid*="size"] input',
            'input[aria-label*="サイズ"]',
        ]);
    }
    function findShippingPayerField() {
        return findInputLike([
            'select[name*="shippingPayer"]',
            'select[name*="shipping_payer"]',
            '[data-testid*="shipping"] select',
            'input[aria-label*="配送料の負担"]',
        ]);
    }
    function findShippingMethodField() {
        return findInputLike([
            'select[name*="shippingMethod"]',
            'select[name*="shipping_method"]',
            '[data-testid*="shippingMethod"] select',
            'input[aria-label*="配送の方法"]',
        ]);
    }
    function findShippingFromField() {
        return findInputLike([
            'select[name*="shippingFrom"]',
            'select[name*="shipping_from"]',
            '[data-testid*="shippingFrom"] select',
            'input[aria-label*="発送元の地域"]',
        ]);
    }
    function findShippingDaysField() {
        return findInputLike([
            'select[name*="shippingDays"]',
            'select[name*="shipping_days"]',
            '[data-testid*="shippingDays"] select',
            'input[aria-label*="発送までの日数"]',
        ]);
    }
    function findPriceField() {
        return findInputLike([
            'input[name="price"]',
            'input[inputmode="numeric"]',
            'input[aria-label*="価格"]',
            '[data-testid*="price"] input',
            '[data-testid*="Price"] input',
        ]);
    }
    function findDescriptionField() {
        return findInputLike([
            'textarea[name="description"]',
            'textarea[aria-label*="商品説明"]',
            'textarea[aria-label*="説明"]',
            '[data-testid*="description"] textarea',
            '[data-testid*="Description"] textarea',
            "textarea",
        ]);
    }
    function findInputLike(selectors) {
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
                return element;
            }
        }
        return null;
    }
    function setFieldValue(field, value) {
        if (!field) {
            return false;
        }
        if (field instanceof HTMLSelectElement) {
            return setSelectValue(field, value);
        }
        const prototype = Object.getPrototypeOf(field);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor?.set) {
            descriptor.set.call(field, value);
        }
        else {
            field.value = value;
        }
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }
    function setSelectValue(field, value) {
        const option = Array.from(field.options).find((candidate) => {
            const label = candidate.textContent?.trim() ?? "";
            return label.includes(value) || value.includes(label);
        });
        if (!option) {
            return false;
        }
        field.value = option.value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }
    function getToastMessage(mode) {
        if (mode === "copy") {
            return "フリマネからコピー出品データを自動入力しました。内容を確認してから出品してください";
        }
        if (mode === "draft") {
            return "フリマネから下書き用データを自動入力しました。内容を確認してください";
        }
        return "フリマネから再出品データを自動入力しました。内容を確認してから出品してください";
    }
    function injectStyles() {
        if (document.getElementById("furimanager-relist-toast-style")) {
            return;
        }
        const style = document.createElement("style");
        style.id = "furimanager-relist-toast-style";
        style.textContent = `
      .furimanager-toast {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        border: 1px solid #5B5FE8;
        border-radius: 12px;
        background: #111827;
        color: #FFFFFF;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.5;
        box-shadow: 0 12px 28px rgba(17, 24, 39, 0.28);
      }
    `;
        document.documentElement.appendChild(style);
    }
    function showToast(message) {
        injectStyles();
        const existing = document.querySelector(".furimanager-toast");
        existing?.remove();
        const toast = document.createElement("div");
        toast.className = "furimanager-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => {
            toast.remove();
        }, 5200);
    }
    function isRelistPendingItem(value) {
        if (!value || typeof value !== "object") {
            return false;
        }
        const item = value;
        return item.mode === "relist" || item.mode === "draft" || item.mode === "copy";
    }
    function sleep(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    }
    else {
        boot();
    }
})();
