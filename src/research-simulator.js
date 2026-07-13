(() => {
  function formatSimulatorPrice(value) {
    return `\xA5${Math.round(value).toLocaleString("ja-JP")}`;
  }
  function formatSimulatorRate(value) {
    return `${(Math.round(value * 10) / 10).toLocaleString("ja-JP")}%`;
  }
  function normalizeSimulatorAmount(value) {
    if (!value.trim()) {
      return 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
  }
  function normalizeSimulatorPlatform(value) {
    return value === "mercari_shops" ? "mercari_shops" : "mercari";
  }
  function getSimulatorPlatform(item, options) {
    return normalizeSimulatorPlatform(options.platform ?? item.platform);
  }
  function createSimulatorElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (textContent !== void 0) {
      element.textContent = textContent;
    }
    return element;
  }
  async function resolveSavedPurchasePrice(item, options) {
    if (options.savedPrice) {
      return options.savedPrice;
    }
    return window.FurimanagerResearchApi?.getPurchasePrice?.(getSimulatorPlatform(item, options), item.item_id) ?? {
      purchasePrice: null,
      shippingFee: null
    };
  }
  async function saveSimulatorValue(item, options, purchaseInput, shippingInput) {
    const purchasePrice = normalizeSimulatorAmount(purchaseInput.value);
    const shippingFee = normalizeSimulatorAmount(shippingInput.value);
    if (!purchaseInput.value.trim()) {
      return;
    }
    const api = window.FurimanagerResearchApi;
    if (!api?.savePurchasePrice) {
      throw new Error("\u4ED5\u5165\u308C\u5024\u4FDD\u5B58API\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F");
    }
    const response = await api.savePurchasePrice({
      platform: getSimulatorPlatform(item, options),
      itemId: item.item_id,
      purchasePrice,
      shippingFee
    });
    if (!response?.success) {
      throw new Error("\u4ED5\u5165\u308C\u5024\u306E\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    }
    const savedPrice = { purchasePrice, shippingFee };
    options.savedPrice = savedPrice;
    await options.onSave?.(savedPrice);
    return response;
  }
  async function renderSimulator(rowElement, item, options = {}) {
    const existing = rowElement.nextElementSibling;
    if (existing?.classList.contains("furimane-research-simulator-row")) {
      existing.remove();
    }
    const simulatorRow = document.createElement("tr");
    simulatorRow.className = "furimane-research-simulator-row";
    simulatorRow.dataset.itemId = item.item_id;
    const simulatorCell = document.createElement("td");
    simulatorCell.colSpan = Math.max(rowElement.cells.length, 1);
    const root = createSimulatorElement("div", "furimane-research-simulator");
    const loading = createSimulatorElement("p", "furimane-research-simulator__status", "\u30B7\u30DF\u30E5\u30EC\u30FC\u30BF\u30FC\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D...");
    root.appendChild(loading);
    simulatorCell.appendChild(root);
    simulatorRow.appendChild(simulatorCell);
    rowElement.insertAdjacentElement("afterend", simulatorRow);
    try {
      const platform = getSimulatorPlatform(item, options);
      const savedPrice = await resolveSavedPurchasePrice(item, options);
      const purchaseInput = document.createElement("input");
      purchaseInput.type = "number";
      purchaseInput.min = "0";
      purchaseInput.inputMode = "numeric";
      purchaseInput.value = savedPrice.purchasePrice === null ? "" : String(savedPrice.purchasePrice);
      purchaseInput.placeholder = "\u4ED5\u5165\u308C\u5024\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044";
      purchaseInput.className = "furimane-research-simulator__input";
      const shippingInput = document.createElement("input");
      shippingInput.type = "number";
      shippingInput.min = "0";
      shippingInput.inputMode = "numeric";
      shippingInput.value = savedPrice.shippingFee === null ? "" : String(savedPrice.shippingFee);
      shippingInput.placeholder = "\u4EFB\u610F";
      shippingInput.className = "furimane-research-simulator__input";
      const monthlySalesInput = document.createElement("input");
      monthlySalesInput.type = "number";
      monthlySalesInput.min = "0";
      monthlySalesInput.inputMode = "numeric";
      monthlySalesInput.placeholder = "\u4EFB\u610F";
      monthlySalesInput.className = "furimane-research-simulator__input";
      const feeValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
      const profitValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
      const rateValue = createSimulatorElement("strong", "furimane-research-simulator__metric-rate");
      const monthlyProfitValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
      const simulatorStatus = createSimulatorElement("p", "furimane-research-simulator__status", "");
      const saveStatus = createSimulatorElement("p", "furimane-research-simulator__save-status", "");
      const saveButton = createSimulatorElement("button", "furimane-research-simulator__save-button", "\u4FDD\u5B58\u3059\u308B");
      saveButton.type = "button";
      let recalculateTimer = null;
      let requestSequence = 0;
      let hasRenderedResult = false;
      const applySimulatorResult = (result) => {
        hasRenderedResult = true;
        simulatorStatus.textContent = "";
        feeLabel.textContent = `\u624B\u6570\u6599\uFF08${Math.round(Number(result.feeRate ?? 0.1) * 100)}%\uFF09`;
        feeValue.textContent = formatSimulatorPrice(result.fee);
        profitValue.textContent = formatSimulatorPrice(result.netProfit);
        profitValue.classList.toggle("furimane-research-simulator__metric-value--positive", result.netProfit >= 0);
        profitValue.classList.toggle("furimane-research-simulator__metric-value--negative", result.netProfit < 0);
        rateValue.textContent = formatSimulatorRate(result.profitRate);
        monthlyProfitValue.textContent = formatSimulatorPrice(result.monthlyExpectedProfit);
        monthlyProfitValue.classList.toggle(
          "furimane-research-simulator__metric-value--positive",
          result.monthlyExpectedProfit >= 0
        );
        monthlyProfitValue.classList.toggle(
          "furimane-research-simulator__metric-value--negative",
          result.monthlyExpectedProfit < 0
        );
      };
      const recalculate = () => {
        const purchasePrice = normalizeSimulatorAmount(purchaseInput.value);
        const shippingFee = normalizeSimulatorAmount(shippingInput.value);
        const monthlySalesCount = normalizeSimulatorAmount(monthlySalesInput.value);
        if (!hasRenderedResult) {
          feeValue.textContent = "...";
          profitValue.textContent = "...";
          rateValue.textContent = "...";
          monthlyProfitValue.textContent = "...";
        }
        if (recalculateTimer !== null) {
          window.clearTimeout(recalculateTimer);
        }
        recalculateTimer = window.setTimeout(async () => {
          const sequence = ++requestSequence;
          try {
            const api = window.FurimanagerResearchApi;
            if (!api?.simulateProfit) {
              throw new Error("simulate_api_missing");
            }
            const result = await api.simulateProfit({
              platform,
              sellPrice: item.price,
              purchasePrice,
              shippingFee,
              monthlySalesCount
            });
            if (sequence === requestSequence) {
              applySimulatorResult(result);
            }
          } catch (error) {
            console.warn("[furimane-research] simulator API failed", error);
            if (sequence === requestSequence) {
              simulatorStatus.textContent = "\u8A08\u7B97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u901A\u4FE1\u74B0\u5883\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
            }
          }
        }, 300);
      };
      const save = async () => {
        if (!purchaseInput.value.trim()) {
          saveStatus.textContent = "\u672A\u5165\u529B";
          return;
        }
        try {
          saveButton.disabled = true;
          saveButton.textContent = "\u4FDD\u5B58\u4E2D...";
          saveStatus.textContent = "\u4FDD\u5B58\u4E2D...";
          const response = await saveSimulatorValue(item, options, purchaseInput, shippingInput);
          saveStatus.textContent = response?.localOnly ? "\u30D6\u30E9\u30A6\u30B6\u306B\u4FDD\u5B58\u3057\u307E\u3057\u305F" : "\u4FDD\u5B58\u3057\u307E\u3057\u305F";
          saveButton.textContent = "\u4FDD\u5B58\u6E08\u307F";
        } catch (error) {
          console.error("[furimane-research] simulator save failed", error);
          saveStatus.textContent = "\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F";
          saveButton.textContent = "\u4FDD\u5B58\u3059\u308B";
        } finally {
          saveButton.disabled = false;
        }
      };
      const markUnsaved = () => {
        saveButton.textContent = "\u4FDD\u5B58\u3059\u308B";
        saveStatus.textContent = purchaseInput.value.trim() ? "\u672A\u4FDD\u5B58" : "";
      };
      purchaseInput.addEventListener("input", () => {
        recalculate();
        markUnsaved();
      });
      shippingInput.addEventListener("input", () => {
        recalculate();
        markUnsaved();
      });
      monthlySalesInput.addEventListener("input", () => {
        recalculate();
      });
      saveButton.addEventListener("click", save);
      const form = createSimulatorElement("div", "furimane-research-simulator__form");
      const purchaseLabel = createSimulatorElement("label", "furimane-research-simulator__label");
      purchaseLabel.append(createSimulatorElement("span", void 0, "\u4ED5\u5165\u308C\u5024"), purchaseInput);
      const shippingLabel = createSimulatorElement("label", "furimane-research-simulator__label");
      shippingLabel.append(createSimulatorElement("span", void 0, "\u9001\u6599"), shippingInput);
      const monthlySalesLabel = createSimulatorElement("label", "furimane-research-simulator__label");
      monthlySalesLabel.append(createSimulatorElement("span", void 0, "\u4E88\u60F3\u8CA9\u58F2\u500B\u6570"), monthlySalesInput);
      form.append(purchaseLabel, shippingLabel, monthlySalesLabel);
      const metrics = createSimulatorElement("div", "furimane-research-simulator__metrics");
      const feeMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
      const feeLabel = createSimulatorElement("span", void 0, "\u624B\u6570\u6599");
      feeMetric.append(feeLabel, feeValue);
      const profitMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
      profitMetric.append(createSimulatorElement("span", void 0, "\u7D14\u5229\u76CA"), profitValue);
      const rateMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
      rateMetric.append(createSimulatorElement("span", void 0, "\u5229\u76CA\u7387"), rateValue);
      const monthlyProfitMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
      monthlyProfitMetric.append(createSimulatorElement("span", void 0, "\u6708\u9593\u4E88\u60F3\u5229\u76CA"), monthlyProfitValue);
      metrics.append(feeMetric, profitMetric, rateMetric, monthlyProfitMetric);
      const actions = createSimulatorElement("div", "furimane-research-simulator__actions");
      actions.append(saveStatus, saveButton);
      root.replaceChildren(form, metrics, simulatorStatus, actions);
      recalculate();
    } catch (error) {
      console.error("[furimane-research] simulator load failed", error);
      root.replaceChildren(
        createSimulatorElement("p", "furimane-research-simulator__status", "\u30B7\u30DF\u30E5\u30EC\u30FC\u30BF\u30FC\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002")
      );
    }
    return simulatorRow;
  }
  window.FurimanagerResearchSimulator = {
    renderSimulator
  };
})();
