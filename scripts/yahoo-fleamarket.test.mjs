import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const coreCode = await readFile(new URL("../src/yahoo-fleamarket-dom.js", import.meta.url), "utf8");
const backgroundCode = await readFile(new URL("../background.js", import.meta.url), "utf8");
const coreContext = vm.createContext({ URL });
vm.runInContext(coreCode, coreContext);
const dom = coreContext.FurimanagerYahooDom;
const cdn = "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/example.jpg";
const source = "https://paypayfleamarket.yahoo.co.jp/item/z12345";
const sell = "https://paypayfleamarket-sec.yahoo.co.jp/item/add";
const token = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const key = `furimanager_yahoo_relist_${token}`;

function background(storage = {}, currentUrl, contentType = "image/jpeg") {
  let listener;
  let senderUrl;
  const requests = [];
  const tabs = [];
  const context = vm.createContext({
    URL, AbortSignal, Response, Uint8Array, btoa, console: { log() {}, warn() {}, error() {} },
    importScripts() {},
    fetch: async (url, options) => { requests.push({ url, options }); return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": contentType } }); },
    chrome: {
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: { get(keys, callback) { callback(Object.fromEntries(keys.map(name => [name, storage[name]]))); } } },
      tabs: { create(options, callback) { tabs.push(options); callback({ id: 1 }); }, get(id, callback) { assert.equal(id, 1); callback({ url: currentUrl ?? senderUrl }); } },
    },
  });
  vm.runInContext(backgroundCode, context);
  const send = (message, url) => new Promise((resolve, reject) => {
    senderUrl = url;
    const timeout = setTimeout(() => reject(new Error("message did not respond")), 1000);
    listener(message, { url, tab: { id: 1, url } }, value => { clearTimeout(timeout); resolve(value); });
  });
  return { send, requests, tabs };
}

test("Yahooの商品IDだけを採用する", () => {
  assert.equal(dom.itemId(source), "z12345");
  assert.equal(dom.itemId(source + "/edit"), "z12345");
  for (const value of ["https://evil.example/item/z12345", "https://jp.mercari.com/item/m12345", source + "/other", source + "x"]) assert.equal(dom.itemId(value), null);
});
test("価格は整数円を厳密に読む", () => {
  assert.equal(dom.price("￥１２,３４５円"), 12345);
  for (const value of ["", "価格不明", "1000円 送料500円", "1000円1000円", "10,000円10,000円", "-100", "1.5", "1,00"]) assert.equal(dom.price(value), null);
});
test("±100円の端数・範囲外は丸めて変更しない", () => {
  assert.equal(dom.adjustedPrice(400, -100), 300);
  assert.equal(dom.adjustedPrice(1000, 100), 1100);
  for (const [current, delta] of [[300, -100], [350, -100], [9999999, 100], [1000.5, 100], [1000, 50]]) assert.equal(dom.adjustedPrice(current, delta), null);
});
test("商品画像CDN以外・認証付きURLは受け付けない", () => {
  assert.equal(dom.imageUrl(cdn), cdn);
  for (const value of ["http://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/a", "https://auctions.c.yimg.jp.evil.example/images.auctions.yahoo.co.jp/a", "https://u:p@auctions.c.yimg.jp/images.auctions.yahoo.co.jp/a", "https://auctions.c.yimg.jp/other/a"]) assert.equal(dom.imageUrl(value), null);
});
test("出品データと送信元の商品が一致すると専用タブを開く", async () => {
  const bg = background({ [key]: { item: { itemId: "z12345" }, mode: "relist", savedAt: Date.now() } });
  assert.equal((await bg.send({ type: "OPEN_YAHOO_RELIST", token }, source)).success, true);
  assert.equal(bg.tabs[0].url, sell + "#furimanager-yahoo=" + token);
});
test("別商品・他サイト・期限切れでは出品タブを開かない", async () => {
  for (const [url, itemId, age] of [[source, "z99999", 0], ["https://evil.example/item/z12345", "z12345", 0], [source, "z12345", 130000], [source + "/edit", "z12345", 0]]) {
    const bg = background({ [key]: { item: { itemId }, mode: "relist", savedAt: Date.now() - age } });
    assert.equal((await bg.send({ type: "OPEN_YAHOO_RELIST", token }, url)).success, false);
    assert.equal(bg.tabs.length, 0);
  }
});

test("SPAで編集から戻った場合はChromeの現在URLで再出品を照合する", async () => {
  const job = { [key]: { item: { itemId: "z12345" }, mode: "relist", savedAt: Date.now() } };
  const bg = background(job, source);
  assert.equal((await bg.send({ type: "OPEN_YAHOO_RELIST", token }, source + "/edit")).success, true);
  assert.equal(bg.tabs.length, 1);
  for (const current of [source + "/edit", source.replace("z12345", "z99999"), "https://evil.example/item/z12345"]) {
    const moved = background(job, current);
    assert.equal((await moved.send({ type: "OPEN_YAHOO_RELIST", token }, source)).success, false);
    assert.equal(moved.tabs.length, 0);
  }
});

test("価格の表示だけでなくフォーカスを外して保存用の値も確定する", () => {
  const events = [];
  class Input {
    get value() { return this.current; }
    set value(value) { this.current = value; }
    focus() { events.push("focus"); }
    dispatchEvent(event) { events.push(event.type); }
    blur() { this.saved = this.value; events.push("blur"); }
  }
  const context = vm.createContext({ URL, Event, HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLSelectElement: class {} });
  vm.runInContext(coreCode, context);
  const field = new Input(); field.value = "400";
  context.FurimanagerYahooDom.setPriceValue(field, "300");
  assert.equal(field.value, "300"); assert.equal(field.saved, "300");
  assert.deepEqual(events, ["focus", "input", "change", "blur"]);
});
test("Yahoo画像は出品フォームからだけ取得できる", async () => {
  const bg = background();
  assert.equal((await bg.send({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: cdn }, sell)).success, true);
  assert.equal(bg.requests[0].options.credentials, "omit");
  assert.equal(bg.requests[0].options.redirect, "error");
  assert.equal((await bg.send({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: cdn }, source)).success, false);
  assert.equal(bg.requests.length, 1);
});
test("メルカリの画像許可範囲は拡大しない", async () => {
  const bg = background();
  assert.equal((await bg.send({ type: "FETCH_IMAGE_AS_DATA_URL", url: cdn }, "https://jp.mercari.com/item/m12345")).success, false);
  assert.equal(bg.requests.length, 0);
  assert.equal((await bg.send({ type: "FETCH_IMAGE_AS_DATA_URL", url: "https://static.mercdn.net/item/detail/orig/a.jpg" }, "https://jp.mercari.com/item/m12345")).success, true);
});

test("実Yahooのimage/jpgをJPEGへ正規化し、不明な形式は許可しない", async () => {
  const bg = background({}, undefined, "image/jpg");
  const result = await bg.send({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: cdn }, sell);
  assert.equal(result.success, true);
  assert.equal(result.type, "image/jpeg");
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  for (const contentType of ["text/html", "image/svg+xml", "application/octet-stream"]) {
    const other = background({}, undefined, contentType);
    assert.equal((await other.send({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: cdn }, sell)).success, false);
  }
});
test("両manifestのYahooスクリプト順と画像権限が一致する", async () => {
  for (const name of ["manifest.json", "manifest.dev.json"]) {
    const manifest = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
    const entry = manifest.content_scripts.find(entry => entry.matches.includes("https://paypayfleamarket.yahoo.co.jp/*"));
    assert.deepEqual(entry.js, ["src/cross-listing.js", "src/yahoo-fleamarket-dom.js", "src/yahoo-fleamarket.js"]);
    assert.ok(manifest.host_permissions.includes("https://auctions.c.yimg.jp/*"));
  }
});


test("Yahoo在庫連携は商品ID・名前・画像を既存の連携画面へ渡す", async () => {
  const bg = background();
  const url = "https://paypayfleamarket.yahoo.co.jp/item/z123456789";
  const payload = { platform: "paypay_flea", yahooItemId: "z123456789", mercariItemId: "m999", listingTitle: "新品 黒　Tシャツ M", listingPrice: 300, listingStatus: "active", imageUrl: cdn };
  assert.equal((await bg.send({ type: "OPEN_INVENTORY_LINK", payload }, url)).success, true);
  const target = new URL(bg.tabs[0].url);
  assert.equal(target.pathname, "/dashboard/inventory/link");
  assert.equal(target.searchParams.get("platform"), "paypay_flea");
  assert.equal(target.searchParams.get("yahoo_item_id"), "z123456789");
  assert.equal(target.searchParams.get("mercari_item_id"), null);
  assert.equal(target.searchParams.get("listing_title"), payload.listingTitle);
  assert.equal(target.searchParams.get("image_url"), cdn);
  assert.equal(target.searchParams.get("listing_url"), url);
});
test("Yahoo在庫連携の別商品・別サイト・不正IDはタブを開かず、SPAの古いURLは現在URLで照合する", async () => {
  const url = "https://paypayfleamarket.yahoo.co.jp/item/z123456789";
  const payload = { platform: "paypay_flea", yahooItemId: "z123456789" };
  for (const source of [url.replace("z123456789", "z999999999"), "https://evil.example/item/z123456789", url + "/edit"]) {
    const bg = background(); assert.equal((await bg.send({ type: "OPEN_INVENTORY_LINK", payload }, source)).success, false); assert.equal(bg.tabs.length, 0);
  }
  const bg = background({}, url);
  assert.equal((await bg.send({ type: "OPEN_INVENTORY_LINK", payload }, url + "/edit")).success, true);
  const invalid = background();
  assert.equal((await invalid.send({ type: "OPEN_INVENTORY_LINK", payload: { ...payload, yahooItemId: "z12" } }, url)).success, false);
});
test("メルカリの在庫連携は従来のパラメーターを維持する", async () => {
  const bg = background();
  assert.equal((await bg.send({ type: "OPEN_INVENTORY_LINK", payload: { platform: "mercari", mercariItemId: "m12345678901", listingTitle: "商品", listingUrl: "https://jp.mercari.com/item/m12345678901" } }, "https://jp.mercari.com/item/m12345678901")).success, true);
  const target = new URL(bg.tabs[0].url); assert.equal(target.searchParams.get("mercari_item_id"), "m12345678901"); assert.equal(target.searchParams.get("yahoo_item_id"), null);
});
