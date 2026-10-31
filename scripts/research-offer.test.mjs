import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const overlay = await readFile(new URL("../src/research-overlay.ts", import.meta.url), "utf8");
const overlayCss = await readFile(new URL("../src/research-overlay.css", import.meta.url), "utf8");
const webLink = await readFile(new URL("../../web/src/lib/research-checkout-link.ts", import.meta.url), "utf8");

test("使い切りの案内から開く web のリサーチ画面のクエリは、web 側の定数と同じ", () => {
  const key = webLink.match(/RESEARCH_CHECKOUT_QUERY_KEY = "([^"]+)"/)?.[1];
  const value = webLink.match(/RESEARCH_CHECKOUT_QUERY_VALUE = "([^"]+)"/)?.[1];
  assert.ok(key && value);
  assert.ok(overlay.includes(`const FURIMANE_RESEARCH_CHECKOUT_PATH = "/dashboard/research?${key}=${value}";`));
});

test("無料枠を使い切ったときだけ横長の案内を出し、「追加プランで使えます」の案内は出さない", () => {
  const limitBranch = overlay.slice(overlay.indexOf('} else if (kind === "limit") {'), overlay.indexOf("} else if (isRetryableResearchErrorKind(kind)"));
  assert.ok(limitBranch.includes("showResearchOffer(cachedResearchAccess?.value.trial ?? null);"));
  assert.ok(!overlay.includes("リサーチ追加プランでご利用いただけます"));
  assert.ok(!overlay.includes('kind === "plan" || kind === "limit"'));
});

test("体験をまだ使っていない人には何日間無料かを目立たせ、日数は web から受け取る", () => {
  assert.match(overlay, /lead: `無料体験（\$\{days\}日間）が使用できます。リサーチは\$\{days\}日間0円`/);
  assert.ok(overlay.includes('"furimane-offer__underline furimane-offer__trial-lead"'));
  assert.ok(overlayCss.includes(".furimane-offer__trial-lead"));
  assert.ok(overlayCss.includes("linear-gradient(90deg, #7c3aed 0%, #ec4899 55%, #f97316 100%)"));
});

test("案内の画像は拡張に入っていて、メルカリの画面から読める", async () => {
  for (const name of ["manifest.json", "manifest.dev.json"]) {
    const manifest = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
    for (const file of ["icons/research-offer/card-background-wide.webp", "icons/research-offer/phone-glow-wide.webp"]) {
      assert.ok(manifest.web_accessible_resources.some(item => item.resources.includes(file) && item.matches.includes("https://jp.mercari.com/*")), `${name} ${file}`);
      await readFile(new URL(`../${file}`, import.meta.url));
    }
  }
});
