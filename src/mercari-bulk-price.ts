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
    // メルカリの実タブはrole=tablistではなくnav内のリンク（2026-10-03確認）。
    const tabs = root.querySelector('[data-testid="tab-to-listing"]')?.closest("nav")
      ?? root.querySelector('[role="tablist"]');
    const list = root.querySelector('[data-testid="listed-item-list"]');
    if (!tabs && !list) return;
    // SPAの再描画でタブだけ差し替わっても、選定した位置に揃える。
    if (mounted?.isConnected) {
      if (tabs && tabs.nextElementSibling !== mounted) tabs.after(mounted);
      else if (!tabs && list?.previousElementSibling !== mounted) list!.before(mounted);
      return;
    }
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
    if (!errorNode) {
      errorNode = element("p", "", "fm-bulk-error"); errorNode.setAttribute("role", "alert");
      (mounted.querySelector(".fm-bulk-content") ?? mounted).append(errorNode);
    }
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
    const heading = element("div", "フリマネ 一括値下げ", "fm-bulk-heading");
    const content = element("div", "", "fm-bulk-content");
    const toolbar = element("div", "", "fm-bulk-toolbar");
    const label = element("p", "更新から24時間以上経過した商品を、各1回100円値下げ", "fm-bulk-hint");
    const actions = element("div", "", "fm-bulk-actions");
    const active = ["scanning", "running"].includes(state.status);
    if (!active) {
      const start = button(pending ? "確認中…" : "一括 −100円", "START");
      start.title = "対象商品を自動確認し、そのまま各1回100円値下げします";
      actions.append(start);
    }
    if (active && owns) actions.append(button("停止", "CANCEL", true));
    toolbar.append(label, actions);
    content.append(toolbar);
    mounted.replaceChildren(heading, content);
    if (state.status !== "idle") {
      const status = element("p", state.message ?? "確認中…", "fm-bulk-status");
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      content.append(status);
      if (active && !owns) content.append(element("p", "開始したタブで操作してください。", "fm-bulk-note"));
      content.append(element("p", `確認 ${state.scanned ?? 0}件 ／ 対象 ${state.candidates?.length ?? 0}件 ／ 完了 ${state.completed ?? 0}件 ／ 対象外・除外 ${state.skipped ?? 0}件`, "fm-bulk-counts"));
      if (active) {
        content.append(element("p", "400円未満・日時不明の商品などは対象外です。実行中はこの一覧を開いたままにしてください。停止時も保存を開始した1件は結果を確認します。", "fm-bulk-note"));
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
        details.append(rows); content.append(details);
        rows.scrollTop = resultScroll;
      }
    }
    if (error) content.append(error);
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
  let itemOpened = false;
  function itemEditLink(itemId: string) {
    if (!/^m\d+$/.test(itemId) || location.href !== `${P.ORIGIN}/item/${itemId}`) throw new Error("対象の商品ページではありません。");
    const links = [...document.querySelectorAll<HTMLAnchorElement>(`a[href="/sell/edit/${itemId}"], a[href="${P.ORIGIN}/sell/edit/${itemId}"]`)]
      .filter(link => link.textContent?.trim() === "商品の編集" && link.getClientRects().length > 0);
    if (links.length !== 1) throw new Error("商品ページの「商品の編集」を確認できませんでした。");
    return links[0];
  }
  function editorFields(itemId: string) {
    if (editorTouched) throw new Error("編集画面が操作されたため停止しました。保存は行っていません。");
    if (location.href !== `${P.ORIGIN}/sell/edit/${itemId}`) throw new Error("編集対象のページが変わったため停止しました。");
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[name="price"][data-testid="price-text-input"], input[name="price"][data-testid="price-input"]')];
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-testid="edit-button"]')];
    if (inputs.length !== 1 || buttons.length !== 1 || buttons[0].textContent?.trim() !== "変更する"
      || inputs[0].disabled || inputs[0].readOnly || buttons[0].disabled) throw new Error("価格欄または変更ボタンを確認できませんでした。");
    return { price: inputs[0], submit: buttons[0] };
  }

  async function apply(message: any, respond: (result: any) => void) {
    if (editorUsed) throw new Error("この編集画面では既に実行済みです。");
    editorUsed = true;
    const fields = editorFields(message.itemId);
    if (!Number.isSafeInteger(message.price) || message.price < 400 || Number(fields.price.value) !== message.price - 100) throw new Error("−100円の入力が一致しないため停止しました。");
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
      // 入力は既存の−100円処理で済んでいる。再度減算せず、保存だけ行う。
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
    if (message?.type === `${P.PREFIX}ITEM_READY`) {
      try { itemEditLink(message.itemId); respond({ ready: !itemOpened }); }
      catch { respond({ ready: false }); }
      return false;
    }
    if (message?.type === `${P.PREFIX}ITEM_OPEN_EDIT`) {
      try {
        if (itemOpened) throw new Error("この商品では既に編集へ進んでいます。");
        const link = itemEditLink(message.itemId);
        itemOpened = true;
        respond({ opened: true });
        // 既存の個別操作同様、実リンクを使い編集用スクリプトを通常読込する。
        location.assign(link.href);
      } catch (error) { respond({ error: error instanceof Error ? error.message : "編集へ進めませんでした。" }); }
      return false;
    }
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
