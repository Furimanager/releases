(() => {
  const api = (globalThis as any).chrome;
  const P = (globalThis as any).FurimaneBulkPolicy;
  if (!api?.runtime?.sendMessage || !P) return;
  const instance = crypto.randomUUID();
  const ROOT_ID = "furimane-bulk-price";
  let state: any = { status: "idle" };
  let owns = false;
  let pending = false;
  let actionEpoch = 0;
  let mounted: HTMLElement | null = null;
  let lastRender = "";
  // 専用編集タブを人が操作したら、そのページでは以後自動保存しない。
  // 入力開始より前の操作も拾うため、document_startで監視を始める。
  let editorTouched = false;
  for (const name of ["input", "change", "pointerdown", "keydown"]) {
    document.addEventListener(name, event => {
      if (event.isTrusted && /^\/sell\/edit\/m\d+$/.test(location.pathname)) editorTouched = true;
    }, true);
  }

  function accessToken(): string | null {
    try { return JSON.parse(localStorage.getItem("authTokenData") ?? "null")?.accessToken ?? null; }
    catch { return null; }
  }

  async function request(action: string, fields: Record<string, unknown> = {}) {
    const response = await api.runtime.sendMessage({
      type: `${P.PREFIX}${action}`, instance, accessToken: accessToken(), jobId: state.id, ...fields,
    });
    if (!response || response.error) throw new Error(response?.error ?? "拡張機能に接続できません。ページを再読み込みしてください。");
    return response;
  }

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  function activeRoot(): HTMLElement | null {
    if (!P.listingsPage(location.href)) return null;
    return document.querySelector("#my-page-main-content") ?? document.querySelector("main");
  }

  function mount() {
    const root = activeRoot();
    if (!root) { mounted?.remove(); mounted = null; return; }
    if (mounted?.isConnected) return;
    const tabs = root.querySelector('[role="tablist"]');
    const firstCard = root.querySelector('a[data-testid="listed-item"][href^="/item/"]');
    // タブDOMが変わった場合は、最初の商品行を内包する一覧の手前に置く。
    let list: Element | null = firstCard;
    while (list?.parentElement && list.parentElement !== root && !list.parentElement.querySelector('[role="tablist"]')) {
      list = list.parentElement;
    }
    if (!tabs && !list) return;
    mounted = element("section", "", "fm-bulk");
    mounted.id = ROOT_ID;
    mounted.setAttribute("aria-label", "フリマネ 一括値下げ");
    if (tabs) tabs.after(mounted);
    else list!.before(mounted);
    lastRender = "";
    render();
  }

  async function operate(action: string) {
    if (pending) return;
    pending = true;
    actionEpoch++;
    mounted?.querySelector(".fm-bulk-error")?.remove();
    const clickedAt = performance.now();
    render();
    try {
      const response = await request(action, { requestAge: performance.now() - clickedAt });
      state = response.state; owns = response.owns;
    } catch (error) {
      showError(error);
    } finally { pending = false; render(); }
  }

  function showError(error: unknown) {
    const text = error instanceof Error ? error.message : "処理を続けられませんでした。";
    if (!mounted) return;
    let errorNode = mounted.querySelector<HTMLElement>(".fm-bulk-error");
    if (!errorNode) { errorNode = element("p", "", "fm-bulk-error"); errorNode.setAttribute("role", "alert"); mounted.append(errorNode); }
    errorNode.textContent = text;
  }

  function button(label: string, action: string, secondary = false) {
    const node = element("button", label, secondary ? "fm-bulk-secondary" : "fm-bulk-primary");
    node.type = "button";
    node.disabled = pending;
    node.addEventListener("click", (event) => { if (event.isTrusted) void operate(action); });
    return node;
  }

  function render() {
    if (!mounted) return;
    const key = JSON.stringify([state, pending, owns]);
    if (key === lastRender) return;
    lastRender = key;
    const error = mounted.querySelector(".fm-bulk-error");
    const detailsOpen = mounted.querySelector("details")?.open ?? false;
    const resultScroll = mounted.querySelector(".fm-bulk-results")?.scrollTop ?? 0;
    const focusedLabel = mounted.contains(document.activeElement) ? document.activeElement?.textContent : null;
    const heading = element("div", "", "fm-bulk-heading");
    const label = element("div");
    label.append(element("strong", "フリマネ 一括値下げ"), element("p", "更新から24時間＋5分経過した商品を、各1回100円値下げ"));
    const actions = element("div", "", "fm-bulk-actions");
    const active = ["scanning", "ready", "running"].includes(state.status);
    if (!active) actions.append(button(pending ? "確認中…" : "まとめて100円値下げ", "START"));
    if (state.status === "ready" && owns && state.candidates?.length) actions.append(button(`${state.candidates.length}件を100円値下げする`, "EXECUTE"));
    if (active && owns) actions.append(button(state.status === "ready" ? "実行せず閉じる" : "停止する", "CANCEL", true));
    heading.append(label, actions);
    mounted.replaceChildren(heading);
    if (state.status === "idle") mounted.append(element("p", "対象を確認してから実行します。自動の定期実行はしません。", "fm-bulk-note"));
    else {
      const status = element("p", state.message ?? "確認中…", "fm-bulk-status");
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      mounted.append(status);
      if (active && !owns) mounted.append(element("p", "開始したタブで操作してください。", "fm-bulk-note"));
      mounted.append(element("p", `確認 ${state.scanned ?? 0}件 ／ 対象 ${state.candidates?.length ?? 0}件 ／ 完了 ${state.completed ?? 0}件 ／ 対象外・除外 ${state.skipped ?? 0}件`, "fm-bulk-counts"));
      if (["ready", "running"].includes(state.status)) {
        mounted.append(element("p", "400円未満・日時不明の商品などは対象外です。実行中はこの一覧を開いたままにしてください。停止時も保存を開始した1件は結果を確認します。", "fm-bulk-note"));
      }
      if (state.rows?.length) {
        const details = element("details");
        details.open = detailsOpen;
        details.append(element("summary", "対象と結果を見る"));
        const rows = element("div", "", "fm-bulk-results");
        for (const row of state.rows) {
          const entry = element("div", "", "fm-bulk-result");
          const link = element("a", row.title);
          link.href = `${P.ORIGIN}/item/${row.id}`; link.target = "_blank"; link.rel = "noopener noreferrer";
          const price = Number.isSafeInteger(row.price) ? `¥${row.price.toLocaleString("ja-JP")}` : "価格不明";
          entry.append(link, element("span", ["対象", "完了", "確認中"].includes(row.status)
            ? `${price} → ¥${(row.price - 100).toLocaleString("ja-JP")} · ${row.status}`
            : `${price} · ${row.reason ?? row.status}`));
          rows.append(entry);
        }
        details.append(rows); mounted.append(details);
        rows.scrollTop = resultScroll;
      }
    }
    if (error) mounted.append(error);
    if (focusedLabel) [...mounted.querySelectorAll<HTMLElement>("button, summary")].find(node => node.textContent === focusedLabel)?.focus({ preventScroll: true });
  }

  async function poll() {
    mount();
    if (!mounted || pending) return;
    const epoch = actionEpoch;
    try {
      const response = await request("STATUS");
      if (epoch !== actionEpoch) return;
      state = response.state; owns = response.owns; render();
    }
    catch (error) { showError(error); }
  }

  // SPAで出品中から取引中へ移動した場合も取り除く。
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mount(); }, 200);
  }).observe(document, { childList: true, subtree: true });
  setInterval(() => { void poll(); }, 5000);
  void poll();

  let editorUsed = false;
  function editorFields(itemId: string) {
    if (editorTouched) throw new Error("編集画面が操作されたため停止しました。保存は行っていません。");
    if (location.href !== `${P.ORIGIN}/sell/edit/${itemId}`) throw new Error("編集対象のページが変わったため停止しました。");
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-testid="price-input"][name="price"]')];
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-testid="edit-button"]')];
    if (inputs.length !== 1 || buttons.length !== 1 || buttons[0].textContent?.trim() !== "変更する"
      || inputs[0].disabled || inputs[0].readOnly || buttons[0].disabled) throw new Error("価格欄または変更ボタンを確認できませんでした。");
    return { price: inputs[0], submit: buttons[0] };
  }

  async function apply(message: any, respond: (result: any) => void) {
    if (editorUsed) throw new Error("この編集画面では既に実行済みです。");
    editorUsed = true;
    const fields = editorFields(message.itemId);
    if (!Number.isSafeInteger(message.price) || message.price < 400 || Number(fields.price.value) !== message.price) throw new Error("価格が変わったため停止しました。");
    let touched = false;
    const onInput = (event: Event) => { if (event.isTrusted) touched = true; };
    const events = ["input", "change", "pointerdown", "keydown"];
    events.forEach(name => document.addEventListener(name, onInput, true));
    const assertForm = () => {
      const fresh = editorFields(message.itemId);
      if (touched || fresh.price !== fields.price || fresh.submit !== fields.submit || !fields.price.isConnected) {
        throw new Error("編集画面が操作されたため停止しました。保存は行っていません。");
      }
    };
    try {
      // Reactの入力イベントを通し、再レンダリング後にも同じ欄か確認する。
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setValue) throw new Error("価格欄へ入力できませんでした。");
      setValue.call(fields.price, String(message.price - 100));
      fields.price.dispatchEvent(new Event("input", { bubbles: true }));
      fields.price.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 700));
      assertForm();
      const result = await request("AUTHORIZE", { jobId: message.jobId, itemId: message.itemId });
      assertForm();
      if (!result.allowed || result.nextPrice !== message.price - 100 || Number(fields.price.value) !== result.nextPrice) throw new Error("保存直前の価格が一致しません。");
      // ページ遷移で応答が消える前に通知する。完了扱いはbackgroundの価格再取得後。
      respond({ submitted: true });
      fields.submit.click();
    } finally {
      events.forEach(name => document.removeEventListener(name, onInput, true));
    }
  }

  api.runtime.onMessage.addListener((message: any, sender: any, respond: (result: any) => void) => {
    if (sender.id !== api.runtime.id || sender.tab) return false;
    if (message?.type === `${P.PREFIX}EDITOR_READY`) {
      if (editorTouched) { respond({ error: "編集画面が操作されたため停止しました。" }); return false; }
      try { editorFields(message.itemId); respond({ ready: !editorUsed }); }
      catch { respond({ ready: false }); }
      return false;
    }
    if (message?.type !== `${P.PREFIX}EDITOR_APPLY`) return false;
    void apply(message, respond).catch(error => respond({ error: error instanceof Error ? error.message : "保存前に停止しました。" }));
    return true;
  });
})();
