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
  monthlySalesCount?: number;
  onSave?: (savedPrice: ResearchSavedPurchasePrice) => void | Promise<void>;
};

type ResearchSimulatorWindow = Window & {
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
    }) => Promise<{ success: boolean; localOnly?: boolean }>;
    simulateProfit?: (payload: {
      platform: ResearchPlatform;
      sellPrice: number;
      purchasePrice: number;
      shippingFee: number;
      monthlySalesCount: number;
    }) => Promise<{
      feeRate: number;
      fee: number;
      netProfit: number;
      profitRate: number;
      monthlyExpectedProfit: number;
    }>;
  };
};

declare global {
  interface Window {
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

  return (window as ResearchSimulatorWindow).FurimanagerResearchApi?.getPurchasePrice?.(getSimulatorPlatform(item, options), item.item_id) ?? {
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

  const api = (window as ResearchSimulatorWindow).FurimanagerResearchApi;

  if (!api?.savePurchasePrice) {
    throw new Error("仕入れ値保存APIを読み込めませんでした");
  }

  const response = await api.savePurchasePrice({
    platform: getSimulatorPlatform(item, options),
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

    const feeValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const profitValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const rateValue = createSimulatorElement("strong", "furimane-research-simulator__metric-rate");
    const monthlyProfitValue = createSimulatorElement("strong", "furimane-research-simulator__metric-value");
    const simulatorStatus = createSimulatorElement("p", "furimane-research-simulator__status", "");
    const saveStatus = createSimulatorElement("p", "furimane-research-simulator__save-status", "");
    const saveButton = createSimulatorElement("button", "furimane-research-simulator__save-button", "保存する");
    saveButton.type = "button";
    let recalculateTimer: number | null = null;
    let requestSequence = 0;
    let hasRenderedResult = false;

    const applySimulatorResult = (result: {
      feeRate: number;
      fee: number;
      netProfit: number;
      profitRate: number;
      monthlyExpectedProfit: number;
    }) => {
      hasRenderedResult = true;
      simulatorStatus.textContent = "";
      feeLabel.textContent = `手数料（${Math.round(Number(result.feeRate ?? 0.1) * 100)}%）`;
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

      // 入力中にAPIを連打しないよう、300ms待ってから最新値だけ計算する。
      recalculateTimer = window.setTimeout(async () => {
        const sequence = ++requestSequence;

        try {
          const api = (window as ResearchSimulatorWindow).FurimanagerResearchApi;

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
        const response = await saveSimulatorValue(item, options, purchaseInput, shippingInput);
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

    const form = createSimulatorElement("div", "furimane-research-simulator__form");
    const purchaseLabel = createSimulatorElement("label", "furimane-research-simulator__label");
    purchaseLabel.append(createSimulatorElement("span", undefined, "仕入れ値"), purchaseInput);

    const shippingLabel = createSimulatorElement("label", "furimane-research-simulator__label");
    shippingLabel.append(createSimulatorElement("span", undefined, "送料"), shippingInput);

    const monthlySalesLabel = createSimulatorElement("label", "furimane-research-simulator__label");
    monthlySalesLabel.append(createSimulatorElement("span", undefined, "予想販売個数"), monthlySalesInput);

    form.append(purchaseLabel, shippingLabel, monthlySalesLabel);

    const metrics = createSimulatorElement("div", "furimane-research-simulator__metrics");
    const feeMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    const feeLabel = createSimulatorElement("span", undefined, "手数料");
    feeMetric.append(feeLabel, feeValue);

    const profitMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    profitMetric.append(createSimulatorElement("span", undefined, "純利益"), profitValue);

    const rateMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    rateMetric.append(createSimulatorElement("span", undefined, "利益率"), rateValue);

    const monthlyProfitMetric = createSimulatorElement("div", "furimane-research-simulator__metric");
    monthlyProfitMetric.append(createSimulatorElement("span", undefined, "月間予想利益"), monthlyProfitValue);

    metrics.append(feeMetric, profitMetric, rateMetric, monthlyProfitMetric);
    const actions = createSimulatorElement("div", "furimane-research-simulator__actions");
    actions.append(saveStatus, saveButton);

    root.replaceChildren(form, metrics, simulatorStatus, actions);
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
