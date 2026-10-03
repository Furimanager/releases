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
  let enteredRunning = false;
  const listeners = [];
  const removed = [];
  const updated = [];
  const storage = structuredClone(options.storage ?? {});
  const items = new Map((options.items ?? [makeItem()]).map(item => [item.id, structuredClone(item)]));
  const tabs = new Map([[1, { id: 1, url: `${ORIGIN}/mypage/listings`, status: "complete" }]]);
  const log = { reads: [], saves: [], creates: [], opens: [], prepares: [], authorizations: [], pauses: [], states: [] };
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
        await options.beforeDetail?.(items.get(id), log);
        payload = { data: structuredClone(items.get(id)) };
      }
      return { ok: true, headers: { get: () => options.noServerTime ? null : new Date(NOW).toUTCString() }, json: async () => payload };
    },
    chrome: {
      storage: { local: {
        get: async keys => Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])])),
        set: async value => {
          if (options.storageFails || options.failWrite?.(value)) throw new Error("storage failed");
          Object.assign(storage, structuredClone(value));
          if (value[STATE]) log.states.push(value[STATE].status);
          if (value[STATE]?.status === "running" && !enteredRunning) {
            enteredRunning = true;
            await options.onRunning?.({ items, send, state: value[STATE], tabs });
          }
        },
      } },
      runtime: { onMessage: { addListener: listener => listeners.push(listener) } },
      tabs: {
        get: async id => { if (!tabs.has(id)) throw new Error("tab closed"); return tabs.get(id); },
        create: async data => { const tab = { id: tabs.size + 10, status: "complete", ...data }; tabs.set(tab.id, tab); log.creates.push({ ...tab }); return tab; },
        remove: async id => { tabs.delete(id); removed.forEach(listener => listener(id)); },
        onRemoved: { addListener: listener => removed.push(listener) },
        onUpdated: { addListener: listener => updated.push(listener) },
        sendMessage: async (tabId, message) => {
          if (message.type.endsWith("ITEM_READY") || message.type === "FURIMANE_PRICE_ADJUST_READY") return { ready: true };
          if (message.type.endsWith("ITEM_OPEN_EDIT")) {
            assert.equal(tabs.get(tabId).url, `${ORIGIN}/item/${message.itemId}`);
            log.opens.push(message.itemId);
            tabs.get(tabId).url = `${ORIGIN}/sell/edit/${message.itemId}`;
            return { opened: true };
          }
          if (message.type === "APPLY_FURIMANE_PRICE_DROP_ON_EDIT") {
            log.prepares.push(message);
            assert.equal(message.delta, -100);
            assert.equal(message.minimumPrice, 300);
            if (options.prepareFails) return { success: false, reason: "既存の入力処理で停止" };
            return { success: true, currentPrice: message.expectedPrice, nextPrice: message.expectedPrice - 100 };
          }
          if (message.type.endsWith("EDITOR_READY")) return { ready: true };
          await options.beforeApply?.({ send, message, tabs, updated });
          const authority = await send("AUTHORIZE", { itemId: message.itemId, jobId: message.jobId }, { frameId: 0, tab: { id: tabId }, url: options.staleEditorSender ? `${ORIGIN}/item/${message.itemId}` : tabs.get(tabId).url });
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

  const end = await f.settle(["done", "error", "stopped"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.completed, 2);
  assert.equal(end.candidates.length, 2);
  assert.ok(!f.log.states.includes("ready"), "確認待ちを挟まずSTARTだけで完了する");
  assert.deepEqual(f.log.saves.map(value => value.price), [900, 900]);
  assert.deepEqual(f.log.creates.map(value => value.url), [`${ORIGIN}/item/m123`, `${ORIGIN}/item/m456`]);
  assert.deepEqual(f.log.opens, ["m123", "m456"]);
  assert.deepEqual(f.log.prepares.map(value => value.itemId), ["m123", "m456"]);
  assert.ok(f.log.saves[1].elapsed - f.log.saves[0].elapsed >= 15_000);
  assert.equal(f.tabs.size, 1, "専用タブのみ閉じる");
  assert.equal(JSON.stringify(f.storage).includes("test-secret-token"), false);
  assert.ok(f.log.reads.every(value => value.init.cache === "no-store" && value.init.method === "GET"));
  await f.send("START");
  const second = await f.settle(["done"]);
  assert.equal(second.candidates.length, 0, "同日再実行で値下げしない");
});

test("2つの開始が重なっても1回、取引中や他のタブから実行不可", async () => {
  const f = fixture();
  const replies = await Promise.all([f.send("START"), f.send("START")]);
  assert.equal(replies.filter(reply => reply.error).length, 1);
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(f.log.saves.length, 1);

  const other = await f.send("CANCEL", { jobId: replies.find(reply => !reply.error).state.id }, { frameId: 0, tab: { id: 2 }, url: `${ORIGIN}/mypage/listings` });
  assert.ok(other.error);
  f.tabs.get(1).url = `${ORIGIN}/mypage/listings/in_progress`;
  const trading = await f.send("START", {}, { frameId: 0, tab: { id: 1 }, url: `${ORIGIN}/mypage/listings/in_progress` });
  assert.ok(trading.error);
});

test("1クリックで24時間経過した商品だけ保存し、直近の商品は除外", async () => {
  const f = fixture({ items: [makeItem(), makeItem("m456", { updated: (NOW - 8 * 3600_000) / 1000 })] });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.completed, 1);
  assert.equal(end.skipped, 1);
  assert.deepEqual(f.log.saves.map(item => item.id), ["m123"]);
  assert.equal(f.items.get("m456").price, 1000);
});

test("対象0件は確認待ちにならず終了し、商品タブも保存操作も発生しない", async () => {
  for (const items of [[], [makeItem("m123", { updated: NOW / 1000 })]]) {
    const f = fixture({ items });
    await f.send("START");
    const end = await f.settle(["done", "error"]);
    assert.equal(end.status, "done", end.message);
    assert.equal(end.message, "今回の対象商品はありません。");
    assert.equal(end.candidates.length, 0);
    assert.equal(f.log.creates.length, 0);
    assert.equal(f.log.saves.length, 0);
  }
});

test("対象の取得途中で停止すると、すでに見つかった対象も値下げしない", async () => {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const f = fixture({ items: [makeItem(), makeItem("m456")], beforeDetail: async item => {
    if (item.id === "m456") { reached(); await gate; }
  } });
  const started = await f.send("START");
  await waiting;
  assert.equal((await f.send("STATUS")).state.candidates.length, 1);
  await f.send("CANCEL", { jobId: started.state.id });
  release();
  const end = await f.settle(["stopped", "error"]);
  assert.equal(end.status, "stopped");
  assert.equal(f.log.creates.length, 0);
  assert.equal(f.log.saves.length, 0);
});

test("対象を一部確認できても残りの取得失敗では保存を開始しない", async () => {
  const f = fixture({ items: [makeItem(), makeItem("m456")], failRead: url => url.searchParams.get("id") === "m456" });
  await f.send("START");
  const end = await f.settle(["error"]);
  assert.equal(end.candidates.length, 1);
  assert.equal(f.log.creates.length, 0);
  assert.equal(f.log.saves.length, 0);
});

test("確認から実行への切り替え時に停止・記録失敗なら保存を開始しない", async () => {
  for (const options of [
    { onRunning: ({ send, state }) => send("CANCEL", { jobId: state.id }) },
    { failWrite: value => value[STATE]?.status === "running" },
  ]) {
    const f = fixture(options);
    await f.send("START");
    await f.settle(["stopped", "error"]);
    assert.equal(f.log.creates.length, 0);
    assert.equal(f.log.saves.length, 0);
  }
});

test("入力失敗・保存未確認なら次の商品ページを開かない", async () => {
  for (const options of [{ prepareFails: true }, { ignoreSave: true }]) {
    const f = fixture({ ...options, items: [makeItem(), makeItem("m456")] });
    await f.send("START");
    const end = await f.settle(["error"]);
    assert.equal(end.completed, 0);
    assert.equal(f.log.creates.length, 1);
    assert.equal(f.log.prepares.length, 1);
    assert.equal(f.log.saves.length, 0);
  }
});

test("商品ページ由来のsender.urlでも現在の編集タブを確認して保存を許可", async () => {
  const f = fixture({ staleEditorSender: true });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(f.log.saves.length, 1);
});

test("サイト内移動でsender.urlが古くても現在の出品中タブから対象確認できる", async () => {
  const f = fixture();
  const sender = { frameId: 0, tab: { id: 1 }, url: `${ORIGIN}/item/m123`, origin: ORIGIN };
  assert.equal((await f.send("STATUS", {}, sender)).state?.status, "idle");
  const started = await f.send("START", {}, sender);
  assert.equal(started.error, undefined);
  assert.equal((await f.settle(["done"])).candidates.length, 1);
  assert.equal(f.log.saves.length, 1);
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
    const f = fixture({ onRunning: ({ items }) => Object.assign(items.get("m123"), change) });
    await f.send("START");

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
    await f.send("START");

    await f.settle(["stopped", "error"]);
    assert.equal(f.log.saves.length, 0);
  }
});

test("保存応答が失われても再送せず、取得した価格で結果を確認する", async () => {
  const f = fixture({ lostReply: true });
  await f.send("START");

  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done"); assert.equal(f.log.authorizations.length, 1); assert.equal(f.log.saves.length, 1);
});

test("保存結果不明は停止し、次回も記録により二重値下げを防ぐ", async () => {
  const f = fixture({ ignoreSave: true });
  await f.send("START");

  const end = await f.settle(["error"]);
  assert.equal(end.completed, 0); assert.equal(end.rows[0].status, "確認中");
  assert.equal(f.log.authorizations.length, 1);
  await f.send("START"); assert.equal((await f.settle(["done"])).candidates.length, 0);
});

test("サーバー時刻不明・取得失敗・ページング欠落では実行しない", async () => {
  for (const options of [{ noServerTime: true }, { failRead: () => true }, { pages: { first: { data: [makeItem()], meta: { has_next: true } } } }]) {
    const f = fixture(options); await f.send("START");
    await f.settle(["error"]); assert.equal(f.log.saves.length, 0); assert.equal(f.log.creates.length, 0);
  }
});

test("サービスワーカー再起動で処理を勝手に再開しない", async () => {
  for (const status of ["scanning", "ready", "running"]) {
    const f = fixture({ storage: { [STATE]: { id: "old", status, completed: 1, candidates: [], rows: [] }, [LEDGER]: { "123/m123": NOW } } });
    assert.equal((await f.send("STATUS")).state.status, "interrupted");
    assert.equal(f.log.reads.length, 0); assert.equal(f.log.creates.length, 0);
    assert.ok((await f.send("EXECUTE", { jobId: "old" })).error, "旧画面からの2段階目の実行も再開しない");
    await f.send("START"); assert.equal((await f.settle(["done"])).candidates.length, 0);
  }
});

test("保存記録を書けない場合に実行を開始しない", async () => {
  const f = fixture({ storageFails: true });
  assert.ok((await f.send("START")).error);
  assert.equal((await f.send("STATUS")).state.status, "error");
  assert.equal(f.log.saves.length, 0);
});

test("端末の時計が進んでいてもサーバー時刻で除外する", async () => {
  const f = fixture({ clockOffset: 3 * DAY, items: [makeItem("m123", { updated: (NOW - DAY) / 1000 })] });
  await f.send("START"); assert.equal((await f.settle(["done"])).candidates.length, 0);
});

test("最終確認時の記録失敗・更新競合では保存しない", async () => {
  for (const options of [
    { failWrite: value => Boolean(value[LEDGER]) },
    { beforeApply: () => { f.items.get("m123").updated = NOW / 1000; } },
  ]) {
    var f = fixture(options);
    await f.send("START");
    await f.settle(["error"]);
    assert.equal(f.log.saves.length, 0);
  }
});

// 実際の編集用スクリプトも実行し、DOM入力後の中断を検証する。
function editorFixture(options = {}) {
  let priceValue = options.price ?? "900";
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
      querySelectorAll: selector => selector.startsWith("input")
        ? (selector.includes('data-testid="price-text-input"') ? [price] : []) : [submit],
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
    { price: "1000" },
    { price: "800" },
    { duringWait: ({ location }) => { location.href = `${ORIGIN}/sell/edit/m999`; } },
    { duringWait: ({ handlers }) => { handlers.get("input").forEach(fn => fn({ isTrusted: true })); } },
    { duringAuthorize: ({ price }) => { price.value = "800"; } },
    { denied: true },
    { touchedBeforeApply: true },
  ]) {
    const f = editorFixture(options); assert.ok((await f.apply()).error); assert.equal(f.log.clicks, 0);
  }
});

// 個別−100円と共用する実関数を検証する（自動保存を個別操作へ広げない）。
const legacyCode = await readFile(new URL("../content-script-relist.js", import.meta.url), "utf8");
const legacyApplyCode = legacyCode.slice(legacyCode.indexOf("async function applyPriceDropOnEditPage("), legacyCode.indexOf("async function waitForPriceField("));
function legacyFixture() {
  const price = { value: "1000", getAttribute() { return this.value; } };
  const log = { input: 0, manual: 0 };
  const context = vm.createContext({
    console: { info() {} }, window: { location: { pathname: "/sell/edit/m123" } },
    getEditPageItemId: () => "m123", normalizePositiveInteger: (value, fallback) => value ?? fallback,
    normalizeNullableInteger: value => value ?? null, waitForPriceField: async () => price,
    parsePriceValue: Number, setFieldValue: (field, value) => { log.input++; field.value = value; },
    sleep: async () => {}, SAFE_CLICK_SETTLE_MS: 0, waitForEditSubmitButton: async () => ({}),
    getButtonLogDetails: () => ({}), sanitizeLogDetails: value => value, handOffManualConfirmation: () => log.manual++,
  });
  vm.runInContext(legacyApplyCode, context);
  return { price, log, apply: message => context.applyPriceDropOnEditPage(message) };
}
test("既存−100円関数を共用し、一括は900円入力後に戻り個別操作の手動確定は維持", async () => {
  const bulk = legacyFixture();
  const result = await bulk.apply({ delta: -100, minimumPrice: 300, itemId: "m123", expectedPrice: 1000, bulkJobId: "job" });
  assert.equal(result.nextPrice, 900); assert.equal(bulk.price.value, "900");
  assert.deepEqual(bulk.log, { input: 1, manual: 0 });
  const manual = legacyFixture(); await manual.apply({ delta: -100 });
  assert.equal(manual.price.value, "900"); assert.equal(manual.log.manual, 1);
});
test("共用入力は対象ID・元価格・差額が異なる一括依頼を受け付けない", async () => {
  for (const extra of [{ itemId: "m999" }, { expectedPrice: 900 }, { delta: 100 }]) {
    const f = legacyFixture();
    await assert.rejects(f.apply({ delta: -100, itemId: "m123", expectedPrice: 1000, bulkJobId: "job", ...extra }));
    assert.equal(f.log.input, 0);
  }
});

test("商品ページでは対象IDの実編集リンクへ1回だけ進み、別商品や欠落リンクでは進まない", async () => {
  function itemFixture(missing = false) {
    let listener;
    const navigation = [];
    const location = { href: `${ORIGIN}/item/m123`, pathname: "/item/m123", assign: url => navigation.push(url) };
    const link = { href: `${ORIGIN}/sell/edit/m123`, textContent: "商品の編集", getClientRects: () => [{}] };
    const context = vm.createContext({
      URL, Date, console, location, crypto: { randomUUID: () => "item-instance" },
      setTimeout() {}, setInterval() {}, MutationObserver: class { observe() {} },
      document: { addEventListener() {}, querySelectorAll: () => missing ? [] : [link] },
      chrome: { runtime: { id: "extension", sendMessage() {}, onMessage: { addListener: fn => { listener = fn; } } } },
    });
    vm.runInContext(policyCode, context); vm.runInContext(contentCode, context);
    return { navigation, send: (action, itemId = "m123") => new Promise(resolve => listener({ type: PREFIX + action, itemId }, { id: "extension" }, resolve)) };
  }
  const f = itemFixture();
  assert.equal((await f.send("ITEM_READY")).ready, true);
  assert.equal((await f.send("ITEM_OPEN_EDIT")).opened, true);
  assert.ok((await f.send("ITEM_OPEN_EDIT")).error);
  assert.deepEqual(f.navigation, [`${ORIGIN}/sell/edit/m123`]);
  for (const [fixture, id] of [[itemFixture(), "m999"], [itemFixture(true), "m123"]]) {
    assert.equal((await fixture.send("ITEM_READY", id)).ready, false);
    assert.ok((await fixture.send("ITEM_OPEN_EDIT", id)).error);
    assert.equal(fixture.navigation.length, 0);
  }
});
