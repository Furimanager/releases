type ResearchListingForStats = {
  price: number;
  sold_at: string | null;
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

declare global {
  interface Window {
    FurimanagerResearchStats?: {
      calcPeriodStats: (listings: ResearchListingForStats[]) => ResearchPeriodStats;
      getListingPeriodKey: (listing: ResearchListingForStats) => "period1" | "period2" | "period3" | null;
    };
  }
}

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

function getListingPeriodKey(listing: ResearchListingForStats) {
  const daysAgo = getDaysAgo(listing.sold_at);

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

window.FurimanagerResearchStats = {
  calcPeriodStats,
  getListingPeriodKey
};

export {};
