(function attachFurimanagerParser(globalObject) {
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

    const rows = root.querySelectorAll("table tbody tr");

    if (rows.length === 0) {
      return [];
    }

    const items = Array.from(rows, (row) => {
      const cells = row.querySelectorAll("td");
      const itemCell = cells[0];
      const priceCell = cells[1];
      const shippingFeeCell = cells[3];
      const soldAtCell = cells[8];
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
