(() => {
  (() => {
    const AGE_MS = (24 * 60 + 5) * 6e4;
    const ORIGIN = "https://jp.mercari.com";
    const PREFIX = "FURIMANE_BULK_PRICE_";
    const STATE_KEY = "furimane_bulk_price_state_v1";
    const LEDGER_KEY = "furimane_bulk_price_attempts_v1";
    function timestamp(value) {
      if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) value = Number(value);
      const result = typeof value === "number" ? value < 1e12 ? value * 1e3 : value : typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
      return Number.isFinite(result) && result >= 1e12 ? result : null;
    }
    function item(payload, expectedId) {
      const source = payload?.data ?? payload;
      if (!source || String(source.id ?? source.item_id ?? "") !== expectedId || !/^m\d+$/.test(expectedId)) {
        throw new Error("\u5546\u54C1\u306E\u8B58\u5225\u60C5\u5831\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002\u518D\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      }
      const created = timestamp(source.created ?? source.created_at ?? source.createdAt);
      const updated = timestamp(source.updated ?? source.updated_at ?? source.updatedAt);
      const seller = String(source.seller?.id ?? source.seller_id ?? "");
      const rawPrice = source.price;
      const price = typeof rawPrice === "number" || typeof rawPrice === "string" && /^\d+$/.test(rawPrice) ? Number(rawPrice) : NaN;
      const auction = Boolean(source.auction || source.auction_info || source.auctionInfo || source.is_auction || source.isAuction) || source.item_type != null && !["normal", "fixed_price"].includes(source.item_type);
      return {
        id: expectedId,
        title: String(source.name ?? source.title ?? expectedId).slice(0, 200),
        seller,
        price,
        created,
        updated,
        auction,
        status: source.status
      };
    }
    function reason(value, seller, at, attemptedAt = 0) {
      if (!/^\d+$/.test(seller) || value.seller !== seller) return "\u51FA\u54C1\u8005\u3092\u78BA\u8A8D\u3067\u304D\u306A\u3044";
      if (value.status !== "on_sale") return "\u8CA9\u58F2\u4E2D\u3067\u306F\u306A\u3044";
      if (value.auction) return "\u30AA\u30FC\u30AF\u30B7\u30E7\u30F3\u5F62\u5F0F";
      if (!Number.isSafeInteger(value.price) || value.price < 400 || value.price > 9999999) return "400\u5186\u672A\u6E80\u30FB\u4FA1\u683C\u4E0D\u660E";
      if (!Number.isFinite(at) || value.created === null || value.updated === null || value.updated < value.created) return "\u65E5\u6642\u3092\u78BA\u8A8D\u3067\u304D\u306A\u3044";
      if (!Number.isFinite(attemptedAt) || attemptedAt < 0) return "\u524D\u56DE\u306E\u5B9F\u884C\u8A18\u9332\u3092\u78BA\u8A8D\u3067\u304D\u306A\u3044";
      if (at - Math.max(value.created, value.updated, attemptedAt) < AGE_MS) return "\u66F4\u65B0\u304B\u308924\u6642\u9593\u672A\u6E80";
      return null;
    }
    function unchanged(before, after) {
      return ["id", "seller", "price", "created", "updated", "auction", "status"].every((key) => before[key] === after[key]);
    }
    function listingsPage(url) {
      try {
        const parsed = new URL(url);
        return parsed.origin === ORIGIN && /^\/mypage\/listings\/?$/.test(parsed.pathname);
      } catch {
        return false;
      }
    }
    function nextPage(payload, rows) {
      const meta = payload?.meta ?? {};
      const value = payload?.has_next ?? payload?.hasNext ?? meta.has_next ?? meta.hasNext;
      const hasNext = [true, 1, "1", "true"].includes(value) ? true : [false, 0, "0", "false"].includes(value) ? false : null;
      if (hasNext === false || hasNext === null && rows.length < 30) return null;
      const cursor = meta.next_pager_id ?? meta.pager_id ?? payload?.next_pager_id ?? payload?.pager_id ?? rows.at(-1)?.pager_id;
      if (cursor === void 0 || cursor === null || String(cursor) === "") {
        throw new Error("\u4E00\u89A7\u306E\u6700\u5F8C\u307E\u3067\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u4FA1\u683C\u306F\u5909\u66F4\u3057\u3066\u3044\u307E\u305B\u3093\u3002");
      }
      return String(cursor);
    }
    globalThis.FurimaneBulkPolicy = {
      AGE_MS,
      ORIGIN,
      PREFIX,
      STATE_KEY,
      LEDGER_KEY,
      timestamp,
      item,
      reason,
      unchanged,
      listingsPage,
      nextPage
    };
  })();
})();
