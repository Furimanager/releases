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

test("進捗10目盛りは処理件数で進み、現在の1個だけを点滅対象にする", () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({ id: `m${1000 + index}` }));
  for (const completed of [0, 9, 10, 19, 20, 50, 99]) {
    const result = P.progress({ status: "running", candidates, completed });
    assert.equal(result.lit, Math.floor(completed / 10));
    assert.equal(result.current, result.lit);
    assert.equal(result.percent, completed);
  }
  const done = P.progress({ status: "done", candidates, completed: 100 });
  assert.equal(done.lit, 10); assert.equal(done.current, -1); assert.equal(done.remainingMs, null);
  for (const status of ["stopped", "error", "interrupted"]) {
    const stopped = P.progress({ status, candidates, completed: 20 });
    assert.equal(stopped.lit, 2); assert.equal(stopped.current, -1); assert.equal(stopped.remainingMs, null);
  }
});

test("対象確認中と対象0件では進捗を100%にせず、途中除外だけ処理済みに含める", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ id: `m${1000 + index}` }));
  const scanning = P.progress({ status: "scanning", candidates, completed: 0, scanned: 100 });
  assert.equal(scanning.lit, 0); assert.equal(scanning.current, 0); assert.equal(scanning.remainingMs, null);
  const empty = P.progress({ status: "done", candidates: [], completed: 0, skipped: 100 });
  assert.equal(empty.lit, 0); assert.equal(empty.percent, 0);
  const result = P.progress({ status: "running", candidates, completed: 2, skipped: 90,
    rows: [{ id: "m1002", status: "除外" }, { id: "m1003", status: "確認中" }, { id: "m9999", status: "対象外" }] });
  assert.equal(result.processed, 3); assert.equal(result.lit, 3);
});

for (const total of [1, 3, 5]) test(`${total}件でも商品内の作業段階で進み、保存確認までは完了にならない`, () => {
  const candidates = Array.from({ length: total }, (_, index) => ({ id: `m${1000 + index}` }));
  const percents = [];
  for (let completed = 0; completed < total; completed++) {
    for (const workProgress of [0, 0.1, 0.2, 0.35, 0.45, 0.6, 0.7, 0.9]) {
      const state = { status: "running", candidates, completed, workProgress };
      const view = P.progress(state);
      assert.equal(view.processed, completed, "作業中の1件を完了件数に足さない");
      assert.ok(view.percent < 100); assert.ok(view.lit < 10);
      assert.equal(P.progress({ ...state, progressTiming: { currentWorkMs: 300_000 } }).percent, view.percent,
        "読み込みや保存確認が遅くても時間だけで進めない");
      percents.push(view.percent);
    }
  }
  assert.ok(percents.every((value, index) => index === 0 || value >= percents[index - 1]));
  assert.ok(new Set(percents).size > total + 1, "完了件数の段階より細かく進む");
  const done = P.progress({ status: "done", candidates, completed: total, workProgress: 0 });
  assert.equal(done.lit, 10); assert.equal(done.percent, 100); assert.equal(done.current, -1);
});

test("停止は作業中の位置で点滅を止め、待機・確認中・空データでは作業進捗を足さない", () => {
  const candidates = [{ id: "m123" }];
  for (const status of ["stopped", "error", "interrupted"]) {
    const view = P.progress({ status, candidates, completed: 0, workProgress: 0.7 });
    assert.equal(view.percent, 70); assert.equal(view.current, -1); assert.equal(view.processed, 0);
  }
  for (const phase of ["waiting", "break"]) {
    assert.equal(P.progress({ status: "running", candidates, workProgress: 0.9, progressTiming: { phase } }).percent, 0);
  }
  for (const workProgress of [NaN, Infinity, "0.9", -1]) {
    assert.equal(P.progress({ status: "running", candidates, workProgress }).percent, 0);
  }
  assert.equal(P.progress({ status: "running", candidates, workProgress: 1 }).percent, 90);
  assert.equal(P.progress({ status: "scanning", candidates, workProgress: 0.9 }).percent, 0);
});

test("残り時間は実測の作業時間と通常/20件休憩を合算し、最後の待機は足さない", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({ id: `m${1000 + index}` }));
  const state = { status: "running", candidates, completed: 19,
    progressTiming: { samples: 19, workMs: 19 * 4000, currentWorkMs: 1000, waitRemainingMs: 0 } };
  // 残り6件の作業24秒−進行中1秒、20件目後25秒＋通常待機4回20秒。
  assert.equal(P.progress(state).remainingMs, 68_000);
  const duringBreak = { ...state, completed: 20,
    progressTiming: { samples: 20, workMs: 80_000, currentWorkMs: 0, waitRemainingMs: 12_000 } };
  assert.equal(P.progress(duringBreak).remainingMs, 52_000);
  const final = { ...state, completed: 24 };
  assert.equal(P.progress(final).remainingMs, 3000);
  assert.ok(P.progress({ ...final, progressTiming: { ...final.progressTiming, currentWorkMs: 6000 } }).remainingMs > 0);
  assert.ok(P.progress({ ...state, progressTiming: { samples: 0 } }).remainingMs > 0);
  assert.equal(P.progress({ ...state, progressTiming: { ...state.progressTiming, currentWorkMs: 2000 } }).lit, 7,
    "時間が経っても四角は件数に同期する");
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
    Math: Object.assign(Object.create(Math), { random: () => options.random ?? 0.5 }),
    performance: { now: () => elapsed }, crypto: { randomUUID: () => `job-${++uuid}` },
    setTimeout(callback, ms) {
      log.pauses.push(ms); elapsed += ms;
      queueMicrotask(async () => { await options.onSleep?.({ send, log, ms }); callback(); });
    },
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
          await options.onWorkerMessage?.({ send, message });
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
  return { send, settle, log, storage, items, tabs, updated, getElapsed: () => elapsed };
}

test("実処理が商品読込・編集・入力・保存確認の段階を公開し、件数は保存確認後だけ増える", async () => {
  const stages = [];
  const capture = async send => {
    const { state } = await send("STATUS");
    if (state.status === "running") stages.push({ work: state.workProgress, completed: state.completed });
  };
  const f = fixture({ onWorkerMessage: ({ send }) => capture(send), onSleep: ({ send }) => capture(send) });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  for (const work of [0.2, 0.35, 0.45, 0.6, 0.7, 0.9]) {
    assert.ok(stages.some(value => value.work === work && value.completed === 0), `stage=${work}`);
  }
  assert.equal(end.status, "done"); assert.equal(end.completed, 1); assert.equal(end.workProgress, 0);
  assert.equal(f.log.saves.length, 1);
});

test("続きのページを全件取得し、重複IDは各1回だけ値下げ・商品間3〜7秒待機", async () => {
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
  const interval = f.log.saves[1].elapsed - f.log.saves[0].elapsed;
  assert.ok(interval >= 5000 && interval <= 9000, "保存確認の2秒＋3〜7秒待機");
  assert.equal(f.tabs.size, 1, "専用タブのみ閉じる");
  assert.equal(JSON.stringify(f.storage).includes("test-secret-token"), false);
  assert.ok(f.log.reads.every(value => value.init.cache === "no-store" && value.init.method === "GET"));
  await f.send("START");
  const second = await f.settle(["done"]);
  assert.equal(second.candidates.length, 0, "同日再実行で値下げしない");
});

// 実商品を変更せず、30件ずつの一覧と100商品の処理を再現する。
function hundredItems(options = {}) {
  const items = Array.from({ length: 100 }, (_, index) => makeItem(`m${1000 + index}`));
  const pages = {};
  for (let offset = 0; offset < items.length; offset += 30) {
    const next = offset + 30;
    pages[offset === 0 ? "first" : String(offset)] = {
      data: items.slice(offset, next),
      meta: { has_next: next < items.length, ...(next < items.length ? { next_pager_id: String(next) } : {}) },
    };
  }
  return fixture({ items, pages, ...options });
}

test("進捗用計測は実処理だけを平均し、待機残秒を別に返して完了後は終了する", async () => {
  let snapshot;
  const f = fixture({
    clockOffset: 3 * DAY,
    items: Array.from({ length: 5 }, (_, index) => makeItem(`m${1000 + index}`)),
    onSleep: async ({ send, log }) => {
      if (snapshot || log.saves.length !== 3) return;
      const reply = await send("STATUS");
      if (reply.state.progressTiming?.phase === "waiting") snapshot = reply.state;
    },
  });
  await f.send("START"); await f.settle(["done"]);
  assert.equal(snapshot.completed, 3);
  assert.equal(snapshot.progressTiming.samples, 3);
  assert.equal(snapshot.progressTiming.workMs, 6000, "2秒の保存確認×3件。商品間の5秒は含めない");
  assert.equal(snapshot.progressTiming.currentWorkMs, 0);
  assert.equal(snapshot.progressTiming.waitRemainingMs, 4500);
  assert.equal(P.progress(snapshot).remainingMs, 13_500);
  assert.equal((await f.send("STATUS")).state.progressTiming, null);
});

test("100件を4ページから取得し、専用タブ1枚で順番に各100円だけ値下げする", async () => {
  const f = hundredItems({ beforeApply: ({ tabs }) => assert.equal(tabs.size, 2, "一覧と専用タブ1枚だけ") });
  await f.send("START");
  const end = await f.settle(["done", "error", "stopped"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.scanned, 100);
  assert.equal(end.completed, 100);
  assert.equal(end.skipped, 0);
  assert.equal(end.rows.filter(row => row.status === "完了").length, 100);
  assert.deepEqual(f.log.reads.filter(read => read.path.endsWith("get_items")).map(read => read.cursor), [null, "30", "60", "90"]);
  assert.deepEqual(f.log.saves.map(save => save.id), [...f.items.keys()]);
  assert.ok(f.log.saves.every(save => save.price === 900));
  for (let index = 1; index < f.log.saves.length; index++) {
    const interval = f.log.saves[index].elapsed - f.log.saves[index - 1].elapsed;
    // 20/40/60/80件後だけ長く休む。保存確認の2秒は休憩とは別。
    assert.equal(interval, index % 20 === 0 ? 27_000 : 7000, `${index + 1}件目の間隔`);
  }
  assert.equal(f.getElapsed() - f.log.saves.at(-1).elapsed, 2000, "100件目の保存確認後は休憩せず完了");
  assert.equal(f.log.creates.length, 100);
  assert.equal(f.tabs.size, 1);
  await f.send("START");
  assert.equal((await f.settle(["done"])).candidates.length, 0);
  assert.equal(f.log.saves.length, 100, "再度押しても同じ100件を二重に値下げしない");
});

test("ランダム待機の下限と上限付近でも、通常3〜7秒・20件ごと20〜30秒", async () => {
  for (const random of [0, 0.999]) {
    const f = fixture({ random, items: Array.from({ length: 21 }, (_, index) => makeItem(`m${2000 + index}`)) });
    await f.send("START");
    const end = await f.settle(["done", "error"]);
    assert.equal(end.status, "done", end.message);
    const intervals = f.log.saves.slice(1).map((save, index) => save.elapsed - f.log.saves[index].elapsed - 2000);
    assert.ok(intervals.slice(0, 19).every(ms => ms >= 3000 && ms < 7000));
    assert.ok(intervals[19] >= 20_000 && intervals[19] < 30_000);
    assert.equal(f.getElapsed() - f.log.saves.at(-1).elapsed, 2000);
  }
});

test("ちょうど20件で完了するときは最後の長い休憩を入れない", async () => {
  const f = fixture({ items: Array.from({ length: 20 }, (_, index) => makeItem(`m${2000 + index}`)) });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.completed, 20);
  assert.equal(f.getElapsed() - f.log.saves.at(-1).elapsed, 2000);
});

test("途中で除外した商品は20件休憩の件数に含めない", async () => {
  const f = fixture({
    items: Array.from({ length: 26 }, (_, index) => makeItem(`m${2000 + index}`)),
    onRunning: ({ items }) => [...items.values()].slice(0, 5).forEach(item => { item.updated = NOW / 1000; }),
  });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.completed, 21);
  assert.equal(end.skipped, 5);
  const intervals = f.log.saves.slice(1).map((save, index) => save.elapsed - f.log.saves[index].elapsed);
  assert.ok(intervals.slice(0, 19).every(ms => ms === 7000));
  assert.equal(intervals[19], 27_000);
});

test("20件ごとの休憩中も停止を受け付け、21件目を開かない", async () => {
  let cancelled = false;
  const f = hundredItems({ onSleep: async ({ send, log, ms }) => {
    if (!cancelled && log.saves.length === 20 && ms === 500) {
      const { state } = await send("STATUS");
      assert.match(state.message, /20件完了。20〜30秒休憩/);
      cancelled = true;
      await send("CANCEL", { jobId: state.id });
    }
  } });
  await f.send("START");
  const end = await f.settle(["done", "error", "stopped"]);
  assert.equal(end.status, "stopped");
  assert.equal(end.completed, 20);
  assert.equal(f.log.saves.length, 20);
  assert.equal(f.log.creates.length, 20);
});

test("100件中の直近更新・停止中・下限価格は除外し、残り25件だけ値下げする", async () => {
  const f = hundredItems();
  [...f.items.values()].forEach((item, index) => {
    if (index < 25) item.updated = (NOW - 8 * 3600_000) / 1000;
    else if (index < 50) item.status = "stop";
    else if (index < 75) item.price = 300;
  });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "done", end.message);
  assert.equal(end.scanned, 100);
  assert.equal(end.completed, 25);
  assert.equal(end.skipped, 75);
  assert.deepEqual(f.log.saves.map(save => save.id), [...f.items.keys()].slice(75));
  assert.ok(f.log.saves.every(save => save.price === 900));
});

test("100件の途中で429なら50件で停止し、手動再実行は未実施の50件だけ処理する", async () => {
  const f = hundredItems({ failRead: (url, log) => log.saves.length === 50 && url.searchParams.get("id") === "m1050" });
  await f.send("START");
  const end = await f.settle(["done", "error"]);
  assert.equal(end.status, "error");
  assert.match(end.message, /429/);
  assert.equal(end.completed, 50);
  assert.equal(f.log.saves.length, 50);
  assert.equal(f.log.creates.length, 50, "制限応答後に次の商品画面を開かない");

  // 拡張再起動後、利用者がもう一度押すケース。保存済みの商品は記録で除外する。
  const resumed = hundredItems({ items: [...f.items.values()], storage: f.storage });
  await resumed.send("START");
  const second = await resumed.settle(["done", "error"]);
  assert.equal(second.status, "done", second.message);
  assert.equal(second.completed, 50);
  assert.equal(second.skipped, 50);
  assert.deepEqual(resumed.log.saves.map(save => save.id), [...f.items.keys()].slice(50));
  assert.ok([...resumed.items.values()].every(item => item.price === 900));
});

test("100件の途中で停止ボタンを押すと50件で止まり、残りを保存しない", async () => {
  const f = hundredItems({ beforeApply: async ({ send, message }) => {
    if (message.itemId === "m1050") await send("CANCEL", { jobId: message.jobId });
  } });
  await f.send("START");
  const end = await f.settle(["done", "error", "stopped"]);
  assert.equal(end.status, "stopped");
  assert.equal(end.completed, 50);
  assert.deepEqual(f.log.saves.map(save => save.id), [...f.items.keys()].slice(0, 50));
  assert.ok([...f.items.values()].slice(50).every(item => item.price === 1000));
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
