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

function getFurimaneResearchListingPeriodKey(listing) {
  const daysAgo = getFurimaneResearchDaysAgo(listing.sold_at);

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

window.FurimanagerResearchStats = {
  calcPeriodStats: calcFurimaneResearchPeriodStats,
  getListingPeriodKey: getFurimaneResearchListingPeriodKey
};
