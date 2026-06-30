type ResearchListingForStats = {
  price: number;
  sold_at: string | null;
  period_date?: string | null;
  period_date_source?: string | null;
  period_date_estimated?: boolean;
  status?: string;
};

type PeriodStats = {
  revenue: number;
  count: number;
};

type ResearchPeriodStats = {
  period1: PeriodStats;
  period2: PeriodStats;
  period3: PeriodStats;
  total: PeriodStats;
};

type ResearchPeriodAnalysisSummary = {
  stats: ResearchPeriodStats;
  available: boolean;
  usesEstimatedDates: boolean;
  periodSourceField: string;
  sourceCounts: Record<string, number>;
  oldestItemDaysAgo: number | null;
  reached90Days: boolean;
  outOfRangeCount: number;
  datedCount: number;
};

type ResearchStatsWindow = Window & {
  FurimanagerResearchStats?: {
    calcPeriodStats: (listings: ResearchListingForStats[]) => ResearchPeriodStats;
    getListingPeriodKey: (listing: ResearchListingForStats) => "period1" | "period2" | "period3" | null;
    summarizePeriodAnalysis: (listings: ResearchListingForStats[]) => ResearchPeriodAnalysisSummary;
  };
};

function createEmptyStats(): ResearchPeriodStats {
  return {
    period1: { revenue: 0, count: 0 },
    period2: { revenue: 0, count: 0 },
    period3: { revenue: 0, count: 0 },
    total: { revenue: 0, count: 0 }
  };
}

function getDaysAgo(value: string | null) {
  if (!value) {
    return null;
  }

  const soldAt = new Date(value).getTime();

  if (!Number.isFinite(soldAt)) {
    return null;
  }

  return Math.floor((Date.now() - soldAt) / (24 * 60 * 60 * 1000));
}

function getListingPeriodDate(listing: ResearchListingForStats) {
  return listing.period_date || listing.sold_at || null;
}

function isSoldListing(listing: ResearchListingForStats) {
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

function getListingPeriodKey(listing: ResearchListingForStats) {
  const daysAgo = getDaysAgo(getListingPeriodDate(listing));

  if (daysAgo === null || daysAgo < 0 || daysAgo > 90) {
    return null;
  }

  if (daysAgo <= 30) {
    return "period1" as const;
  }

  if (daysAgo <= 60) {
    return "period2" as const;
  }

  return "period3" as const;
}

function calcPeriodStats(listings: ResearchListingForStats[]) {
  const stats = createEmptyStats();

  for (const listing of listings) {
    if (!isSoldListing(listing)) {
      continue;
    }

    const price = Number.isFinite(listing.price) ? listing.price : 0;
    const periodKey = getListingPeriodKey(listing);

    stats.total.revenue += price;
    stats.total.count += 1;

    if (periodKey) {
      stats[periodKey].revenue += price;
      stats[periodKey].count += 1;
    }
  }

  return stats;
}

function getPeriodSourceField(sourceCounts: Record<string, number>) {
  const entries = Object.entries(sourceCounts);

  if (entries.length === 0) {
    return "unavailable";
  }

  entries.sort((a, b) => b[1] - a[1]);
  return entries.length === 1 ? entries[0][0] : "mixed";
}

function summarizePeriodAnalysis(listings: ResearchListingForStats[]): ResearchPeriodAnalysisSummary {
  const stats = createEmptyStats();
  const sourceCounts: Record<string, number> = {};
  let oldestDaysAgo: number | null = null;
  let outOfRangeCount = 0;
  let datedCount = 0;
  let usesEstimatedDates = false;

  for (const listing of listings) {
    if (!isSoldListing(listing)) {
      continue;
    }

    const price = Number.isFinite(listing.price) ? listing.price : 0;
    const periodDate = getListingPeriodDate(listing);
    const daysAgo = getDaysAgo(periodDate);

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

    const periodKey = getListingPeriodKey(listing);

    if (periodKey) {
      stats[periodKey].revenue += price;
      stats[periodKey].count += 1;
    }
  }

  return {
    stats,
    available: datedCount > 0,
    usesEstimatedDates,
    periodSourceField: getPeriodSourceField(sourceCounts),
    sourceCounts,
    oldestItemDaysAgo: oldestDaysAgo,
    reached90Days: oldestDaysAgo !== null && oldestDaysAgo >= 90,
    outOfRangeCount,
    datedCount
  };
}

(window as ResearchStatsWindow).FurimanagerResearchStats = {
  calcPeriodStats,
  getListingPeriodKey,
  summarizePeriodAnalysis
};

export {};
