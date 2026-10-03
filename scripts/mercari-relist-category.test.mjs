import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// 実際に配布するJSを動かし、URLだけ先行する遷移・遅延・無反応を再現する。
const code = await readFile(new URL("../content-script-relist.js", import.meta.url), "utf8");
const startup = '    if (document.readyState === "loading") {';
assert.equal(code.split(startup).length, 2);
const instrumented = code.replace(startup, `
    globalThis.categoryTest = { handleCategorySelectionPage, fillCategoryFields, fillCategorySelects, categoryTextMatches, waitForFormAndFill };
    showToast = message => globalThis.result.messages.push(message);
    logRelistFlow = () => {};
    waitForFormAndFill = async () => { globalThis.result.continued++; };
    observeSellFormMutations = () => {};
    isInitialSellLandingPage = () => false;
    getFinalActionReadiness = () => ({ ready: false, reason: "not-ready", details: {} });
    fillAvailableFields = () => globalThis.result.fillFields();
${startup}`);
const categoryPath = ["ファッション", "メンズ", "パンツ", "その他"];
const ids = ["3088", "2", "32"];
const key = name => `furimanager_relist_category_${name}`;

function fixture(options = {}) {
  let time = 0;
  let level = options.startLevel ?? 0;
  const scheduled = [];
  const storage = new Map();
  const result = { clicks: [], messages: [], continued: 0, prematureDone: false };
  let selected = [];
  let heading = level ? categoryPath[level - 1] : "カテゴリー";
  let links = [];
  const window = {
    location: new URL("https://jp.mercari.com/sell/categories" + (level ? `?category_id=${ids[level - 1]}` : "")),
    setTimeout(callback, delay) {
      time += delay;
      for (let index = 0; index < scheduled.length;) {
        if (scheduled[index].at <= time) scheduled.splice(index, 1)[0].run();
        else index++;
      }
      queueMicrotask(callback);
    },
  };
  function schedule(delay, run) { scheduled.push({ at: time + delay, run }); }
  class Button {
    constructor(click) { this.click = click; }
  }
  class Anchor {
    constructor(text, href, nextLevel, inner = false) {
      this.textContent = text;
      this.href = new URL(href, window.location).href;
      this.nextLevel = nextLevel;
      this.isConnected = true;
      this.firstElementChild = null;
      this.button = inner ? new Button(() => this.navigate()) : null;
    }
    getBoundingClientRect() { return { width: 700, height: 60 }; }
    querySelector() { return this.button; }
    click() { if (!this.button) this.navigate(); }
    navigate() {
      result.clicks.push({ text: this.textContent, href: this.href });
      if (options.neverNavigate || (options.ignoreFirstClick && result.clicks.length === 1)) return;
      const delay = options.delay ?? 50;
      const nextLevel = this.nextLevel;
      schedule(delay, () => { window.location = new URL(this.href); });
      schedule(delay + (options.domDelay ?? 0), () => {
        if (nextLevel < categoryPath.length) {
          level = nextLevel;
          heading = level ? categoryPath[level - 1] : "カテゴリー";
          render();
        } else {
          links.forEach(link => { link.isConnected = false; });
          links = [];
          heading = "商品の出品";
          if (!options.wrongSelection) selected = [...categoryPath];
          else selected = ["ファッション", "メンズ", "パンツ", "スラックス"];
        }
      });
    }
  }
  function render() {
    links.forEach(link => { link.isConnected = false; });
    const leaf = level === categoryPath.length - 1;
    const text = categoryPath[level] + (options.selectedHint ? "このカテゴリーを選択しています" : "");
    links = [new Anchor(text, leaf ? "/sell/create" : `/sell/categories?category_id=${ids[level]}`, level + 1, leaf)];
    if (options.missingTarget && leaf) links = [];
    // 対象が見つからない場合に先頭の別カテゴリへ進まないことを検証。
    links.unshift(new Anchor("別のカテゴリー", "/sell/create", 4, true));
  }
  render();
  const entry = new Anchor("カテゴリーを選択する", "/sell/categories", 0);
  if (level) {
    storage.set(key("id_path"), JSON.stringify(ids.slice(0, level)));
    storage.set(key("step"), String(options.savedStep ?? level));
  }
  const document = {
    readyState: "loading", addEventListener() {},
    querySelector: selector => selector === "main h1" ? { textContent: heading } : null,
    querySelectorAll: selector => {
      if (selector.includes('main a[href*="/sell"]')) return links;
      if (selector.includes('sell-category')) return selected.map(textContent => ({ textContent }));
      if (selector.includes('a[href="/sell/categories"]')) return window.location.pathname === "/sell/create" ? [entry] : [];
      return [];
    },
  };
  const context = vm.createContext({
    window, document, result, URL, console,
    HTMLAnchorElement: Anchor, HTMLButtonElement: Button,
    Date: { now: () => time },
    sessionStorage: {
      getItem: name => storage.get(name) ?? null,
      removeItem: name => storage.delete(name),
      setItem(name, value) {
        if (name === key("done") && value === "true" && selected.join() !== categoryPath.join()) result.prematureDone = true;
        storage.set(name, value);
      },
    },
  });
  vm.runInContext(instrumented, context);
  result.fillFields = async () => {
    await new Promise(resolve => window.setTimeout(resolve, options.imageDelay ?? 0));
    await context.categoryTest.fillCategoryFields(categoryPath);
    return { filled: true, complete: false, filledCount: 4, targetCount: 5, missingFields: ["category"] };
  };
  return { ...context.categoryTest, result, storage, window, document,
    setSelection: value => { selected = value; },
    run: () => context.categoryTest.handleCategorySelectionPage({ categoryPath }),
    runFromForm: () => {
      window.location = new URL("https://jp.mercari.com/sell/create");
      return context.categoryTest.waitForFormAndFill({ categoryPath, mode: "relist", imageUrls: [] });
    },
  };
}

for (const options of [
  {},
  { delay: 2500, domDelay: 2200 },
  { selectedHint: true },
  { startLevel: 3, savedStep: 4, delay: 1800 },
  { ignoreFirstClick: true },
]) {
  test(`正しい最終カテゴリを選択して再開する ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await f.run();
    assert.equal(f.window.location.pathname, "/sell/create");
    assert.equal(f.result.continued, 1);
    assert.equal(f.result.prematureDone, false);
    assert.equal(f.storage.get(key("done")), "true");
    assert.deepEqual(f.result.messages, []);
    assert.ok(f.result.clicks.every(click => !click.text.includes("別の")));
  });
}

test("一致する候補が無ければ別の最終カテゴリへ進まず案内する", async () => {
  const f = fixture({ startLevel: 3, missingTarget: true });
  await f.run();
  assert.equal(f.result.clicks.length, 0);
  assert.equal(f.result.continued, 0);
  assert.notEqual(f.storage.get(key("done")), "true");
  assert.equal(f.result.messages.length, 1);
});

test("クリックが反応しなくても進捗を先送りせず、再試行は1回まで", async () => {
  const f = fixture({ neverNavigate: true });
  await f.run();
  assert.equal(f.result.clicks.length, 2);
  assert.equal(f.storage.get(key("step")), "0");
  assert.equal(f.result.messages.length, 1);
});

test("フォームへ戻ってもカテゴリーが違う場合は完了扱いにしない", async () => {
  const f = fixture({ startLevel: 3, wrongSelection: true });
  await f.run();
  assert.equal(f.result.continued, 0);
  assert.notEqual(f.storage.get(key("done")), "true");
  assert.equal(f.result.messages.length, 1);
});

test("記録のない別階層では同名の候補を勝手に選ばない", async () => {
  const f = fixture({ startLevel: 3 });
  f.storage.delete(key("id_path"));
  await f.run();
  assert.equal(f.result.clicks.length, 0);
  assert.equal(f.result.continued, 0);
});

test("フォームに同じ全階層が反映済みなら選び直さない", async () => {
  const f = fixture();
  f.setSelection(categoryPath);
  assert.equal(await f.fillCategoryFields(categoryPath), true);
  assert.equal(f.result.clicks.length, 0);
});

test("読み上げ補助文字だけを除き、その他と類似名を混同しない", () => {
  const f = fixture();
  assert.equal(f.categoryTextMatches("その他このカテゴリーを選択しています", "その他"), true);
  assert.equal(f.categoryTextMatches("その他のパンツ", "その他"), false);
});

test("実機で再現した画像20秒待ちの後も、遷移が遅いカテゴリー画面へ引き継ぐ", async () => {
  const f = fixture({ imageDelay: 20000, delay: 1800, domDelay: 600 });
  await f.runFromForm();
  assert.equal(f.window.location.pathname, "/sell/create");
  assert.equal(f.result.continued, 1);
  assert.equal(f.storage.get(key("done")), "true");
  assert.equal(f.result.prematureDone, false);
  assert.deepEqual(f.result.messages, []);
});
