(() => {
  type RelistMode = "relist" | "draft" | "copy";

  type RelistPendingItem = {
    itemId: string | null;
    title: string | null;
    price: number | null;
    itemUrl: string | null;
    thumbnailUrl: string | null;
    imageUrls: string[];
    description: string | null;
    categoryPath: string[];
    condition: string | null;
    brand: string | null;
    size: string | null;
    shippingPayer: string | null;
    shippingMethod: string | null;
    shippingFrom: string | null;
    shippingDays: string | null;
    savedAt?: string;
    mode: RelistMode;
  };

  type ChromeLike = {
    storage?: {
      local: {
        get: (keys: string | string[], callback: (items: Record<string, unknown>) => void) => void;
        remove: (keys: string | string[], callback?: () => void) => void;
      };
    };
    runtime?: {
      lastError?: {
        message?: string;
      };
      sendMessage: (
        message: unknown,
        response?: (result?: { success?: boolean; dataUrl?: string; type?: string; message?: string }) => void
      ) => void;
    };
  };

  type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  const mountedWindow = window as Window & {
    __furimanagerRelistAutofillMounted?: boolean;
  };
  const chromeApi = (globalThis as unknown as { chrome?: ChromeLike }).chrome;
  const RELIST_PENDING_KEY = "relist_pending";
  const MAX_WAIT_MS = 12000;
  const RETRY_INTERVAL_MS = 500;
  let imageFillAttempted = false;

  if (mountedWindow.__furimanagerRelistAutofillMounted) {
    return;
  }

  mountedWindow.__furimanagerRelistAutofillMounted = true;

  function boot(): void {
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

  function getPendingItem(callback: (item: RelistPendingItem | null) => void): void {
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

  async function waitForFormAndFill(item: RelistPendingItem): Promise<void> {
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

  async function fillAvailableFields(item: RelistPendingItem): Promise<{ filled: boolean; complete: boolean }> {
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

  async function fillImageField(imageUrls: string[]): Promise<boolean> {
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

  function findImageField(): HTMLInputElement | null {
    const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    return input instanceof HTMLInputElement ? input : null;
  }

  async function fetchImageFiles(imageUrls: string[]): Promise<File[]> {
    const uniqueUrls = Array.from(new Set(imageUrls)).slice(0, 10);
    const files: File[] = [];

    for (let index = 0; index < uniqueUrls.length; index += 1) {
      const file = await fetchImageFile(uniqueUrls[index], index);

      if (file) {
        files.push(file);
      }
    }

    return files;
  }

  async function fetchImageFile(url: string, index: number): Promise<File | null> {
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
    } catch {
      return null;
    }
  }

  function fetchImageThroughBackground(url: string): Promise<{ dataUrl: string; type: string }> {
    return new Promise((resolve, reject) => {
      if (!chromeApi?.runtime?.sendMessage) {
        reject(new Error("background unavailable"));
        return;
      }

      chromeApi.runtime.sendMessage(
        {
          type: "FETCH_IMAGE_AS_DATA_URL",
          url,
        },
        (response) => {
          if (chromeApi.runtime?.lastError || !response?.success || !response.dataUrl) {
            reject(new Error(response?.message ?? "image fetch failed"));
            return;
          }

          resolve({
            dataUrl: response.dataUrl,
            type: response.type ?? "image/jpeg",
          });
        }
      );
    });
  }

  function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob | null {
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

  function getImageExtension(type: string, url: string): string {
    if (type.includes("png")) {
      return "png";
    }

    if (type.includes("webp")) {
      return "webp";
    }

    const matched = url.match(/\.(jpe?g|png|webp)(?:\?|$)/i);
    return matched?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
  }

  function clearPendingItem(): void {
    chromeApi?.storage?.local.remove(RELIST_PENDING_KEY);
  }

  function fillMetadataFields(item: RelistPendingItem): void {
    setOptionalField(findCategoryField(), item.categoryPath?.join(" > ") ?? null);
    setOptionalField(findConditionField(), item.condition);
    setOptionalField(findBrandField(), item.brand);
    setOptionalField(findSizeField(), item.size);
    setOptionalField(findShippingPayerField(), item.shippingPayer);
    setOptionalField(findShippingMethodField(), item.shippingMethod);
    setOptionalField(findShippingFromField(), item.shippingFrom);
    setOptionalField(findShippingDaysField(), item.shippingDays);
  }

  function setOptionalField(field: FieldElement | null, value: string | null): void {
    if (!value) {
      return;
    }

    setFieldValue(field, value);
  }

  function findTitleField(): FieldElement | null {
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

  function findCategoryField(): FieldElement | null {
    return findInputLike([
      'select[name*="category"]',
      'input[name*="category"]',
      '[data-testid*="category"] select',
      '[data-testid*="category"] input',
      'input[aria-label*="カテゴリー"]',
    ]);
  }

  function findConditionField(): FieldElement | null {
    return findInputLike([
      'select[name*="condition"]',
      'input[name*="condition"]',
      '[data-testid*="condition"] select',
      '[data-testid*="condition"] input',
      'select[aria-label*="商品の状態"]',
      'input[aria-label*="商品の状態"]',
    ]);
  }

  function findBrandField(): FieldElement | null {
    return findInputLike([
      'input[name*="brand"]',
      '[data-testid*="brand"] input',
      'input[aria-label*="ブランド"]',
    ]);
  }

  function findSizeField(): FieldElement | null {
    return findInputLike([
      'select[name*="size"]',
      'input[name*="size"]',
      '[data-testid*="size"] select',
      '[data-testid*="size"] input',
      'input[aria-label*="サイズ"]',
    ]);
  }

  function findShippingPayerField(): FieldElement | null {
    return findInputLike([
      'select[name*="shippingPayer"]',
      'select[name*="shipping_payer"]',
      '[data-testid*="shipping"] select',
      'input[aria-label*="配送料の負担"]',
    ]);
  }

  function findShippingMethodField(): FieldElement | null {
    return findInputLike([
      'select[name*="shippingMethod"]',
      'select[name*="shipping_method"]',
      '[data-testid*="shippingMethod"] select',
      'input[aria-label*="配送の方法"]',
    ]);
  }

  function findShippingFromField(): FieldElement | null {
    return findInputLike([
      'select[name*="shippingFrom"]',
      'select[name*="shipping_from"]',
      '[data-testid*="shippingFrom"] select',
      'input[aria-label*="発送元の地域"]',
    ]);
  }

  function findShippingDaysField(): FieldElement | null {
    return findInputLike([
      'select[name*="shippingDays"]',
      'select[name*="shipping_days"]',
      '[data-testid*="shippingDays"] select',
      'input[aria-label*="発送までの日数"]',
    ]);
  }

  function findPriceField(): FieldElement | null {
    return findInputLike([
      'input[name="price"]',
      'input[inputmode="numeric"]',
      'input[aria-label*="価格"]',
      '[data-testid*="price"] input',
      '[data-testid*="Price"] input',
    ]);
  }

  function findDescriptionField(): FieldElement | null {
    return findInputLike([
      'textarea[name="description"]',
      'textarea[aria-label*="商品説明"]',
      'textarea[aria-label*="説明"]',
      '[data-testid*="description"] textarea',
      '[data-testid*="Description"] textarea',
      "textarea",
    ]);
  }

  function findInputLike(selectors: string[]): FieldElement | null {
    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return element;
      }
    }

    return null;
  }

  function setFieldValue(field: FieldElement | null, value: string): boolean {
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
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setSelectValue(field: HTMLSelectElement, value: string): boolean {
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

  function getToastMessage(mode: RelistMode): string {
    if (mode === "copy") {
      return "フリマネからコピー出品データを自動入力しました。内容を確認してから出品してください";
    }

    if (mode === "draft") {
      return "フリマネから下書き用データを自動入力しました。内容を確認してください";
    }

    return "フリマネから再出品データを自動入力しました。内容を確認してから出品してください";
  }

  function injectStyles(): void {
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

  function showToast(message: string): void {
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

  function isRelistPendingItem(value: unknown): value is RelistPendingItem {
    if (!value || typeof value !== "object") {
      return false;
    }

    const item = value as RelistPendingItem;
    return item.mode === "relist" || item.mode === "draft" || item.mode === "copy";
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
