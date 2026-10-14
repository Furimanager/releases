import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// 売れた自分の商品だけに在庫連携を出すための判定材料（メルカリの本人ID・Yahooの出品者用取引リンク）。
const backgroundCode = await readFile(new URL("../background.js", import.meta.url), "utf8");
const domCode = await readFile(new URL("../src/yahoo-fleamarket-dom.js", import.meta.url), "utf8");
const domContext = vm.createContext({ URL });
vm.runInContext(domCode, domContext);
const dom = domContext.FurimanagerYahooDom;

function background(reply) {
  let listener;
  const requests = [];
  const context = vm.createContext({
    URL, AbortSignal, Response, console: { log() {}, warn() {}, error() {} },
    importScripts() {},
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return reply(); },
    chrome: {
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: { get(keys, callback) { callback({}); } } },
      tabs: { create(options, callback) { callback({ id: 1 }); }, get(id, callback) { callback({ url: "https://jp.mercari.com/" }); } },
    },
  });
  vm.runInContext(backgroundCode, context);
  const send = message => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("message did not respond")), 1000);
    const url = "https://jp.mercari.com/item/m12345678901";
    listener(message, { url, tab: { id: 1, url } }, value => { clearTimeout(timeout); resolve(value); });
  });
  return { send, requests };
}

test("メルカリの本人IDはトークンの持ち主のプロフィールから数字だけを返す", async () => {
  const bg = background(() => Response.json({ result: "OK", data: { id: 929204030, name: "出品者" } }));
  const response = await bg.send({ type: "FETCH_MERCARI_OWN_USER_ID", accessToken: "token-value" });
  assert.equal(response.success, true);
  assert.equal(response.userId, "929204030");
  assert.equal(response.data, undefined, "プロフィール全体は返さない");
  assert.equal(bg.requests.length, 1);
  const url = new URL(bg.requests[0].url);
  assert.equal(url.origin + url.pathname, "https://api.mercari.jp/users/get_profile");
  assert.equal(url.searchParams.get("id"), null, "ID指定なしで本人を引く");
  assert.equal(bg.requests[0].options.headers.authorization, "token-value");
  assert.equal(bg.requests[0].options.credentials, "omit");
});

test("メルカリの本人IDはログインしていない・取得失敗・数字以外なら返さない", async () => {
  const noToken = background(() => Response.json({ data: { id: 1 } }));
  assert.equal((await noToken.send({ type: "FETCH_MERCARI_OWN_USER_ID", accessToken: "  " })).success, false);
  assert.equal(noToken.requests.length, 0, "トークンが無ければ問い合わせない");
  const rejected = background(() => new Response("", { status: 401 }));
  assert.equal((await rejected.send({ type: "FETCH_MERCARI_OWN_USER_ID", accessToken: "token-value" })).success, false);
  for (const payload of [{ data: { id: "abc" } }, { data: {} }, { result: "error" }]) {
    const invalid = background(() => Response.json(payload));
    assert.equal((await invalid.send({ type: "FETCH_MERCARI_OWN_USER_ID", accessToken: "token-value" })).success, false);
  }
});

function link(href, visible = true) {
  return { href, getClientRects: () => (visible ? [{}] : []) };
}

function root(...links) {
  return { querySelectorAll: () => links };
}

test("Yahooの売れた自分の商品は、表示中の出品者用取引リンクで見分ける", () => {
  const seller = link("https://paypayfleamarket-sec.yahoo.co.jp/item/z682135684/trade/seller");
  assert.equal(dom.sellerTradeLink(root(seller), "z682135684"), seller);
  // PC用（表示）とスマホ用（非表示）が同居するので、表示中の方を返す。
  const hidden = link("https://paypayfleamarket-sec.yahoo.co.jp/item/z682135684/trade/seller", false);
  assert.equal(dom.sellerTradeLink(root(hidden, seller), "z682135684"), seller);
  assert.equal(dom.sellerTradeLink(root(hidden), "z682135684"), null);
});

test("Yahooの購入した商品・別商品・別サイトの取引リンクは自分の売れた商品と見なさない", () => {
  for (const href of [
    "https://paypayfleamarket-sec.yahoo.co.jp/item/z682135684/trade/buyer",
    "https://paypayfleamarket-sec.yahoo.co.jp/item/z999999999/trade/seller",
    "https://paypayfleamarket.yahoo.co.jp/item/z682135684/trade/seller",
    "https://evil.example/item/z682135684/trade/seller",
    "https://paypayfleamarket-sec.yahoo.co.jp/item/z682135684/trade/seller/extra",
  ]) assert.equal(dom.sellerTradeLink(root(link(href)), "z682135684"), null, href);
});
