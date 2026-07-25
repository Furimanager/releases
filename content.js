console.log("[furimanager-extension] content loaded");

const PAGE_CHANGE_TIMEOUT_MS = 10000;
const PAGE_CHANGE_POLL_MS = 300;
const SYNC_ANCHOR_EXTERNAL_ID_LIMIT = 50;

function getParser() {
  const parser = window.FurimanagerParser;

  if (!parser || typeof parser.collectSalesPage !== "function") {
    throw new Error("parser is not available");
  }

  return parser;
}

function normalizeRecipe(recipe) {
  return getParser().normalizeRecipe(recipe);
}

function assertMercariSoldPage(recipe) {
  const normalizedRecipe = normalizeRecipe(recipe);
  if (!window.location.pathname.startsWith(normalizedRecipe.pagePathPrefix)) {
    throw new Error("メルカリ販売履歴ページを開いてから同期してください");
  }
}

function buildPingResponse() {
  const currentUrl = window.location.href;

  return {
    success: true,
    currentUrl,
    isMercariSoldPage: currentUrl.includes("/mypage/listings/sold"),
    title: document.title
  };
}

function normalizeAnchorExternalId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue.includes("|")) {
    return null;
  }

  return normalizedValue;
}

function normalizeAnchorExternalIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalizedValues = [];
  const seen = new Set();

  for (const value of values) {
    const externalId = normalizeAnchorExternalId(value);

    if (!externalId || seen.has(externalId)) {
      continue;
    }

    seen.add(externalId);
    normalizedValues.push(externalId);

    if (normalizedValues.length >= SYNC_ANCHOR_EXTERNAL_ID_LIMIT) {
      break;
    }
  }

  return normalizedValues;
}

function buildPreviousAnchorExternalIds(anchorInput) {
  const anchorExternalIds = normalizeAnchorExternalIds(anchorInput?.lastSyncedExternalIds);
  const legacyLastItemId = normalizeAnchorExternalId(anchorInput?.lastItemId);

  if (legacyLastItemId && !anchorExternalIds.includes(legacyLastItemId)) {
    anchorExternalIds.push(legacyLastItemId);
  }

  return anchorExternalIds.slice(0, SYNC_ANCHOR_EXTERNAL_ID_LIMIT);
}

function collectCurrentPage(recipe, pageNumber = null) {
  return getParser().collectSalesPage(document, recipe, pageNumber);
}

function getPageRows(page) {
  return Array.isArray(page?.rows) ? page.rows : [];
}

function countRows(pages) {
  return pages.reduce((count, page) => count + getPageRows(page).length, 0);
}

function getPageFirstIdentity(page, recipe) {
  const firstRow = getPageRows(page)[0] || null;
  return firstRow ? getParser().getRowIdentity(firstRow, recipe) : null;
}

function isButtonDisabled(button) {
  return button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("data-disabled") === "true";
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function getButtonLabel(button) {
  return [button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPageButton(labels) {
  const buttons = Array.from(document.querySelectorAll("button"));

  return (
    buttons.find((button) => {
      const text = getButtonLabel(button);

      if (!labels.some((label) => text.includes(label))) {
        return false;
      }

      return !isButtonDisabled(button) && isElementVisible(button);
    }) || null
  );
}

function waitForPageChange(previousFirstId, recipe, timeoutMs = PAGE_CHANGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    function checkPageChanged() {
      const currentFirstId = getPageFirstIdentity(collectCurrentPage(recipe), recipe);

      if (currentFirstId && currentFirstId !== previousFirstId) {
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }

      window.setTimeout(checkPageChanged, PAGE_CHANGE_POLL_MS);
    }

    checkPageChanged();
  });
}

async function movePage(labels, currentPage, recipe) {
  const button = findPageButton(labels);

  if (!button) {
    return false;
  }

  const previousFirstId = getPageFirstIdentity(currentPage, recipe);
  button.click();

  const pageChanged = await waitForPageChange(previousFirstId, recipe, PAGE_CHANGE_TIMEOUT_MS);

  if (!pageChanged) {
    throw new Error("ページ切り替えの待機がタイムアウトしました");
  }

  return true;
}

async function moveToFirstPage(recipe, maxSteps) {
  let movedPageCount = 0;

  while (movedPageCount < maxSteps) {
    const moved = await movePage(recipe.pagination.prevLabels, collectCurrentPage(recipe), recipe);

    if (!moved) {
      break;
    }

    movedPageCount += 1;
  }

  if (movedPageCount >= maxSteps && findPageButton(recipe.pagination.prevLabels)) {
    throw new Error("先頭ページへの移動が上限に達しました");
  }

  if (movedPageCount > 0) {
    console.log("[furimanager-extension] moved to first sold page", { movedPageCount });
  }

  return movedPageCount;
}

async function goToNextPage(currentPage, recipe) {
  return movePage(recipe.pagination.nextLabels, currentPage, recipe);
}

function buildPayloadResult(recipe, pages, scanMeta) {
  const anchorExternalIds = getParser().collectAnchorExternalIdsFromPages(pages, recipe);
  const rowCount = countRows(pages);
  const payload = {
    payloadVersion: 2,
    recipeVersion: Number(recipe.recipeVersion),
    source: "extension",
    capturedAt: new Date().toISOString(),
    pages,
    scanMeta
  };

  return {
    success: true,
    ...payload,
    count: rowCount,
    anchorExternalIds,
    newLastItemId: anchorExternalIds[0] || null,
    pageCount: scanMeta.pageCount,
    reachedPageLimit: scanMeta.reachedPageLimit,
    reachedItemLimit: scanMeta.reachedItemLimit,
    timedOut: scanMeta.timedOut,
    scanComplete: scanMeta.scanComplete,
    gapSuspected: scanMeta.reachedPageLimit && !scanMeta.matchedAnchorExternalId,
    matchedLastItemId: Boolean(scanMeta.matchedAnchorExternalId),
    matchedAnchorExternalId: scanMeta.matchedAnchorExternalId,
    stoppedByOlderAnchorDate: scanMeta.stoppedByOlderAnchorDate,
    startPageResetCount: scanMeta.startPageResetCount
  };
}

function appendPageRows(pages, page, maxItems, recipe, seenRowIds) {
  const remaining = Math.max(0, maxItems - countRows(pages));
  const rows = getPageRows(page)
    .filter((row) => {
      if (!seenRowIds) {
        return true;
      }

      const key = getParser().getRowIdentity(row, recipe);
      if (seenRowIds.has(key)) {
        return false;
      }

      seenRowIds.add(key);
      return true;
    })
    .slice(0, remaining);

  if (rows.length > 0 || getPageRows(page).length === 0) {
    pages.push({ ...page, rows });
  }
}

function buildScrapeResponse(recipeInput) {
  const recipe = normalizeRecipe(recipeInput);
  assertMercariSoldPage(recipe);

  const page = collectCurrentPage(recipe, 1);
  const result = buildPayloadResult(recipe, [page], {
    pageCount: 1,
    loadStepCount: 1,
    reachedPageLimit: false,
    reachedItemLimit: false,
    timedOut: false,
    scanComplete: true,
    matchedAnchorExternalId: null,
    stoppedByOlderAnchorDate: false,
    startPageResetCount: 0
  });

  console.log("[furimanager-extension] scrape result", { count: result.count });
  return result;
}

async function scrapeAllPages(recipeInput) {
  const recipe = normalizeRecipe(recipeInput);
  assertMercariSoldPage(recipe);

  const maxSteps = Number(recipe.limits.fullMaxSteps);
  const maxItems = Number(recipe.limits.fullMaxItems);
  const startPageResetCount = await moveToFirstPage(recipe, maxSteps);
  const pages = [];
  const seenRowIds = new Set();
  let pageCount = 0;
  let reachedPageLimit = false;
  let reachedItemLimit = false;

  while (pageCount < maxSteps && countRows(pages) < maxItems) {
    const currentPage = collectCurrentPage(recipe, pageCount + 1);
    appendPageRows(pages, currentPage, maxItems, recipe, seenRowIds);
    pageCount += 1;
    reachedItemLimit = countRows(pages) >= maxItems;

    if (reachedItemLimit) {
      break;
    }

    if (pageCount >= maxSteps) {
      reachedPageLimit = Boolean(findPageButton(recipe.pagination.nextLabels));
      break;
    }

    const moved = await goToNextPage(currentPage, recipe);

    if (!moved) {
      break;
    }
  }

  const result = buildPayloadResult(recipe, pages, {
    pageCount,
    loadStepCount: pageCount,
    reachedPageLimit: reachedPageLimit || reachedItemLimit,
    reachedItemLimit,
    timedOut: false,
    scanComplete: !reachedPageLimit && !reachedItemLimit,
    matchedAnchorExternalId: null,
    stoppedByOlderAnchorDate: false,
    startPageResetCount
  });

  console.log("[furimanager-extension] scrape all pages result", { count: result.count, pageCount });
  return result;
}

async function scrapeDeltaPages(anchorInput = {}) {
  const recipe = normalizeRecipe(anchorInput.recipe);
  assertMercariSoldPage(recipe);

  const previousAnchorExternalIds = buildPreviousAnchorExternalIds(anchorInput);
  const previousAnchorExternalIdSet = new Set(previousAnchorExternalIds);
  const normalizedLastSoldAt = typeof anchorInput?.lastSoldAt === "string" && anchorInput.lastSoldAt.trim()
    ? anchorInput.lastSoldAt.slice(0, 10)
    : null;

  if (previousAnchorExternalIds.length === 0 && !normalizedLastSoldAt) {
    return scrapeAllPages(recipe);
  }

  const maxSteps = Number(recipe.limits.deltaMaxSteps);
  const maxItems = Number(recipe.limits.deltaMaxItems);
  const startPageResetCount = await moveToFirstPage(recipe, maxSteps);
  const pages = [];
  const seenRowIds = new Set();
  let pageCount = 0;
  let matchedAnchorExternalId = null;
  let stoppedByOlderAnchorDate = false;
  let reachedPageLimit = false;
  let reachedItemLimit = false;

  while (pageCount < maxSteps && !matchedAnchorExternalId && !stoppedByOlderAnchorDate && countRows(pages) < maxItems) {
    const currentPage = collectCurrentPage(recipe, pageCount + 1);
    const acceptedRows = [];

    for (const row of getPageRows(currentPage)) {
      const anchorExternalId = getParser().extractAnchorIdFromRow(row, recipe);
      const itemSoldAt = getParser().extractStopDateFromRow(row, recipe);

      if (anchorExternalId && previousAnchorExternalIdSet.has(anchorExternalId)) {
        matchedAnchorExternalId = anchorExternalId;
        break;
      }

      if (normalizedLastSoldAt && itemSoldAt && itemSoldAt < normalizedLastSoldAt) {
        stoppedByOlderAnchorDate = true;
        break;
      }

      const rowIdentity = getParser().getRowIdentity(row, recipe);
      if (seenRowIds.has(rowIdentity)) {
        continue;
      }

      seenRowIds.add(rowIdentity);
      acceptedRows.push(row);

      if (countRows(pages) + acceptedRows.length >= maxItems) {
        reachedItemLimit = true;
        break;
      }
    }

    if (acceptedRows.length > 0) {
      pages.push({ ...currentPage, rows: acceptedRows });
    }

    pageCount += 1;

    if (matchedAnchorExternalId || stoppedByOlderAnchorDate || reachedItemLimit) {
      break;
    }

    if (pageCount >= maxSteps) {
      reachedPageLimit = Boolean(findPageButton(recipe.pagination.nextLabels));
      break;
    }

    const moved = await goToNextPage(currentPage, recipe);

    if (!moved) {
      break;
    }
  }

  reachedItemLimit = reachedItemLimit || countRows(pages) >= maxItems;
  const result = buildPayloadResult(recipe, pages, {
    pageCount,
    loadStepCount: pageCount,
    reachedPageLimit: !matchedAnchorExternalId && (reachedPageLimit || reachedItemLimit),
    reachedItemLimit,
    timedOut: false,
    scanComplete: !reachedItemLimit && (Boolean(matchedAnchorExternalId) || stoppedByOlderAnchorDate || pageCount < maxSteps),
    matchedAnchorExternalId,
    stoppedByOlderAnchorDate,
    startPageResetCount
  });

  console.log("[furimanager-extension] scrape delta pages result", {
    count: result.count,
    newLastItemId: result.newLastItemId,
    anchorExternalIds: result.anchorExternalIds,
    pageCount,
    reachedPageLimit: result.reachedPageLimit,
    gapSuspected: result.gapSuspected
  });

  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({
      success: false,
      message: "invalid message"
    });
    return false;
  }

  if (message.action === "ping") {
    sendResponse(buildPingResponse());
    return false;
  }

  if (message.action === "scrape") {
    try {
      sendResponse(buildScrapeResponse(message.recipe));
    } catch (error) {
      sendResponse({
        success: false,
        message: error instanceof Error ? error.message : "scrape failed"
      });
    }
    return false;
  }

  if (message.action === "scrapeAllPages") {
    scrapeAllPages(message.recipe)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : "scrapeAllPages failed"
        });
      });
    return true;
  }

  if (message.action === "scrapeDeltaPages") {
    scrapeDeltaPages({
      lastItemId: message.lastItemId,
      lastSyncedExternalIds: message.lastSyncedExternalIds,
      lastSoldAt: message.lastSoldAt,
      recipe: message.recipe
    })
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : "scrapeDeltaPages failed"
        });
      });
    return true;
  }

  sendResponse({
    success: false,
    message: "unknown action"
  });
  return false;
});
