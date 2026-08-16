(() => {
  (() => {
    const mountedWindow = window;
    const chromeApi = globalThis.chrome;
    const RELIST_PENDING_KEY = "relist_pending";
    const MANUAL_CONFIRMATION_REQUIRED_KEY = "furimanager_manual_confirmation_required";
    const TOAST_PREVIEW_KEY = "furimanager_toast_preview";
    const TOAST_PREVIEW_MESSAGE_KEY = "furimanager_toast_preview_message";
    const TOAST_STYLE_RULES = `
      .furimanager-toast {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 14px;
        width: min(440px, calc(100vw - 32px));
        padding: 16px 12px 16px 18px;
        border: 1.5px solid transparent;
        border-radius: 14px;
        background:
          linear-gradient(180deg, #FDF6FC 0%, #FAEDF8 100%) padding-box,
          linear-gradient(112deg, #FF7A2F 0%, #F5386B 13%, #E0329C 29%, #B03BC8 46%, #6F4FDE 70%, #3F6BEF 100%) border-box;
        box-shadow: 0 10px 30px rgba(74, 32, 96, 0.12), 0 2px 6px rgba(74, 32, 96, 0.06);
        color: #2A2735;
        font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, system-ui, -apple-system, "Segoe UI", sans-serif;
        text-align: left;
      }

      .furimanager-toast__icon {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background-image: linear-gradient(135deg, #FF8A2B 0%, #F5356C 34%, #C13BB4 64%, #4F5BE0 100%);
      }

      .furimanager-toast__icon svg,
      .furimanager-toast__close svg {
        display: block;
      }

      .furimanager-toast__message {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        color: #2A2735;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.5;
        letter-spacing: 0.01em;
        overflow-wrap: anywhere;
      }

      .furimanager-toast__meta {
        flex: none;
        align-self: flex-start;
        display: flex;
        align-items: center;
        gap: 6px;
        height: 21px;
      }

      .furimanager-toast__time {
        color: #8B8797;
        font-size: 12px;
        font-weight: 400;
        line-height: 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .furimanager-toast__close {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #6F6B7D;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
      }

      .furimanager-toast__close:hover {
        background: rgba(110, 90, 140, 0.12);
      }

      .furimanager-toast--preview {
        cursor: default;
      }
  `;
    const PRICE_ADJUST_PENDING_KEY = "furimanager_price_adjust_pending";
    const LISTING_MANAGEMENT_PENDING_KEY = "furimanager_listing_management_pending";
    const MAX_WAIT_MS = 12e3;
    const RETRY_INTERVAL_MS = 300;
    const INITIAL_SELL_CLICK_WAIT_MS = 600;
    const METADATA_OPEN_WAIT_MS = 350;
    const METADATA_SELECT_WAIT_MS = 250;
    const SELECTION_POLL_MS = 75;
    const SAFE_CLICK_SETTLE_MS = 150;
    const FINAL_ACTION_AFTER_COMPLETE_WAIT_MS = 1e3;
    const FINAL_ACTION_MIN_WAIT_MS = 1e4;
    const FINAL_ACTION_DOM_STABLE_MS = 800;
    const RELIST_FLOW_LOG_INTERVAL_MS = 1500;
    const NON_BLOCKING_FINAL_ACTION_MISSING_FIELDS = /* @__PURE__ */ new Set(["size", "brand"]);
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
    const DRAFT_SAVE_DONE_KEY = "furimanager_relist_draft_save_done";
    const LISTING_SUBMIT_DONE_KEY = "furimanager_relist_submit_done";
    const ENABLE_DOM_DEBUG = false;
    const ENABLE_METADATA_AUTOFILL = true;
    const ENABLE_RELIST_FLOW_LOG = true;
    let imageFillAttempted = false;
    let sellFormMutationObserver = null;
    let observedSellFormMutationRoot = null;
    let lastSellFormMutationAt = Date.now();
    let lastRelistFlowLogAt = 0;
    let lastRelistFlowLogKey = "";
    if (mountedWindow.__furimanagerRelistAutofillMounted) {
      return;
    }
    mountedWindow.__furimanagerRelistAutofillMounted = true;
    installToastPreviewControls();
    function getUserFacingRelistErrorMessage(error) {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (message === "edit page is not open") {
        return "\u4FA1\u683C\u5909\u66F4\u753B\u9762\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5546\u54C1\u7DE8\u96C6\u30DA\u30FC\u30B8\u3092\u958B\u304D\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
      }
      if (message === "price field not found") {
        return "\u4FA1\u683C\u5165\u529B\u6B04\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
      }
      if (message === "current price could not be read") {
        return "\u73FE\u5728\u4FA1\u683C\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u4FA1\u683C\u6B04\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
      }
      if (message.startsWith("minimum price reached:")) {
        return "\u8A2D\u5B9A\u3057\u305F\u4E0B\u9650\u4FA1\u683C\u3092\u4E0B\u56DE\u308B\u305F\u3081\u3001\u4FA1\u683C\u5909\u66F4\u3092\u6B62\u3081\u307E\u3057\u305F\u3002";
      }
      if (message === "edit submit button not found") {
        return "\u5909\u66F4\u3092\u4FDD\u5B58\u3059\u308B\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
      }
      if (message.startsWith("price update was not completed:")) {
        return "\u4FA1\u683C\u5909\u66F4\u306E\u5B8C\u4E86\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30E1\u30EB\u30AB\u30EA\u306E\u5546\u54C1\u30DA\u30FC\u30B8\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
      }
      if (/[ぁ-んァ-ヶ一-龠々]/.test(message)) {
        return message;
      }
      return "\u5546\u54C1\u64CD\u4F5C\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
    }
    chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "APPLY_FURIMANE_PRICE_DROP_ON_EDIT") {
        return false;
      }
      void applyPriceDropOnEditPage(message).then((result) => {
        sendResponse({
          success: true,
          ...result
        });
      }).catch((error) => {
        sendResponse({
          success: false,
          reason: getUserFacingRelistErrorMessage(error)
        });
      });
      return true;
    });
    function boot() {
      if (!window.location.pathname.startsWith("/sell")) {
        return;
      }
      if (ENABLE_DOM_DEBUG) {
        debugMercariSellDom();
        window.setTimeout(debugMercariSellDom, 1500);
      }
      if (window.location.pathname.startsWith("/sell/edit")) {
        if (applyPendingListingManagementOnEditPage()) {
          return;
        }
        if (applyPendingPriceAdjustOnEditPage()) {
          return;
        }
      }
      getPendingItem((item) => {
        if (!item) {
          return;
        }
        void waitForFormAndFill(item);
      });
    }
    function applyPendingPriceAdjustOnEditPage() {
      const pending = getPendingPriceAdjustItem();
      if (!pending) {
        return false;
      }
      const currentItemId = getEditPageItemId();
      if (pending.itemId !== currentItemId) {
        clearPendingPriceAdjustItem();
        return false;
      }
      const amount = Math.abs(pending.delta);
      if (!Number.isFinite(amount) || amount <= 0) {
        clearPendingPriceAdjustItem();
        return false;
      }
      void applyPriceDropOnEditPage({ delta: pending.delta }).then(() => {
        clearPendingPriceAdjustItem();
      }).catch((error) => {
        clearPendingPriceAdjustItem();
        console.warn("[furimanager] manual price adjust failed", error);
      });
      return true;
    }
    function applyPendingListingManagementOnEditPage() {
      const pending = getPendingListingManagementItem();
      if (!pending) {
        return false;
      }
      const currentItemId = getEditPageItemId();
      if (pending.itemId !== currentItemId) {
        clearPendingListingManagementItem();
        return false;
      }
      void executePendingListingManagement(pending).then(() => {
        clearPendingListingManagementItem();
      }).catch((error) => {
        clearPendingListingManagementItem();
        console.warn("[furimanager] listing management failed", error);
        showToast(getUserFacingRelistErrorMessage(error));
      });
      return true;
    }
    function getPendingListingManagementItem() {
      try {
        const raw = sessionStorage.getItem(LISTING_MANAGEMENT_PENDING_KEY);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        const isFresh = typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt <= 12e4;
        if (typeof parsed.itemId !== "string" || !/^m\d{8,}$/.test(parsed.itemId) || parsed.action !== "stop" && parsed.action !== "delete" || !isFresh) {
          clearPendingListingManagementItem();
          return null;
        }
        return {
          itemId: parsed.itemId,
          action: parsed.action,
          savedAt: parsed.savedAt
        };
      } catch {
        clearPendingListingManagementItem();
        return null;
      }
    }
    function clearPendingListingManagementItem() {
      sessionStorage.removeItem(LISTING_MANAGEMENT_PENDING_KEY);
    }
    async function executePendingListingManagement(pending) {
      if (pending.action === "stop") {
        const suspendButton = await waitForActionButton(findSuspendListingButton);
        if (!suspendButton) {
          throw new Error("\u300C\u51FA\u54C1\u3092\u4E00\u6642\u505C\u6B62\u3059\u308B\u300D\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
        }
        const details2 = {
          action: "stop",
          itemId: pending.itemId,
          reason: "suspend-button-ready",
          ...getButtonLogDetails(suspendButton)
        };
        logRelistFlow("\u505C\u6B62\u30DC\u30BF\u30F3\u691C\u77E5", { pathname: window.location.pathname, ...details2 }, { force: true });
        handOffManualConfirmation(details2, "\u505C\u6B62\u30DC\u30BF\u30F3\u3092\u691C\u77E5\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u505C\u6B62\u64CD\u4F5C\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
        return;
      }
      const deleteButton = await waitForActionButton(findInitialDeleteListingButton);
      if (!deleteButton) {
        throw new Error("\u300C\u3053\u306E\u5546\u54C1\u3092\u524A\u9664\u3059\u308B\u300D\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
      }
      clickButtonLike(deleteButton);
      const confirmButton = await waitForActionButton(findDeleteConfirmationButton);
      if (!confirmButton) {
        throw new Error("\u524A\u9664\u78BA\u8A8D\u30C0\u30A4\u30A2\u30ED\u30B0\u306E\u300C\u524A\u9664\u3059\u308B\u300D\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
      }
      const details = {
        action: "delete",
        itemId: pending.itemId,
        reason: "delete-confirmation-button-ready",
        ...getButtonLogDetails(confirmButton)
      };
      logRelistFlow("\u524A\u9664\u78BA\u8A8D\u30DC\u30BF\u30F3\u691C\u77E5", { pathname: window.location.pathname, ...details }, { force: true });
      handOffManualConfirmation(details, "\u524A\u9664\u78BA\u8A8D\u30C0\u30A4\u30A2\u30ED\u30B0\u3092\u8868\u793A\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u524A\u9664\u64CD\u4F5C\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
    }
    async function waitForActionButton(finder) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const button = finder();
        if (button && isClickableButtonLike(button)) {
          return button;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      return null;
    }
    function findSuspendListingButton() {
      const selectors = [
        'button[data-testid="suspend-button"]',
        '[data-testid="suspend-button"] button',
        '[data-location="listing:footer:exit_buttons:suspend_listing"] button'
      ];
      const direct = findVisibleElement(selectors);
      if (direct && normalizeText(direct.textContent).includes("\u51FA\u54C1\u3092\u4E00\u6642\u505C\u6B62\u3059\u308B")) {
        return direct;
      }
      return findVisibleButtonByExactText("\u51FA\u54C1\u3092\u4E00\u6642\u505C\u6B62\u3059\u308B");
    }
    function findInitialDeleteListingButton() {
      const selectors = [
        'button[data-testid="delete-button"]',
        '[data-testid="delete-button"] button',
        '[data-location="listing:footer:exit_buttons:delete_listing"] button'
      ];
      const direct = findVisibleElement(selectors);
      if (direct && normalizeText(direct.textContent).includes("\u3053\u306E\u5546\u54C1\u3092\u524A\u9664\u3059\u308B")) {
        return direct;
      }
      return findVisibleButtonByExactText("\u3053\u306E\u5546\u54C1\u3092\u524A\u9664\u3059\u308B");
    }
    function findDeleteConfirmationButton() {
      const selectors = [
        'button[data-testid="dialog-action-button"]',
        '[data-testid="dialog-action-button"] button'
      ];
      const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter((element) => element instanceof HTMLElement && isVisible(element));
      const textCandidates = Array.from(document.querySelectorAll("button")).filter((element) => element instanceof HTMLButtonElement && isVisible(element) && normalizeText(element.textContent) === "\u524A\u9664\u3059\u308B");
      return [...candidates, ...textCandidates].find((element) => normalizeText(element.textContent) === "\u524A\u9664\u3059\u308B" && hasDeleteConfirmationContext(element)) ?? null;
    }
    function findVisibleElement(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement && isVisible(element)) {
          return element;
        }
      }
      return null;
    }
    function findVisibleButtonByExactText(text) {
      return Array.from(document.querySelectorAll("button")).filter((element) => element instanceof HTMLButtonElement && isVisible(element)).find((button) => normalizeText(button.textContent) === text) ?? null;
    }
    function hasDeleteConfirmationContext(element) {
      let current = element;
      for (let depth = 0; current && depth < 7; depth += 1) {
        if (normalizeText(current.textContent).includes("\u3053\u306E\u5546\u54C1\u3092\u524A\u9664\u3057\u307E\u3059\u304B")) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }
    function getPendingPriceAdjustItem() {
      try {
        const raw = sessionStorage.getItem(PRICE_ADJUST_PENDING_KEY);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed.itemId !== "string" || !/^m\d{8,}$/.test(parsed.itemId)) {
          clearPendingPriceAdjustItem();
          return null;
        }
        if (typeof parsed.delta !== "number" || !Number.isFinite(parsed.delta)) {
          clearPendingPriceAdjustItem();
          return null;
        }
        return {
          itemId: parsed.itemId,
          delta: parsed.delta,
          savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0
        };
      } catch {
        clearPendingPriceAdjustItem();
        return null;
      }
    }
    function clearPendingPriceAdjustItem() {
      sessionStorage.removeItem(PRICE_ADJUST_PENDING_KEY);
    }
    function getEditPageItemId() {
      return window.location.pathname.match(/\/sell\/edit\/(m\d{8,})/)?.[1] ?? null;
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
      resetSelectionSessionIfNeeded(item);
      observeSellFormMutations();
      logRelistFlow("\u958B\u59CB", getItemLogDetails(item), { force: true });
      if (ENABLE_DOM_DEBUG && isMercariSellDebugPath()) {
        return;
      }
      if (await handleSelectionSubPage(item)) {
        return;
      }
      const startedAt = Date.now();
      let hasFilledAnyField = false;
      let latestResult = null;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        if (await handleSelectionSubPage(item)) {
          return;
        }
        if (!hasFilledAnyField && isInitialSellLandingPage() && goToInitialSellForm()) {
          logRelistFlow("\u65B0\u898F\u51FA\u54C1\u30D5\u30A9\u30FC\u30E0\u3078\u79FB\u52D5", { elapsedSec: getElapsedSec(startedAt), pathname: window.location.pathname, mode: item.mode }, { force: true });
          await sleep(INITIAL_SELL_CLICK_WAIT_MS);
          continue;
        }
        const result = await fillAvailableFields(item);
        latestResult = result;
        hasFilledAnyField = result.filled || hasFilledAnyField;
        const readinessBeforeWait = getFinalActionReadiness(item);
        const canProceedWithPartialFields = canProceedWithNonBlockingMissingFields(item, result, readinessBeforeWait);
        const canHandOffCopyListing = canHandOffCopyListingToUser(item, result, readinessBeforeWait);
        const flowStatus = getFlowStatus(result, readinessBeforeWait, canProceedWithPartialFields);
        logRelistFlow("\u5165\u529B\u72B6\u6CC1", {
          elapsedMs: Date.now() - startedAt,
          elapsedSec: getElapsedSec(startedAt),
          pathname: window.location.pathname,
          mode: item.mode,
          step: flowStatus.step,
          waitingFor: flowStatus.waitingFor,
          filled: result.filled,
          complete: result.complete,
          filledCount: result.filledCount,
          targetCount: result.targetCount,
          missingFields: result.missingFields,
          skippedMissingFields: canProceedWithPartialFields ? result.missingFields : [],
          hasFilledAnyField,
          finalReady: readinessBeforeWait.ready,
          reason: flowStatus.reason,
          ...readinessBeforeWait.details
        });
        if (canHandOffCopyListing) {
          logRelistFlow("\u30B3\u30D4\u30FC\u51FA\u54C1\u306F\u624B\u52D5\u78BA\u8A8D\u5F85\u3061", {
            elapsedMs: Date.now() - startedAt,
            elapsedSec: getElapsedSec(startedAt),
            pathname: window.location.pathname,
            mode: item.mode,
            reason: result.complete ? "copy-ready" : "copy-ready-with-non-blocking-fields-skipped",
            skippedMissingFields: result.complete ? [] : result.missingFields,
            ...readinessBeforeWait.details
          }, { force: true });
          handOffManualConfirmation({
            action: "copy",
            itemId: item.itemId,
            itemUrl: item.itemUrl,
            taskId: item.taskId,
            mode: item.mode,
            reason: result.complete ? "copy-ready" : "copy-ready-with-non-blocking-fields-skipped",
            missingFields: result.missingFields,
            ...readinessBeforeWait.details
          }, "\u30B3\u30D4\u30FC\u51FA\u54C1\u306E\u5165\u529B\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u51FA\u54C1\u30DC\u30BF\u30F3\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
          clearPendingItem();
          return;
        }
        if (result.complete || canProceedWithPartialFields) {
          await sleep(FINAL_ACTION_AFTER_COMPLETE_WAIT_MS);
          const readiness = getFinalActionReadiness(item);
          const canProceedAfterWait = result.complete || canProceedWithNonBlockingMissingFields(item, result, readiness);
          if (!readiness.ready || !canProceedAfterWait) {
            logRelistFlow("\u6700\u7D42\u30DC\u30BF\u30F3\u5F85\u3061", {
              elapsedMs: Date.now() - startedAt,
              elapsedSec: getElapsedSec(startedAt),
              pathname: window.location.pathname,
              mode: item.mode,
              reason: readiness.ready ? "blocking-fields-incomplete" : readiness.reason,
              missingFields: result.missingFields,
              ...readiness.details
            });
            await sleep(RETRY_INTERVAL_MS);
            continue;
          }
          logRelistFlow("\u6700\u7D42\u30DC\u30BF\u30F3\u691C\u77E5", {
            elapsedMs: Date.now() - startedAt,
            elapsedSec: getElapsedSec(startedAt),
            pathname: window.location.pathname,
            mode: item.mode,
            reason: result.complete ? readiness.reason : "non-blocking-fields-skipped",
            skippedMissingFields: result.complete ? [] : result.missingFields,
            ...readiness.details
          }, { force: true });
          if (item.mode === "draft") {
            await saveDraftAfterFill(item);
          } else if (item.mode === "relist" || item.mode === "copy") {
            await submitListingAfterFill(item);
          }
          return;
        }
        if (hasFilledAnyField && Date.now() - startedAt > FINAL_ACTION_MIN_WAIT_MS && (result.complete || canProceedWithPartialFields) && await detectVisibleFinalActionIfReady(item, { requireStableDom: false })) {
          return;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      if (hasFilledAnyField) {
        const readiness = getFinalActionReadiness(item, { requireStableDom: false });
        const canClickAfterTimeout = latestResult !== null && (latestResult.complete || canProceedWithNonBlockingMissingFields(item, latestResult, readiness));
        if (canClickAfterTimeout) {
          logRelistFlow("\u901A\u5E38\u5F85\u6A5F\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u5F8C\u306E\u4FDD\u967A\u691C\u77E5", { elapsedSec: getElapsedSec(startedAt), pathname: window.location.pathname, mode: item.mode }, { force: true });
          await detectVisibleFinalActionIfReady(item, { requireStableDom: false });
          return;
        }
        logRelistFlow("\u901A\u5E38\u5F85\u6A5F\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\uFF08\u672A\u5B8C\u4E86\uFF09", {
          elapsedSec: getElapsedSec(startedAt),
          pathname: window.location.pathname,
          mode: item.mode,
          reason: "blocking-fields-incomplete",
          missingFields: latestResult?.missingFields ?? []
        }, { force: true });
        showToast("\u672A\u5165\u529B\u306E\u5FC5\u9808\u9805\u76EE\u304C\u3042\u308B\u305F\u3081\u3001\u51FA\u54C1\u30DC\u30BF\u30F3\u306F\u62BC\u3057\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      if (isInitialSellLandingPage()) {
        return;
      }
      showToast("\u30D5\u30EA\u30DE\u30CD\u306E\u51FA\u54C1\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F\u304C\u3001\u5165\u529B\u3067\u304D\u308B\u6B04\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
    }
    function observeSellFormMutations() {
      const root = document.querySelector("form") ?? document.querySelector("main") ?? document.body;
      if (!root || observedSellFormMutationRoot === root) {
        return;
      }
      sellFormMutationObserver?.disconnect();
      lastSellFormMutationAt = Date.now();
      observedSellFormMutationRoot = root;
      sellFormMutationObserver = new MutationObserver(() => {
        lastSellFormMutationAt = Date.now();
      });
      sellFormMutationObserver.observe(root, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }
    function resetSelectionSessionIfNeeded(item) {
      const sessionKey = item.savedAt ?? item.itemUrl ?? item.itemId ?? "unknown";
      if (sessionStorage.getItem(SESSION_ITEM_KEY) === sessionKey) {
        return;
      }
      [IMAGE_DONE_KEY, SIZE_DONE_KEY, BRAND_DONE_KEY, SHIPPING_FROM_DONE_KEY, CATEGORY_STEP_KEY, CATEGORY_DONE_KEY, CONDITION_DONE_KEY, SHIPPING_METHOD_DONE_KEY, CATEGORY_ID_PATH_KEY, INITIAL_CREATE_VISITED_KEY, DRAFT_SAVE_DONE_KEY, LISTING_SUBMIT_DONE_KEY].forEach((key) => sessionStorage.removeItem(key));
      sessionStorage.setItem(SESSION_ITEM_KEY, sessionKey);
    }
    async function submitListingAfterFill(item) {
      if (sessionStorage.getItem(LISTING_SUBMIT_DONE_KEY) === "true" && !findFinalListingSubmitButton()) {
        return;
      }
      if (!await ensurePriceBeforeFinalAction(item)) {
        showToast("\u4FA1\u683C\u304C\u5143\u306E\u5546\u54C1\u4FA1\u683C\u3068\u4E00\u81F4\u3057\u306A\u3044\u305F\u3081\u3001\u51FA\u54C1\u3092\u6B62\u3081\u307E\u3057\u305F");
        return;
      }
      await sleep(SAFE_CLICK_SETTLE_MS);
      const button = await waitForFinalListingSubmitButton();
      if (!button) {
        showToast("\u300C\u51FA\u54C1\u3059\u308B\u300D\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      sessionStorage.setItem(LISTING_SUBMIT_DONE_KEY, "true");
      const details = {
        action: item.mode === "copy" ? "copy" : "relist",
        itemId: item.itemId,
        itemUrl: item.itemUrl,
        taskId: item.taskId,
        mode: item.mode,
        reason: "listing-submit-button-ready",
        ...getButtonLogDetails(button)
      };
      logRelistFlow("\u51FA\u54C1\u30DC\u30BF\u30F3\u691C\u77E5", { pathname: window.location.pathname, mode: item.mode, ...details }, { force: true });
      handOffManualConfirmation(details, "\u5165\u529B\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u51FA\u54C1\u30DC\u30BF\u30F3\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
      chromeApi?.storage?.local?.remove(RELIST_PENDING_KEY);
    }
    async function waitForFinalListingSubmitButton() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const button = findFinalListingSubmitButton();
        if (button && isClickableButtonLike(button)) {
          return button;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      return null;
    }
    function findFinalListingSubmitButton() {
      if (window.location.pathname !== "/sell/create") {
        return null;
      }
      const selectors = [
        'button[data-testid="list-item-button"]',
        'button[type="submit"][data-testid="list-item-button"]',
        '[data-location="listing:footer:exit_buttons:list"] button',
        '[data-location="listing:footer:exit_buttons:list"]',
        'button[type="submit"]',
        'button[data-testid*="submit"]',
        '[data-testid*="submit"] button',
        '[data-location*="submit"] button',
        '[data-location*="listing"] button',
        "mer-button button"
      ];
      const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      return Array.from(new Set(candidates)).filter((element) => element instanceof HTMLElement && isVisible(element)).find((element) => {
        const joinedText = normalizeText([
          getElementSearchText(element),
          element.getAttribute("data-testid"),
          element.getAttribute("data-location"),
          element.getAttribute("aria-label"),
          element.id,
          element.className?.toString?.()
        ].filter(Boolean).join(" "));
        return /出品する|公開する|確認する/.test(joinedText) || joinedText.toLowerCase().includes("submit");
      }) ?? null;
    }
    async function saveDraftAfterFill(item) {
      if (sessionStorage.getItem(DRAFT_SAVE_DONE_KEY) === "true" && !findDraftSaveButton()) {
        return;
      }
      if (!await ensurePriceBeforeFinalAction(item)) {
        showToast("\u4FA1\u683C\u304C\u5143\u306E\u5546\u54C1\u4FA1\u683C\u3068\u4E00\u81F4\u3057\u306A\u3044\u305F\u3081\u3001\u4E0B\u66F8\u304D\u4FDD\u5B58\u3092\u6B62\u3081\u307E\u3057\u305F");
        return;
      }
      await sleep(SAFE_CLICK_SETTLE_MS);
      const button = await waitForDraftSaveButton();
      if (!button) {
        showToast("\u300C\u4E0B\u66F8\u304D\u306B\u4FDD\u5B58\u3059\u308B\u300D\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      sessionStorage.setItem(DRAFT_SAVE_DONE_KEY, "true");
      const details = {
        action: "draft",
        itemId: item.itemId,
        itemUrl: item.itemUrl,
        taskId: item.taskId,
        mode: item.mode,
        reason: "draft-save-button-ready",
        ...getButtonLogDetails(button)
      };
      logRelistFlow("\u4E0B\u66F8\u304D\u4FDD\u5B58\u30DC\u30BF\u30F3\u691C\u77E5", { pathname: window.location.pathname, mode: item.mode, ...details }, { force: true });
      handOffManualConfirmation(details, "\u5165\u529B\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u4E0B\u66F8\u304D\u4FDD\u5B58\u30DC\u30BF\u30F3\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
      chromeApi?.storage?.local?.remove(RELIST_PENDING_KEY);
    }
    async function detectVisibleFinalActionIfReady(item, options = {}) {
      const readiness = getFinalActionReadiness(item, options);
      if (!readiness.ready) {
        logRelistFlow("\u4FDD\u967A\u30AF\u30EA\u30C3\u30AF\u5F85\u3061\u5931\u6557", {
          pathname: window.location.pathname,
          mode: item.mode,
          reason: readiness.reason,
          ...readiness.details
        }, { force: true });
        return false;
      }
      if (item.mode === "draft") {
        await saveDraftAfterFill(item);
        return true;
      }
      if (item.mode === "relist" || item.mode === "copy") {
        await submitListingAfterFill(item);
        return true;
      }
      return false;
    }
    async function ensurePriceBeforeFinalAction(item) {
      if (typeof item.price !== "number") {
        return false;
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (fillPriceField(item.price)) {
          return true;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      logRelistFlow("\u4FA1\u683C\u30C1\u30A7\u30C3\u30AF\u5931\u6557", {
        pathname: window.location.pathname,
        mode: item.mode,
        expectedPrice: item.price,
        priceFieldFound: findPriceField() !== null,
        priceFieldValue: findPriceField()?.value ?? null
      }, { force: true });
      return false;
    }
    async function waitForDraftSaveButton() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const button = findDraftSaveButton();
        if (button && isClickableButtonLike(button)) {
          return button;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      return null;
    }
    function findDraftSaveButton() {
      const selectors = [
        'button[data-testid="save-draft"]',
        'button[testid="save-draft"]',
        '[data-location="listing:footer:exit_buttons:save_draft"] button',
        '[data-location="listing:footer:exit_buttons:save_draft"]'
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement && isVisible(element)) {
          return element;
        }
      }
      return Array.from(document.querySelectorAll("button")).filter((element) => element instanceof HTMLButtonElement && isVisible(element)).find((button) => normalizeText(button.textContent).includes("\u4E0B\u66F8\u304D\u306B\u4FDD\u5B58\u3059\u308B")) ?? null;
    }
    async function handleSelectionSubPage(item) {
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
    async function fillAvailableFields(item) {
      let targetCount = 0;
      let filledCount = 0;
      const missingFields = [];
      await clickImageUploadNextButtonIfVisible();
      await clickAiSupportSkipButtonIfVisible();
      if ((item.imageUrls?.length ?? 0) > 0) {
        targetCount += 1;
        if (await fillImageField(item.imageUrls)) {
          filledCount += 1;
        } else {
          missingFields.push("images");
        }
      }
      if (item.title) {
        targetCount += 1;
        if (setFieldValue(findTitleField(), item.title)) {
          filledCount += 1;
        } else {
          missingFields.push("title");
        }
      }
      if (typeof item.price === "number") {
        targetCount += 1;
        if (fillPriceField(item.price)) {
          filledCount += 1;
        } else {
          missingFields.push("price");
        }
      }
      if (item.description) {
        targetCount += 1;
        if (setFieldValue(findDescriptionField(), item.description)) {
          filledCount += 1;
        } else {
          missingFields.push("description");
        }
      }
      await clickAiSupportSkipButtonIfVisible();
      const basicFieldsComplete = targetCount > 0 && filledCount === targetCount && !isImageUploadDialogOpen() && !isAiSupportDialogOpen();
      const metadataResult = basicFieldsComplete ? await fillMetadataFields(item) : { targetCount: 0, filledCount: 0, missingFields: [] };
      targetCount += metadataResult.targetCount;
      filledCount += metadataResult.filledCount;
      missingFields.push(...metadataResult.missingFields);
      const valuesComplete = targetCount > 0 && filledCount === targetCount;
      return {
        filled: filledCount > 0,
        complete: valuesComplete,
        targetCount,
        filledCount,
        missingFields
      };
    }
    function isFinalActionReady(item, options = {}) {
      return getFinalActionReadiness(item, options).ready;
    }
    function getFinalActionReadiness(item, options = {}) {
      if (window.location.pathname !== "/sell/create") {
        return { ready: false, reason: "not-sell-create", details: { pathname: window.location.pathname } };
      }
      const imageDialogOpen = isImageUploadDialogOpen();
      const aiDialogOpen = isAiSupportDialogOpen();
      const activePickerRoot = findActivePickerRoot();
      if (imageDialogOpen || aiDialogOpen || activePickerRoot !== document) {
        return {
          ready: false,
          reason: imageDialogOpen ? "image-dialog-open" : aiDialogOpen ? "ai-dialog-open" : "picker-open",
          details: {
            imageDialogOpen,
            aiDialogOpen,
            activePicker: summarizeElement(activePickerRoot),
            activePickerDetails: getElementLogDetails(activePickerRoot)
          }
        };
      }
      const stableForMs = Date.now() - lastSellFormMutationAt;
      if ((options.requireStableDom ?? true) && stableForMs < FINAL_ACTION_DOM_STABLE_MS) {
        return { ready: false, reason: "dom-not-stable", details: { stableForMs, requiredStableMs: FINAL_ACTION_DOM_STABLE_MS } };
      }
      if (typeof item.price === "number" && !isPriceReady(item.price)) {
        const priceField = findPriceField();
        return {
          ready: false,
          reason: "price-not-ready",
          details: {
            expectedPrice: item.price,
            priceFieldFound: priceField !== null,
            priceFieldValue: priceField?.value ?? null,
            displayedPriceReady: isPriceAlreadyDisplayed(item.price)
          }
        };
      }
      const button = item.mode === "draft" ? findDraftSaveButton() : findFinalListingSubmitButton();
      if (!button) {
        return { ready: false, reason: "button-not-found", details: getButtonLogDetails(button) };
      }
      if (!isClickableButtonLike(button)) {
        return { ready: false, reason: "button-not-clickable", details: getButtonLogDetails(button) };
      }
      return { ready: true, reason: "ready", details: getButtonLogDetails(button) };
    }
    function logRelistFlow(message, details = {}, options = {}) {
      if (!ENABLE_RELIST_FLOW_LOG) {
        return;
      }
      const now = Date.now();
      const key = [message, details.pathname, details.mode, details.step, details.waitingFor, details.complete, details.filledCount, details.targetCount, details.reason, details.finalReady, details.buttonFound, details.buttonClickable, details.missingFields, details.activePicker].join("|");
      if (!options.force && key === lastRelistFlowLogKey && now - lastRelistFlowLogAt < RELIST_FLOW_LOG_INTERVAL_MS) {
        return;
      }
      lastRelistFlowLogAt = now;
      lastRelistFlowLogKey = key;
      console.info(`[furimanager:relist] ${message}${getRelistFlowLogSuffix(details)}`, details);
    }
    function getRelistFlowLogSuffix(details) {
      const parts = [
        typeof details.elapsedSec === "number" ? `${details.elapsedSec}s` : null,
        typeof details.result === "string" ? `result=${details.result}` : null,
        typeof details.signal === "string" ? `signal=${details.signal}` : null,
        typeof details.from === "string" ? `from=${details.from}` : null,
        typeof details.to === "string" ? `to=${details.to}` : null,
        typeof details.current === "string" ? `current=${details.current}` : null,
        typeof details.step === "string" ? `step=${details.step}` : null,
        typeof details.waitingFor === "string" ? `waiting=${details.waitingFor}` : null,
        typeof details.reason === "string" ? `reason=${details.reason}` : null,
        typeof details.message === "string" ? `message=${details.message.slice(0, 80)}` : null,
        Array.isArray(details.missingFields) && details.missingFields.length > 0 ? `missing=${details.missingFields.join(",")}` : null,
        Array.isArray(details.skippedMissingFields) && details.skippedMissingFields.length > 0 ? `skipped=${details.skippedMissingFields.join(",")}` : null,
        typeof details.activePicker === "string" && details.activePicker !== "document" ? `picker=${details.activePicker.slice(0, 80)}` : null,
        typeof details.buttonText === "string" && details.buttonText ? `button=${details.buttonText.slice(0, 40)}` : null
      ].filter(Boolean);
      return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
    }
    function canProceedWithNonBlockingMissingFields(item, result, readiness) {
      const nonBlockingFields = item.mode === "relist" ? /* @__PURE__ */ new Set(["brand"]) : NON_BLOCKING_FINAL_ACTION_MISSING_FIELDS;
      return !result.complete && result.filled && readiness.ready && result.missingFields.length > 0 && result.missingFields.every((field) => nonBlockingFields.has(field));
    }
    function canHandOffCopyListingToUser(item, result, readiness) {
      return item.mode === "copy" && result.filled && readiness.ready && (result.complete || result.missingFields.length > 0 && result.missingFields.every((field) => NON_BLOCKING_FINAL_ACTION_MISSING_FIELDS.has(field)));
    }
    function getFlowStatus(result, readiness, canProceedWithPartialFields) {
      if (canProceedWithPartialFields) {
        return {
          step: "manual-confirmation",
          waitingFor: "ready",
          reason: "non-blocking-fields-skipped"
        };
      }
      if (!result.complete) {
        const missing = result.missingFields[0] ?? "values";
        return {
          step: "fill-fields",
          waitingFor: missing,
          reason: "values-incomplete"
        };
      }
      if (!readiness.ready) {
        return {
          step: "wait-final-action",
          waitingFor: readiness.reason,
          reason: readiness.reason
        };
      }
      return {
        step: "manual-confirmation",
        waitingFor: "ready",
        reason: "ready"
      };
    }
    function getElapsedSec(startedAt) {
      return Math.round((Date.now() - startedAt) / 100) / 10;
    }
    function getItemLogDetails(item) {
      return {
        pathname: window.location.pathname,
        mode: item.mode,
        itemId: item.itemId,
        hasTitle: !!item.title,
        price: item.price,
        imageCount: item.imageUrls?.length ?? 0,
        hasDescription: !!item.description,
        categoryCount: item.categoryPath?.length ?? 0,
        hasCondition: !!item.condition,
        hasShippingMethod: !!item.shippingMethod,
        hasShippingFrom: !!item.shippingFrom,
        hasShippingDays: !!item.shippingDays
      };
    }
    function getButtonLogDetails(button) {
      const innerButton = button instanceof HTMLButtonElement ? button : button?.querySelector("button") ?? null;
      const target = innerButton instanceof HTMLElement ? innerButton : button;
      return {
        buttonFound: button !== null,
        buttonClickable: button ? isClickableButtonLike(button) : false,
        buttonText: button ? normalizeText(getElementSearchText(button)).slice(0, 80) : "",
        buttonDisabled: innerButton instanceof HTMLButtonElement ? innerButton.disabled : null,
        buttonAriaDisabled: target?.getAttribute("aria-disabled") ?? null,
        buttonVisible: button ? isVisible(button) : false
      };
    }
    function summarizeElement(root) {
      if (root === document) {
        return "document";
      }
      if (!(root instanceof HTMLElement)) {
        return "unknown";
      }
      const rect = root.getBoundingClientRect();
      const label = root.getAttribute("aria-label") ?? root.getAttribute("data-testid") ?? root.id ?? root.className?.toString?.() ?? "";
      const text = normalizeText(root.textContent).slice(0, 80);
      return [root.tagName.toLowerCase(), label, `${Math.round(rect.width)}x${Math.round(rect.height)}`, text].filter(Boolean).join(" ");
    }
    function getElementLogDetails(root) {
      if (root === document || !(root instanceof HTMLElement)) {
        return null;
      }
      const rect = root.getBoundingClientRect();
      return {
        tag: root.tagName.toLowerCase(),
        id: root.id || null,
        className: root.className?.toString?.().slice(0, 160) || null,
        role: root.getAttribute("role"),
        ariaModal: root.getAttribute("aria-modal"),
        ariaLabel: root.getAttribute("aria-label"),
        dataTestId: root.getAttribute("data-testid"),
        text: normalizeText(root.textContent).slice(0, 160),
        rect: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        }
      };
    }
    function isPriceReady(price) {
      const field = findPriceField();
      if (field) {
        return parsePriceValue(field.value) === price;
      }
      return false;
    }
    async function fillImageField(imageUrls) {
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
    function hasUploadedListingImages() {
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
    async function clickImageUploadNextButtonIfVisible() {
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
    function findImageUploadNextButton() {
      const fixedButton = document.querySelector('[data-testid="image-upload-step"] [data-testid="stepper-next-button"] button, [data-testid="image-upload-step"] button[data-testid="stepper-next-button"], [data-testid="image-upload-step"] [data-testid="stepper-next-button"]');
      if (fixedButton instanceof HTMLElement && isClickableButtonLike(fixedButton)) {
        return fixedButton;
      }
      const dialog = getImageUploadDialog();
      if (!dialog) {
        return null;
      }
      return Array.from(dialog.querySelectorAll('button[type="button"], button, [role="button"]')).filter((button) => button instanceof HTMLElement && isClickableButtonLike(button)).find((button) => normalizeText(button.textContent) === "\u6B21\u3078") ?? null;
    }
    function isClickableButtonLike(element) {
      const button = element instanceof HTMLButtonElement ? element : element.querySelector("button");
      if (button instanceof HTMLButtonElement) {
        return !button.disabled && button.getAttribute("aria-disabled") !== "true" && isVisible(button);
      }
      return element.getAttribute("aria-disabled") !== "true" && isVisible(element);
    }
    function getImageUploadDialog() {
      const dialog = document.querySelector('[role="dialog"][aria-label="\u51FA\u54C1\u753B\u50CF"], [data-testid="image-upload-step"]');
      return dialog instanceof HTMLElement && isVisible(dialog) ? dialog : null;
    }
    function isImageUploadDialogOpen() {
      return getImageUploadDialog() !== null;
    }
    async function clickAiSupportSkipButtonIfVisible() {
      const dialog = getAiSupportDialog();
      if (!dialog) {
        return false;
      }
      const skipButton = dialog.querySelector('button[data-testid="stepper-skip-button"]') ?? Array.from(dialog.querySelectorAll('button[type="button"], button')).find((button) => button instanceof HTMLButtonElement && normalizeText(button.textContent) === "\u30B9\u30AD\u30C3\u30D7");
      if (!(skipButton instanceof HTMLButtonElement) || skipButton.disabled || !isVisible(skipButton)) {
        return false;
      }
      skipButton.click();
      await sleep(METADATA_SELECT_WAIT_MS);
      return true;
    }
    function getAiSupportDialog() {
      const dialog = document.querySelector('[role="dialog"][aria-label="AI\u51FA\u54C1\u30B5\u30DD\u30FC\u30C8"], [data-testid="category-select-step"]');
      return dialog instanceof HTMLElement && isVisible(dialog) ? dialog : null;
    }
    function isAiSupportDialogOpen() {
      return getAiSupportDialog() !== null;
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
          type: blob.type || "image/jpeg"
        });
      } catch {
        return null;
      }
    }
    function goToInitialSellForm() {
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
    function isInitialSellLandingPage() {
      if (hasSellFormFields()) {
        return false;
      }
      const bodyText = normalizeText(document.body?.innerText ?? "");
      return bodyText.includes("\u4E0B\u66F8\u304D\u4E00\u89A7") || bodyText.includes("\u51FA\u54C1\u3057\u305F\u5546\u54C1") || bodyText.includes("\u767A\u9001\u30FB\u8A55\u4FA1\u5F85\u3061");
    }
    function hasSellFormFields() {
      const bodyText = normalizeText(document.body?.innerText ?? "");
      return findTitleField() !== null || findDescriptionField() !== null || findPriceField() !== null || bodyText.includes("\u5546\u54C1\u540D") || bodyText.includes("\u5546\u54C1\u306E\u8AAC\u660E") || bodyText.includes("\u8CA9\u58F2\u4FA1\u683C");
    }
    function fetchImageThroughBackground(url) {
      return new Promise((resolve, reject) => {
        if (!chromeApi?.runtime?.sendMessage) {
          reject(new Error("background unavailable"));
          return;
        }
        chromeApi.runtime.sendMessage(
          {
            type: "FETCH_IMAGE_AS_DATA_URL",
            url
          },
          (response) => {
            if (chromeApi.runtime?.lastError || !response?.success || !response.dataUrl) {
              reject(new Error(response?.message ?? "image fetch failed"));
              return;
            }
            resolve({
              dataUrl: response.dataUrl,
              type: response.type ?? "image/jpeg"
            });
          }
        );
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
    function saveManualConfirmationRequired(details) {
      const payload = {
        status: "manual_confirmation_required",
        savedAt: Date.now(),
        pathname: window.location.pathname,
        pageUrl: window.location.href,
        ...details
      };
      chromeApi?.storage?.local.set({ [MANUAL_CONFIRMATION_REQUIRED_KEY]: payload }, () => {
        if (chromeApi?.runtime?.lastError) {
          console.warn("[furimanager] manual confirmation state save failed", chromeApi.runtime.lastError.message);
        }
      });
    }
    function handOffManualConfirmation(details, message) {
      saveManualConfirmationRequired(details);
      showToast(message);
    }
    async function fillMetadataFields(item) {
      if (ENABLE_DOM_DEBUG || !ENABLE_METADATA_AUTOFILL) {
        return { targetCount: 0, filledCount: 0, missingFields: [] };
      }
      let targetCount = 0;
      let filledCount = 0;
      const missingFields = [];
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
          missingFields.push("category");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (condition) {
        targetCount += 1;
        if (await fillConditionField(condition)) {
          filledCount += 1;
        } else {
          missingFields.push("condition");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (size) {
        targetCount += 1;
        if (await fillSizeField(size)) {
          filledCount += 1;
        } else {
          missingFields.push("size");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (brand) {
        targetCount += 1;
        if (await fillBrandField(brand)) {
          filledCount += 1;
        } else {
          missingFields.push("brand");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (shippingFrom) {
        targetCount += 1;
        if (fillShippingFromField(shippingFrom)) {
          filledCount += 1;
        } else {
          missingFields.push("shippingFrom");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (shippingDays) {
        targetCount += 1;
        if (fillShippingDaysField(shippingDays)) {
          filledCount += 1;
        } else {
          missingFields.push("shippingDays");
          return { targetCount, filledCount, missingFields };
        }
      }
      if (shippingMethod) {
        targetCount += 1;
        if (await fillShippingMethodField(shippingMethod)) {
          filledCount += 1;
        } else {
          missingFields.push("shippingMethod");
          return { targetCount, filledCount, missingFields };
        }
      }
      return { targetCount, filledCount, missingFields };
    }
    async function fillCategoryFields(categoryPath) {
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
    function findCategoryEntryLink() {
      const links = Array.from(document.querySelectorAll('main a[href="/sell/categories"], a[href="/sell/categories"]')).filter((link) => link instanceof HTMLAnchorElement && isVisible(link));
      return links.find((link) => normalizeText(link.textContent).includes("\u30AB\u30C6\u30B4\u30EA\u30FC")) ?? links[0] ?? null;
    }
    async function fillCategorySelects(categoryPath) {
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
    async function fillConditionField(condition) {
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
      if (clickChipInSection("\u5546\u54C1\u306E\u72B6\u614B", condition)) {
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
    function findConditionEntryLink() {
      const section = findFormSection("\u5546\u54C1\u306E\u72B6\u614B");
      const sectionLink = section ? Array.from(section.querySelectorAll('a[href="/sell/conditions"][data-location*="condition"], a[href="/sell/conditions"]')).find((link) => link instanceof HTMLAnchorElement && isVisible(link)) : null;
      if (sectionLink) {
        return sectionLink;
      }
      const links = Array.from(document.querySelectorAll('a[href="/sell/conditions"][data-location*="condition"], a[href="/sell/conditions"]')).filter((link) => link instanceof HTMLAnchorElement && isVisible(link));
      return links.find((link) => normalizeText(link.textContent).includes("\u5546\u54C1\u306E\u72B6\u614B")) ?? links[0] ?? null;
    }
    async function fillSizeField(size) {
      if (sessionStorage.getItem(SIZE_DONE_KEY) === "true") {
        return true;
      }
      const select = findSizeSelect();
      if (select instanceof HTMLSelectElement && setSelectValue(select, size)) {
        sessionStorage.setItem(SIZE_DONE_KEY, "true");
        return true;
      }
      if (clickChipInSection("\u30B5\u30A4\u30BA", size)) {
        sessionStorage.setItem(SIZE_DONE_KEY, "true");
        return true;
      }
      return false;
    }
    function findSizeSelect() {
      const directSelect = document.querySelector('select[name="size"], select[data-testid="size-select"], [data-testid="size-select"] select, select[name*="size"]');
      if (directSelect instanceof HTMLSelectElement) {
        return directSelect;
      }
      const sectionSelect = findFormSection("\u30B5\u30A4\u30BA")?.querySelector("select");
      if (sectionSelect instanceof HTMLSelectElement) {
        return sectionSelect;
      }
      return Array.from(document.querySelectorAll('select[data-testid="attribute-select"], select[placeholder*="\u9078\u629E"], .merSelect select')).find((select) => select instanceof HTMLSelectElement && isVisible(select) && /サイズ/.test(getNearbySearchText(select))) ?? null;
    }
    async function fillBrandField(brand) {
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
    async function fillBrandInline(brand) {
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
    function isBrandAlreadySelected(brand) {
      const link = findBrandEntryLink();
      const text = normalizeText(link?.textContent ?? "");
      return !!text && !text.includes("\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044") && optionTextMatches(text, brand);
    }
    function findBrandEntryLink() {
      const links = Array.from(document.querySelectorAll('a[data-testid="brand-link"], a[href="/sell/brands"], a[href^="/sell/brands?"]')).filter((link) => link instanceof HTMLAnchorElement && isVisible(link));
      return links[0] ?? null;
    }
    async function waitForBrandInput(maxAttempts = 30) {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const input = document.querySelector(`
        input[name="brandName"],
        input[placeholder*="\u30D6\u30E9\u30F3\u30C9\u540D"],
        mer-text-input[label="\u30D6\u30E9\u30F3\u30C9"] input,
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
    function findBrandAutocompleteOption(brand) {
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
    `)).filter((element) => element instanceof HTMLElement && isVisible(element));
      return candidates.find((candidate) => {
        const text = getElementSearchText(candidate);
        return optionTextMatches(text, brand) || optionTextMatches(text, searchText);
      }) ?? candidates[0] ?? null;
    }
    function normalizeBrandSearchText(brand) {
      return brand === "GU" ? "\u30B8\u30FC\u30E6\u30FC" : brand;
    }
    async function fillShippingMethodField(shippingMethod) {
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
    function findShippingMethodEntryLink() {
      const links = Array.from(document.querySelectorAll('a[href="/sell/shipping_methods"][data-location*="shipping_method"], a[href="/sell/shipping_methods"]')).filter((link) => link instanceof HTMLAnchorElement && isVisible(link));
      return links.find((link) => normalizeText(link.textContent).includes("\u914D\u9001\u306E\u65B9\u6CD5")) ?? links[0] ?? null;
    }
    function fillShippingDaysField(shippingDays) {
      return fillSelectBySelector('select[name="shippingDuration"], select[name*="shippingDuration"], select[name*="shippingDays"]', shippingDays);
    }
    function fillShippingFromField(shippingFrom) {
      if (sessionStorage.getItem(SHIPPING_FROM_DONE_KEY) === "true") {
        return true;
      }
      const filled = fillSelectBySelector('select[name="shippingFromArea"], select[name*="shippingFrom"], select[name*="shipping_from"], [data-testid*="shippingFrom"] select', shippingFrom);
      if (filled) {
        sessionStorage.setItem(SHIPPING_FROM_DONE_KEY, "true");
      }
      return filled;
    }
    async function handleCategorySelectionPage(item) {
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
          await clickCategoryCreateLink(link);
          await continueOnSellCreate(item);
          return;
        }
      }
    }
    function findCategoryCreateLink(links) {
      return links.find((link) => {
        const url = new URL(link.href);
        return url.pathname === "/sell/create" || url.pathname === "/sell";
      }) ?? null;
    }
    async function clickCategoryCreateLink(link) {
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
    async function waitForReadyCategoryLinks() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const links = getCategoryPageLinks();
        if (links.length > 0 && !hasCurrentCategorySelfLink(links)) {
          return;
        }
        await sleep(SELECTION_POLL_MS);
      }
    }
    function getCategoryPageLinks() {
      const excludedTexts = ["\u30AB\u30C6\u30B4\u30EA\u30FC\u3092\u9078\u629E\u3059\u308B", "\u5909\u66F4\u3059\u308B", "\u52A0\u76DF\u5E97\u898F\u7D04"];
      return Array.from(document.querySelectorAll('main a[href*="/sell"]')).filter((link) => link instanceof HTMLAnchorElement && isVisible(link)).filter((link) => {
        const url = new URL(link.href);
        const text = normalizeText(link.textContent);
        return url.origin === window.location.origin && (url.pathname === "/sell/categories" || url.pathname === "/sell/create" || url.pathname === "/sell") && !excludedTexts.includes(text) && !link.href.includes("/sell/conditions");
      });
    }
    function hasCurrentCategorySelfLink(links) {
      const current = `${window.location.pathname}${window.location.search}`;
      return links.some((link) => {
        const url = new URL(link.href);
        return `${url.pathname}${url.search}` === current;
      });
    }
    function currentCategoryPageMatchesStep(step) {
      if (step === 0) {
        return !new URL(window.location.href).searchParams.get("category_id");
      }
      const ids = getSavedCategoryIds();
      const expectedId = ids[step - 1];
      const currentId = new URL(window.location.href).searchParams.get("category_id");
      return !!expectedId && currentId === expectedId;
    }
    function saveCategoryIdForStep(step, categoryId) {
      if (!categoryId) {
        return;
      }
      const ids = getSavedCategoryIds();
      ids[step] = categoryId;
      sessionStorage.setItem(CATEGORY_ID_PATH_KEY, JSON.stringify(ids));
    }
    function getSavedCategoryIds() {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(CATEGORY_ID_PATH_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
      } catch {
        return [];
      }
    }
    function categoryTextMatches(text, value) {
      return text === value || normalizeOptionText(text) === normalizeOptionText(value);
    }
    async function handleConditionSelectionPage(item, condition) {
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
    async function waitForConditionOptions() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const options = Array.from(document.querySelectorAll('ul li a[href*="/sell/create"], main a[href*="/sell/create"], main button, main label, main [role="button"], main [data-testid*="condition"]')).filter((element) => element instanceof HTMLElement && isVisible(element));
        if (options.some((option) => normalizeMercariCondition(getConditionOptionText(option)))) {
          return options;
        }
        await sleep(SELECTION_POLL_MS);
      }
      return [];
    }
    function getConditionOptionText(element) {
      return normalizeText(element.querySelector("p:first-child")?.textContent || element.getAttribute("label") || element.textContent);
    }
    function conditionTextMatches(text, value) {
      return normalizeOptionText(text) === normalizeOptionText(value);
    }
    async function handleBrandSelectionPage(item, brand) {
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
    async function handleWizardSelectionPage(item) {
      const button = await waitForWizardBackToListingButton();
      if (!button) {
        return;
      }
      clickButtonLike(button);
      await continueOnSellCreate(item);
    }
    async function waitForWizardBackToListingButton() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = findWizardBackToListingButton();
        if (button) {
          return button;
        }
        await sleep(SELECTION_POLL_MS);
      }
      return null;
    }
    function findWizardBackToListingButton() {
      const candidates = Array.from(document.querySelectorAll(`
      [data-testid="back-to-listing-button"] button,
      button[data-testid="back-to-listing-button"],
      [data-testid="back-to-listing-button"],
      [data-location*="back-to-listing-button"] button,
      button[data-location*="back-to-listing-button"],
      [data-location*="back-to-listing-button"]
    `)).filter((element) => element instanceof HTMLElement && isVisible(element));
      return candidates.find((candidate) => normalizeText(candidate.textContent).includes("\u51FA\u54C1\u753B\u9762\u306B\u623B\u308B")) ?? null;
    }
    function findBrandPageOption(brand) {
      const searchText = normalizeBrandSearchText(brand);
      const candidates = Array.from(document.querySelectorAll(`
      a[href*="/sell/create"],
      mer-action-row,
      .merActionRow,
      .mer-action-row,
      button,
      [role="button"]
    `)).filter((element) => element instanceof HTMLElement && isVisible(element));
      return candidates.find((candidate) => {
        const text = getElementSearchText(candidate);
        return optionTextMatches(text, brand) || optionTextMatches(text, searchText);
      }) ?? null;
    }
    async function handleShippingMethodSelectionPage(item, shippingMethod) {
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
    async function openShippingServicesIfNeeded() {
      if (document.querySelector('[data-testid="shipping-services"]')) {
        return;
      }
      const button = document.querySelector('[data-testid="shipping-service-group"] button');
      if (button instanceof HTMLButtonElement && isVisible(button)) {
        button.click();
        await sleep(SAFE_CLICK_SETTLE_MS);
      }
    }
    async function waitForShippingMethodCandidates() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (getShippingMethodCandidates().length > 0) {
          return;
        }
        await sleep(SELECTION_POLL_MS);
      }
    }
    async function continueOnSellCreate(item) {
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
    function findShippingMethodOption(shippingMethod) {
      const candidates = getShippingMethodCandidates();
      return candidates.find((candidate) => optionTextMatches(normalizeShippingMethod(getShippingOptionText(candidate)) ?? "", shippingMethod)) ?? null;
    }
    function getShippingMethodCandidates() {
      const directCandidates = Array.from(document.querySelectorAll(`
      mer-radio-group mer-radio-label,
      [class*="formGroup"] [class*="merRadioLabel"],
      [role="radio"]
    `)).filter((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
      const inputCandidates = Array.from(document.querySelectorAll('input[type="radio"]')).flatMap((input) => {
        const element = input instanceof HTMLInputElement ? input.closest('label, [role="radio"], mer-radio-label, .merRadioLabel, section, div') : null;
        return element instanceof HTMLElement && isVisible(element) ? [element] : [];
      });
      return Array.from(/* @__PURE__ */ new Set([...directCandidates, ...inputCandidates])).filter((candidate) => {
        const text = getShippingOptionText(candidate);
        return text && candidate.querySelector('input[type="radio"]') !== null && !text.includes("\u65E9\u308F\u304B\u308A\u8868") && !text.includes("\u5E83\u544A");
      });
    }
    function isShippingMethodOptionSelected(option) {
      const input = option.querySelector('input[type="radio"]');
      if (input instanceof HTMLInputElement) {
        return input.checked;
      }
      return option.getAttribute("aria-checked") === "true" || option.querySelector('[aria-checked="true"], input:checked') !== null;
    }
    function isAnyShippingMethodSelected() {
      return getShippingMethodCandidates().some((candidate) => isShippingMethodOptionSelected(candidate));
    }
    function clickShippingMethodOption(option) {
      const input = option.querySelector('input[type="radio"]');
      if (input instanceof HTMLInputElement) {
        input.click();
        return;
      }
      option.click();
    }
    async function waitForShippingMethodSelected(option) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (isShippingMethodOptionSelected(option) || isAnyShippingMethodSelected()) {
          return true;
        }
        await sleep(SELECTION_POLL_MS);
      }
      return false;
    }
    async function clickShippingUpdateButton() {
      const updateButton = await waitForShippingUpdateButton();
      if (!updateButton) {
        return false;
      }
      updateButton.scrollIntoView({ block: "center" });
      await sleep(SAFE_CLICK_SETTLE_MS);
      clickButtonLike(updateButton);
      return true;
    }
    async function waitForShippingUpdateButton() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = findShippingUpdateButton();
        if (button && isClickableButtonLike(button)) {
          return button;
        }
        await sleep(SELECTION_POLL_MS);
      }
      return null;
    }
    function findShippingUpdateButton() {
      const button = document.querySelector('button[data-location="listing_shipping_methods:update"]');
      return button instanceof HTMLElement && isVisible(button) ? button : null;
    }
    function clickButtonLike(element) {
      const innerButton = element instanceof HTMLButtonElement ? element : element.querySelector("button");
      if (innerButton instanceof HTMLElement) {
        innerButton.scrollIntoView({ block: "center", inline: "center" });
        dispatchRealisticClick(innerButton);
        return;
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      dispatchRealisticClick(element);
    }
    function dispatchRealisticClick(element) {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      element.click();
    }
    function clickLinkOrInnerButton(link) {
      const innerButton = link.querySelector("button");
      if (innerButton instanceof HTMLElement) {
        innerButton.click();
        return;
      }
      link.click();
    }
    function findLinkByHref(path) {
      const link = document.querySelector(`a[href="${path}"], a[href*="${path}"]`);
      return link instanceof HTMLElement ? link : null;
    }
    async function waitForSelect(selector, index = 0) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const select = Array.from(document.querySelectorAll(selector)).filter((element) => element instanceof HTMLSelectElement)[index];
        if (select) {
          return select;
        }
        await sleep(SELECTION_POLL_MS);
      }
      return null;
    }
    function fillSelectBySelector(selector, value) {
      const select = document.querySelector(selector);
      return select instanceof HTMLSelectElement ? setSelectValue(select, value) : false;
    }
    function clickChipInSection(label, value) {
      const section = findFormSection(label);
      if (!section) {
        return false;
      }
      const chip = Array.from(section.querySelectorAll("mer-chip, .merChip, button, label")).filter((candidate) => candidate instanceof HTMLElement && isVisible(candidate)).find((candidate) => optionTextMatches(candidate.getAttribute("label") ?? getElementSearchText(candidate), value));
      if (!chip) {
        return false;
      }
      chip.click();
      return true;
    }
    function findFormSection(label) {
      const labelElement = Array.from(document.querySelectorAll("mer-text, .merText, label, span, p")).find((candidate) => candidate instanceof HTMLElement && normalizeText(candidate.textContent) === label);
      return labelElement instanceof HTMLElement ? labelElement.closest('[class*="mer-spacing-t-"], section, div') : null;
    }
    function getShippingOptionText(element) {
      const fieldset = element.closest("fieldset");
      return normalizeText(fieldset?.textContent ?? element.textContent ?? "");
    }
    async function fillMetadataValue(field, labels, values, allowTextInput) {
      const fieldValue = values.join(" > ");
      if ((field instanceof HTMLSelectElement || allowTextInput) && setFieldValue(field, fieldValue)) {
        return true;
      }
      return selectFromMercariPicker(labels, values);
    }
    async function selectFromMercariPicker(labels, values) {
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
    async function clickPickerDecisionButton(root) {
      if (root === document) {
        return;
      }
      const button = Array.from(root.querySelectorAll('button, [role="button"]')).find((candidate) => {
        if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
          return false;
        }
        return ["\u6C7A\u5B9A", "\u5B8C\u4E86", "\u9078\u629E\u3059\u308B", "\u3053\u306E\u30AB\u30C6\u30B4\u30EA\u30FC\u306B\u6C7A\u5B9A"].some((label) => getElementSearchText(candidate).includes(label));
      });
      if (button instanceof HTMLElement) {
        button.click();
        await sleep(METADATA_SELECT_WAIT_MS);
      }
    }
    function findMetadataTrigger(labels) {
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
    function findPickerOption(value, root) {
      const normalizedValue = normalizeText(value);
      const candidates = Array.from(root.querySelectorAll('button, [role="option"], [role="menuitem"], li, a, label, input[type="radio"]')).flatMap((candidate) => {
        if (candidate instanceof HTMLInputElement && candidate.type === "radio") {
          return candidate.closest("label") instanceof HTMLElement ? [candidate.closest("label")] : [];
        }
        return candidate instanceof HTMLElement ? [candidate] : [];
      }).filter((candidate) => isVisible(candidate) && optionTextMatches(getElementSearchText(candidate), normalizedValue));
      return candidates.sort((a, b) => getPickerOptionScore(a, normalizedValue) - getPickerOptionScore(b, normalizedValue))[0] ?? null;
    }
    function findActivePickerRoot() {
      const roots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="modal"], [class*="modal"], [class*="Modal"], [class*="sheet"], [class*="Sheet"]')).filter((candidate) => candidate instanceof HTMLElement && isActivePickerRootCandidate(candidate));
      return roots.sort((a, b) => getElementArea(a) - getElementArea(b))[0] ?? document;
    }
    function isActivePickerRootCandidate(element) {
      if (!isVisible(element) || isHiddenFromUser(element) || !intersectsViewport(element)) {
        return false;
      }
      const role = element.getAttribute("role") ?? "";
      const ariaModal = element.getAttribute("aria-modal") === "true";
      const descriptor = [element.className?.toString?.(), element.getAttribute("data-testid"), element.id].filter(Boolean).join(" ");
      const looksLikeOverlay = /modal|sheet/i.test(descriptor);
      const position = window.getComputedStyle(element).position;
      return role === "dialog" || ariaModal || looksLikeOverlay && ["fixed", "absolute", "sticky"].includes(position);
    }
    function isHiddenFromUser(element) {
      if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.closest('[aria-hidden="true"], [hidden], [inert]')) {
        return true;
      }
      const style = window.getComputedStyle(element);
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none";
    }
    function intersectsViewport(element) {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    }
    function getPickerOptionScore(element, value) {
      const text = getElementSearchText(element);
      const compactText = normalizeOptionText(text);
      const compactValue = normalizeOptionText(value);
      if (text === value || compactText === compactValue) {
        return 0;
      }
      return text.length;
    }
    function optionTextMatches(text, value) {
      if (!text || !value) {
        return false;
      }
      const compactText = normalizeOptionText(text);
      const compactValue = normalizeOptionText(value);
      return text === value || compactText === compactValue || text.includes(value) && text.length <= value.length + 12 || compactText.includes(compactValue) && compactText.length <= compactValue.length + 12;
    }
    function normalizeOptionText(value) {
      return normalizeText(value).replace(/[〜～]/g, "~").replace(/[\s、，,・/／()（）\[\]【】]/g, "");
    }
    function normalizeMercariCondition(value) {
      const compactValue = normalizeOptionText(value ?? "");
      if (!compactValue) {
        return null;
      }
      const conditions = [
        "\u65B0\u54C1\u3001\u672A\u4F7F\u7528",
        "\u672A\u4F7F\u7528\u306B\u8FD1\u3044",
        "\u76EE\u7ACB\u3063\u305F\u50B7\u3084\u6C5A\u308C\u306A\u3057",
        "\u3084\u3084\u50B7\u3084\u6C5A\u308C\u3042\u308A",
        "\u50B7\u3084\u6C5A\u308C\u3042\u308A",
        "\u5168\u4F53\u7684\u306B\u72B6\u614B\u304C\u60AA\u3044"
      ];
      return conditions.find((condition) => {
        const compactCondition = normalizeOptionText(condition);
        return compactCondition === compactValue || compactValue.includes(compactCondition);
      }) ?? null;
    }
    function normalizeShippingMethod(value) {
      const text = normalizeText(value ?? "").replace(/匿名配送|梱包代行|補償|郵便局\/コンビニ受取|集荷/g, "").trim();
      return text || null;
    }
    function normalizeShippingDays(value) {
      return normalizeText(value ?? "").replace(/〜/g, "~");
    }
    function normalizeOptionalMetadataValue(value) {
      const text = normalizeText(value ?? "");
      if (!text || ["\u306A\u3057", "\u6307\u5B9A\u306A\u3057", "\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044", "\u672A\u8A2D\u5B9A"].includes(text)) {
        return null;
      }
      return text;
    }
    function getElementSearchText(element) {
      const value = element instanceof HTMLInputElement ? element.value : "";
      return normalizeText([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("label"),
        element.getAttribute("title"),
        element.getAttribute("placeholder"),
        value
      ].filter(Boolean).join(" "));
    }
    function getNearbySearchText(element) {
      let current = element;
      for (let depth = 0; current && depth < 4; depth += 1) {
        const text = normalizeText(current.textContent ?? "");
        if (text && text.length <= 300) {
          return text;
        }
        current = current.parentElement;
      }
      return "";
    }
    function normalizeText(value) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    }
    function parsePriceValue(value) {
      const normalized = String(value ?? "").replace(/[^\d]/g, "");
      const price = Number.parseInt(normalized, 10);
      return Number.isFinite(price) ? price : NaN;
    }
    function normalizePositiveInteger(value, fallback) {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
    }
    function normalizeNullableInteger(value) {
      if (value === null || value === void 0 || value === "") {
        return null;
      }
      const numberValue = Number(value);
      return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
    }
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    function getElementArea(element) {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    }
    function findTitleField() {
      return findInputLike([
        'input[name="name"]',
        'input[name="title"]',
        'textarea[name="name"]',
        '[data-testid*="name"] input',
        '[data-testid*="title"] input',
        'input[aria-label*="\u5546\u54C1\u540D"]',
        'textarea[aria-label*="\u5546\u54C1\u540D"]'
      ]);
    }
    function findCategoryField() {
      return findInputLike([
        'select[name*="category"]',
        'input[name*="category"]',
        '[data-testid*="category"] select',
        '[data-testid*="category"] input',
        'input[aria-label*="\u30AB\u30C6\u30B4\u30EA\u30FC"]'
      ]);
    }
    function findConditionField() {
      return findInputLike([
        'select[name*="condition"]',
        'input[name*="condition"]',
        '[data-testid*="condition"] select',
        '[data-testid*="condition"] input',
        'select[aria-label*="\u5546\u54C1\u306E\u72B6\u614B"]',
        'input[aria-label*="\u5546\u54C1\u306E\u72B6\u614B"]'
      ]);
    }
    function findBrandField() {
      return findInputLike([
        'input[name*="brand"]',
        '[data-testid*="brand"] input',
        'input[aria-label*="\u30D6\u30E9\u30F3\u30C9"]'
      ]);
    }
    function findSizeField() {
      return findInputLike([
        'select[name*="size"]',
        'input[name*="size"]',
        '[data-testid*="size"] select',
        '[data-testid*="size"] input',
        'input[aria-label*="\u30B5\u30A4\u30BA"]'
      ]);
    }
    function findShippingPayerField() {
      return findInputLike([
        'select[name*="shippingPayer"]',
        'select[name*="shipping_payer"]',
        '[data-testid*="shipping"] select',
        'input[aria-label*="\u914D\u9001\u6599\u306E\u8CA0\u62C5"]'
      ]);
    }
    function findShippingMethodField() {
      return findInputLike([
        'select[name*="shippingMethod"]',
        'select[name*="shipping_method"]',
        '[data-testid*="shippingMethod"] select',
        'input[aria-label*="\u914D\u9001\u306E\u65B9\u6CD5"]'
      ]);
    }
    function findShippingFromField() {
      return findInputLike([
        'select[name*="shippingFrom"]',
        'select[name*="shipping_from"]',
        '[data-testid*="shippingFrom"] select',
        'input[aria-label*="\u767A\u9001\u5143\u306E\u5730\u57DF"]'
      ]);
    }
    function findShippingDaysField() {
      return findInputLike([
        'select[name*="shippingDays"]',
        'select[name*="shipping_days"]',
        '[data-testid*="shippingDays"] select',
        'input[aria-label*="\u767A\u9001\u307E\u3067\u306E\u65E5\u6570"]'
      ]);
    }
    function findPriceField() {
      const directField = findInputLike([
        'input[name="price"][data-testid="price-input"]',
        'input[data-testid="price-input"]',
        'input[name="price"]',
        'input[name*="price"]',
        'input[placeholder*="\u4FA1\u683C"]',
        'input[aria-label*="\u4FA1\u683C"]',
        '[data-testid*="price"] input',
        '[data-testid*="Price"] input'
      ]);
      if (directField) {
        return directField;
      }
      const inputs = Array.from(document.querySelectorAll('input[inputmode="numeric"], input[type="number"], input[type="text"]')).filter((input) => input instanceof HTMLInputElement && isVisible(input));
      return inputs.find((input) => {
        const text = normalizeText([
          input.getAttribute("aria-label"),
          input.getAttribute("placeholder"),
          getNearbySearchText(input)
        ].filter(Boolean).join(" "));
        return /価格|販売価格|開始価格/.test(text);
      }) ?? null;
    }
    function fillPriceField(price) {
      const field = findPriceField();
      if (field) {
        if (parsePriceValue(field.value) === price) {
          return true;
        }
        setFieldValue(field, String(price));
        return parsePriceValue(field.value) === price;
      }
      return false;
    }
    function isPriceAlreadyDisplayed(price) {
      const candidates = Array.from(document.querySelectorAll('[data-testid*="price"], [aria-label*="\u4FA1\u683C"], section, div')).filter((element) => element instanceof HTMLElement && isVisible(element));
      return candidates.some((element) => {
        const text = normalizeText(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`);
        return /価格|販売価格|開始価格/.test(text) && parseFirstYenPrice(text) === price;
      });
    }
    function parseFirstYenPrice(value) {
      const matched = value.match(/(?:¥|￥)\s*([0-9０-９,，]+)/);
      if (!matched) {
        return null;
      }
      const normalized = matched[1].replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/[^\d]/g, "");
      const price = Number.parseInt(normalized, 10);
      return Number.isFinite(price) ? price : null;
    }
    function findDescriptionField() {
      return findInputLike([
        'textarea[name="description"]',
        'textarea[aria-label*="\u5546\u54C1\u8AAC\u660E"]',
        'textarea[aria-label*="\u8AAC\u660E"]',
        '[data-testid*="description"] textarea',
        '[data-testid*="Description"] textarea',
        "textarea"
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
      if (field.value === value) {
        return true;
      }
      field.focus();
      const prototype = Object.getPrototypeOf(field);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(field, value);
      } else {
        field.value = value;
      }
      field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value }));
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.blur();
      return true;
    }
    function setSelectValue(field, value) {
      const options = Array.from(field.options);
      const option = options.find((candidate) => normalizeOptionText(candidate.label || candidate.textContent?.trim() || "") === normalizeOptionText(value)) ?? options.find((candidate) => {
        const label = normalizeText([candidate.label, candidate.textContent].filter(Boolean).join(" "));
        return optionTextMatches(label, value);
      });
      if (!option) {
        return false;
      }
      if (field.value === option.value) {
        return true;
      }
      field.value = option.value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    function injectStyles() {
      if (document.getElementById("furimanager-relist-toast-style")) {
        return;
      }
      const style = document.createElement("style");
      style.id = "furimanager-relist-toast-style";
      style.textContent = `
      ${TOAST_STYLE_RULES}
    `;
      document.documentElement.appendChild(style);
    }
    function createSvgElement(tag, attributes) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
      });
      return element;
    }
    function createToastIcon() {
      const icon = document.createElement("span");
      icon.className = "furimanager-toast__icon";
      icon.setAttribute("aria-hidden", "true");
      const mark = createSvgElement("svg", { viewBox: "0 0 24 24", width: "21", height: "21", focusable: "false" });
      mark.appendChild(createSvgElement("circle", { cx: "12", cy: "12", r: "10.1", fill: "none", stroke: "#FFFFFF", "stroke-width": "1.8" }));
      mark.appendChild(createSvgElement("circle", { cx: "12", cy: "7.7", r: "1.3", fill: "#FFFFFF" }));
      mark.appendChild(createSvgElement("rect", { x: "10.9", y: "10.7", width: "2.2", height: "6.5", rx: "1.1", fill: "#FFFFFF" }));
      icon.appendChild(mark);
      return icon;
    }
    function createToastCloseButton(toast) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "furimanager-toast__close";
      close.setAttribute("aria-label", "\u9589\u3058\u308B");
      const mark = createSvgElement("svg", { viewBox: "0 0 16 16", width: "14", height: "14", focusable: "false" });
      mark.appendChild(createSvgElement("path", {
        d: "M3.4 3.4 L12.6 12.6 M12.6 3.4 L3.4 12.6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round"
      }));
      close.appendChild(mark);
      close.addEventListener("click", () => {
        if (toast.classList.contains("furimanager-toast--preview")) {
          sessionStorage.removeItem(TOAST_PREVIEW_KEY);
          sessionStorage.removeItem(TOAST_PREVIEW_MESSAGE_KEY);
        }
        toast.remove();
      });
      return close;
    }
    function renderToastContent(toast, message) {
      toast.textContent = "";
      toast.setAttribute("role", "status");
      toast.appendChild(createToastIcon());
      const text = document.createElement("span");
      text.className = "furimanager-toast__message";
      text.textContent = message;
      toast.appendChild(text);
      const meta = document.createElement("span");
      meta.className = "furimanager-toast__meta";
      const now = /* @__PURE__ */ new Date();
      const time = document.createElement("span");
      time.className = "furimanager-toast__time";
      time.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      meta.appendChild(time);
      meta.appendChild(createToastCloseButton(toast));
      toast.appendChild(meta);
    }
    function showToast(message) {
      injectStyles();
      const existing = document.querySelector(".furimanager-toast:not(.furimanager-toast--preview)");
      existing?.remove();
      const toast = document.createElement("div");
      toast.className = "furimanager-toast";
      renderToastContent(toast, message);
      document.body.appendChild(toast);
      window.setTimeout(() => {
        toast.remove();
      }, 5200);
    }
    function installToastPreviewControls() {
      const previewWindow = window;
      previewWindow.furimanagerToastPreview = (message) => {
        sessionStorage.setItem(TOAST_PREVIEW_KEY, "true");
        if (typeof message === "string" && message.trim()) {
          sessionStorage.setItem(TOAST_PREVIEW_MESSAGE_KEY, message.trim());
        }
        ensurePersistentToastPreview();
      };
      previewWindow.furimanagerToastPreviewOff = () => {
        sessionStorage.removeItem(TOAST_PREVIEW_KEY);
        sessionStorage.removeItem(TOAST_PREVIEW_MESSAGE_KEY);
        document.querySelector(".furimanager-toast--preview")?.remove();
      };
      window.setTimeout(ensurePersistentToastPreview, 0);
    }
    function ensurePersistentToastPreview() {
      if (sessionStorage.getItem(TOAST_PREVIEW_KEY) !== "true") {
        return;
      }
      injectStyles();
      const existing = document.querySelector(".furimanager-toast--preview");
      const message = sessionStorage.getItem(TOAST_PREVIEW_MESSAGE_KEY) || "\u4FA1\u683C\u3092\u53D6\u5F97\u3067\u304D\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u65B0\u898F\u51FA\u54C1\u30DA\u30FC\u30B8\u3092\u958B\u304D\u307E\u305B\u3093\u3067\u3057\u305F";
      if (existing) {
        const existingMessage = existing.querySelector(".furimanager-toast__message");
        if (existingMessage) {
          existingMessage.textContent = message;
        } else {
          renderToastContent(existing, message);
        }
        return;
      }
      const toast = document.createElement("div");
      toast.className = "furimanager-toast furimanager-toast--preview";
      renderToastContent(toast, message);
      document.body.appendChild(toast);
    }
    function debugMercariSellDom() {
      if (!isMercariSellDebugPath()) {
        return;
      }
      const result = {
        url: window.location.href,
        pathname: window.location.pathname,
        collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
        candidates: collectMercariSellDomCandidates()
      };
      console.log("[furimanager dom debug]", result);
      renderDomDebugPanel(result);
    }
    function isMercariSellDebugPath() {
      return ["/sell", "/sell/create", "/sell/categories", "/sell/conditions", "/sell/shipping_methods", "/sell/brands", "/sell/wizard"].includes(window.location.pathname);
    }
    async function applyPriceDropOnEditPage(message) {
      if (!window.location.pathname.startsWith("/sell/edit")) {
        throw new Error("edit page is not open");
      }
      const itemId = getEditPageItemId();
      const requestedDelta = Number(message?.delta);
      const delta = Number.isFinite(requestedDelta) && requestedDelta !== 0 ? Math.trunc(requestedDelta) : -normalizePositiveInteger(message?.amount, 100);
      const amount = Math.abs(delta);
      const minimumPrice = normalizeNullableInteger(message?.minimumPrice);
      const priceField = await waitForPriceField();
      if (!priceField) {
        throw new Error("price field not found");
      }
      const currentPrice = parsePriceValue(priceField.value || priceField.getAttribute("value") || "");
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        throw new Error("current price could not be read");
      }
      const nextPrice = Math.max(currentPrice + delta, 0);
      if (delta < 0 && minimumPrice !== null && nextPrice < minimumPrice) {
        throw new Error(`minimum price reached: ${nextPrice} < ${minimumPrice}`);
      }
      setFieldValue(priceField, String(nextPrice));
      await sleep(SAFE_CLICK_SETTLE_MS);
      const submitButton = await waitForEditSubmitButton();
      if (!submitButton) {
        throw new Error("edit submit button not found");
      }
      const details = {
        action: message?.taskId ? "price_drop" : "price_adjust",
        itemId,
        taskId: typeof message?.taskId === "string" ? message.taskId : void 0,
        reason: "edit-submit-button-ready",
        currentPrice,
        nextPrice,
        amount,
        delta,
        minimumPrice,
        ...getButtonLogDetails(submitButton)
      };
      console.info("[furimanager:price-adjust] \u4FDD\u5B58\u30DC\u30BF\u30F3\u691C\u77E5", details);
      handOffManualConfirmation(details, "\u4FA1\u683C\u6B04\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F\u3002\u6700\u5F8C\u306E\u4FDD\u5B58\u30DC\u30BF\u30F3\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
      return {
        submitted: false,
        manualConfirmationRequired: true,
        verificationReason: "edit-submit-button-ready",
        currentPrice,
        nextPrice,
        amount,
        delta,
        minimumPrice
      };
    }
    async function waitForPriceField() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const field = findPriceField();
        if (field instanceof HTMLInputElement && field.type !== "hidden") {
          return field;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      return null;
    }
    async function waitForEditSubmitButton() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        const button = findEditSubmitButton();
        if (button && isClickableButtonLike(button)) {
          return button;
        }
        await sleep(RETRY_INTERVAL_MS);
      }
      return null;
    }
    function findEditSubmitButton() {
      const selectors = [
        'button[data-testid="edit-button"]',
        'button[type="submit"][data-testid="edit-button"]',
        '[data-location="listing:footer:edit"] button',
        'button[type="submit"]'
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement && isVisible(element)) {
          return element;
        }
      }
      return Array.from(document.querySelectorAll("button")).filter((element) => element instanceof HTMLElement && isVisible(element)).find((button) => normalizeText(button.textContent).includes("\u5909\u66F4\u3059\u308B")) ?? null;
    }
    function collectMercariSellDomCandidates() {
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
        "mer-select"
      ].join(",");
      const candidates = Array.from(document.querySelectorAll(selector)).filter((element) => element instanceof HTMLElement).filter((element) => !element.closest("#furimanager-dom-debug-panel")).map((element) => {
        const reasons = getDomDebugReasons(element);
        return { element, reasons };
      }).filter((entry) => entry.reasons.length > 0);
      return candidates.map(({ element, reasons }) => toDomDebugCandidate(element, reasons));
    }
    function getDomDebugReasons(element) {
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
      const reasons = [];
      if (pathname === "/sell" && (href.includes("/sell/create") || text === "\u51FA\u54C1\u3059\u308B")) {
        reasons.push("/sell \u306E\u6700\u521D\u306E\u51FA\u54C1\u30DC\u30BF\u30F3\u5019\u88DC");
      }
      if (pathname === "/sell/create" && /カテゴリー|商品の状態|配送の方法|発送方法/.test(joined)) {
        reasons.push("/sell/create \u306E\u30AB\u30C6\u30B4\u30EA\u30FC\u30FB\u72B6\u614B\u30FB\u914D\u9001\u65B9\u6CD5\u6B04\u5019\u88DC");
      }
      if (pathname === "/sell/categories" && (href.includes("/sell/categories") || href.includes("/sell/create") || /決定|戻る|カテゴリー|選択する/.test(joined))) {
        reasons.push("/sell/categories \u306E\u5019\u88DC\u30EA\u30F3\u30AF\u30FB\u623B\u308B/\u6C7A\u5B9A\u30EA\u30F3\u30AF\u5019\u88DC");
      }
      if (pathname === "/sell/conditions" && (href.includes("/sell/create") || /新品|未使用|傷|汚れ|状態/.test(joined))) {
        reasons.push("/sell/conditions \u306E\u5546\u54C1\u72B6\u614B\u5019\u88DC");
      }
      if (pathname === "/sell/shipping_methods" && (dataLocation.includes("listing_shipping_methods:update") || text === "\u66F4\u65B0\u3059\u308B")) {
        reasons.push("/sell/shipping_methods \u306E\u66F4\u65B0\u3059\u308B\u30DC\u30BF\u30F3\u5019\u88DC");
      }
      if (pathname === "/sell/shipping_methods" && (/広告|早わかり表|配送方法早わかり表|専用資材|資材|メルカリ便|詳しく見る|ガイド/.test(joined) || /(^|[-_\s])(ad|ads|banner|promo|promotion|guide|help)([-_\s]|$)/i.test(joined))) {
        reasons.push("/sell/shipping_methods \u306E\u30AF\u30EA\u30C3\u30AF\u7981\u6B62\u5019\u88DC");
      }
      if (/出品する|出品する$|公開する|確認する/.test(joined) || dataLocation.includes("submit") || dataTestId.toLowerCase().includes("submit")) {
        reasons.push("\u6700\u7D42\u51FA\u54C1\u30DC\u30BF\u30F3\u306E\u8B58\u5225\u5019\u88DC");
      }
      if (/category|condition|shipping/i.test([dataTestId, dataLocation, ariaLabel, element.id, element.className.toString(), element.getAttribute("name") ?? ""].join(" "))) {
        reasons.push("\u5C5E\u6027\u540D\u304C category / condition / shipping \u306B\u4E00\u81F4");
      }
      return Array.from(new Set(reasons));
    }
    function toDomDebugCandidate(element, reasons) {
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
        outerHTML: element.outerHTML.slice(0, 1e3),
        parentOuterHTML: element.parentElement?.outerHTML.slice(0, 1e3) ?? "",
        visible: isVisible(element),
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    }
    function guessDomDebugLabel(element) {
      const text = getElementSearchText(element);
      const label = text || element.getAttribute("data-testid") || element.getAttribute("data-location") || element.getAttribute("aria-label") || element.id || element.tagName;
      return label.slice(0, 120);
    }
    function isElementDisabled(element) {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        return element.disabled;
      }
      return element.getAttribute("aria-disabled") === "true";
    }
    function renderDomDebugPanel(result) {
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
          "box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32)"
        ].join(";");
        document.body.appendChild(panel);
      }
      const json = JSON.stringify(result, null, 2);
      panel.innerHTML = "";
      const title = document.createElement("div");
      title.textContent = `DOM\u8ABF\u67FB: ${result.candidates.length}\u4EF6`;
      title.style.cssText = "font-weight: 700; margin-bottom: 8px;";
      const path = document.createElement("div");
      path.textContent = result.pathname;
      path.style.cssText = "margin-bottom: 8px; color: #d8b4fe; word-break: break-all;";
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.textContent = "DOM\u8ABF\u67FB\u30B3\u30D4\u30FC";
      copyButton.style.cssText = [
        "width: 100%",
        "min-height: 36px",
        "border: 0",
        "border-radius: 6px",
        "background: linear-gradient(90deg, #7c3aed, #f97316)",
        "color: #ffffff",
        "font-weight: 700",
        "cursor: pointer"
      ].join(";");
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(json);
          copyButton.textContent = "\u30B3\u30D4\u30FC\u6E08\u307F";
        } catch {
          console.log("[furimanager dom debug]", result);
          copyButton.textContent = "console\u306B\u51FA\u529B\u6E08\u307F";
        }
      });
      const note = document.createElement("div");
      note.textContent = "\u30AF\u30EA\u30C3\u30AF\u8ABF\u67FB\u306E\u307F\u3002\u81EA\u52D5\u30AF\u30EA\u30C3\u30AF\u306F\u505C\u6B62\u4E2D\u3002";
      note.style.cssText = "margin-top: 8px; color: #fbcfe8;";
      panel.append(title, path, copyButton, note);
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
    } else {
      boot();
    }
  })();
})();
