console.log("[furimanager-extension] content loaded");

const FULL_SCRAPE_MAX_PAGES = 50;
const DELTA_SCRAPE_MAX_PAGES = 20;
const PAGE_CHANGE_TIMEOUT_MS = 10000;
const PAGE_CHANGE_POLL_MS = 300;

function getParser() {
  const parser = window.FurimanagerParser;

  if (!parser || typeof parser.parseSoldItemsFromDocument !== "function") {
    throw new Error("parser is not available");
  }

  return parser;
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

function getStorageItemId(item) {
  const id = getItemIdentity(item);
  return id || null;
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

function findNextPageButton() {
  const buttons = Array.from(document.querySelectorAll("button"));

  return (
    buttons.find((button) => {
      const text = button.textContent?.replace(/\s+/g, " ").trim() || "";

      if (!text.includes("次へ")) {
        return false;
      }

      return !isButtonDisabled(button);
    }) || null
  );
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

async function scrapeAllPages() {
  const allItems = [];
  let pageCount = 0;

  while (pageCount < FULL_SCRAPE_MAX_PAGES) {
    const currentItems = parseCurrentPageItems();
    allItems.push(...currentItems);
    pageCount += 1;

    const moved = await goToNextPage(currentItems);

    if (!moved) {
      break;
    }
  }

  const items = dedupeItems(allItems);
  const reachedPageLimit = pageCount >= FULL_SCRAPE_MAX_PAGES;

  console.log("[furimanager-extension] scrape all pages result", items);

  return {
    success: true,
    count: items.length,
    items,
    pageCount,
    reachedPageLimit,
  };
}

async function scrapeDeltaPages(lastItemId) {
  const normalizedLastItemId =
    typeof lastItemId === "string" && lastItemId.trim() !== "" ? lastItemId.trim() : null;

  if (!normalizedLastItemId) {
    const fullResult = await scrapeAllPages();

    return {
      ...fullResult,
      newLastItemId: getStorageItemId(fullResult.items[0]) || null,
    };
  }

  const collectedItems = [];
  let pageCount = 0;
  let matchedLastItemId = false;

  while (pageCount < DELTA_SCRAPE_MAX_PAGES && !matchedLastItemId) {
    const currentItems = parseCurrentPageItems();

    for (const item of currentItems) {
      if (getStorageItemId(item) === normalizedLastItemId) {
        matchedLastItemId = true;
        break;
      }

      collectedItems.push(item);
    }

    pageCount += 1;

    if (matchedLastItemId) {
      break;
    }

    const moved = await goToNextPage(currentItems);

    if (!moved) {
      break;
    }
  }

  const items = dedupeItems(collectedItems);
  const currentPageItems = parseCurrentPageItems();
  const sourceFirstItem = items[0] || currentPageItems[0] || null;
  const newLastItemId = getStorageItemId(sourceFirstItem);
  const reachedPageLimit = !matchedLastItemId && pageCount >= DELTA_SCRAPE_MAX_PAGES;

  console.log("[furimanager-extension] scrape delta pages result", {
    count: items.length,
    newLastItemId,
    pageCount,
    reachedPageLimit,
    items,
  });

  return {
    success: true,
    count: items.length,
    items,
    newLastItemId,
    pageCount,
    reachedPageLimit,
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
    scrapeDeltaPages(message.lastItemId)
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
