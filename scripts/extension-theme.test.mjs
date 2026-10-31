import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const themeCode = await readFile(new URL("../src/extension-theme.js", import.meta.url), "utf8");
const themeCss = await readFile(new URL("../src/extension-theme.css", import.meta.url), "utf8");
const STORAGE_KEY = "furimaneExtensionTheme";

function run({ protocol = "https:", saved } = {}) {
  const attributes = {};
  const listeners = [];
  const context = vm.createContext({
    location: { protocol },
    document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } },
    chrome: {
      runtime: {},
      storage: {
        local: { get: (key, callback) => callback(saved === undefined ? {} : { [key]: saved }) },
        onChanged: { addListener: listener => listeners.push(listener) }
      }
    }
  });
  vm.runInContext(themeCode, context);
  return { api: context.FurimaneExtensionTheme, attributes, listeners };
}

test("保存した色をメルカリの画面に付け、変更もすぐ反映する", () => {
  const page = run({ saved: "tora-blue" });
  assert.equal(page.attributes["data-furimane-theme"], "tora-blue");
  page.listeners[0]({ [STORAGE_KEY]: { newValue: "indigo" } }, "local");
  assert.equal(page.attributes["data-furimane-theme"], "indigo");
  page.listeners[0]({ other: { newValue: "pink" } }, "local");
  assert.equal(page.attributes["data-furimane-theme"], "indigo");
});

test("未設定・知らない値は紫にする", () => {
  assert.equal(run().attributes["data-furimane-theme"], "purple");
  assert.equal(run({ saved: "green" }).attributes["data-furimane-theme"], "purple");
});

test("ポップアップにも同じ色を付け、選択肢の一覧を共用する", async () => {
  const popup = run({ protocol: "chrome-extension:", saved: "pink" });
  assert.equal(popup.attributes["data-furimane-theme"], "pink");
  assert.equal(popup.api.STORAGE_KEY, STORAGE_KEY);
  assert.deepEqual(Array.from(popup.api.GROUPS, group => group.key), ["basic", "tora"]);
  // ポップアップは背景を変えず、ボタンと紫の文字だけテーマごとに定義する。
  const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
  for (const theme of popup.api.THEMES) {
    if (theme.key === popup.api.DEFAULT_THEME) continue;
    assert.ok(popupCss.includes(`:root[data-furimane-theme="${theme.key}"]`), `popup ${theme.key}`);
  }
  assert.equal(popupCss.split("#7c3aed 0%, #ec4899 55%, #f97316 100%").length - 1, 1, "紫のグラデは --theme-button の定義だけ");
});

test("選択肢の色はすべてCSSに定義があり、トラ柄の柄は拡張の中のSVGを使う", () => {
  const { api } = run({ protocol: "chrome-extension:" });
  for (const theme of api.THEMES) {
    if (theme.key === api.DEFAULT_THEME) continue;
    assert.ok(themeCss.includes(`:root[data-furimane-theme="${theme.key}"]`), theme.key);
  }
  for (const color of ["pink", "brown", "purple", "blue"]) {
    assert.ok(themeCss.includes(`chrome-extension://__MSG_@@extension_id__/icons/tora-rosettes.svg#${color}`), color);
  }
});

test("ボタンの色はパレットで上に重ねて開き、適用したときだけ保存する", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  // Windows で取り出すと改行が CRLF になるので、改行をそろえてから見る。
  const popupJs = (await readFile(new URL("../popup.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
  assert.match(html, /<section id="themePanel" class="panel theme-card"[^>]*hidden>/);
  assert.match(html, /id="themeToggleButton"[^>]*aria-expanded="false"[^>]*aria-controls="themePanel"/);
  assert.ok(html.indexOf('id="themeToggleButton"') < html.indexOf("</header>"), "パレットは一番上の欄の中");
  assert.match(html, /id="themeApplyButton"[^>]*>適用</);
  assert.match(popupCss, /\.theme-card \{[^}]*position: absolute;[^}]*z-index: 30;/);
  // 保存（＝メルカリ等のタブの色が変わる）は適用ボタンだけ。選ぶだけではポップアップに試しに当てるだけ。
  const handleSelect = popupJs.slice(popupJs.indexOf("function handleThemeSelect"), popupJs.indexOf("async function applyTheme"));
  assert.ok(!handleSelect.includes("setLocalStorage"), "選ぶだけでは保存しない");
  assert.match(popupJs.slice(popupJs.indexOf("async function applyTheme")), /setLocalStorage\(\{ \[extensionTheme\.STORAGE_KEY\]: currentThemeKey \}\)/);
  assert.match(popupJs, /function closeThemePanel\(\) \{\n {2}pendingThemeKey = currentThemeKey;\n {2}previewTheme\(currentThemeKey\);/);
});

test("トラ柄のボタンは Web の主ボタンと同じ柄の大きさ・位置・中央の膜", async () => {
  const webCss = await readFile(new URL("../../web/app/globals.css", import.meta.url), "utf8");
  assert.ok(webCss.includes("--tora-size: 112px 84px;") && webCss.includes("--tora-cover-center: 84%;"), "Web側の値が変わったら拡張も揃える");
  const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
  for (const css of [themeCss, popupCss]) {
    assert.ok(css.includes("right center / 112px 84px repeat"));
    assert.ok(css.includes("50%, var(--fm-tora-end)) 84%, transparent) 50%") || css.includes("50%, var(--theme-tora-end)) 84%, transparent) 50%"));
  }
});

test("コピー出品とYahoo!フリマのお知らせ枠もテーマ色で、暗い固定色を使わない", async () => {
  for (const name of ["cross-listing.ts", "yahoo-fleamarket.ts"]) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    assert.ok(source.includes("var(--fm-panel-line,"), name);
    assert.ok(!source.includes("#150c2b"), name);
  }
});

test("両manifestでメルカリ・Yahoo!フリマに色を読み込み、柄の画像を使える", async () => {
  for (const name of ["manifest.json", "manifest.dev.json"]) {
    const manifest = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
    const entry = manifest.content_scripts.find(item => item.js?.includes("src/extension-theme.js"));
    assert.deepEqual(entry.css, ["src/extension-theme.css"]);
    assert.equal(entry.run_at, "document_start");
    for (const match of ["https://jp.mercari.com/*", "https://paypayfleamarket.yahoo.co.jp/*"]) {
      assert.ok(entry.matches.includes(match), `${name} ${match}`);
      assert.ok(manifest.web_accessible_resources.some(item => item.resources.includes("icons/tora-rosettes.svg") && item.matches.includes(match)), `${name} svg ${match}`);
    }
  }
});
