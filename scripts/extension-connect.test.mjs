import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// 配布するJSそのものの交換処理を、外部へ送信せず検証する。
const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const start = source.indexOf("async function exchangeExtensionConnectToken(");
const end = source.indexOf("async function handleExtensionConnect(", start);
assert.ok(start > 0 && end > start);
const constants = source.match(/const EXTENSION_CONNECT_(?:NETWORK|RATE|EXPIRED)_ERROR = [^;]+;/g).join("\n");

function exchange(fetcher, timeout = false) {
  const context = vm.createContext({
    fetch: fetcher, AbortController, Error,
    setTimeout: (fn, ms) => setTimeout(fn, timeout ? 5 : ms), clearTimeout,
    getConfig: () => ({ url: "https://auth.example.invalid", anonKey: "test-public" })
  });
  return vm.runInContext(`${constants}\n${source.slice(start, end)}\nexchangeExtensionConnectToken`, context)("test-one-time");
}

test("障害・制限・本当の期限切れを別々に案内する", async () => {
  for (const [status, body, message] of [
    [503, {}, /接続できません/],
    [429, {}, /操作が続いています/],
    [403, { code: "otp_expired" }, /有効期限が切れました/],
    [400, { error_code: "otp_expired" }, /有効期限が切れました/],
    [400, {}, /確認できません/]
  ]) await assert.rejects(exchange(async () => Response.json(body, { status })), message);
});

test("ネットワーク切断は英語や期限切れ表示にしない", async () => {
  await assert.rejects(exchange(async () => { throw new TypeError("Failed to fetch"); }), /接続できません/);
});

test("遅延した交換処理を中止して、後からセッションを保存させない", async () => {
  let aborted = false;
  await assert.rejects(exchange((_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("Aborted")); });
  }), true), /接続できません/);
  assert.equal(aborted, true);
});

test("独立した完全なセッションだけ返し、トークンは本文で渡す", async () => {
  const session = { access_token: "test-access", refresh_token: "test-refresh", user: { id: "test-user" } };
  const result = await exchange(async (url, init) => {
    assert.equal(url, "https://auth.example.invalid/auth/v1/verify");
    assert.deepEqual(JSON.parse(init.body), { type: "magiclink", token_hash: "test-one-time" });
    return Response.json(session);
  });
  assert.deepEqual(result, session);
  await assert.rejects(exchange(async () => Response.json({ access_token: "test-access", user: { id: "test-user" } })), /接続できません/);
});
