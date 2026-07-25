(function attachFurimanagerParser(globalObject) {
  const SYNC_ANCHOR_EXTERNAL_ID_LIMIT = 50;

  function normalizeVisibleText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeRecipe(recipe) {
    if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
      throw new Error("販売履歴レシピを取得できませんでした");
    }

    const requiredArrays = [
      recipe.rootSelectors,
      recipe?.table?.rowLinkSelectors,
      recipe?.table?.headerSelectors,
      recipe?.pagination?.nextLabels,
      recipe?.pagination?.prevLabels,
      recipe.emptyStateMarkers
    ];
    const hasRequiredArrays = requiredArrays.every((value) => Array.isArray(value));
    const hasPatterns = typeof recipe.anchorIdPattern === "string" && typeof recipe.stopDatePattern === "string";

    if (!hasRequiredArrays || !hasPatterns || !recipe.limits) {
      throw new Error("販売履歴レシピの形式が不正です");
    }

    return recipe;
  }

  function safeQuerySelectorAll(root, selector) {
    try {
      return Array.from(root?.querySelectorAll(selector) ?? []).filter((element) => element instanceof HTMLElement);
    } catch {
      return [];
    }
  }

  function getSalesRoot(doc, recipe) {
    for (const selector of recipe.rootSelectors) {
      const root = doc.querySelector(selector);
      if (root) {
        return root;
      }
    }

    return doc.body;
  }

  function findSalesTable(doc, recipe) {
    const root = getSalesRoot(doc, recipe);
    const tables = Array.from(root?.querySelectorAll("table") ?? []);

    return (
      tables.find((table) => recipe.table.rowLinkSelectors.some((selector) => table.querySelector(selector))) ||
      tables.find((table) => table.querySelector("tbody tr")) ||
      null
    );
  }

  function getSalesTableHeaders(table, recipe) {
    for (const selector of recipe.table.headerSelectors) {
      const headers = safeQuerySelectorAll(table, selector).map((header) => normalizeVisibleText(header.textContent));
      if (headers.length > 0) {
        return headers;
      }
    }

    return [];
  }

  function normalizeMercariUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      const url = new URL(value, globalObject.location?.origin || "https://jp.mercari.com");
      return url.hostname.endsWith("mercari.com") ? url.toString() : null;
    } catch {
      return null;
    }
  }

  function getRowLinkHrefs(row) {
    return Array.from(row.querySelectorAll("a[href]"))
      .map((link) => normalizeMercariUrl(link.href || link.getAttribute("href")))
      .filter(Boolean);
  }

  function collectSalesPage(doc = document, recipeInput, pageNumber = null) {
    const recipe = normalizeRecipe(recipeInput);
    const table = findSalesTable(doc, recipe);
    const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);

    return {
      pageNumber,
      headerTexts: getSalesTableHeaders(table, recipe),
      rows: rows.map((row, index) => ({
        rowIndex: index + 1,
        cellTexts: Array.from(row.querySelectorAll("td"), (cell) => normalizeVisibleText(cell.textContent)),
        linkHrefs: getRowLinkHrefs(row)
      }))
    };
  }

  function extractAnchorIdFromRow(row, recipeInput) {
    const recipe = normalizeRecipe(recipeInput);
    const matcher = new RegExp(recipe.anchorIdPattern, "i");
    const values = [
      ...(Array.isArray(row?.linkHrefs) ? row.linkHrefs : []),
      ...(Array.isArray(row?.cellTexts) ? row.cellTexts : []),
      row?.rawText || ""
    ];

    for (const value of values) {
      const matched = String(value || "").match(matcher);
      if (matched?.[1]) {
        return matched[1];
      }
    }

    return null;
  }

  function normalizeStopDate(year, month, day) {
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

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function extractStopDateFromRow(row, recipeInput) {
    const recipe = normalizeRecipe(recipeInput);
    const matcher = new RegExp(recipe.stopDatePattern, "i");
    const values = [
      ...(Array.isArray(row?.cellTexts) ? row.cellTexts : []),
      row?.rawText || ""
    ];
    const dates = [];

    for (const value of values) {
      const matched = String(value || "").match(matcher);
      const normalized = matched ? normalizeStopDate(matched[1] || matched[4], matched[2] || matched[5], matched[3] || matched[6]) : null;
      if (normalized && !dates.includes(normalized)) {
        dates.push(normalized);
      }
    }

    return dates.length === 1 ? dates[0] : null;
  }

  function getRowIdentity(row, recipe) {
    return extractAnchorIdFromRow(row, recipe) || [...(row?.cellTexts || []), row?.rawText || ""].join("|");
  }

  function collectAnchorExternalIdsFromPages(pages, recipe, limit = SYNC_ANCHOR_EXTERNAL_ID_LIMIT) {
    const ids = [];
    const seen = new Set();

    for (const page of Array.isArray(pages) ? pages : []) {
      for (const row of Array.isArray(page?.rows) ? page.rows : []) {
        const id = extractAnchorIdFromRow(row, recipe);
        if (!id || seen.has(id)) {
          continue;
        }

        seen.add(id);
        ids.push(id);

        if (ids.length >= limit) {
          return ids;
        }
      }
    }

    return ids;
  }

  function hasSalesHistoryMarkers(doc, recipeInput) {
    const recipe = normalizeRecipe(recipeInput);
    const table = findSalesTable(doc, recipe);
    const headers = getSalesTableHeaders(table, recipe).join(" ");
    return recipe.pageDetection?.headerMarkers?.some((marker) => headers.includes(marker));
  }

  globalObject.FurimanagerParser = {
    collectSalesPage,
    collectAnchorExternalIdsFromPages,
    extractAnchorIdFromRow,
    extractStopDateFromRow,
    getRowIdentity,
    hasSalesHistoryMarkers,
    normalizeRecipe,
    normalizeVisibleText
  };
})(window);
