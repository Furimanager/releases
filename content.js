console.log("[furimanager-extension] content loaded");

const FULL_SCRAPE_MAX_PAGES = 50;
const DELTA_SCRAPE_MAX_PAGES = 20;
const PAGE_CHANGE_TIMEOUT_MS = 10000;
const PAGE_CHANGE_POLL_MS = 300;
const SYNC_ANCHOR_EXTERNAL_ID_LIMIT = 50;

function getParser() {
  const parser = window.FurimanagerParser;

  if (!parser || typeof parser.parseSoldItemsFromDocument !== "function") {
    throw new Error("parser is not available");
  }

  return parser;
}

function assertMercariSoldPage() {
  if (!window.location.pathname.startsWith("/mypage/listings/sold")) {
    throw new Error("メルカリ販売履歴ページを開いてから同期してください");
  }
}

function buildPingResponse() {
  const currentUrl = window.location.href;

  return {
    success: true,
    currentUrl,
    isMercariSoldPage: currentUrl.includes("/mypage/listings/sold"),
    title: document.title,
  };
}

function getItemIdentity(item) {
  if (item?.mercariTransactionId) {
    return item.mercariTransactionId;
  }

  return [item?.itemName || "", item?.soldAtText || "", item?.soldPrice ?? ""].join("|");
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

function getAnchorExternalId(item) {
  return normalizeAnchorExternalId(item?.mercariTransactionId);
}

function collectAnchorExternalIds(items, limit = SYNC_ANCHOR_EXTERNAL_ID_LIMIT) {
  const anchorExternalIds = [];
  const seen = new Set();

  for (const item of items) {
    const externalId = getAnchorExternalId(item);

    if (!externalId || seen.has(externalId)) {
      continue;
    }

    seen.add(externalId);
    anchorExternalIds.push(externalId);

    if (anchorExternalIds.length >= limit) {
      break;
    }
  }

  return anchorExternalIds.slice(0, SYNC_ANCHOR_EXTERNAL_ID_LIMIT);
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

function parseCurrentPageItems() {
  const parser = getParser();
  return parser.parseSoldItemsFromDocument(document);
}

function dedupeItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = getItemIdentity(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildScrapeResponse() {
  assertMercariSoldPage();

  const items = parseCurrentPageItems();

  console.log("[furimanager-extension] scrape result", items);

  return {
    success: true,
    count: items.length,
    items,
  };
}

function isButtonDisabled(button) {
  return (
    button.disabled ||
    button.getAttribute("aria-disabled") === "true" ||
    button.getAttribute("data-disabled") === "true"
  );
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

function findNextPageButton() {
  return findPageButton(["次へ", "次のページ", "Next"]);
}

function findPreviousPageButton() {
  return findPageButton(["前へ", "前のページ", "Previous", "Prev"]);
}

function waitForPageChange(previousFirstId, timeoutMs = PAGE_CHANGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    function checkPageChanged() {
      const items = parseCurrentPageItems();
      const currentFirstId = items[0] ? getItemIdentity(items[0]) : null;

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

async function goToNextPage(currentItems) {
  const nextButton = findNextPageButton();

  if (!nextButton) {
    return false;
  }

  const previousFirstId = currentItems[0] ? getItemIdentity(currentItems[0]) : null;

  nextButton.click();

  const pageChanged = await waitForPageChange(previousFirstId, PAGE_CHANGE_TIMEOUT_MS);

  if (!pageChanged) {
    throw new Error("ページ切り替えの待機がタイムアウトしました");
  }

  return true;
}

async function goToPreviousPage(currentItems) {
  const previousButton = findPreviousPageButton();

  if (!previousButton) {
    return false;
  }

  const previousFirstId = currentItems[0] ? getItemIdentity(currentItems[0]) : null;

  previousButton.click();

  const pageChanged = await waitForPageChange(previousFirstId, PAGE_CHANGE_TIMEOUT_MS);

  if (!pageChanged) {
    throw new Error("ページ切り替えの待機がタイムアウトしました");
  }

  return true;
}

async function moveToFirstPage() {
  let movedPageCount = 0;

  while (movedPageCount < FULL_SCRAPE_MAX_PAGES) {
    const currentItems = parseCurrentPageItems();
    const moved = await goToPreviousPage(currentItems);

    if (!moved) {
      break;
    }

    movedPageCount += 1;
  }

  if (movedPageCount >= FULL_SCRAPE_MAX_PAGES && findPreviousPageButton()) {
    throw new Error("先頭ページへの移動が上限に達しました");
  }

  if (movedPageCount > 0) {
    console.log("[furimanager-extension] moved to first sold page", { movedPageCount });
  }

  return movedPageCount;
}

async function scrapeAllPages() {
  assertMercariSoldPage();

  const startPageResetCount = await moveToFirstPage();
  const allItems = [];
  let pageCount = 0;
  let reachedPageLimit = false;

  while (pageCount < FULL_SCRAPE_MAX_PAGES) {
    const currentItems = parseCurrentPageItems();
    allItems.push(...currentItems);
    pageCount += 1;

    if (pageCount >= FULL_SCRAPE_MAX_PAGES) {
      reachedPageLimit = Boolean(findNextPageButton());
      break;
    }

    const moved = await goToNextPage(currentItems);

    if (!moved) {
      break;
    }
  }

  const items = dedupeItems(allItems);
  const anchorExternalIds = collectAnchorExternalIds(items);

  console.log("[furimanager-extension] scrape all pages result", items);

  return {
    success: true,
    count: items.length,
    items,
    pageCount,
    reachedPageLimit,
    gapSuspected: reachedPageLimit,
    anchorExternalIds,
    newLastItemId: anchorExternalIds[0] || null,
    startPageResetCount,
  };
}

async function scrapeDeltaPages(anchorInput = {}) {
  assertMercariSoldPage();

  const previousAnchorExternalIds = buildPreviousAnchorExternalIds(anchorInput);
  const previousAnchorExternalIdSet = new Set(previousAnchorExternalIds);

  if (previousAnchorExternalIds.length === 0) {
    const fullResult = await scrapeAllPages();

    return {
      ...fullResult,
      matchedAnchorExternalId: null,
    };
  }

  const startPageResetCount = await moveToFirstPage();
  const collectedItems = [];
  const scannedItems = [];
  let pageCount = 0;
  let matchedAnchorExternalId = null;
  let reachedPageLimit = false;

  while (pageCount < DELTA_SCRAPE_MAX_PAGES && !matchedAnchorExternalId) {
    const currentItems = parseCurrentPageItems();

    for (const item of currentItems) {
      scannedItems.push(item);

      const anchorExternalId = getAnchorExternalId(item);

      if (anchorExternalId && previousAnchorExternalIdSet.has(anchorExternalId)) {
        matchedAnchorExternalId = anchorExternalId;
        break;
      }

      collectedItems.push(item);
    }

    pageCount += 1;

    if (matchedAnchorExternalId) {
      break;
    }

    if (pageCount >= DELTA_SCRAPE_MAX_PAGES) {
      reachedPageLimit = Boolean(findNextPageButton());
      break;
    }

    const moved = await goToNextPage(currentItems);

    if (!moved) {
      break;
    }
  }

  const items = dedupeItems(collectedItems);
  const anchorExternalIds = collectAnchorExternalIds(scannedItems.length > 0 ? scannedItems : items);
  const newLastItemId = anchorExternalIds[0] || null;
  const gapSuspected = !matchedAnchorExternalId && reachedPageLimit;

  console.log("[furimanager-extension] scrape delta pages result", {
    count: items.length,
    newLastItemId,
    anchorExternalIds,
    pageCount,
    reachedPageLimit,
    gapSuspected,
    items,
  });

  return {
    success: true,
    count: items.length,
    items,
    newLastItemId,
    anchorExternalIds,
    pageCount,
    reachedPageLimit,
    gapSuspected,
    startPageResetCount,
    matchedLastItemId: Boolean(matchedAnchorExternalId),
    matchedAnchorExternalId,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({
      success: false,
      message: "invalid message",
    });
    return false;
  }

  if (message.action === "ping") {
    sendResponse(buildPingResponse());
    return false;
  }

  if (message.action === "scrape") {
    try {
      sendResponse(buildScrapeResponse());
    } catch (error) {
      sendResponse({
        success: false,
        message: error instanceof Error ? error.message : "scrape failed",
      });
    }
    return false;
  }

  if (message.action === "scrapeAllPages") {
    scrapeAllPages()
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : "scrapeAllPages failed",
        });
      });
    return true;
  }

  if (message.action === "scrapeDeltaPages") {
    scrapeDeltaPages({
      lastItemId: message.lastItemId,
      lastSyncedExternalIds: message.lastSyncedExternalIds,
    })
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : "scrapeDeltaPages failed",
        });
      });
    return true;
  }

  sendResponse({
    success: false,
    message: "unknown action",
  });
  return false;
});
