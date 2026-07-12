function formatFurimaneSimulatorPrice(value) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatFurimaneSimulatorRate(value) {
  return `${(Math.round(value * 10) / 10).toLocaleString("ja-JP")}%`;
}

function normalizeFurimaneSimulatorAmount(value) {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeFurimaneSimulatorPlatform(value) {
  return value === "mercari_shops" ? "mercari_shops" : "mercari";
}

function getFurimaneSimulatorPlatform(item, options) {
  return normalizeFurimaneSimulatorPlatform(options.platform ?? item.platform);
}

function createFurimaneSimulatorElement(tagName, className, textContent) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

async function resolveFurimaneSavedPurchasePrice(item, options) {
  if (options.savedPrice) {
    return options.savedPrice;
  }

  return window.FurimanagerResearchApi?.getPurchasePrice?.(getFurimaneSimulatorPlatform(item, options), item.item_id) ?? {
    purchasePrice: null,
    shippingFee: null
  };
}

async function saveFurimaneSimulatorValue(item, options, purchaseInput, shippingInput) {
  const purchasePrice = normalizeFurimaneSimulatorAmount(purchaseInput.value);
  const shippingFee = normalizeFurimaneSimulatorAmount(shippingInput.value);

  if (!purchaseInput.value.trim()) {
    return;
  }

  if (!window.FurimanagerResearchApi?.savePurchasePrice) {
    throw new Error("仕入れ値保存APIを読み込めませんでした");
  }

  const response = await window.FurimanagerResearchApi.savePurchasePrice({
    platform: getFurimaneSimulatorPlatform(item, options),
    itemId: item.item_id,
    purchasePrice,
    shippingFee
  });

  if (!response?.success) {
    throw new Error("仕入れ値の保存に失敗しました");
  }

  const savedPrice = { purchasePrice, shippingFee };
  options.savedPrice = savedPrice;
  await options.onSave?.(savedPrice);
  return response;
}

async function renderFurimaneSimulator(rowElement, item, options = {}) {
  const existing = rowElement.nextElementSibling;

  if (existing?.classList.contains("furimane-research-simulator-row")) {
    existing.remove();
  }

  const simulatorRow = document.createElement("tr");
  simulatorRow.className = "furimane-research-simulator-row";
  simulatorRow.dataset.itemId = item.item_id;

  const simulatorCell = document.createElement("td");
  simulatorCell.colSpan = Math.max(rowElement.cells.length, 1);

  const root = createFurimaneSimulatorElement("div", "furimane-research-simulator");
  const loading = createFurimaneSimulatorElement("p", "furimane-research-simulator__status", "シミュレーターを読み込み中...");
  root.appendChild(loading);
  simulatorCell.appendChild(root);
  simulatorRow.appendChild(simulatorCell);
  rowElement.insertAdjacentElement("afterend", simulatorRow);

  try {
    const platform = getFurimaneSimulatorPlatform(item, options);
    const savedPrice = await resolveFurimaneSavedPurchasePrice(item, options);
    const purchaseInput = document.createElement("input");
    purchaseInput.type = "number";
    purchaseInput.min = "0";
    purchaseInput.inputMode = "numeric";
    purchaseInput.value = savedPrice.purchasePrice === null ? "" : String(savedPrice.purchasePrice);
    purchaseInput.placeholder = "仕入れ値を入力してください";
    purchaseInput.className = "furimane-research-simulator__input";

    const shippingInput = document.createElement("input");
    shippingInput.type = "number";
    shippingInput.min = "0";
    shippingInput.inputMode = "numeric";
    shippingInput.value = savedPrice.shippingFee === null ? "" : String(savedPrice.shippingFee);
    shippingInput.placeholder = "任意";
    shippingInput.className = "furimane-research-simulator__input";

    const monthlySalesInput = document.createElement("input");
    monthlySalesInput.type = "number";
    monthlySalesInput.min = "0";
    monthlySalesInput.inputMode = "numeric";
    monthlySalesInput.placeholder = "任意";
    monthlySalesInput.className = "furimane-research-simulator__input";

    const feeValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const profitValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const rateValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-rate");
    const monthlyProfitValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const simulatorStatus = createFurimaneSimulatorElement("p", "furimane-research-simulator__status", "");
    const saveStatus = createFurimaneSimulatorElement("p", "furimane-research-simulator__save-status", "");
    const saveButton = createFurimaneSimulatorElement("button", "furimane-research-simulator__save-button", "保存する");
    saveButton.type = "button";
    let recalculateTimer = null;
    let requestSequence = 0;
    let hasRenderedResult = false;

    const applySimulatorResult = (result) => {
      hasRenderedResult = true;
      simulatorStatus.textContent = "";
      feeLabel.textContent = `手数料（${Math.round(Number(result.feeRate ?? 0.1) * 100)}%）`;
      feeValue.textContent = formatFurimaneSimulatorPrice(result.fee);
      profitValue.textContent = formatFurimaneSimulatorPrice(result.netProfit);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--positive", result.netProfit >= 0);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--negative", result.netProfit < 0);
      rateValue.textContent = formatFurimaneSimulatorRate(result.profitRate);
      monthlyProfitValue.textContent = formatFurimaneSimulatorPrice(result.monthlyExpectedProfit);
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
      const purchasePrice = normalizeFurimaneSimulatorAmount(purchaseInput.value);
      const shippingFee = normalizeFurimaneSimulatorAmount(shippingInput.value);
      const monthlySalesCount = normalizeFurimaneSimulatorAmount(monthlySalesInput.value);

      if (!hasRenderedResult) {
        feeValue.textContent = "...";
        profitValue.textContent = "...";
        rateValue.textContent = "...";
        monthlyProfitValue.textContent = "...";
      }

      if (recalculateTimer !== null) {
        window.clearTimeout(recalculateTimer);
      }

      // 入力中にAPIを連打しないよう、300ms待ってから最新値だけ計算する。
      recalculateTimer = window.setTimeout(async () => {
        const sequence = ++requestSequence;

        try {
          if (!window.FurimanagerResearchApi?.simulateProfit) {
            throw new Error("simulate_api_missing");
          }

          const result = await window.FurimanagerResearchApi.simulateProfit({
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
            simulatorStatus.textContent = "計算できませんでした。通信環境を確認してください。";
          }
        }
      }, 300);
    };

    const save = async () => {
      if (!purchaseInput.value.trim()) {
        saveStatus.textContent = "未入力";
        return;
      }

      try {
        saveButton.disabled = true;
        saveButton.textContent = "保存中...";
        saveStatus.textContent = "保存中...";
        const response = await saveFurimaneSimulatorValue(item, options, purchaseInput, shippingInput);
        saveStatus.textContent = response?.localOnly ? "ブラウザに保存しました" : "保存しました";
        saveButton.textContent = "保存済み";
      } catch (error) {
        console.error("[furimane-research] simulator save failed", error);
        saveStatus.textContent = "保存に失敗しました";
        saveButton.textContent = "保存する";
      } finally {
        saveButton.disabled = false;
      }
    };

    const markUnsaved = () => {
      saveButton.textContent = "保存する";
      saveStatus.textContent = purchaseInput.value.trim() ? "未保存" : "";
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

    const form = createFurimaneSimulatorElement("div", "furimane-research-simulator__form");
    const purchaseLabel = createFurimaneSimulatorElement("label", "furimane-research-simulator__label");
    purchaseLabel.append(createFurimaneSimulatorElement("span", undefined, "仕入れ値"), purchaseInput);

    const shippingLabel = createFurimaneSimulatorElement("label", "furimane-research-simulator__label");
    shippingLabel.append(createFurimaneSimulatorElement("span", undefined, "送料"), shippingInput);

    const monthlySalesLabel = createFurimaneSimulatorElement("label", "furimane-research-simulator__label");
    monthlySalesLabel.append(createFurimaneSimulatorElement("span", undefined, "予想販売個数"), monthlySalesInput);

    form.append(purchaseLabel, shippingLabel, monthlySalesLabel);

    const metrics = createFurimaneSimulatorElement("div", "furimane-research-simulator__metrics");
    const feeMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    const feeLabel = createFurimaneSimulatorElement("span", undefined, "手数料");
    feeMetric.append(feeLabel, feeValue);

    const profitMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    profitMetric.append(createFurimaneSimulatorElement("span", undefined, "純利益"), profitValue);

    const rateMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    rateMetric.append(createFurimaneSimulatorElement("span", undefined, "利益率"), rateValue);

    const monthlyProfitMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    monthlyProfitMetric.append(createFurimaneSimulatorElement("span", undefined, "月間予想利益"), monthlyProfitValue);

    metrics.append(feeMetric, profitMetric, rateMetric, monthlyProfitMetric);
    const actions = createFurimaneSimulatorElement("div", "furimane-research-simulator__actions");
    actions.append(saveStatus, saveButton);

    root.replaceChildren(form, metrics, simulatorStatus, actions);
    recalculate();
  } catch (error) {
    console.error("[furimane-research] simulator load failed", error);
    root.replaceChildren(
      createFurimaneSimulatorElement("p", "furimane-research-simulator__status", "シミュレーターの読み込みに失敗しました。")
    );
  }

  return simulatorRow;
}

window.FurimanagerResearchSimulator = {
  renderSimulator: renderFurimaneSimulator
};
