import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { setImmediate } from "node:timers";

const policyCode = await readFile(new URL("../src/mercari-bulk-policy.js", import.meta.url), "utf8");
const workerCode = await readFile(new URL("../src/mercari-bulk-background.js", import.meta.url), "utf8");
const contentCode = await readFile(new URL("../src/mercari-bulk-price.js", import.meta.url), "utf8");
const PREFIX = "FURIMANE_BULK_PRICE_";
const STATE = "furimane_bulk_price_state_v1";
const LEDGER = "furimane_bulk_price_attempts_v1";
const ORIGIN = "https://jp.mercari.com";
const NOW = Date.parse("2026-09-27T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const policyContext = vm.createContext({ URL, Date, console });
vm.runInContext(policyCode, policyContext);
const P = policyContext.FurimaneBulkPolicy;
const makeItem = (id = "m123", extra = {}) => ({ id, name: "テスト商品", seller: { id: 123 }, status: "on_sale", price: 1000,
  created: (NOW - 3 * DAY) / 1000, updated: (NOW - 2 * DAY) / 1000, ...extra });

test("24時間ちょうど・5分の余裕・未来日時・欠損日時を厳密に判定する", () => {
  for (const [age, eligible] of [[DAY - 1, false], [DAY, false], [P.AGE_MS - 1, false], [P.AGE_MS, true], [P.AGE_MS + 1, true]]) {
    const value = P.item(makeItem("m123", { updated: NOW - age }), "m123");
    assert.equal(P.reason(value, "123", NOW) === null, eligible, `age=${age}`);
  }
  for (const updated of [undefined, null, 0, "1日前", "2026/09/25 12:00:00", NOW + DAY]) {
    assert.ok(P.reason(P.item(makeItem("m123", { updated }), "m123"), "123", NOW));
  }
  assert.equal(P.timestamp("2026-09-25T12:00:00+09:00"), Date.parse("2026-09-25T03:00:00Z"));
});

test("出品直後・売却/停止・他人・オークション・価格下限・実行記録を除外", () => {
  for (const extra of [{ created: NOW }, { status: "sold_out" }, { status: "stop" }, { seller: { id: 456 } },
    { auction_info: {} }, { price: 399 }, { price: 350 }, { price: 300 }, { price: "1,000" }, { price: 1000.5 }]) {
    assert.ok(P.reason(P.item(makeItem("m123", extra), "m123"), "123", NOW));
  }
  assert.equal(P.reason(P.item(makeItem("m123", { price: 400 }), "m123"), "123", NOW), null);
  assert.ok(P.reason(P.item(makeItem(), "m123"), "123", NOW, NOW - DAY));
  assert.ok(P.reason(P.item(makeItem(), "m123"), "123", NOW, "invalid"));
  assert.throws(() => P.item(makeItem(), "m999"));
});

test("対象ページの完全一致とページングの終端・欠落を確認", () => {
  assert.ok(P.listingsPage(`${ORIGIN}/mypage/listings`));
  for (const path of ["/mypage/listings/sold", "/mypage/listings/in_progress", "/item/m123"]) assert.equal(P.listingsPage(ORIGIN + path), false);
  assert.equal(P.listingsPage("https://example.com/mypage/listings"), false);
  assert.equal(P.nextPage({ meta: { has_next: false } }, Array(30).fill({})), null);
  assert.equal(P.nextPage({ meta: { has_next: true, next_pager_id: "cursor-2" } }, [{}]), "cursor-2");
  assert.throws(() => P.nextPage({ meta: { has_next: true } }, [{}]));
  assert.throws(() => P.nextPage({}, Array(30).fill({})));
});

function fixture(options = {}) {
  let elapsed = 0;
  let uuid = 0;
  const listeners = [];
  const removed = [];
  const updated = [];
  const storage = structuredClone(options.storage ?? {});
  const items = new Map((options.items ?? [makeItem()]).map(item => [item.id, structuredClone(item)]));
  const tabs = new Map([[1, { id: 1, url: `${ORIGIN}/mypage/listings`, status: "complete" }]]);
  const log = { reads: [], saves: [], creates: [], authorizations: [], pauses: [] };
  const owner = { frameId: 0, tab: { id: 1 }, url: `${ORIGIN}/mypage/listings` };
  let context;
  const send = (action, extra = {}, sender = owner) => new Promise(resolve => {
    const message = { type: PREFIX + action, instance: "page-1", accessToken: "test-secret-token", ...extra };
    if (!listeners.some(listener => listener(message, sender, resolve))) resolve(undefined);
  });
  context = vm.createContext({
    console, URL, AbortSignal, Date: class extends Date { static now() { return NOW + (options.clockOffset ?? 0); } },
    performance: { now: () => elapsed }, crypto: { randomUUID: () => `job-${++uuid}` },
    setTimeout(callback, ms) { log.pauses.push(ms); elapsed += ms; queueMicrotask(callback); },
    fetch: async (url, init) => {
      url = new URL(url);
      log.reads.push({ path: url.pathname, cursor: url.searchParams.get("max_pager_id"), init });
      if (options.failRead?.(url, log)) return { ok: false, status: 429 };
      let payload;
      if (url.pathname.endsWith("get_profile")) payload = { data: { id: options.seller ?? 123 } };
      else if (url.pathname.endsWith("get_items")) {
        payload = options.pages?.[url.searchParams.get("max_pager_id") ?? "first"]
          ?? { data: [...items.values()], meta: { has_next: false } };
      } else {
        const id = url.searchParams.get("id");
        options.beforeDetail?.(items.get(id), log);
        payload = { data: structuredClone(items.get(id)) };
      }
      return { ok: true, headers: { get: () => options.noServerTime ? null : new Date(NOW).toUTCString() }, json: async () => payload };
    },
    chrome: {
      storage: { local: {
        get: async keys => Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])])),
        set: async value => { if (options.storageFails || options.failWrite?.(value)) throw new Error("storage failed"); Object.assign(storage, structuredClone(value)); },
      } },
      runtime: { onMessage: { addListener: listener => listeners.push(listener) } },
      tabs: {
        get: async id => { if (!tabs.has(id)) throw new Error("tab closed"); return tabs.get(id); },
        create: async data => { const tab = { id: tabs.size + 10, status: "complete", ...data }; tabs.set(tab.id, tab); log.creates.push(tab); return tab; },
        remove: async id => { tabs.delete(id); removed.forEach(listener => listener(id)); },
        onRemoved: { addListener: listener => removed.push(listener) },
        onUpdated: { addListener: listener => updated.push(listener) },
        sendMessage: async (tabId, message) => {
          if (message.type.endsWith("EDITOR_READY")) return { ready: true };
          await options.beforeApply?.({ send, message, tabs, updated });
          const authority = await send("AUTHORIZE", { itemId: message.itemId, jobId: message.jobId }, { frameId: 0, tab: { id: tabId }, url: tabs.get(tabId).url });
          log.authorizations.push(authority);
          if (!authority.allowed) return { error: authority.error };
          assert.ok(storage[LEDGER]?.[`123/${message.itemId}`], "保存前に記録する");
          if (!options.ignoreSave) {
            const value = items.get(message.itemId);
            value.price = authority.nextPrice; value.updated = NOW / 1000;
            log.saves.push({ id: message.itemId, price: value.price, elapsed });
          }
          if (options.lostReply) throw new Error("message port closed");
          return { submitted: true };
        },
      },
    },
  });
  vm.runInContext(policyCode, context);
  vm.runInContext(workerCode, context);
  const settle = async status => {
    for (let i = 0; i < 2000; i++) {
      const response = await send("STATUS");
      if (status.includes(response?.state?.status)) return response.state;
      // 一覧を離れた後のSTATUSは拒否されるので、停止結果は永続記録で確認する。
      if (response?.error && status.includes(storage[STATE]?.status)) return structuredClone(storage[STATE]);
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error("state wait timeout");
  };
  return { send, settle, log, storage, items, tabs, updated };
}

test("続きのページを全件取得し、重複IDは各1回だけ値下げ・商品間15秒以上", async () => {
  const a = makeItem(), b = makeItem("m456");
  const f = fixture({ items: [a, b], pages: {
    first: { data: [a], meta: { has_next: true, next_pager_id: "two" } },
    two: { data: [a, b], meta: { has_next: false } },
  } });
  await f.send("START");
  const preview = await f.settle(["ready"]);
  assert.equal(preview.candidates.length, 2);
  assert.equal(f.log.saves.length, 0, "プレビューだけでは保存しない");
  await f.send("EXECUTE", { jobId: preview.id });
  const end = await f.settle(["done", "error", "stopped"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.completed, 2);
  assert.deepEqual(f.log.saves.map(value => value.price), [900, 900]);
  assert.ok(f.log.saves[1].elapsed - f.log.saves[0].elapsed >= 15_000);
  assert.equal(f.tabs.size, 1, "専用タブのみ閉じる");
  assert.equal(JSON.stringify(f.storage).includes("test-secret-token"), false);
  assert.ok(f.log.reads.every(value => value.init.cache === "no-store" && value.init.method === "GET"));
  await f.send("START");
  const second = await f.settle(["ready"]);
  assert.equal(second.candidates.length, 0, "同日再実行で値下げしない");
});

test("2つの開始が重なっても1回、取引中や他のタブから実行不可", async () => {
  const f = fixture();
  const replies = await Promise.all([f.send("START"), f.send("START")]);
  assert.equal(replies.filter(reply => reply.error).length, 1);
  const preview = await f.settle(["ready"]);
  const other = await f.send("EXECUTE", { jobId: preview.id }, { frameId: 0, tab: { id: 2 }, url: `${ORIGIN}/mypage/listings` });
  assert.ok(other.error);
  f.tabs.get(1).url = `${ORIGIN}/mypage/listings/in_progress`;
  const trading = await f.send("START", {}, { frameId: 0, tab: { id: 1 }, url: `${ORIGIN}/mypage/listings/in_progress` });
  assert.ok(trading.error);
});

test("サイト内移動でsender.urlが古くても現在の出品中タブから対象確認できる", async () => {
  const f = fixture();
  const sender = { frameId: 0, tab: { id: 1 }, url: `${ORIGIN}/item/m123`, origin: ORIGIN };
  assert.equal((await f.send("STATUS", {}, sender)).state?.status, "idle");
  const started = await f.send("START", {}, sender);
  assert.equal(started.error, undefined);
  assert.equal((await f.settle(["ready"])).candidates.length, 1);
  assert.equal(f.log.saves.length, 0);
});

test("古い送信元・偽のpageUrlで取引中や遷移中のタブを許可しない", async () => {
  for (const url of [`${ORIGIN}/mypage/listings/in_progress`, `${ORIGIN}/mypage/listings/sold`, "https://example.com/"]) {
    const f = fixture(); f.tabs.get(1).url = url;
    assert.ok((await f.send("START", { pageUrl: `${ORIGIN}/mypage/listings` })).error);
    assert.equal(f.log.reads.length, 0);
  }
  const pending = fixture(); pending.tabs.get(1).pendingUrl = `${ORIGIN}/item/m123`;
  assert.ok((await pending.send("START")).error);
  const foreign = fixture();
  for (const sender of [
    { frameId: 1, tab: { id: 1 }, url: `${ORIGIN}/mypage/listings`, origin: ORIGIN },
    { frameId: 0, tab: { id: 1 }, url: "https://example.com/", origin: "https://example.com" },
    { frameId: 0, url: `${ORIGIN}/mypage/listings`, origin: ORIGIN },
  ]) assert.ok((await foreign.send("START", {}, sender)).error);
  assert.equal(foreign.log.reads.length, 0);
});

test("確認後に価格や日時が変わった商品を除外", async () => {
  for (const change of [{ price: 1100 }, { updated: NOW / 1000 }, { status: "sold_out" }]) {
    const f = fixture(); await f.send("START");
    const preview = await f.settle(["ready"]);
    Object.assign(f.items.get("m123"), change);
    await f.send("EXECUTE", { jobId: preview.id });
    const end = await f.settle(["done", "error"]);
    assert.equal(end.completed, 0); assert.equal(end.rows[0].status, "除外"); assert.equal(f.log.saves.length, 0);
  }
});

test("保存直前のキャンセル・一覧の移動を反映する", async () => {
  for (const navigate of [false, true]) {
    const f = fixture({ beforeApply: async ({ send, message, tabs, updated }) => {
      if (navigate) { tabs.get(1).url = `${ORIGIN}/mypage/listings/sold`; updated.forEach(listener => listener(1, { url: tabs.get(1).url })); }
      else await send("CANCEL", { jobId: message.jobId });
    } });
    await f.send("START"); const preview = await f.settle(["ready"]);
    await f.send("EXECUTE", { jobId: preview.id });
    await f.settle(["stopped", "error"]);
    assert.equal(f.log.saves.length, 0);
  }
});

test("保存応答が失われても再送せず、取得した価格で結果を確認する", async () => {
  const f = fixture({ lostReply: true });
  await f.send("START"); const preview = await f.settle(["ready"]);
  await f.send("EXECUTE", { jobId: preview.id });
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done"); assert.equal(f.log.authorizations.length, 1); assert.equal(f.log.saves.length, 1);
});

test("保存結果不明は停止し、次回も記録により二重値下げを防ぐ", async () => {
  const f = fixture({ ignoreSave: true });
  await f.send("START"); const preview = await f.settle(["ready"]);
  await f.send("EXECUTE", { jobId: preview.id });
  const end = await f.settle(["error"]);
  assert.equal(end.completed, 0); assert.equal(end.rows[0].status, "確認中");
  assert.equal(f.log.authorizations.length, 1);
  await f.send("START"); assert.equal((await f.settle(["ready"])).candidates.length, 0);
});

test("サーバー時刻不明・取得失敗・ページング欠落では実行しない", async () => {
  for (const options of [{ noServerTime: true }, { failRead: () => true }, { pages: { first: { data: [makeItem()], meta: { has_next: true } } } }]) {
    const f = fixture(options); await f.send("START");
    await f.settle(["error"]); assert.equal(f.log.saves.length, 0); assert.equal(f.log.creates.length, 0);
  }
});

test("サービスワーカー再起動で処理を勝手に再開しない", async () => {
  const f = fixture({ storage: { [STATE]: { id: "old", status: "running", completed: 1, candidates: [], rows: [] }, [LEDGER]: { "123/m123": NOW } } });
  assert.equal((await f.send("STATUS")).state.status, "interrupted");
  assert.equal(f.log.reads.length, 0); assert.equal(f.log.creates.length, 0);
  await f.send("START"); assert.equal((await f.settle(["ready"])).candidates.length, 0);
});

test("保存記録を書けない場合に実行を開始しない", async () => {
  const f = fixture({ storageFails: true });
  assert.ok((await f.send("START")).error);
  assert.equal((await f.send("STATUS")).state.status, "error");
  assert.equal(f.log.saves.length, 0);
});

test("端末の時計が進んでいてもサーバー時刻で除外する", async () => {
  const f = fixture({ clockOffset: 3 * DAY, items: [makeItem("m123", { updated: (NOW - DAY) / 1000 })] });
  await f.send("START"); assert.equal((await f.settle(["ready"])).candidates.length, 0);
});

test("最終確認時の記録失敗・更新競合では保存しない", async () => {
  for (const options of [
    { failWrite: value => Boolean(value[LEDGER]) },
    { beforeApply: () => { f.items.get("m123").updated = NOW / 1000; } },
  ]) {
    var f = fixture(options);
    await f.send("START"); const preview = await f.settle(["ready"]);
    await f.send("EXECUTE", { jobId: preview.id }); await f.settle(["error"]);
    assert.equal(f.log.saves.length, 0);
  }
});

// 実際の編集用スクリプトも実行し、DOM入力後の中断を検証する。
function editorFixture(options = {}) {
  let priceValue = "1000";
  const log = { clicks: 0, authorize: 0 };
  const handlers = new Map();
  class Input {
    get value() { return priceValue; }
    set value(value) { priceValue = value; }
    isConnected = true;
    dispatchEvent(event) { for (const handler of handlers.get(event.type) ?? []) handler(event); }
  }
  const price = new Input();
  const submit = { textContent: "変更する", disabled: false, click() { log.clicks++; } };
  let listener;
  const location = { href: `${ORIGIN}/sell/edit/m123`, pathname: "/sell/edit/m123" };
  const context = vm.createContext({
    URL, console, Date, performance, location, HTMLInputElement: Input, Event,
    localStorage: { getItem: () => JSON.stringify({ accessToken: "token" }) },
    crypto: { randomUUID: () => "instance" }, setInterval() {},
    setTimeout(callback) { options.duringWait?.({ location, price, handlers }); queueMicrotask(callback); },
    MutationObserver: class { observe(target) { assert.equal(target, context.document, "document_startではhtml生成前でも監視できるDocumentを使う"); } },
    document: {
      documentElement: null,
      querySelectorAll: selector => selector.startsWith("input") ? [price] : [submit],
      addEventListener: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
      removeEventListener: (name, fn) => handlers.set(name, handlers.get(name).filter(item => item !== fn)),
    },
    chrome: { runtime: {
      id: "extension", onMessage: { addListener: fn => { listener = fn; } },
      async sendMessage() { log.authorize++; options.duringAuthorize?.({ price, location, submit }); return options.denied ? { error: "停止済み" } : { allowed: true, nextPrice: 900 }; },
    } },
  });
  vm.runInContext(policyCode, context); vm.runInContext(contentCode, context);
  if (options.touchedBeforeApply) handlers.get("input").forEach(fn => fn({ isTrusted: true }));
  return { log, apply: () => new Promise(resolve => listener({ type: PREFIX + "EDITOR_APPLY", jobId: "job", itemId: "m123", price: 1000 }, { id: "extension" }, resolve)) };
}

test("編集フォームを正確に100円下げて1回だけ保存", async () => {
  const f = editorFixture(); assert.equal((await f.apply()).submitted, true); assert.equal(f.log.clicks, 1);
  assert.ok((await f.apply()).error); assert.equal(f.log.clicks, 1);
});

test("編集画面の移動・手動操作・最終価格不一致・停止時は保存しない", async () => {
  for (const options of [
    { duringWait: ({ location }) => { location.href = `${ORIGIN}/sell/edit/m999`; } },
    { duringWait: ({ handlers }) => { handlers.get("input").forEach(fn => fn({ isTrusted: true })); } },
    { duringAuthorize: ({ price }) => { price.value = "800"; } },
    { denied: true },
    { touchedBeforeApply: true },
  ]) {
    const f = editorFixture(options); assert.ok((await f.apply()).error); assert.equal(f.log.clicks, 0);
  }
});
