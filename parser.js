(function attachFurimanagerParser(globalObject) {
  const SOLD_AT_HEADER_LABELS = [
    "購入完了日時",
    "購入完了日",
    "購入日時",
    "購入日",
    "販売日時",
    "販売日",
    "売上確定日時",
    "売上確定日",
    "売却日時",
    "売却日",
    "取引完了日時",
    "取引完了日",
    "取引終了日時",
    "取引終了日",
    "取引日",
    "日付",
  ];

  function normalizeSoldPrice(text) {
    if (typeof text !== "string") {
      return null;
    }

    const numericText = text.replace(/[^\d]/g, "");

    if (!numericText) {
      return null;
    }

    const value = Number.parseInt(numericText, 10);

    return Number.isNaN(value) ? null : value;
  }

  function normalizeHeaderText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .trim();
  }

  function normalizeSoldAtDate(text) {
    if (typeof text !== "string") {
      return null;
    }

    const normalizedText = text.normalize("NFKC").trim();
    const matched =
      normalizedText.match(/(?:^|[^\d])(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?=$|[^\d])/) ||
      normalizedText.match(/(?:^|[^\d])(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);

    if (!matched) {
      return null;
    }

    const [, year, month, day] = matched;
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
    if (
      date.getUTCFullYear() !== yearNumber ||
      date.getUTCMonth() + 1 !== monthNumber ||
      date.getUTCDate() !== dayNumber
    ) {
      return null;
    }

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  function getSalesTableHeaders(table) {
    const headerElements = table?.querySelectorAll("thead th, [role='columnheader']") ?? [];
    const resolvedHeaderElements = headerElements.length > 0
      ? headerElements
      : table?.querySelectorAll("tr:first-child th") ?? [];

    return Array.from(resolvedHeaderElements, (header) => normalizeHeaderText(header.textContent));
  }

  function findSoldAtHeaderIndex(headers) {
    const normalizedLabels = SOLD_AT_HEADER_LABELS.map(normalizeHeaderText);
    const exactIndex = headers.findIndex((header) => normalizedLabels.includes(header));

    if (exactIndex >= 0) {
      return exactIndex;
    }

    return headers.findIndex((header) => normalizedLabels.some((label) => header.includes(label)));
  }

  function getFallbackSoldAtCell(cells) {
    const itemCell = cells[0];
    const priceCell = cells[1];
    const hasSalesRowShape =
      Boolean(itemCell?.querySelector("a[href*='/transaction/'], a[href*='/item/m'], a[href]")) &&
      typeof normalizeSoldPrice(priceCell?.textContent || "") === "number";

    if (!hasSalesRowShape) {
      return null;
    }

    const excludedIndexes = new Set([0, 1, 3]);
    const dateCandidates = Array.from(cells)
      .filter((cell, index) => !excludedIndexes.has(index) && normalizeSoldAtDate(cell.textContent || ""));

    // ヘッダーが変わった場合も、行内に有効な年月日が1つだけなら安全に採用する。
    return dateCandidates.length === 1 ? dateCandidates[0] : null;
  }

  function classifyShippingFee(rawText, shippingFee) {
    const normalizedText = typeof rawText === "string" ? rawText.replace(/\s+/g, " ").trim() : "";

    if (!normalizedText) {
      return "unknown";
    }

    if (normalizedText.includes("着払い")) {
      return "buyer_cash_on_delivery";
    }

    if (normalizedText.includes("購入者負担")) {
      return "buyer_paid";
    }

    if (normalizedText.includes("出品者負担")) {
      return "seller_paid";
    }

    if (normalizedText.includes("送料込み")) {
      return "seller_included";
    }

    if (typeof shippingFee === "number") {
      return "unknown_numeric";
    }

    return "unknown";
  }

  function extractMercariTransactionId(url) {
    if (typeof url !== "string" || url.trim() === "") {
      return null;
    }

    const matched = url.match(/\/transaction\/([^/?#]+)/);

    return matched?.[1] ?? null;
  }

  function parseSoldItemsFromDocument(doc = document) {
    const root = doc.querySelector("#my-page-main-content");

    if (!root) {
      return [];
    }

    const tables = Array.from(root.querySelectorAll("table"));
    const table =
      tables.find((candidate) => candidate.querySelector("tbody tr a[href*='/transaction/']")) ||
      tables.find((candidate) => candidate.querySelector("tbody tr")) ||
      null;
    const rows = table?.querySelectorAll("tbody tr") ?? [];

    if (rows.length === 0) {
      return [];
    }

    const soldAtHeaderIndex = findSoldAtHeaderIndex(getSalesTableHeaders(table));

    const items = Array.from(rows, (row) => {
      const cells = row.querySelectorAll("td");
      const itemCell = cells[0];
      const priceCell = cells[1];
      const shippingFeeCell = cells[3];
      const headerSoldAtCell = soldAtHeaderIndex >= 0 ? cells[soldAtHeaderIndex] : null;
      const validHeaderSoldAtCell = normalizeSoldAtDate(headerSoldAtCell?.textContent || "") ? headerSoldAtCell : null;
      const soldAtCell = validHeaderSoldAtCell || getFallbackSoldAtCell(cells);
      const link = itemCell?.querySelector("a[href]") ?? null;
      const itemName = link?.textContent?.trim() || itemCell?.textContent?.trim() || "";
      const itemUrl = link?.href || null;
      const shippingFeeRawText = shippingFeeCell?.textContent ?? "";
      const shippingFee = normalizeSoldPrice(shippingFeeRawText);
      const shippingFeeClassification = classifyShippingFee(shippingFeeRawText, shippingFee);

      return {
        itemName,
        soldPrice: normalizeSoldPrice(priceCell?.textContent ?? ""),
        soldAtText: soldAtCell?.textContent?.trim() || "",
        mercariTransactionId: extractMercariTransactionId(itemUrl),
        itemUrl,
        shippingFee,
        shippingFeeClassification,
        shippingFeeRawText,
      };
    });

    const firstRow = rows[0];
    const firstItem = items[0];

    if (firstRow && firstItem) {
      const firstRowTexts = Array.from(firstRow.querySelectorAll("td"), (cell) => {
        return cell.textContent?.replace(/\s+/g, " ").trim() || "";
      });

      console.log("[furimanager-extension] first row shipping debug", {
        tdTexts: firstRowTexts,
        shippingFeeRawText: firstItem.shippingFeeRawText,
        shippingFee: firstItem.shippingFee,
        shippingFeeClassification: firstItem.shippingFeeClassification,
      });
    }

    return items;
  }

  globalObject.FurimanagerParser = {
    normalizeSoldPrice,
    extractMercariTransactionId,
    parseSoldItemsFromDocument,
  };
})(window);
