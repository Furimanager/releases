type ResearchPlatform = "mercari" | "mercari_shops";

type ResearchSimulatorItem = {
  item_id: string;
  title: string;
  price: number;
  platform?: string;
};

type ResearchSavedPurchasePrice = {
  purchasePrice: number | null;
  shippingFee: number | null;
};

type ResearchSimulatorOptions = {
  savedPrice?: ResearchSavedPurchasePrice;
  platform?: ResearchPlatform;
};

declare global {
  interface Window {
    FurimanagerResearchApi?: {
      getPurchasePrice?: (
        platform: ResearchPlatform,
        itemId: string
      ) => Promise<ResearchSavedPurchasePrice>;
      savePurchasePrice?: (payload: {
        platform: ResearchPlatform;
        itemId: string;
        purchasePrice: number;
        shippingFee: number;
      }) => Promise<{ success: boolean }>;
    };
    FurimanagerResearchSimulator?: {
      renderSimulator: (
        rowElement: HTMLTableRowElement,
        item: ResearchSimulatorItem,
        options?: ResearchSimulatorOptions
      ) => Promise<HTMLTableRowElement>;
    };
  }
}

function formatSimulatorPrice(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatSimulatorRate(value: number) {
  return `${(Math.round(value * 10) / 10).toLocaleString("ja-JP")}%`;
}

function normalizeSimulatorAmount(value: string) {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeSimulatorPlatform(value: string | null | undefined): ResearchPlatform {
  return value === "mercari_shops" ? "mercari_shops" : "mercari";
}

function getSimulatorPlatform(item: ResearchSimulatorItem, options: ResearchSimulatorOptions) {
  return normalizeSimulatorPlatform(options.platform ?? item.platform);
}

function getSimulatorFeeRate(_platform: ResearchPlatform) {
  // TODO: Shopsの手数料率を確定したらplatform別に分岐する。
  return 0.1;
}

function calculateSimulatorProfit(
  sellPrice: number,
  purchasePrice: number,
  shippingFee: number,
  platform: ResearchPlatform
) {
  const fee = Math.round(sellPrice * getSimulatorFeeRate(platform));
  const netProfit = sellPrice - purchasePrice - shippingFee - fee;
  const profitRate = sellPrice > 0 ? (netProfit / sellPrice) * 100 : 0;

  return {
    fee,
    netProfit,
    profitRate
  };
}

function createSimulatorElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string
) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

async function resolveSavedPurchasePrice(item: ResearchSimulatorItem, options: ResearchSimulatorOptions) {
  if (options.savedPrice) {
    return options.savedPrice;
  }

  return window.FurimanagerResearchApi?.getPurchasePrice?.(getSimulatorPlatform(item, options), item.item_id) ?? {
    purchasePrice: null,
    shippingFee: null
  };
}

async function saveSimulatorValue(
  item: ResearchSimulatorItem,
  options: ResearchSimulatorOptions,
  purchaseInput: HTMLInputElement,
  shippingInput: HTMLInputElement
) {
  const purchasePrice = normalizeSimulatorAmount(purchaseInput.value);
  const shippingFee = normalizeSimulatorAmount(shippingInput.value);

  if (!purchaseInput.value.trim()) {
    return;
  }

  await window.FurimanagerResearchApi?.savePurchasePrice?.({
    platform: getSimulatorPlatform(item, options),
    itemId: item.item_id,
    purchasePrice,
    shippingFee
  });
}

async function renderSimulator(
  rowElement: HTMLTableRowElement,
  item: ResearchSimulatorItem,
  options: ResearchSimulatorOptions = {}
) {
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
  const loading = createSimulatorElement("p", "furimane-research-simulator__status", "シミュレーターを読み込み中...");
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
    purchaseInput.placeholder = "例: 1200";
    purchaseInput.className = "furimane-research-simulator__input";

    const shippingInput = document.createElement("input");
    shippingInput.type = "number";
    shippingInput.min = "0";
    shippingInput.inputMode = "numeric";
    shippingInput.value = savedPrice.shippingFee === null ? "0" : String(savedPrice.shippingFee);
    shippingInput.className = "furimane-research-simulator__input";

    const feeValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const profitValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const rateValue = createSimulatorElement("strong", "furimane-research-simulator__metric-rate");
    const saveStatus = createSimulatorElement("p", "furimane-research-simulator__save-status", "");

    const recalculate = () => {
      const purchasePrice = normalizeSimulatorAmount(purchaseInput.value);
      const shippingFee = normalizeSimulatorAmount(shippingInput.value);
      const result = calculateSimulatorProfit(item.price, purchasePrice, shippingFee, platform);

      feeValue.textContent = formatSimulatorPrice(result.fee);
      profitValue.textContent = formatSimulatorPrice(result.netProfit);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--positive", result.netProfit >= 0);
      profitValue.classList.toggle("furimane-research-simulator__metric-value--negative", result.netProfit < 0);
      rateValue.textContent = formatSimulatorRate(result.profitRate);
    };

    const save = async () => {
      try {
        saveStatus.textContent = "保存中...";
        await saveSimulatorValue(item, options, purchaseInput, shippingInput);
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

    const form = createSimulatorElement("div", "furimane-research-simulator__form");
    const purchaseLabel = createSimulatorElement("label", "furimane-research-simulator__label");
    purchaseLabel.append(createSimulatorElement("span", undefined, "仕入れ値"), purchaseInput);

    const shippingLabel = createSimulatorElement("label", "furimane-research-simulator__label");
    shippingLabel.append(createSimulatorElement("span", undefined, "送料"), shippingInput);

    form.append(purchaseLabel, shippingLabel);

    const metrics = createSimulatorElement("div", "furimane-research-simulator__metrics");
    const feeMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    feeMetric.append(createSimulatorElement("span", undefined, "手数料（10%）"), feeValue);

    const profitMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    profitMetric.append(createSimulatorElement("span", undefined, "純利益"), profitValue);

    const rateMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    rateMetric.append(createSimulatorElement("span", undefined, "利益率"), rateValue);

    metrics.append(feeMetric, profitMetric, rateMetric);

    root.replaceChildren(form, metrics, saveStatus);
    recalculate();
  } catch (error) {
    console.error("[furimane-research] simulator load failed", error);
    root.replaceChildren(
      createSimulatorElement("p", "furimane-research-simulator__status", "シミュレーターの読み込みに失敗しました。")
    );
  }

  return simulatorRow;
}

window.FurimanagerResearchSimulator = {
  renderSimulator
};

export {};
