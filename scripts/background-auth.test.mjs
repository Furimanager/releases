import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// ポップアップ以外の更新処理も同じ保存先を使うため、配布JSで競合を検証する。
const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const start = source.indexOf("async function refreshSupabaseSession(");
const end = source.indexOf("async function persistAuthSession(", start);
assert.ok(start > 0 && end > start);

for (const action of ["connect", "logout"]) {
  test(`backgroundの古いrefresh成功は、その間の${action}を上書きしない`, async () => {
    let resolveResponse;
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    const response = new Promise(resolve => { resolveResponse = resolve; });
    let stored = {
      supabaseAccessToken: "old-access", supabaseRefreshToken: "old-refresh",
      supabaseUser: { id: "old" }, supabaseTokenExpiresAt: 1
    };
    const authState = { accessToken: "old-access", refreshToken: "old-refresh", user: { id: "old" }, tokenExpiresAt: 1 };
    let writes = 0;
    const context = vm.createContext({
      AUTH_STORAGE_KEYS: [], authState,
      getLocalStorage: async () => structuredClone(stored),
      getConfig: () => ({ url: "https://auth.example.invalid", anonKey: "test-public" }),
      shouldRefreshAuthToken: expiry => expiry < Date.now(),
      applyAuthStateFromStorage: data => {
        Object.assign(authState, { accessToken: data.supabaseAccessToken, refreshToken: data.supabaseRefreshToken, user: data.supabaseUser, tokenExpiresAt: data.supabaseTokenExpiresAt });
        return Boolean(authState.accessToken && authState.user);
      },
      fetch: () => { requestStarted(); return response; },
      persistAuthSession: async data => {
        writes++;
        stored = { supabaseAccessToken: data.access_token, supabaseRefreshToken: data.refresh_token, supabaseUser: data.user };
      }
    });
    const refresh = vm.runInContext(`${source.slice(start, end)}\nrefreshSupabaseSession`, context)();
    await started;
    stored = action === "logout" ? {} : {
      supabaseAccessToken: "new-access", supabaseRefreshToken: "new-refresh",
      supabaseUser: { id: "new" }, supabaseTokenExpiresAt: Date.now() + 3600000
    };
    resolveResponse(Response.json({ access_token: "old-renewed", refresh_token: "old-rotated", user: { id: "old" }, expires_in: 3600 }));
    assert.equal(await refresh, action === "connect");
    assert.equal(writes, 0);
    assert.equal(stored.supabaseUser?.id, action === "connect" ? "new" : undefined);
  });
}
