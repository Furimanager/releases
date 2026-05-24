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
  const RETRY_INTERVAL_MS = 300;
  const INITIAL_SELL_CLICK_WAIT_MS = 600;
  const METADATA_OPEN_WAIT_MS = 350;
  const METADATA_SELECT_WAIT_MS = 250;
  const SELECTION_POLL_MS = 75;
  const SAFE_CLICK_SETTLE_MS = 150;
  const IMAGE_DONE_KEY = "furimanager_relist_image_done";
  const SIZE_DONE_KEY = "furimanager_relist_size_done";
  const BRAND_DONE_KEY = "furimanager_relist_brand_done";
  const SHIPPING_FROM_DONE_KEY = "furimanager_relist_shipping_from_done";
  const CATEGORY_STEP_KEY = "furimanager_relist_category_step";
  const CATEGORY_DONE_KEY = "furimanager_relist_category_done";
  const CONDITION_DONE_KEY = "furimanager_relist_condition_done";
  const SHIPPING_METHOD_DONE_KEY = "furimanager_relist_shipping_method_done";
  const SESSION_ITEM_KEY = "furimanager_relist_session_item";
  const CATEGORY_ID_PATH_KEY = "furimanager_relist_category_id_path";
  const INITIAL_CREATE_VISITED_KEY = "furimanager_relist_initial_create_visited";
  const ENABLE_DOM_DEBUG = false;
  const ENABLE_METADATA_AUTOFILL = true;
  let imageFillAttempted = false;

  if (mountedWindow.__furimanagerRelistAutofillMounted) {
    return;
  }

  mountedWindow.__furimanagerRelistAutofillMounted = true;

  function boot(): void {
    if (!window.location.pathname.startsWith("/sell")) {
      return;
    }

    if (ENABLE_DOM_DEBUG) {
      debugMercariSellDom();
      window.setTimeout(debugMercariSellDom, 1500);
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
    resetSelectionSessionIfNeeded(item);

    if (ENABLE_DOM_DEBUG && isMercariSellDebugPath()) {
      return;
    }

    if (await handleSelectionSubPage(item)) {
      return;
    }

    const startedAt = Date.now();
    let hasFilledAnyField = false;

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      if (await handleSelectionSubPage(item)) {
        return;
      }

      if (!hasFilledAnyField && isInitialSellLandingPage() && goToInitialSellForm()) {
        await sleep(INITIAL_SELL_CLICK_WAIT_MS);
        continue;
      }

      const result = await fillAvailableFields(item);
      hasFilledAnyField = result.filled || hasFilledAnyField;

      if (result.complete) {
        return;
      }

      await sleep(RETRY_INTERVAL_MS);
    }

    if (hasFilledAnyField) {
      return;
    }

    if (isInitialSellLandingPage()) {
      return;
    }

    showToast("フリマネの出品データを読み込みましたが、入力できる欄が見つかりませんでした");
  }

  function resetSelectionSessionIfNeeded(item: RelistPendingItem): void {
    const sessionKey = item.savedAt ?? item.itemUrl ?? item.itemId ?? "unknown";

    if (sessionStorage.getItem(SESSION_ITEM_KEY) === sessionKey) {
      return;
    }

    [IMAGE_DONE_KEY, SIZE_DONE_KEY, BRAND_DONE_KEY, SHIPPING_FROM_DONE_KEY, CATEGORY_STEP_KEY, CATEGORY_DONE_KEY, CONDITION_DONE_KEY, SHIPPING_METHOD_DONE_KEY, CATEGORY_ID_PATH_KEY, INITIAL_CREATE_VISITED_KEY].forEach((key) => sessionStorage.removeItem(key));
    sessionStorage.setItem(SESSION_ITEM_KEY, sessionKey);
  }

  async function handleSelectionSubPage(item: RelistPendingItem): Promise<boolean> {
    if (!ENABLE_METADATA_AUTOFILL && ["/sell/categories", "/sell/conditions", "/sell/shipping_methods", "/sell/brands", "/sell/wizard"].includes(window.location.pathname)) {
      return true;
    }

    if (ENABLE_DOM_DEBUG && isMercariSellDebugPath()) {
      return ["/sell/categories", "/sell/conditions", "/sell/shipping_methods", "/sell/brands", "/sell/wizard"].includes(window.location.pathname);
    }

    if (window.location.pathname === "/sell/categories") {
      await handleCategorySelectionPage(item);
      return true;
    }

    if (window.location.pathname === "/sell/conditions") {
      await handleConditionSelectionPage(item, normalizeMercariCondition(item.condition));
      return true;
    }

    if (window.location.pathname === "/sell/shipping_methods") {
      await handleShippingMethodSelectionPage(item, normalizeShippingMethod(item.shippingMethod));
      return true;
    }

    if (window.location.pathname === "/sell/brands") {
      await handleBrandSelectionPage(item, normalizeOptionalMetadataValue(item.brand));
      return true;
    }

    if (window.location.pathname === "/sell/wizard") {
      await handleWizardSelectionPage(item);
      return true;
    }

    return false;
  }

  async function fillAvailableFields(item: RelistPendingItem): Promise<{ filled: boolean; complete: boolean }> {
    let targetCount = 0;
    let filledCount = 0;

    await clickImageUploadNextButtonIfVisible();
    await clickAiSupportSkipButtonIfVisible();

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

    await clickAiSupportSkipButtonIfVisible();
    const basicFieldsComplete = targetCount > 0 && filledCount === targetCount && !isImageUploadDialogOpen() && !isAiSupportDialogOpen();
    const metadataResult = basicFieldsComplete ? await fillMetadataFields(item) : { targetCount: 0, filledCount: 0 };
    targetCount += metadataResult.targetCount;
    filledCount += metadataResult.filledCount;

    return {
      filled: filledCount > 0,
      complete: targetCount > 0 && filledCount === targetCount,
    };
  }

  async function fillImageField(imageUrls: string[]): Promise<boolean> {
    if (sessionStorage.getItem(IMAGE_DONE_KEY) === "true") {
      return true;
    }

    if (hasUploadedListingImages()) {
      sessionStorage.setItem(IMAGE_DONE_KEY, "true");
      return true;
    }

    if (imageFillAttempted) {
      const existingInput = findImageField();

      if (!existingInput || existingInput.files?.length) {
        return true;
      }

      imageFillAttempted = false;
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

    input.multiple = true;
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    sessionStorage.setItem(IMAGE_DONE_KEY, "true");
    await sleep(METADATA_OPEN_WAIT_MS);
    await clickImageUploadNextButtonIfVisible();
    await clickAiSupportSkipButtonIfVisible();
    return true;
  }

  function hasUploadedListingImages(): boolean {
    const input = findImageField();
    const root = input?.closest("section, form, main") ?? document.querySelector("main");

    if (!(root instanceof HTMLElement)) {
      return false;
    }

    return Array.from(root.querySelectorAll("img")).some((image) => {
      if (!(image instanceof HTMLImageElement) || !isVisible(image)) {
        return false;
      }

      const rect = image.getBoundingClientRect();
      return rect.width >= 40 && rect.height >= 40;
    });
  }

  async function clickImageUploadNextButtonIfVisible(): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const nextButton = findImageUploadNextButton();

      if (nextButton) {
        clickButtonLike(nextButton);
        await sleep(METADATA_SELECT_WAIT_MS);
        return true;
      }

      if (!getImageUploadDialog()) {
        return false;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return false;
  }

  function findImageUploadNextButton(): HTMLElement | null {
    const fixedButton = document.querySelector('[data-testid="image-upload-step"] [data-testid="stepper-next-button"] button, [data-testid="image-upload-step"] button[data-testid="stepper-next-button"], [data-testid="image-upload-step"] [data-testid="stepper-next-button"]');

    if (fixedButton instanceof HTMLElement && isClickableButtonLike(fixedButton)) {
      return fixedButton;
    }

    const dialog = getImageUploadDialog();

    if (!dialog) {
      return null;
    }

    return Array.from(dialog.querySelectorAll('button[type="button"], button, [role="button"]'))
      .filter((button): button is HTMLElement => button instanceof HTMLElement && isClickableButtonLike(button))
      .find((button) => normalizeText(button.textContent) === "次へ") ?? null;
  }

  function isClickableButtonLike(element: HTMLElement): boolean {
    const button = element instanceof HTMLButtonElement ? element : element.querySelector("button");

    if (button instanceof HTMLButtonElement) {
      return !button.disabled && isVisible(button);
    }

    return isVisible(element);
  }

  function getImageUploadDialog(): HTMLElement | null {
    const dialog = document.querySelector('[role="dialog"][aria-label="出品画像"], [data-testid="image-upload-step"]');
    return dialog instanceof HTMLElement && isVisible(dialog) ? dialog : null;
  }

  function isImageUploadDialogOpen(): boolean {
    return getImageUploadDialog() !== null;
  }

  async function clickAiSupportSkipButtonIfVisible(): Promise<boolean> {
    const dialog = getAiSupportDialog();

    if (!dialog) {
      return false;
    }

    const skipButton = dialog.querySelector('button[data-testid="stepper-skip-button"]') ?? Array.from(dialog.querySelectorAll('button[type="button"], button'))
      .find((button) => button instanceof HTMLButtonElement && normalizeText(button.textContent) === "スキップ");

    if (!(skipButton instanceof HTMLButtonElement) || skipButton.disabled || !isVisible(skipButton)) {
      return false;
    }

    skipButton.click();
    await sleep(METADATA_SELECT_WAIT_MS);
    return true;
  }

  function getAiSupportDialog(): HTMLElement | null {
    const dialog = document.querySelector('[role="dialog"][aria-label="AI出品サポート"], [data-testid="category-select-step"]');
    return dialog instanceof HTMLElement && isVisible(dialog) ? dialog : null;
  }

  function isAiSupportDialogOpen(): boolean {
    return getAiSupportDialog() !== null;
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

  function goToInitialSellForm(): boolean {
    if (window.location.pathname !== "/sell") {
      return false;
    }

    if (sessionStorage.getItem(INITIAL_CREATE_VISITED_KEY) === "true") {
      return false;
    }

    sessionStorage.setItem(INITIAL_CREATE_VISITED_KEY, "true");
    window.location.assign("/sell/create");
    return true;
  }

  function isInitialSellLandingPage(): boolean {
    if (hasSellFormFields()) {
      return false;
    }

    const bodyText = normalizeText(document.body?.innerText ?? "");
    return bodyText.includes("下書き一覧") || bodyText.includes("出品した商品") || bodyText.includes("発送・評価待ち");
  }

  function hasSellFormFields(): boolean {
    const bodyText = normalizeText(document.body?.innerText ?? "");
    return (
      findTitleField() !== null ||
      findDescriptionField() !== null ||
      findPriceField() !== null ||
      bodyText.includes("商品名") ||
      bodyText.includes("商品の説明") ||
      bodyText.includes("販売価格")
    );
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

  async function fillMetadataFields(item: RelistPendingItem): Promise<{ targetCount: number; filledCount: number }> {
    if (ENABLE_DOM_DEBUG || !ENABLE_METADATA_AUTOFILL) {
      // TODO: メルカリ側のDOM仕様が変わった場合は、入力候補を1項目ずつ見直す。
      return { targetCount: 0, filledCount: 0 };
    }

    let targetCount = 0;
    let filledCount = 0;
    const categoryPath = item.categoryPath?.filter(Boolean) ?? [];

    const condition = normalizeMercariCondition(item.condition);
    const shippingMethod = normalizeShippingMethod(item.shippingMethod);
    const shippingDays = normalizeShippingDays(item.shippingDays);
    const shippingFrom = normalizeText(item.shippingFrom ?? "");
    const size = normalizeOptionalMetadataValue(item.size);
    const brand = normalizeOptionalMetadataValue(item.brand);

    if (categoryPath.length > 0) {
      targetCount += 1;
      if (await fillCategoryFields(categoryPath)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (condition) {
      targetCount += 1;
      if (await fillConditionField(condition)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (size) {
      targetCount += 1;
      if (await fillSizeField(size)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (brand) {
      targetCount += 1;
      if (await fillBrandField(brand)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (shippingFrom) {
      targetCount += 1;
      if (fillShippingFromField(shippingFrom)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (shippingDays) {
      targetCount += 1;
      if (fillShippingDaysField(shippingDays)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    if (shippingMethod) {
      targetCount += 1;
      if (await fillShippingMethodField(shippingMethod)) {
        filledCount += 1;
      } else {
        return { targetCount, filledCount };
      }
    }

    return { targetCount, filledCount };
  }

  async function fillCategoryFields(categoryPath: string[]): Promise<boolean> {
    if (sessionStorage.getItem(CATEGORY_DONE_KEY) === "true") {
      return true;
    }

    if (await fillCategorySelects(categoryPath)) {
      sessionStorage.setItem(CATEGORY_DONE_KEY, "true");
      return true;
    }

    const link = findCategoryEntryLink();

    if (!link) {
      return false;
    }

    sessionStorage.setItem(CATEGORY_STEP_KEY, "0");
    sessionStorage.removeItem(CATEGORY_ID_PATH_KEY);
    link.click();

    return false;
  }

  function findCategoryEntryLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll('main a[href="/sell/categories"], a[href="/sell/categories"]'))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links.find((link) => normalizeText(link.textContent).includes("カテゴリー")) ?? links[0] ?? null;
  }

  async function fillCategorySelects(categoryPath: string[]): Promise<boolean> {
    let selectedCount = 0;

    for (let index = 0; index < categoryPath.length; index += 1) {
      const select = await waitForSelect(`select[name*="category"], select[name="category${index + 1}"]`, index);

      if (!select || !setSelectValue(select, categoryPath[index])) {
        break;
      }

      selectedCount += 1;
      await sleep(METADATA_SELECT_WAIT_MS);
    }

    return selectedCount > 0;
  }

  async function fillConditionField(condition: string | null): Promise<boolean> {
    if (!condition) {
      return false;
    }

    if (sessionStorage.getItem(CONDITION_DONE_KEY) === "true") {
      return true;
    }

    const select = document.querySelector('select[name="itemCondition"], select[name*="condition"]');

    if (select instanceof HTMLSelectElement && setSelectValue(select, condition)) {
      sessionStorage.setItem(CONDITION_DONE_KEY, "true");
      return true;
    }

    if (clickChipInSection("商品の状態", condition)) {
      sessionStorage.setItem(CONDITION_DONE_KEY, "true");
      return true;
    }

    const link = findConditionEntryLink();

    if (!link) {
      return false;
    }

    link.click();

    return false;
  }

  function findConditionEntryLink(): HTMLAnchorElement | null {
    const section = findFormSection("商品の状態");
    const sectionLink = section ? Array.from(section.querySelectorAll('a[href="/sell/conditions"][data-location*="condition"], a[href="/sell/conditions"]'))
      .find((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link)) : null;

    if (sectionLink) {
      return sectionLink;
    }

    const links = Array.from(document.querySelectorAll('a[href="/sell/conditions"][data-location*="condition"], a[href="/sell/conditions"]'))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links.find((link) => normalizeText(link.textContent).includes("商品の状態")) ?? links[0] ?? null;
  }

  async function fillSizeField(size: string): Promise<boolean> {
    if (sessionStorage.getItem(SIZE_DONE_KEY) === "true") {
      return true;
    }

    const select = document.querySelector('select[name="size"], select[data-testid="size-select"], [data-testid="size-select"] select, select[name*="size"]');

    if (select instanceof HTMLSelectElement && setSelectValue(select, size)) {
      sessionStorage.setItem(SIZE_DONE_KEY, "true");
      return true;
    }

    if (clickChipInSection("サイズ", size)) {
      sessionStorage.setItem(SIZE_DONE_KEY, "true");
      return true;
    }

    return false;
  }

  async function fillBrandField(brand: string): Promise<boolean> {
    if (sessionStorage.getItem(BRAND_DONE_KEY) === "true") {
      return true;
    }

    if (isBrandAlreadySelected(brand)) {
      sessionStorage.setItem(BRAND_DONE_KEY, "true");
      return true;
    }

    if (await fillBrandInline(brand)) {
      sessionStorage.setItem(BRAND_DONE_KEY, "true");
      return true;
    }

    const link = findBrandEntryLink();

    if (!link) {
      return false;
    }

    link.click();
    return false;
  }

  async function fillBrandInline(brand: string): Promise<boolean> {
    const input = await waitForBrandInput(8);

    if (!input) {
      return false;
    }

    setFieldValue(input, normalizeBrandSearchText(brand));
    await sleep(700);

    const option = findBrandAutocompleteOption(brand);

    if (!option) {
      return false;
    }

    clickButtonLike(option);
    await sleep(METADATA_SELECT_WAIT_MS);
    return true;
  }

  function isBrandAlreadySelected(brand: string): boolean {
    const link = findBrandEntryLink();
    const text = normalizeText(link?.textContent ?? "");
    return !!text && !text.includes("選択してください") && optionTextMatches(text, brand);
  }

  function findBrandEntryLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll('a[data-testid="brand-link"], a[href="/sell/brands"], a[href^="/sell/brands?"]'))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links[0] ?? null;
  }

  async function waitForBrandInput(maxAttempts = 30): Promise<HTMLInputElement | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const input = document.querySelector(`
        input[name="brandName"],
        input[placeholder*="ブランド名"],
        mer-text-input[label="ブランド"] input,
        .merTextInput[data-testid*="brand"] input,
        mer-autocomplete[data-testid*="brand"] input,
        .merAutocomplete[data-testid*="brand"] input,
        [data-testid*="brand"] input
      `);

      if (input instanceof HTMLInputElement && isVisible(input)) {
        return input;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return null;
  }

  function findBrandAutocompleteOption(brand: string): HTMLElement | null {
    const searchText = normalizeBrandSearchText(brand);
    const candidates = Array.from(document.querySelectorAll(`
      mer-list mer-action-row,
      .merList .merActionRow,
      [slot="list"] mer-action-row,
      [slot="list"] .merActionRow,
      #brand-autocomplete mer-action-row,
      #brand-autocomplete .merActionRow,
      .merActionRow,
      mer-action-row
    `)).filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element));

    return candidates.find((candidate) => {
      const text = getElementSearchText(candidate);
      return optionTextMatches(text, brand) || optionTextMatches(text, searchText);
    }) ?? candidates[0] ?? null;
  }

  function normalizeBrandSearchText(brand: string): string {
    return brand === "GU" ? "ジーユー" : brand;
  }

  async function fillShippingMethodField(shippingMethod: string | null): Promise<boolean> {
    if (!shippingMethod) {
      return false;
    }

    if (sessionStorage.getItem(SHIPPING_METHOD_DONE_KEY) === "true") {
      return true;
    }

    if (fillSelectBySelector('select[name="shippingMethod"]', shippingMethod)) {
      sessionStorage.setItem(SHIPPING_METHOD_DONE_KEY, "true");
      return true;
    }

    const link = findShippingMethodEntryLink();

    if (!link) {
      return false;
    }

    link.click();

    return false;
  }

  function findShippingMethodEntryLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll('a[href="/sell/shipping_methods"][data-location*="shipping_method"], a[href="/sell/shipping_methods"]'))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link));

    return links.find((link) => normalizeText(link.textContent).includes("配送の方法")) ?? links[0] ?? null;
  }

  function fillShippingDaysField(shippingDays: string): boolean {
    return fillSelectBySelector('select[name="shippingDuration"], select[name*="shippingDuration"], select[name*="shippingDays"]', shippingDays);
  }

  function fillShippingFromField(shippingFrom: string): boolean {
    if (sessionStorage.getItem(SHIPPING_FROM_DONE_KEY) === "true") {
      return true;
    }

    const filled = fillSelectBySelector('select[name="shippingFromArea"], select[name*="shippingFrom"], select[name*="shipping_from"], [data-testid*="shippingFrom"] select', shippingFrom);

    if (filled) {
      sessionStorage.setItem(SHIPPING_FROM_DONE_KEY, "true");
    }

    return filled;
  }

  async function handleCategorySelectionPage(item: RelistPendingItem): Promise<void> {
    const categoryPath = item.categoryPath?.filter(Boolean) ?? [];

    if (categoryPath.length === 0) {
      return;
    }

    for (let attempt = 0; attempt < categoryPath.length + 2; attempt += 1) {
      await waitForReadyCategoryLinks();
      const step = Number(sessionStorage.getItem(CATEGORY_STEP_KEY) ?? "0");
      const target = categoryPath[step];

      if (!target) {
        sessionStorage.setItem(CATEGORY_DONE_KEY, "true");
        return;
      }

      if (!currentCategoryPageMatchesStep(step)) {
        await sleep(SELECTION_POLL_MS);
        continue;
      }

      const links = getCategoryPageLinks();
      const link = links.find((candidate) => categoryTextMatches(normalizeText(candidate.textContent), target));

      if (!link) {
        const createLink = findCategoryCreateLink(links);

        if (createLink) {
          sessionStorage.setItem(CATEGORY_DONE_KEY, "true");
          await clickCategoryCreateLink(createLink);
          await continueOnSellCreate(item);
        }

        return;
      }

      const url = new URL(link.href);

      if (url.pathname === "/sell/categories") {
        saveCategoryIdForStep(step, url.searchParams.get("category_id"));
        sessionStorage.setItem(CATEGORY_STEP_KEY, String(step + 1));
        link.click();
        await sleep(SAFE_CLICK_SETTLE_MS);
        continue;
      }

      if (url.pathname === "/sell/create" || url.pathname === "/sell") {
        sessionStorage.setItem(CATEGORY_DONE_KEY, "true");
        // 最終カテゴリの確定はメルカリ側の内部ボタンを押す必要がある。
        await clickCategoryCreateLink(link);
        await continueOnSellCreate(item);
        return;
      }
    }
  }

  function findCategoryCreateLink(links: HTMLAnchorElement[]): HTMLAnchorElement | null {
    return links.find((link) => {
      const url = new URL(link.href);
      return url.pathname === "/sell/create" || url.pathname === "/sell";
    }) ?? null;
  }

  async function clickCategoryCreateLink(link: HTMLAnchorElement): Promise<void> {
    await sleep(SAFE_CLICK_SETTLE_MS);

    const shadowButton = link.firstElementChild?.shadowRoot?.querySelector("button");

    if (shadowButton instanceof HTMLButtonElement) {
      shadowButton.click();
      return;
    }

    const innerButton = link.querySelector("button");

    if (innerButton instanceof HTMLButtonElement) {
      innerButton.click();
      return;
    }

    link.click();
  }

  async function waitForReadyCategoryLinks(): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const links = getCategoryPageLinks();

      if (links.length > 0 && !hasCurrentCategorySelfLink(links)) {
        return;
      }

      await sleep(SELECTION_POLL_MS);
    }
  }

  function getCategoryPageLinks(): HTMLAnchorElement[] {
    const excludedTexts = ["カテゴリーを選択する", "変更する", "加盟店規約"];
    return Array.from(document.querySelectorAll('main a[href*="/sell"]'))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isVisible(link))
      .filter((link) => {
        const url = new URL(link.href);
        const text = normalizeText(link.textContent);
        return (
          url.origin === window.location.origin &&
          (url.pathname === "/sell/categories" || url.pathname === "/sell/create" || url.pathname === "/sell") &&
          !excludedTexts.includes(text) &&
          !link.href.includes("/sell/conditions")
        );
      });
  }

  function hasCurrentCategorySelfLink(links: HTMLAnchorElement[]): boolean {
    const current = `${window.location.pathname}${window.location.search}`;
    return links.some((link) => {
      const url = new URL(link.href);
      return `${url.pathname}${url.search}` === current;
    });
  }

  function currentCategoryPageMatchesStep(step: number): boolean {
    if (step === 0) {
      return !new URL(window.location.href).searchParams.get("category_id");
    }

    const ids = getSavedCategoryIds();
    const expectedId = ids[step - 1];
    const currentId = new URL(window.location.href).searchParams.get("category_id");
    return !!expectedId && currentId === expectedId;
  }

  function saveCategoryIdForStep(step: number, categoryId: string | null): void {
    if (!categoryId) {
      return;
    }

    const ids = getSavedCategoryIds();
    ids[step] = categoryId;
    sessionStorage.setItem(CATEGORY_ID_PATH_KEY, JSON.stringify(ids));
  }

  function getSavedCategoryIds(): string[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(CATEGORY_ID_PATH_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }

  function categoryTextMatches(text: string, value: string): boolean {
    return text === value || normalizeOptionText(text) === normalizeOptionText(value);
  }

  async function handleConditionSelectionPage(item: RelistPendingItem, condition: string | null): Promise<void> {
    if (!condition) {
      return;
    }

    const options = await waitForConditionOptions();
    const option = options.find((candidate) => conditionTextMatches(getConditionOptionText(candidate), condition));

    if (option) {
      sessionStorage.setItem(CONDITION_DONE_KEY, "true");
      clickButtonLike(option);
      await continueOnSellCreate(item);
    }
  }

  async function waitForConditionOptions(): Promise<HTMLElement[]> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const options = Array.from(document.querySelectorAll('ul li a[href*="/sell/create"], main a[href*="/sell/create"], main button, main label, main [role="button"], main [data-testid*="condition"]'))
        .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element));

      if (options.some((option) => normalizeMercariCondition(getConditionOptionText(option)))) {
        return options;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return [];
  }

  function getConditionOptionText(element: HTMLElement): string {
    return normalizeText(element.querySelector("p:first-child")?.textContent || element.getAttribute("label") || element.textContent);
  }

  function conditionTextMatches(text: string, value: string): boolean {
    return normalizeOptionText(text) === normalizeOptionText(value);
  }

  async function handleBrandSelectionPage(item: RelistPendingItem, brand: string | null): Promise<void> {
    if (!brand) {
      return;
    }

    const input = await waitForBrandInput();

    if (input) {
      setFieldValue(input, normalizeBrandSearchText(brand));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      await sleep(900);
    }

    const option = findBrandPageOption(brand);

    if (!option) {
      return;
    }

    sessionStorage.setItem(BRAND_DONE_KEY, "true");
    clickButtonLike(option);
    await continueOnSellCreate(item);
  }

  async function handleWizardSelectionPage(item: RelistPendingItem): Promise<void> {
    const button = await waitForWizardBackToListingButton();

    if (!button) {
      return;
    }

    clickButtonLike(button);
    await continueOnSellCreate(item);
  }

  async function waitForWizardBackToListingButton(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const button = findWizardBackToListingButton();

      if (button) {
        return button;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return null;
  }

  function findWizardBackToListingButton(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll(`
      [data-testid="back-to-listing-button"] button,
      button[data-testid="back-to-listing-button"],
      [data-testid="back-to-listing-button"],
      [data-location*="back-to-listing-button"] button,
      button[data-location*="back-to-listing-button"],
      [data-location*="back-to-listing-button"]
    `)).filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element));

    return candidates.find((candidate) => normalizeText(candidate.textContent).includes("出品画面に戻る")) ?? null;
  }

  function findBrandPageOption(brand: string): HTMLElement | null {
    const searchText = normalizeBrandSearchText(brand);
    const candidates = Array.from(document.querySelectorAll(`
      a[href*="/sell/create"],
      mer-action-row,
      .merActionRow,
      .mer-action-row,
      button,
      [role="button"]
    `)).filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element));

    return candidates.find((candidate) => {
      const text = getElementSearchText(candidate);
      return optionTextMatches(text, brand) || optionTextMatches(text, searchText);
    }) ?? null;
  }

  async function handleShippingMethodSelectionPage(item: RelistPendingItem, shippingMethod: string | null): Promise<void> {
    if (!shippingMethod) {
      return;
    }

    await openShippingServicesIfNeeded();
    await waitForShippingMethodCandidates();
    const option = findShippingMethodOption(shippingMethod);

    if (!option) {
      return;
    }

    if (!isShippingMethodOptionSelected(option)) {
      clickShippingMethodOption(option);

      if (!await waitForShippingMethodSelected(option)) {
        return;
      }
    }

    const updated = await clickShippingUpdateButton();

    if (updated) {
      sessionStorage.setItem(SHIPPING_METHOD_DONE_KEY, "true");
      await continueOnSellCreate(item);
    }
  }

  async function openShippingServicesIfNeeded(): Promise<void> {
    if (document.querySelector('[data-testid="shipping-services"]')) {
      return;
    }

    const button = document.querySelector('[data-testid="shipping-service-group"] button');

    if (button instanceof HTMLButtonElement && isVisible(button)) {
      button.click();
      await sleep(SAFE_CLICK_SETTLE_MS);
    }
  }

  async function waitForShippingMethodCandidates(): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (getShippingMethodCandidates().length > 0) {
        return;
      }

      await sleep(SELECTION_POLL_MS);
    }
  }

  async function continueOnSellCreate(item: RelistPendingItem): Promise<void> {
    if (window.location.pathname === "/sell/create") {
      await waitForFormAndFill(item);
      return;
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(SELECTION_POLL_MS);

      if (window.location.pathname === "/sell/create") {
        await waitForFormAndFill(item);
        return;
      }
    }
  }

  function findShippingMethodOption(shippingMethod: string): HTMLElement | null {
    const candidates = getShippingMethodCandidates();
    return candidates.find((candidate) => optionTextMatches(normalizeShippingMethod(getShippingOptionText(candidate)) ?? "", shippingMethod)) ?? null;
  }

  function getShippingMethodCandidates(): HTMLElement[] {
    const directCandidates = Array.from(document.querySelectorAll(`
      mer-radio-group mer-radio-label,
      [class*="formGroup"] [class*="merRadioLabel"],
      [role="radio"]
    `)).filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && isVisible(candidate));
    const inputCandidates = Array.from(document.querySelectorAll('input[type="radio"]'))
      .flatMap((input) => {
        const element = input instanceof HTMLInputElement ? input.closest('label, [role="radio"], mer-radio-label, .merRadioLabel, section, div') : null;
        return element instanceof HTMLElement && isVisible(element) ? [element] : [];
      });

    return Array.from(new Set([...directCandidates, ...inputCandidates])).filter((candidate) => {
      const text = getShippingOptionText(candidate);
      return text && candidate.querySelector('input[type="radio"]') !== null && !text.includes("早わかり表") && !text.includes("広告");
    });
  }

  function isShippingMethodOptionSelected(option: HTMLElement): boolean {
    const input = option.querySelector('input[type="radio"]');

    if (input instanceof HTMLInputElement) {
      return input.checked;
    }

    return option.getAttribute("aria-checked") === "true" || option.querySelector('[aria-checked="true"], input:checked') !== null;
  }

  function isAnyShippingMethodSelected(): boolean {
    return getShippingMethodCandidates().some((candidate) => isShippingMethodOptionSelected(candidate));
  }

  function clickShippingMethodOption(option: HTMLElement): void {
    const input = option.querySelector('input[type="radio"]');

    if (input instanceof HTMLInputElement) {
      input.click();
      return;
    }

    option.click();
  }

  async function waitForShippingMethodSelected(option: HTMLElement): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (isShippingMethodOptionSelected(option) || isAnyShippingMethodSelected()) {
        return true;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return false;
  }

  async function clickShippingUpdateButton(): Promise<boolean> {
    const updateButton = await waitForShippingUpdateButton();

    if (!updateButton) {
      return false;
    }

    updateButton.scrollIntoView({ block: "center" });
    await sleep(SAFE_CLICK_SETTLE_MS);
    clickButtonLike(updateButton);
    return true;
  }

  async function waitForShippingUpdateButton(): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const button = findShippingUpdateButton();

      if (button && isClickableButtonLike(button)) {
        return button;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return null;
  }

  function findShippingUpdateButton(): HTMLElement | null {
    const button = document.querySelector('button[data-location="listing_shipping_methods:update"]');
    return button instanceof HTMLElement && isVisible(button) ? button : null;
  }

  function clickButtonLike(element: HTMLElement): void {
    const innerButton = element instanceof HTMLButtonElement ? element : element.querySelector("button");

    if (innerButton instanceof HTMLElement) {
      innerButton.click();
      return;
    }

    element.click();
  }

  function clickLinkOrInnerButton(link: HTMLAnchorElement): void {
    const innerButton = link.querySelector("button");

    if (innerButton instanceof HTMLElement) {
      innerButton.click();
      return;
    }

    link.click();
  }

  function findLinkByHref(path: string): HTMLElement | null {
    const link = document.querySelector(`a[href="${path}"], a[href*="${path}"]`);
    return link instanceof HTMLElement ? link : null;
  }

  async function waitForSelect(selector: string, index = 0): Promise<HTMLSelectElement | null> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const select = Array.from(document.querySelectorAll(selector)).filter((element): element is HTMLSelectElement => element instanceof HTMLSelectElement)[index];

      if (select) {
        return select;
      }

      await sleep(SELECTION_POLL_MS);
    }

    return null;
  }

  function fillSelectBySelector(selector: string, value: string): boolean {
    const select = document.querySelector(selector);
    return select instanceof HTMLSelectElement ? setSelectValue(select, value) : false;
  }

  function clickChipInSection(label: string, value: string): boolean {
    const section = findFormSection(label);

    if (!section) {
      return false;
    }

    const chip = Array.from(section.querySelectorAll('mer-chip, .merChip, button, label'))
      .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && isVisible(candidate))
      .find((candidate) => optionTextMatches(candidate.getAttribute("label") ?? getElementSearchText(candidate), value));

    if (!chip) {
      return false;
    }

    chip.click();
    return true;
  }

  function findFormSection(label: string): HTMLElement | null {
    const labelElement = Array.from(document.querySelectorAll("mer-text, .merText, label, span, p"))
      .find((candidate) => candidate instanceof HTMLElement && normalizeText(candidate.textContent) === label);

    return labelElement instanceof HTMLElement ? labelElement.closest('[class*="mer-spacing-t-"], section, div') : null;
  }

  function getShippingOptionText(element: HTMLElement): string {
    const fieldset = element.closest("fieldset");
    return normalizeText(fieldset?.textContent ?? element.textContent ?? "");
  }

  async function fillMetadataValue(field: FieldElement | null, labels: string[], values: string[], allowTextInput: boolean): Promise<boolean> {
    const fieldValue = values.join(" > ");

    if ((field instanceof HTMLSelectElement || allowTextInput) && setFieldValue(field, fieldValue)) {
      return true;
    }

    return selectFromMercariPicker(labels, values);
  }

  async function selectFromMercariPicker(labels: string[], values: string[]): Promise<boolean> {
    const trigger = findMetadataTrigger(labels);

    if (!trigger) {
      return false;
    }

    trigger.click();
    await sleep(METADATA_OPEN_WAIT_MS);

    let clicked = false;
    let root = findActivePickerRoot();

    for (const value of values) {
      root = findActivePickerRoot();
      const option = findPickerOption(value, root);

      if (!option) {
        return false;
      }

      option.click();
      clicked = true;
      await sleep(METADATA_SELECT_WAIT_MS);
    }

    await clickPickerDecisionButton(root);
    return clicked;
  }

  async function clickPickerDecisionButton(root: ParentNode): Promise<void> {
    if (root === document) {
      return;
    }

    const button = Array.from(root.querySelectorAll('button, [role="button"]')).find((candidate) => {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
        return false;
      }

      return ["決定", "完了", "選択する", "このカテゴリーに決定"].some((label) => getElementSearchText(candidate).includes(label));
    });

    if (button instanceof HTMLElement) {
      button.click();
      await sleep(METADATA_SELECT_WAIT_MS);
    }
  }

  function findMetadataTrigger(labels: string[]): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[readonly], select'));

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
        continue;
      }

      const text = getElementSearchText(candidate);
      const rowText = getNearbySearchText(candidate);

      if (labels.some((label) => text.includes(label) || rowText.includes(label))) {
        return candidate;
      }
    }

    return null;
  }

  function findPickerOption(value: string, root: ParentNode): HTMLElement | null {
    const normalizedValue = normalizeText(value);
    const candidates = Array.from(root.querySelectorAll('button, [role="option"], [role="menuitem"], li, a, label, input[type="radio"]'))
      .flatMap((candidate) => {
        if (candidate instanceof HTMLInputElement && candidate.type === "radio") {
          return candidate.closest("label") instanceof HTMLElement ? [candidate.closest("label") as HTMLElement] : [];
        }

        return candidate instanceof HTMLElement ? [candidate] : [];
      })
      .filter((candidate) => isVisible(candidate) && optionTextMatches(getElementSearchText(candidate), normalizedValue));

    return candidates.sort((a, b) => getPickerOptionScore(a, normalizedValue) - getPickerOptionScore(b, normalizedValue))[0] ?? null;
  }

  function findActivePickerRoot(): ParentNode {
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="modal"], [class*="modal"], [class*="Modal"], [class*="sheet"], [class*="Sheet"]'))
      .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && isVisible(candidate));

    return roots.sort((a, b) => getElementArea(a) - getElementArea(b))[0] ?? document;
  }

  function getPickerOptionScore(element: HTMLElement, value: string): number {
    const text = getElementSearchText(element);
    const compactText = normalizeOptionText(text);
    const compactValue = normalizeOptionText(value);

    if (text === value || compactText === compactValue) {
      return 0;
    }

    return text.length;
  }

  function optionTextMatches(text: string, value: string): boolean {
    if (!text || !value) {
      return false;
    }

    const compactText = normalizeOptionText(text);
    const compactValue = normalizeOptionText(value);

    return (
      text === value ||
      compactText === compactValue ||
      (text.includes(value) && text.length <= value.length + 12) ||
      (compactText.includes(compactValue) && compactText.length <= compactValue.length + 12)
    );
  }

  function normalizeOptionText(value: string): string {
    return normalizeText(value).replace(/[〜～]/g, "~").replace(/[\s、，,・/／()（）\[\]【】]/g, "");
  }

  function normalizeMercariCondition(value: string | null): string | null {
    const compactValue = normalizeOptionText(value ?? "");

    if (!compactValue) {
      return null;
    }

    const conditions = [
      "新品、未使用",
      "未使用に近い",
      "目立った傷や汚れなし",
      "やや傷や汚れあり",
      "傷や汚れあり",
      "全体的に状態が悪い",
    ];

    return conditions.find((condition) => {
      const compactCondition = normalizeOptionText(condition);
      return compactCondition === compactValue || compactValue.includes(compactCondition);
    }) ?? null;
  }

  function normalizeShippingMethod(value: string | null): string | null {
    const text = normalizeText(value ?? "")
      .replace(/匿名配送|梱包代行|補償|郵便局\/コンビニ受取|集荷/g, "")
      .trim();
    return text || null;
  }

  function normalizeShippingDays(value: string | null): string {
    return normalizeText(value ?? "").replace(/〜/g, "~");
  }

  function normalizeOptionalMetadataValue(value: string | null): string | null {
    const text = normalizeText(value ?? "");

    if (!text || ["なし", "指定なし", "選択してください", "未設定"].includes(text)) {
      return null;
    }

    return text;
  }

  function getElementSearchText(element: HTMLElement): string {
    const value = element instanceof HTMLInputElement ? element.value : "";
    return normalizeText([
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("label"),
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      value,
    ].filter(Boolean).join(" "));
  }

  function getNearbySearchText(element: HTMLElement): string {
    let current: HTMLElement | null = element;

    for (let depth = 0; current && depth < 4; depth += 1) {
      const text = normalizeText(current.textContent ?? "");

      if (text && text.length <= 300) {
        return text;
      }

      current = current.parentElement;
    }

    return "";
  }

  function normalizeText(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getElementArea(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
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
    const options = Array.from(field.options);
    const option = options.find((candidate) => normalizeOptionText(candidate.label || candidate.textContent?.trim() || "") === normalizeOptionText(value)) ?? options.find((candidate) => {
      const label = normalizeText([candidate.label, candidate.textContent].filter(Boolean).join(" "));
      return optionTextMatches(label, value);
    });

    if (!option) {
      return false;
    }

    field.value = option.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
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

  type DomDebugCandidate = {
    label: string;
    reason: string;
    tagName: string;
    text: string;
    href: string | null;
    type: string | null;
    name: string | null;
    id: string;
    className: string;
    "data-testid": string | null;
    "data-location": string | null;
    "aria-label": string | null;
    role: string | null;
    disabled: boolean;
    outerHTML: string;
    parentOuterHTML: string;
    visible: boolean;
    rect: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
  };

  function debugMercariSellDom(): void {
    if (!isMercariSellDebugPath()) {
      return;
    }

    const result = {
      url: window.location.href,
      pathname: window.location.pathname,
      collectedAt: new Date().toISOString(),
      candidates: collectMercariSellDomCandidates(),
    };

    console.log("[furimanager dom debug]", result);
    renderDomDebugPanel(result);
  }

  function isMercariSellDebugPath(): boolean {
    return ["/sell", "/sell/create", "/sell/categories", "/sell/conditions", "/sell/shipping_methods", "/sell/brands", "/sell/wizard"].includes(window.location.pathname);
  }

  function collectMercariSellDomCandidates(): DomDebugCandidate[] {
    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role]",
      "[data-testid]",
      "[data-location]",
      "mer-radio-label",
      "mer-button",
      "mer-select",
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => !element.closest("#furimanager-dom-debug-panel"))
      .map((element) => {
        const reasons = getDomDebugReasons(element);
        return { element, reasons };
      })
      .filter((entry) => entry.reasons.length > 0);

    return candidates.map(({ element, reasons }) => toDomDebugCandidate(element, reasons));
  }

  function getDomDebugReasons(element: HTMLElement): string[] {
    const pathname = window.location.pathname;
    const text = getElementSearchText(element);
    const rawText = normalizeText(element.textContent ?? "");
    const href = element instanceof HTMLAnchorElement ? element.href : element.closest("a")?.href ?? "";
    const dataTestId = element.getAttribute("data-testid") ?? "";
    const dataLocation = element.getAttribute("data-location") ?? "";
    const ariaLabel = element.getAttribute("aria-label") ?? "";
    const role = element.getAttribute("role") ?? "";
    const nearbyText = getNearbySearchText(element);
    const joined = normalizeText([text, rawText, nearbyText, href, dataTestId, dataLocation, ariaLabel, role, element.id, element.className.toString()].join(" "));
    const reasons: string[] = [];

    if (pathname === "/sell" && (href.includes("/sell/create") || text === "出品する")) {
      reasons.push("/sell の最初の出品ボタン候補");
    }

    if (pathname === "/sell/create" && /カテゴリー|商品の状態|配送の方法|発送方法/.test(joined)) {
      reasons.push("/sell/create のカテゴリー・状態・配送方法欄候補");
    }

    if (pathname === "/sell/categories" && (href.includes("/sell/categories") || href.includes("/sell/create") || /決定|戻る|カテゴリー|選択する/.test(joined))) {
      reasons.push("/sell/categories の候補リンク・戻る/決定リンク候補");
    }

    if (pathname === "/sell/conditions" && (href.includes("/sell/create") || /新品|未使用|傷|汚れ|状態/.test(joined))) {
      reasons.push("/sell/conditions の商品状態候補");
    }

    if (pathname === "/sell/shipping_methods" && (dataLocation.includes("listing_shipping_methods:update") || text === "更新する")) {
      reasons.push("/sell/shipping_methods の更新するボタン候補");
    }

    if (pathname === "/sell/shipping_methods" && (/広告|早わかり表|配送方法早わかり表|専用資材|資材|メルカリ便|詳しく見る|ガイド/.test(joined) || /(^|[-_\s])(ad|ads|banner|promo|promotion|guide|help)([-_\s]|$)/i.test(joined))) {
      reasons.push("/sell/shipping_methods のクリック禁止候補");
    }

    if (/出品する|出品する$|公開する|確認する/.test(joined) || dataLocation.includes("submit") || dataTestId.toLowerCase().includes("submit")) {
      reasons.push("最終出品ボタンの識別候補");
    }

    if (/category|condition|shipping/i.test([dataTestId, dataLocation, ariaLabel, element.id, element.className.toString(), element.getAttribute("name") ?? ""].join(" "))) {
      reasons.push("属性名が category / condition / shipping に一致");
    }

    return Array.from(new Set(reasons));
  }

  function toDomDebugCandidate(element: HTMLElement, reasons: string[]): DomDebugCandidate {
    const rect = element.getBoundingClientRect();

    return {
      label: guessDomDebugLabel(element),
      reason: reasons.join(" / "),
      tagName: element.tagName,
      text: normalizeText(element.textContent ?? "").slice(0, 500),
      href: element instanceof HTMLAnchorElement ? element.href : element.closest("a")?.href ?? null,
      type: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type || null : element.getAttribute("type"),
      name: element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element.name || null : element.getAttribute("name"),
      id: element.id,
      className: typeof element.className === "string" ? element.className : element.className.toString(),
      "data-testid": element.getAttribute("data-testid"),
      "data-location": element.getAttribute("data-location"),
      "aria-label": element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
      disabled: isElementDisabled(element),
      outerHTML: element.outerHTML.slice(0, 1000),
      parentOuterHTML: element.parentElement?.outerHTML.slice(0, 1000) ?? "",
      visible: isVisible(element),
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function guessDomDebugLabel(element: HTMLElement): string {
    const text = getElementSearchText(element);
    const label = text || element.getAttribute("data-testid") || element.getAttribute("data-location") || element.getAttribute("aria-label") || element.id || element.tagName;
    return label.slice(0, 120);
  }

  function isElementDisabled(element: HTMLElement): boolean {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      return element.disabled;
    }

    return element.getAttribute("aria-disabled") === "true";
  }

  function renderDomDebugPanel(result: { url: string; pathname: string; collectedAt: string; candidates: DomDebugCandidate[] }): void {
    let panel = document.getElementById("furimanager-dom-debug-panel");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "furimanager-dom-debug-panel";
      panel.style.cssText = [
        "position: fixed",
        "right: 12px",
        "bottom: 12px",
        "z-index: 2147483647",
        "width: 280px",
        "max-width: calc(100vw - 24px)",
        "padding: 10px",
        "border: 1px solid #7c3aed",
        "border-radius: 8px",
        "background: #150c2b",
        "color: #ffffff",
        "font-size: 12px",
        "line-height: 1.4",
        "box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32)",
      ].join(";");
      document.body.appendChild(panel);
    }

    const json = JSON.stringify(result, null, 2);
    panel.innerHTML = "";

    const title = document.createElement("div");
    title.textContent = `DOM調査: ${result.candidates.length}件`;
    title.style.cssText = "font-weight: 700; margin-bottom: 8px;";

    const path = document.createElement("div");
    path.textContent = result.pathname;
    path.style.cssText = "margin-bottom: 8px; color: #d8b4fe; word-break: break-all;";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "DOM調査コピー";
    copyButton.style.cssText = [
      "width: 100%",
      "min-height: 36px",
      "border: 0",
      "border-radius: 6px",
      "background: linear-gradient(90deg, #7c3aed, #f97316)",
      "color: #ffffff",
      "font-weight: 700",
      "cursor: pointer",
    ].join(";");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(json);
        copyButton.textContent = "コピー済み";
      } catch {
        console.log("[furimanager dom debug]", result);
        copyButton.textContent = "consoleに出力済み";
      }
    });

    const note = document.createElement("div");
    note.textContent = "クリック調査のみ。自動クリックは停止中。";
    note.style.cssText = "margin-top: 8px; color: #fbcfe8;";

    panel.append(title, path, copyButton, note);
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
