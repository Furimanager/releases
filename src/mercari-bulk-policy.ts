// UIと実行側で同じ判定を使う。表示の「1日前」を時刻へ逆算しない。
(() => {
  const AGE_MS = (24 * 60 + 5) * 60_000;
  const ORIGIN = "https://jp.mercari.com";
  const PREFIX = "FURIMANE_BULK_PRICE_";
  const STATE_KEY = "furimane_bulk_price_state_v1";
  const LEDGER_KEY = "furimane_bulk_price_attempts_v1";

  function timestamp(value: unknown): number | null {
    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) value = Number(value);
    const result = typeof value === "number"
      ? (value < 1e12 ? value * 1000 : value)
      : typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(result) && result >= 1_000_000_000_000 ? result : null;
  }

  function item(payload: any, expectedId: string) {
    const source = payload?.data ?? payload;
    if (!source || String(source.id ?? source.item_id ?? "") !== expectedId || !/^m\d+$/.test(expectedId)) {
      throw new Error("商品の識別情報が一致しません。再確認してください。");
    }
    const created = timestamp(source.created ?? source.created_at ?? source.createdAt);
    const updated = timestamp(source.updated ?? source.updated_at ?? source.updatedAt);
    const seller = String(source.seller?.id ?? source.seller_id ?? "");
    const rawPrice = source.price;
    const price = typeof rawPrice === "number" || (typeof rawPrice === "string" && /^\d+$/.test(rawPrice))
      ? Number(rawPrice) : NaN;
    const auction = Boolean(source.auction || source.auction_info || source.auctionInfo || source.is_auction || source.isAuction)
      || (source.item_type != null && !["normal", "fixed_price"].includes(source.item_type));
    return {
      id: expectedId, title: String(source.name ?? source.title ?? expectedId).slice(0, 200),
      seller, price, created, updated, auction, status: source.status,
    };
  }

  function reason(value: any, seller: string, at: number, attemptedAt = 0): string | null {
    if (!/^\d+$/.test(seller) || value.seller !== seller) return "出品者を確認できない";
    if (value.status !== "on_sale") return "販売中ではない";
    if (value.auction) return "オークション形式";
    if (!Number.isSafeInteger(value.price) || value.price < 400 || value.price > 9_999_999) return "400円未満・価格不明";
    if (!Number.isFinite(at) || value.created === null || value.updated === null || value.updated < value.created) return "日時を確認できない";
    if (!Number.isFinite(attemptedAt) || attemptedAt < 0) return "前回の実行記録を確認できない";
    if (at - Math.max(value.created, value.updated, attemptedAt) < AGE_MS) return "更新から24時間未満";
    return null;
  }

  function unchanged(before: any, after: any): boolean {
    return ["id", "seller", "price", "created", "updated", "auction", "status"].every(key => before[key] === after[key]);
  }

  function listingsPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.origin === ORIGIN && /^\/mypage\/listings\/?$/.test(parsed.pathname);
    } catch { return false; }
  }

  function nextPage(payload: any, rows: any[]): string | null {
    const meta = payload?.meta ?? {};
    const value = payload?.has_next ?? payload?.hasNext ?? meta.has_next ?? meta.hasNext;
    const hasNext = [true, 1, "1", "true"].includes(value) ? true
      : [false, 0, "0", "false"].includes(value) ? false : null;
    if (hasNext === false || (hasNext === null && rows.length < 30)) return null;
    const cursor = meta.next_pager_id ?? meta.pager_id ?? payload?.next_pager_id
      ?? payload?.pager_id ?? rows.at(-1)?.pager_id;
    if (cursor === undefined || cursor === null || String(cursor) === "") {
      throw new Error("一覧の最後まで取得できませんでした。価格は変更していません。");
    }
    return String(cursor);
  }

  (globalThis as any).FurimaneBulkPolicy = {
    AGE_MS, ORIGIN, PREFIX, STATE_KEY, LEDGER_KEY,
    timestamp, item, reason, unchanged, listingsPage, nextPage,
  };
})();
