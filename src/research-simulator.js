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

function getFurimaneSimulatorFeeRate(_platform) {
  // TODO: Shopsの手数料率を確定したらplatform別に分岐する。
  return 0.1;
}

function calculateFurimaneSimulatorProfit(sellPrice, purchasePrice, shippingFee, platform) {
  const fee = Math.round(sellPrice * getFurimaneSimulatorFeeRate(platform));
  const netProfit = sellPrice - purchasePrice - shippingFee - fee;
  const profitRate = sellPrice > 0 ? (netProfit / sellPrice) * 100 : 0;

  return {
    fee,
    netProfit,
    profitRate
  };
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

  await window.FurimanagerResearchApi?.savePurchasePrice?.({
    platform: getFurimaneSimulatorPlatform(item, options),
    itemId: item.item_id,
    purchasePrice,
    shippingFee
  });
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
    purchaseInput.placeholder = "例: 1200";
    purchaseInput.className = "furimane-research-simulator__input";

    const shippingInput = document.createElement("input");
    shippingInput.type = "number";
    shippingInput.min = "0";
    shippingInput.inputMode = "numeric";
    shippingInput.value = savedPrice.shippingFee === null ? "0" : String(savedPrice.shippingFee);
    shippingInput.className = "furimane-research-simulator__input";

    const feeValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const profitValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const rateValue = createFurimaneSimulatorElement("strong", "furimane-research-simulator__metric-rate");
    const saveStatus = createFurimaneSimulatorElement("p", "furimane-research-simulator__save-status", "");

    const recalculate = () => {
      const purchasePrice = normalizeFurimaneSimulatorAmount(purchaseInput.value);
      const shippingFee = normalizeFurimaneSimulatorAmount(shippingInput.value);
      const result = calculateFurimaneSimulatorProfit(item.price, purchasePrice, shippingFee, platform);

      feeValue.textContent = formatFurimaneSimulatorPrice(result.fee);
      profitValue.textContent = formatFurimaneSimulatorPrice(result.netProfit);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--positive", result.netProfit >= 0);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--negative", result.netProfit < 0);
      rateValue.textContent = formatFurimaneSimulatorRate(result.profitRate);
    };

    const save = async () => {
      try {
        saveStatus.textContent = "保存中...";
        await saveFurimaneSimulatorValue(item, options, purchaseInput, shippingInput);
        saveStatus.textContent = purchaseInput.value.trim() ? "保存しました" : "";
      } catch (error) {
        console.error("[furimane-research] simulator save failed", error);
        saveStatus.textContent = "保存に失敗しました";
      }
    };

    purchaseInput.addEventListener("input", recalculate);
    shippingInput.addEventListener("input", recalculate);
    purchaseInput.addEventListener("blur", save);
    shippingInput.addEventListener("blur", save);

    const form = createFurimaneSimulatorElement("div", "furimane-research-simulator__form");
    const purchaseLabel = createFurimaneSimulatorElement("label", "furimane-research-simulator__label");
    purchaseLabel.append(createFurimaneSimulatorElement("span", undefined, "仕入れ値"), purchaseInput);

    const shippingLabel = createFurimaneSimulatorElement("label", "furimane-research-simulator__label");
    shippingLabel.append(createFurimaneSimulatorElement("span", undefined, "送料"), shippingInput);

    form.append(purchaseLabel, shippingLabel);

    const metrics = createFurimaneSimulatorElement("div", "furimane-research-simulator__metrics");
    const feeMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    feeMetric.append(createFurimaneSimulatorElement("span", undefined, "手数料（10%）"), feeValue);

    const profitMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    profitMetric.append(createFurimaneSimulatorElement("span", undefined, "純利益"), profitValue);

    const rateMetric = createFurimaneSimulatorElement("div", "furimane-research-simulator__metric");
    rateMetric.append(createFurimaneSimulatorElement("span", undefined, "利益率"), rateValue);

    metrics.append(feeMetric, profitMetric, rateMetric);

    root.replaceChildren(form, metrics, saveStatus);
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
