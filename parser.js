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

    return Array.from(rows, (row) => {
      const cells = row.querySelectorAll("td");
      const itemCell = cells[0];
      const priceCell = cells[1];
      const soldAtCell = cells[8];
      const link = itemCell?.querySelector("a[href]") ?? null;
      const itemName = link?.textContent?.trim() || itemCell?.textContent?.trim() || "";
      const itemUrl = link?.href || null;

      return {
        itemName,
        soldPrice: normalizeSoldPrice(priceCell?.textContent ?? ""),
        soldAtText: soldAtCell?.textContent?.trim() || "",
        mercariTransactionId: extractMercariTransactionId(itemUrl),
        itemUrl,
      };
    });
  }

  globalObject.FurimanagerParser = {
    normalizeSoldPrice,
    extractMercariTransactionId,
    parseSoldItemsFromDocument,
  };
})(window);
