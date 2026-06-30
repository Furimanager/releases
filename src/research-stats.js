function createFurimaneEmptyStats() {
  return {
    period1: { revenue: 0, count: 0 },
    period2: { revenue: 0, count: 0 },
    period3: { revenue: 0, count: 0 },
    total: { revenue: 0, count: 0 }
  };
}

function getFurimaneResearchDaysAgo(value) {
  if (!value) {
    return null;
  }

  const soldAt = new Date(value).getTime();

  if (!Number.isFinite(soldAt)) {
    return null;
  }

  return Math.floor((Date.now() - soldAt) / (24 * 60 * 60 * 1000));
}

function getFurimaneResearchListingPeriodDate(listing) {
  return listing.period_date || listing.sold_at || null;
}

function isFurimaneSoldListing(listing) {
  const status = (listing.status || "").trim().toLowerCase();

  if (!status) {
    return Boolean(listing.sold_at);
  }

  return (
    status.includes("sold") ||
    status.includes("trading") ||
    status.includes("complete") ||
    status.includes("\u58f2\u308a\u5207\u308c") ||
    status.includes("\u58f2\u5374\u6e08") ||
    status.includes("\u53d6\u5f15\u4e2d")
  );
}

function getFurimaneResearchListingPeriodKey(listing) {
  const daysAgo = getFurimaneResearchDaysAgo(getFurimaneResearchListingPeriodDate(listing));

  if (daysAgo === null || daysAgo < 0 || daysAgo > 90) {
    return null;
  }

  if (daysAgo <= 30) {
    return "period1";
  }

  if (daysAgo <= 60) {
    return "period2";
  }

  return "period3";
}

function calcFurimaneResearchPeriodStats(listings) {
  const stats = createFurimaneEmptyStats();

  for (const listing of listings) {
    if (!isFurimaneSoldListing(listing)) {
      continue;
    }

    const price = Number.isFinite(listing.price) ? listing.price : 0;
    const periodKey = getFurimaneResearchListingPeriodKey(listing);

    stats.total.revenue += price;
    stats.total.count += 1;

    if (periodKey) {
      stats[periodKey].revenue += price;
      stats[periodKey].count += 1;
    }
  }

  return stats;
}

function getFurimaneResearchPeriodSourceField(sourceCounts) {
  const entries = Object.entries(sourceCounts);

  if (entries.length === 0) {
    return "unavailable";
  }

  entries.sort((a, b) => b[1] - a[1]);
  return entries.length === 1 ? entries[0][0] : "mixed";
}

function summarizeFurimaneResearchPeriodAnalysis(listings) {
  const stats = createFurimaneEmptyStats();
  const sourceCounts = {};
  let oldestDaysAgo = null;
  let outOfRangeCount = 0;
  let datedCount = 0;
  let usesEstimatedDates = false;

  for (const listing of listings) {
    if (!isFurimaneSoldListing(listing)) {
      continue;
    }

    const price = Number.isFinite(listing.price) ? listing.price : 0;
    const periodDate = getFurimaneResearchListingPeriodDate(listing);
    const daysAgo = getFurimaneResearchDaysAgo(periodDate);

    stats.total.revenue += price;
    stats.total.count += 1;

    if (daysAgo === null || daysAgo < 0) {
      continue;
    }

    datedCount += 1;
    oldestDaysAgo = oldestDaysAgo === null ? daysAgo : Math.max(oldestDaysAgo, daysAgo);

    const source = listing.period_date_source || (listing.sold_at ? "sold_at" : "unknown");
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

    if (listing.period_date_estimated) {
      usesEstimatedDates = true;
    }

    if (daysAgo > 90) {
      outOfRangeCount += 1;
      continue;
    }

    const periodKey = getFurimaneResearchListingPeriodKey(listing);

    if (periodKey) {
      stats[periodKey].revenue += price;
      stats[periodKey].count += 1;
    }
  }

  return {
    stats,
    available: datedCount > 0,
    usesEstimatedDates,
    periodSourceField: getFurimaneResearchPeriodSourceField(sourceCounts),
    sourceCounts,
    oldestItemDaysAgo: oldestDaysAgo,
    reached90Days: oldestDaysAgo !== null && oldestDaysAgo >= 90,
    outOfRangeCount,
    datedCount
  };
}

window.FurimanagerResearchStats = {
  calcPeriodStats: calcFurimaneResearchPeriodStats,
  getListingPeriodKey: getFurimaneResearchListingPeriodKey,
  summarizePeriodAnalysis: summarizeFurimaneResearchPeriodAnalysis
};
