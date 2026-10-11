import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// ビルド済みの入力本体を実行する。起動処理だけを関数公開へ置換し、
// DOMと画像通信を制御して「待っている間に画面が変わる」を再現する。
const code = await readFile(new URL("../src/yahoo-fleamarket.js", import.meta.url), "utf8");
const startup = 'void (async () => {\n      if (!await cross?.receive("yahoo", fillCrossListing)) await fillRelist();\n      scan();\n    })();';
assert.equal(code.split(startup).length, 2, "本体の起動箇所が変わったらテストも確認する");
const instrumented = code.replace(startup,
  "globalThis.reviewFunctions = { createFormGuard, fillImages, fillPicker, pickerMatches, fillHashtags, fillRelist, errorMessage };");
const origin = "https://paypayfleamarket-sec.yahoo.co.jp";
const imageUrl = "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/test.jpg";

function fixture() {
  let time = 0;
  const listeners = new Map();
  const state = { imageCount: 0, dropped: 0, requests: 0, pickerClicks: 0, closed: 0 };
  const form = {
    isConnected: true,
    contains: target => target === form || target === price,
    querySelector: () => state.imageCount ? {} : null,
    querySelectorAll: () => Array.from({ length: state.imageCount }, () => ({})),
    addEventListener: (name, callback) => addListener(name, callback),
    removeEventListener: (name, callback) => removeListener(name, callback),
  };
  const price = { value: "1000", closest: () => form };
  function addListener(name, callback) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
  }
  function removeListener(name, callback) { listeners.get(name)?.delete(callback); }
  const document = {
    head: { append() {} }, body: { append(element) { state.status = element; } },
    createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() {} }),
    getElementById: () => state.status ?? null,
    querySelector: selector => selector.startsWith('#addimg') ? (state.modalOpen ? album : null) : document.currentForm,
    currentForm: form,
    addEventListener: addListener,
    removeEventListener: removeListener,
  };
  const album = {
    contains: target => target === album,
    dispatchEvent() {
      state.dropped++;
      state.imageCount = state.uploadedCount ?? 1;
      state.modalOpen = false;
    },
  };
  const dropTarget = { click() { state.modalOpen = true; } };
  const dom = {
    ORIGIN: "https://paypayfleamarket.yahoo.co.jp", SELL_ORIGIN: origin,
    exactButton: () => dropTarget,
    unique: () => state.modalOpen ? album : null,
    fieldSection: () => state.section ?? null,
    text: value => (value ?? "").replace(/\s+/g, " ").trim(),
  };
  const context = vm.createContext({
    URL, Error, console, innerHeight: 1000, innerWidth: 1000,
    Date: { now: () => time },
    setTimeout(callback, delay) { time += delay; state.onTimer?.(time); queueMicrotask(callback); },
    setInterval() {},
    location: { origin, pathname: "/item/add", search: "", href: origin + "/item/add", hash: "" },
    document, FurimanagerYahooDom: dom,
    chrome: {
      storage: { local: {} },
      runtime: {
        async sendMessage() {
          state.requests++;
          await state.onRequest?.(state.requests);
          if (state.failRequest === state.requests) return { success: false };
          return { success: true, dataUrl: "data:image/jpeg;base64,AA==" };
        },
      },
    },
    MutationObserver: class { observe() {} },
    DataTransfer: class { constructor() { this.items = { add() {} }; } },
    File: class {}, Event: class {}, KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    fetch: async () => ({ blob: async () => ({ type: "image/jpeg" }) }),
  });
  vm.runInContext(instrumented, context);
  const trusted = (name, isTrusted = true) => {
    for (const callback of listeners.get(name) ?? []) {
      callback({ type: name, isTrusted, target: price, composedPath: () => [price, form, document] });
    }
  };
  return { context, state, form, price, document, dom, trusted, listeners,
    album, ...context.reviewFunctions };
}

test("同じ接続済みフォームは継続し、プログラム入力では中断しない", () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  assert.doesNotThrow(guard.check);
  f.trusted("input", false);
  assert.doesNotThrow(guard.check);
  guard.dispose();
  assert.equal([...f.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0), 0);
});

for (const kind of ["URL変更", "フォーム切断", "フォーム置換"]) {
  test(`${kind}を検知したら元フォームへの書き込みを止める`, () => {
    const f = fixture();
    const guard = f.createFormGuard(f.form);
    if (kind === "URL変更") f.context.location.href += "?draft=another";
    if (kind === "フォーム切断") f.form.isConnected = false;
    if (kind === "フォーム置換") f.document.currentForm = { isConnected: true };
    assert.throws(guard.check);
    guard.dispose();
  });
}

for (const event of ["input", "change", "click", "drop"]) {
  test(`利用者の${event}で自動入力を中断する`, () => {
    const f = fixture();
    const guard = f.createFormGuard(f.form);
    f.trusted(event);
    assert.throws(guard.check);
    guard.dispose();
  });
}

test("自動radio操作中のtrustedイベントは許可し、終了後の本人操作は中断する", () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  guard.write(() => { f.trusted("input"); f.trusted("change"); });
  assert.doesNotThrow(guard.check);
  f.trusted("input");
  assert.throws(guard.check);
  guard.dispose();
});

test("自動操作が例外になっても本人操作の検知を再開する", () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  assert.throws(() => guard.write(() => { throw new Error("radio failure"); }), /radio failure/);
  f.trusted("change");
  assert.throws(guard.check);
  guard.dispose();
});

test("自動操作の同期部分を過ぎたイベントは検知する", async () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  guard.write(() => { queueMicrotask(() => f.trusted("input")); });
  assert.doesNotThrow(guard.check);
  await Promise.resolve();
  assert.throws(guard.check);
  guard.dispose();
});

test("画像取得中にURLが変わったらアップロードしない", async () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  f.state.onRequest = () => { f.context.location.href += "?draft=another"; };
  await assert.rejects(f.fillImages(f.form, [imageUrl], guard.check));
  assert.equal(f.state.dropped, 0);
  guard.dispose();
});

test("画像取得中に画像が追加されたら重ねてアップロードしない", async () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  f.state.onRequest = () => { f.state.imageCount = 1; };
  let result;
  try { result = await f.fillImages(f.form, [imageUrl], guard.check); }
  catch { result = false; }
  assert.equal(result, false);
  assert.equal(f.state.dropped, 0);
  assert.equal(f.state.imageCount, 1);
  guard.dispose();
});

test("画像取得中の手動価格変更を保持し、その後の処理を中断する", async () => {
  const f = fixture();
  const guard = f.createFormGuard(f.form);
  f.state.onRequest = () => { f.price.value = "700"; f.trusted("input"); };
  await assert.rejects(f.fillImages(f.form, [imageUrl], guard.check));
  assert.equal(f.price.value, "700");
  assert.equal(f.state.dropped, 0);
  guard.dispose();
});

test("画像取得が途中で失敗したら一部だけを送信しない", async () => {
  const f = fixture();
  f.state.failRequest = 2;
  await assert.rejects(f.fillImages(f.form, [imageUrl, imageUrl + "?2"]), /画像2枚目の取得に失敗/);
  assert.equal(f.state.requests, 2);
  assert.equal(f.state.dropped, 0);
});

test("画像の一部しかアップロード完了していなければ成功扱いにしない", async () => {
  const f = fixture();
  f.state.uploadedCount = 1;
  assert.equal(await f.fillImages(f.form, [imageUrl, imageUrl + "?2"]), false);
  assert.equal(f.state.dropped, 1);
});

test("全画像のアップロード完了は成功になる", async () => {
  const f = fixture();
  f.state.uploadedCount = 2;
  const guard = f.createFormGuard(f.form);
  assert.equal(await f.fillImages(f.form, [imageUrl, imageUrl + "?2"], guard.check), true);
  assert.equal(f.state.dropped, 1);
  guard.dispose();
});

test("カテゴリ選択中の画面変更は未反映扱いにせず、全体へ中断を返す", async () => {
  const f = fixture();
  const closeButton = { click() { f.state.closed++; } };
  const closeImage = {
    getBoundingClientRect: () => ({ width: 20, height: 20, top: 0, bottom: 20, left: 0, right: 20 }),
    closest: () => closeButton,
  };
  const choice = {
    textContent: "ファッション", querySelector: () => null, scrollIntoView() {},
    click() { f.state.pickerClicks++; f.context.location.href += "?draft=another"; },
  };
  const panel = { querySelectorAll: () => [choice], querySelector: () => closeImage };
  closeButton.parentElement = { parentElement: panel };
  const control = { textContent: "ファッション", querySelector: () => ({ click() {} }) };
  f.state.section = { children: [{}, control], querySelectorAll: () => [closeImage] };
  const guard = f.createFormGuard(f.form);
  await assert.rejects(f.fillPicker(f.form, "カテゴリ", ["ファッション"], guard.check));
  assert.equal(f.state.pickerClicks, 1);
  assert.equal(f.state.closed, 0, "別画面の閉じるボタンも押さない");
  guard.dispose();
});

test("カテゴリの表示要素が差し替わっても新しい選択結果で確認する", async () => {
  const f = fixture();
  const closeButton = { click() {} };
  const closeImage = {
    getBoundingClientRect: () => ({ width: 20, height: 20, top: 0, bottom: 20, left: 0, right: 20 }),
    closest: () => closeButton,
  };
  const choice = {
    textContent: "スポーツ", querySelector: () => null, scrollIntoView() {},
    click() { f.state.section.children[1] = { textContent: "スポーツ" }; },
  };
  const panel = { querySelectorAll: () => [choice], querySelector: () => closeImage };
  closeButton.parentElement = { parentElement: panel };
  f.state.section = { children: [{}, { textContent: "選択してください", querySelector: () => ({ click() {} }) }], querySelectorAll: () => [closeImage] };
  assert.equal(await f.fillPicker(f.form, "カテゴリ", ["スポーツ"]), true);
});

test("本人が開いた画像ダイアログにはファイルを渡さない", async () => {
  const f = fixture();
  f.state.modalOpen = true;
  await assert.rejects(f.fillImages(f.form, [imageUrl]), /既に開いている/);
  assert.equal(f.state.dropped, 0);
});

test("カテゴリは階層全体で照合し、部分一致の別カテゴリを成功扱いにしない", () => {
  const f = fixture();
  f.state.section = { children: [{}, { textContent: "スポーツ > スポーツアクセサリー >スポーツネックレス" }] };
  assert.equal(f.pickerMatches(f.form, "カテゴリ", ["スポーツ", "スポーツアクセサリー", "スポーツネックレス"]), true);
  assert.equal(f.pickerMatches(f.form, "カテゴリ", ["スポーツ", "アクセサリー", "ネックレス"]), false);
  assert.equal(f.pickerMatches(f.form, "カテゴリ", ["スポーツ"]), false);
});

test("商品状態の非表示候補と説明を選択値に混ぜない", () => {
  const f = fixture();
  const display = { textContent: "傷や汚れあり" };
  const control = { textContent: "傷や汚れあり商品の状態未使用未使用に近い傷や汚れありひとめでわかる大きな傷や汚れがある", querySelector: () => display };
  f.state.section = { children: [{}, control] };
  assert.equal(f.pickerMatches(f.form, "商品の状態", ["傷や汚れあり"]), true);
  // 期待値が隠れた候補にはあっても、実際の選択が違えば失敗にする。
  display.textContent = "未使用";
  assert.equal(f.pickerMatches(f.form, "商品の状態", ["傷や汚れあり"]), false);
});

test("商品状態の選択表示が欠けていたら成功扱いにしない", () => {
  const f = fixture();
  f.state.section = { children: [{}, { textContent: "傷や汚れあり", querySelector: () => null }] };
  assert.equal(f.pickerMatches(f.form, "商品の状態", ["傷や汚れあり"]), false);
});

test("カテゴリ表示の遅延確定を待ってから判定する", async () => {
  const f = fixture();
  const closeButton = { click() {} };
  const closeImage = {
    getBoundingClientRect: () => ({ width: 20, height: 20, top: 0, bottom: 20, left: 0, right: 20 }),
    closest: () => closeButton,
  };
  const choice = { textContent: "スポーツ", querySelector: () => null, scrollIntoView() {}, click() { f.state.pickerClicks++; } };
  const panel = { querySelectorAll: () => [choice], querySelector: () => closeImage };
  closeButton.parentElement = { parentElement: panel };
  f.state.section = { children: [{}, { textContent: "選択してください", querySelector: () => ({ click() {} }) }], querySelectorAll: () => [closeImage] };
  f.state.onTimer = time => { if (time >= 650) f.state.section.children[1] = { textContent: "スポーツ" }; };
  assert.equal(await f.fillPicker(f.form, "カテゴリ", ["スポーツ"]), true);
  assert.equal(f.state.pickerClicks, 1);
});

test("form外の画像選択画面での手動操作も自動入力を中断する", () => {
  const f = fixture();
  f.state.modalOpen = true;
  const guard = f.createFormGuard(f.form);
  for (const callback of f.listeners.get("click")) callback({ isTrusted: true, target: f.album });
  assert.throws(guard.check, /手動操作/);
  guard.dispose();
});

function hashtagFixture(tags = ["#スポーツネックレス"]) {
  const f = fixture();
  f.state.tags = [...tags];
  f.state.tagWrites = [];
  const field = {
    value: "", maxLength: 20, isConnected: true,
    focus() {}, blur() {},
    dispatchEvent(event) {
      assert.equal(event.key, "Enter");
      f.state.tags.push("#" + field.value);
      field.value = "";
    },
  };
  f.dom.unique = () => field;
  f.dom.setValue = (_field, value) => { field.value = value; f.state.tagWrites.push(value); };
  f.form.querySelectorAll = () => f.state.tags.map(tag => ({ textContent: tag, parentElement: { querySelector: () => ({}) } }));
  return { ...f, field };
}

test("既存タグを重ねず任意タグを確定し、似た候補ではなく元の文字を保持する", async () => {
  const f = hashtagFixture();
  assert.equal(await f.fillHashtags(f.form, ["#スポーツネックレス", "#喜平", "#喜平"]), true);
  assert.deepEqual(f.state.tags, ["#スポーツネックレス", "#喜平"]);
  assert.deepEqual(f.state.tagWrites, ["喜平"]);
});

test("入力途中のハッシュタグを上書きしない", async () => {
  const f = hashtagFixture();
  f.field.value = "入力途中";
  assert.equal(await f.fillHashtags(f.form, ["#スポーツネックレス", "#喜平"]), false);
  assert.equal(f.field.value, "入力途中");
  assert.equal(f.state.tagWrites.length, 0);
});

test("タグ確定前の本人操作を検知したらEnterを送らない", async () => {
  const f = hashtagFixture();
  const guard = f.createFormGuard(f.form);
  f.state.onTimer = () => f.trusted("input");
  await assert.rejects(f.fillHashtags(f.form, ["#スポーツネックレス", "#喜平"], guard.check, guard.write), /手動操作/);
  assert.deepEqual(f.state.tags, ["#スポーツネックレス"]);
  guard.dispose();
});

test("元商品と異なる余分なタグがある場合は一致と案内しない", async () => {
  const f = hashtagFixture(["#余分"]);
  assert.equal(await f.fillHashtags(f.form, []), false);
  assert.deepEqual(f.state.tags, ["#余分"]);
});

function relistFixture() {
  const f = fixture();
  const token = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const item = {
    itemId: "z12345", itemUrl: "https://paypayfleamarket.yahoo.co.jp/item/z12345",
    title: "検証商品", description: "検証説明", price: 1000,
    imageUrls: [imageUrl], categoryPath: [], rows: {}, hashtags: [],
  };
  f.state.title = { value: "" };
  f.state.description = { value: "" };
  f.state.writes = [];
  f.state.removals = 0;
  f.price.value = "";
  f.context.location.hash = "#furimanager-yahoo=" + token;
  f.context.location.href += f.context.location.hash;
  f.context.history = {
    state: null,
    replaceState(_state, _title, url) {
      f.context.location.href = origin + url;
      f.context.location.hash = "";
    },
  };
  f.context.chrome.storage.local = {
    async get(key) {
      await f.state.onGet?.();
      return { [key]: { savedAt: 0, mode: "relist", item } };
    },
    async remove() {
      f.state.removals++;
      if (f.state.removals === 1) await f.state.onRemove?.();
    },
  };
  f.dom.itemId = () => "z12345";
  f.dom.imageUrl = value => value;
  const imageUnique = f.dom.unique;
  f.dom.unique = (_form, selector) => {
    if (selector.startsWith('#addimg')) return imageUnique();
    if (f.state.fieldsPending) return null;
    if (selector.startsWith("input[placeholder=")) return f.state.title;
    return selector === "textarea" ? f.state.description : null;
  };
  f.dom.priceField = () => f.state.fieldsPending ? null : f.price;
  f.dom.price = value => Number(value);
  f.dom.setValue = (field, value) => { f.state.writes.push(value); field.value = value; };
  f.dom.setPriceValue = (field, value) => { f.dom.setValue(field, value); f.trusted("change"); };
  f.dom.selectText = () => false;
  return { ...f, item };
}

test("引継ぎデータの読込中にURLが変わったら入力を始めない", async () => {
  const f = relistFixture();
  f.state.onGet = () => { f.context.location.href += "?another"; };
  await f.fillRelist();
  assert.equal(f.state.writes.length, 0);
  assert.match(f.state.status.textContent, /画面が切り替わった/);
});

test("引継ぎデータの消費待ち中の手動入力を上書きしない", async () => {
  const f = relistFixture();
  f.state.onRemove = () => { f.state.title.value = "本人の入力"; f.trusted("input"); };
  await f.fillRelist();
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.title.value, "本人の入力");
  assert.match(f.state.status.textContent, /手動操作/);
  assert.equal([...f.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0), 0);
});

test("引継ぎデータの消費待ち中のフォーム置換で入力を中断する", async () => {
  const f = relistFixture();
  f.state.onRemove = () => { f.document.currentForm = { isConnected: true }; };
  await f.fillRelist();
  assert.equal(f.state.writes.length, 0);
  assert.match(f.state.status.textContent, /画面が切り替わった/);
});

test("引継ぎデータの消費待ち中の別スクリプト入力も上書きしない", async () => {
  const f = relistFixture();
  f.state.onRemove = () => { f.state.title.value = "別スクリプトの入力"; };
  await f.fillRelist();
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.title.value, "別スクリプトの入力");
  assert.match(f.state.status.textContent, /上書きせず/);
});

test("フォームの外枠だけが先に表示されても入力欄が揃うまで待つ", async () => {
  const f = relistFixture();
  f.state.fieldsPending = true;
  f.state.onTimer = time => { if (time >= 450) f.state.fieldsPending = false; };
  await f.fillRelist();
  assert.equal(f.state.title.value, "検証商品");
  assert.equal(f.state.description.value, "検証説明");
  assert.equal(f.price.value, "1000");
  assert.equal(f.state.dropped, 1);
  assert.match(f.state.status.textContent, /入力できた項目を反映/);
});

test("再出品全体でも配送radioのtrustedイベントで誤停止しない", async () => {
  const f = relistFixture();
  f.item.rows["配送の方法"] = "おてがる配送（日本郵便）";
  const originalUnique = f.dom.unique;
  const shipping = {
    checked: false,
    click() { shipping.checked = true; f.trusted("input"); f.trusted("change"); },
  };
  f.dom.unique = (form, selector) => selector.includes('name="JAPAN_POST"') ? shipping : originalUnique(form, selector);
  await f.fillRelist();
  assert.equal(shipping.checked, true);
  assert.equal(f.price.value, "1000");
  assert.equal(f.state.dropped, 1);
  assert.doesNotMatch(f.state.status.textContent, /手動操作を確認/);
});

for (const kind of ["URL変更", "フォーム置換"]) {
  test(`フォーム探索のPromise完了直前の${kind}でも入力を止める`, async () => {
    const f = relistFixture();
    const originalPriceField = f.dom.priceField;
    let scheduled = false;
    f.dom.priceField = () => {
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          if (kind === "URL変更") f.context.location.href += "?another";
          else f.document.currentForm = { isConnected: true };
        });
      }
      return originalPriceField();
    };
    await f.fillRelist();
    assert.equal(f.state.writes.length, 0);
    assert.match(f.state.status.textContent, /画面が切り替わった/);
  });
}

test("拡張再読み込みエラーは商品ページ再読み込みの日本語案内に変わる", async () => {
  const f = relistFixture();
  f.state.onGet = () => { throw new Error("Extension context invalidated."); };
  await f.fillRelist();
  assert.equal(f.state.writes.length, 0);
  assert.match(f.state.status.textContent, /拡張機能が再読み込みされました/);
  assert.match(f.state.status.textContent, /商品ページを再読み込み/);
  assert.doesNotMatch(f.state.status.textContent, /Extension context/);
});
