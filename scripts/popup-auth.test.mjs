import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// 実際に配布するpopup.jsを実行し、Chromeの保存領域と遅い認証通信だけを差し替える。
const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const startup = "void initializePopup();";
assert.equal(source.split(startup).length, 2);

function session(name = "old", partial = false) {
  return {
    supabaseAccessToken: partial ? null : `${name}-access`,
    supabaseRefreshToken: `${name}-refresh`,
    supabaseUser: partial ? null : { id: name, email: `${name}@example.invalid` },
    supabaseTokenExpiresAt: name === "old" ? 1 : Date.now() + 3600000
  };
}

function responseSession(name = "old") {
  return { access_token: `${name}-renewed`, refresh_token: `${name}-rotated`, user: { id: name }, expires_in: 3600 };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture({ storage = {}, fetcher = async () => Response.json(responseSession()), fastTimeout = false } = {}) {
  const values = { furimaneResearchEnabled: true, ...structuredClone(storage) };
  const elements = new Map();
  const storageListeners = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, disabled: false, value: "", textContent: "",
      classList: { toggle() {} }, addEventListener() {}, removeAttribute() {}
    });
    return elements.get(id);
  };
  function emit(changes) {
    if (Object.keys(changes).length) for (const listener of storageListeners) listener(changes, "local");
  }
  function replaceSession(next) {
    const changes = {};
    for (const key of ["supabaseAccessToken", "supabaseRefreshToken", "supabaseUser", "supabaseTokenExpiresAt"]) {
      changes[key] = { oldValue: values[key], newValue: next[key] };
      if (key in next) values[key] = structuredClone(next[key]);
      else delete values[key];
    }
    emit(changes);
  }
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, Error, console,
    setTimeout: (callback, ms) => setTimeout(callback, fastTimeout ? 5 : ms), clearTimeout,
    fetch: fetcher,
    window: { location: { search: "" }, FurimanagerConfig: { SUPABASE_URL: "https://auth.example.invalid", SUPABASE_ANON_KEY: "test-public" } },
    document: { body: element("body"), getElementById: element },
    chrome: {
      runtime: { id: "test-extension", sendMessage(_message, callback) { callback?.({ success: true }); } },
      tabs: { create() {} },
      storage: {
        onChanged: { addListener(listener) { storageListeners.push(listener); } },
        local: {
          get(keys, callback) { callback(Object.fromEntries(keys.filter(key => key in values).map(key => [key, structuredClone(values[key])]))); },
          set(next, callback) { Object.assign(values, structuredClone(next)); callback(); },
          remove(keys, callback) { for (const key of keys) delete values[key]; callback(); }
        }
      }
    }
  });
  const api = vm.runInContext(source.replace(startup, `({ initializePopup, restoreAuthState, refreshSupabaseSession,
    loginToSupabase, handleLoginSubmit, logoutFromSupabase, applyAuthStateFromStorage, updateAuthUi,
    getState: () => ({ ...authState }) });`), context);
  return { api, values, element, replaceSession };
}

for (const partial of [true, false]) {
  test(`同じコードでも${partial ? "一部" : "期限切れ"}保存セッション更新の無応答でGoogle・新規登録の入口が消えない`, async () => {
    const started = deferred();
    const env = fixture({ storage: session("old", partial), fastTimeout: true, fetcher: () => { started.resolve(); return new Promise(() => {}); } });
    const initializing = env.api.initializePopup();
    await started.promise;
    assert.equal(env.element("loginForm").hidden, false);
    assert.equal(env.element("signupPrompt").hidden, false);
    assert.equal(env.element("googleLoginBlock").hidden, false);
    await initializing;
    assert.match(env.element("authMessage").textContent, /接続できません/);
    assert.equal(env.values.supabaseRefreshToken, "old-refresh");
  });
}

test("初回利用で保存セッションがなくてもGoogle・新規登録を表示する", async () => {
  const env = fixture({ fetcher: () => { throw new Error("認証通信は不要"); } });
  await env.api.restoreAuthState();
  assert.equal(env.element("signupPrompt").hidden, false);
  assert.equal(env.element("googleLoginBlock").hidden, false);
});

for (const phase of ["headers", "body"]) {
  test(`パスワード認証の${phase}待機を打ち切り、再操作可能にする`, async () => {
    let signal;
    const env = fixture({ fastTimeout: true, fetcher: (_url, init) => {
      signal = init.signal;
      return phase === "headers" ? new Promise(() => {}) : Promise.resolve({ json: () => new Promise(() => {}) });
    } });
    env.element("emailInput").value = "user@example.invalid";
    env.element("passwordInput").value = "fixture-password";
    await env.api.handleLoginSubmit({ preventDefault() {} });
    assert.equal(signal.aborted, true);
    assert.equal(env.element("loginButton").disabled, false);
    assert.equal(env.element("googleLoginButton").disabled, false);
    assert.equal(env.element("signupPrompt").hidden, false);
    assert.match(env.element("authMessage").textContent, /接続できません/);
    assert.equal(env.values.supabaseAccessToken, undefined);
  });
}

for (const status of [429, 500, 503, 504]) {
  test(`refresh HTTP ${status}は保存セッションを消さない`, async () => {
    const saved = session();
    const env = fixture({ storage: saved, fetcher: async () => Response.json({ msg: "invalid refresh token" }, { status }) });
    env.api.applyAuthStateFromStorage(saved);
    await assert.rejects(env.api.refreshSupabaseSession(), status === 429 ? /操作が続いています/ : /接続できません/);
    assert.equal(env.values.supabaseRefreshToken, saved.supabaseRefreshToken);
    assert.equal(env.values.supabaseUser.id, "old");
  });
}

test("明示されたrefresh失効だけ保存情報を削除する", async () => {
  const saved = session();
  const env = fixture({ storage: saved, fetcher: async () => Response.json({ code: "refresh_token_not_found" }, { status: 400 }) });
  env.api.applyAuthStateFromStorage(saved);
  assert.equal(await env.api.refreshSupabaseSession(), false);
  assert.equal(env.values.supabaseRefreshToken, undefined);
});

for (const responseType of ["success", "invalid", "network"]) {
  test(`古いrefreshの${responseType}応答で後から連携したアカウントを上書きしない`, async () => {
    const pending = deferred();
    const started = deferred();
    const saved = session();
    const env = fixture({ storage: saved, fetcher: async () => {
      started.resolve();
      const result = await pending.promise;
      if (responseType === "network") throw new TypeError("Failed to fetch");
      return result;
    } });
    env.api.applyAuthStateFromStorage(saved);
    const refresh = env.api.refreshSupabaseSession();
    await started.promise;
    env.replaceSession(session("new"));
    pending.resolve(responseType === "success" ? Response.json(responseSession()) : Response.json({ code: "refresh_token_not_found" }, { status: 400 }));
    assert.equal(await refresh, true);
    assert.equal(env.values.supabaseUser.id, "new");
    assert.equal(env.values.supabaseRefreshToken, "new-refresh");
  });
}

test("refresh中のログアウトを遅れた成功応答で取り消さない", async () => {
  const pending = deferred();
  const started = deferred();
  const saved = session();
  const env = fixture({ storage: saved, fetcher: () => { started.resolve(); return pending.promise; } });
  env.api.applyAuthStateFromStorage(saved);
  const refresh = env.api.refreshSupabaseSession();
  await started.promise;
  await env.api.logoutFromSupabase();
  pending.resolve(Response.json(responseSession()));
  assert.equal(await refresh, false);
  assert.equal(env.values.supabaseAccessToken, undefined);
});

test("パスワード認証中に別タブで完了した連携を古い応答で上書きしない", async () => {
  const pending = deferred();
  const started = deferred();
  const env = fixture({ fetcher: () => { started.resolve(); return pending.promise; } });
  const login = env.api.loginToSupabase("old@example.invalid", "fixture-password");
  await started.promise;
  env.replaceSession(session("new"));
  pending.resolve(Response.json(responseSession()));
  await assert.rejects(login, /ログイン状態が変更されました/);
  assert.equal(env.values.supabaseUser.id, "new");
});

test("Aの自動更新とBへの明示ログインが競合しても、AのままBへログイン成功と案内しない", async () => {
  const pending = deferred();
  const started = deferred();
  const saved = session();
  const env = fixture({ storage: saved, fetcher: () => { started.resolve(); return pending.promise; } });
  env.api.applyAuthStateFromStorage(saved);
  env.element("emailInput").value = "new@example.invalid";
  env.element("passwordInput").value = "fixture-password";
  const login = env.api.handleLoginSubmit({ preventDefault() {} });
  await started.promise;
  env.replaceSession({ ...saved, supabaseAccessToken: "old-renewed", supabaseRefreshToken: "old-rotated", supabaseTokenExpiresAt: Date.now() + 3600000 });
  pending.resolve(Response.json(responseSession("new")));
  await login;
  assert.equal(env.values.supabaseUser.id, "old");
  assert.equal(env.values.supabaseRefreshToken, "old-rotated");
  assert.match(env.element("authMessage").textContent, /ログイン状態が変更されました/);
  assert.equal(env.element("authMessage").className, "auth-message auth-message--error");
  assert.equal(env.element("loginButton").disabled, false);
});

test("遅延したパスワード認証はタイムアウト後にセッションを保存しない", async () => {
  const pending = deferred();
  const env = fixture({ fastTimeout: true, fetcher: () => pending.promise });
  await assert.rejects(env.api.loginToSupabase("old@example.invalid", "fixture-password"), /接続できません/);
  pending.resolve(Response.json(responseSession()));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.values.supabaseAccessToken, undefined);
});

test("正常なパスワード認証と実際の入力誤りを区別する", async () => {
  const valid = fixture();
  await valid.api.loginToSupabase("old@example.invalid", "fixture-password");
  assert.equal(valid.values.supabaseRefreshToken, "old-rotated");
  const invalid = fixture({ fetcher: async () => Response.json({ msg: "Invalid login credentials" }, { status: 400 }) });
  invalid.element("emailInput").value = "old@example.invalid";
  invalid.element("passwordInput").value = "fixture-password";
  await invalid.api.handleLoginSubmit({ preventDefault() {} });
  assert.match(invalid.element("authMessage").textContent, /メールアドレスまたはパスワード/);
});
