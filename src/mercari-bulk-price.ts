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
    mounted.setAttribute("aria-label", "一括値下げ（フリマネ）");
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

  let helpPinned = false;
  function showHelp(open: boolean) {
    const toggle = mounted?.querySelector(".fm-bulk-help-button");
    const popup = mounted?.querySelector<HTMLElement>(".fm-bulk-help-popover");
    toggle?.setAttribute("aria-expanded", String(open));
    if (popup) {
      popup.hidden = !open;
      if (open && toggle) {
        const rect = toggle.getBoundingClientRect();
        const below = innerHeight - rect.bottom - 24;
        const above = rect.top - 24;
        const upward = below < 180 && above > below;
        popup.classList.toggle("opens-up", upward);
        popup.style.setProperty("--fm-bulk-help-height", `${Math.max(100, upward ? above : below)}px`);
      }
    }
  }

  function helpButton() {
    helpPinned = false;
    const help = element("div", "", "fm-bulk-help");
    const toggle = element("button", "", "fm-bulk-help-button");
    toggle.type = "button";
    toggle.setAttribute("aria-label", "注意書きと所要時間の目安");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "fm-bulk-help-popover");
    // Lucide CircleAlert。既存のDOM構成のまま、依存を増やさずSVGで描く。
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M12 8v4m0 4h.01");
    svg.append(circle, path); toggle.append(svg);
    const popup = element("div", "", "fm-bulk-help-popover");
    popup.id = "fm-bulk-help-popover"; popup.hidden = true;
    const panel = element("div", "", "fm-bulk-help-panel");
    panel.setAttribute("role", "note"); panel.setAttribute("aria-label", "一括値下げの注意書き"); panel.tabIndex = 0;
    panel.append(element("strong", "実行中のお願い"));
    const list = element("ul");
    for (const [before, emphasis, after] of [
      ["", "この画面を表示したまま", "お待ちください。"],
      ["対象商品の", "編集・価格変更", "は、終わるまでお待ちください。"],
      ["値下げ用に開く", "商品・編集画面のタブ", "は操作しないでください。"],
    ]) {
      const item = element("li");
      item.append(before, element("strong", emphasis), after); list.append(item);
    }
    panel.append(list, element("p", "※再読み込みや画面の切り替え、パソコンのスリープで、途中で止まることがあります。", "fm-bulk-note"));
    const pacing = element("p", "", "fm-bulk-pacing-note");
    pacing.append("操作が集中しないよう、", element("strong", "ランダムに間隔をあけて"), "値下げします。待ち時間が終わると、自動で次の商品へ進みます。");
    panel.append(pacing);
    panel.append(element("strong", "かかる時間の目安"));
    for (const [count, time] of [["20件", "約4〜6分"], ["50件", "約10〜15分"], ["100件", "約20〜30分"]]) {
      const guide = element("p");
      guide.append(`${count} → `, element("strong", time)); panel.append(guide);
    }
    const estimate = element("p", "", "fm-bulk-note");
    estimate.append(element("strong", "時間はあくまで目安です。"), "商品の確認や通信状況によって前後します。実行中は、残り時間を画面に表示します。");
    panel.append(estimate);
    popup.append(panel); help.append(toggle, popup);
    help.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") showHelp(true); });
    help.addEventListener("pointerleave", () => { if (!helpPinned && !help.matches(":focus-within")) showHelp(false); });
    help.addEventListener("focusin", () => showHelp(true));
    help.addEventListener("focusout", event => {
      if (!help.contains(event.relatedTarget as Node | null)) { helpPinned = false; showHelp(false); }
    });
    toggle.addEventListener("click", () => { helpPinned = !helpPinned; showHelp(helpPinned); });
    return help;
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const help = mounted?.querySelector(".fm-bulk-help");
    if (help?.contains(document.activeElement)) help.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    helpPinned = false; showHelp(false);
  });
  document.addEventListener("pointerdown", event => {
    if (!mounted?.querySelector(".fm-bulk-help")?.contains(event.target as Node)) { helpPinned = false; showHelp(false); }
  });

  let meterJob: string | null = null;
  let meterLit = 0;
  let meterTarget = 0;
  let meterActive = false;
  let meterNode: HTMLElement | null = null;
  let meterTimer: ReturnType<typeof setTimeout> | null = null;

  function paintMeter() {
    if (!meterNode) return;
    [...meterNode.children].forEach((square, index) => {
      square.className = `fm-bulk-segment${index < meterLit ? " is-complete" : meterActive && index === meterLit ? " is-current" : ""}`;
    });
  }

  function advanceMeter() {
    meterTimer = null;
    if (!meterNode?.isConnected) return;
    if (meterLit < meterTarget) meterLit++;
    paintMeter();
    if (meterLit < meterTarget) meterTimer = setTimeout(advanceMeter, 180);
  }

  function progressDisplay(previous: HTMLElement | null) {
    const view = P.progress(state);
    const scanning = state.status === "scanning";
    const active = scanning || state.status === "running";
    const group = previous ?? element("div", "", "fm-bulk-progress");
    if (!previous) {
      const caption = element("div", "", "fm-bulk-progress-caption");
      caption.append(element("strong"), element("span"));
      const meter = element("div", "", "fm-bulk-meter");
      meter.setAttribute("role", "progressbar"); meter.setAttribute("aria-label", "一括値下げの進捗");
      meter.setAttribute("aria-valuemin", "0"); meter.setAttribute("aria-valuemax", "100");
      for (let index = 0; index < 10; index++) {
        const square = element("span", "", "fm-bulk-segment");
        square.setAttribute("aria-hidden", "true"); meter.append(square);
      }
      const track = element("div", "", "fm-bulk-progress-track");
      track.append(meter, element("span", "", "fm-bulk-eta"));
      group.append(caption, track);
    }
    const label = scanning ? "対象を確認中" : active
      ? "一括値下げを実行中"
      : state.status === "done" ? "完了" : "停止中";
    const count = scanning ? `${state.scanned ?? 0}件確認` : `${view.processed} / ${view.total}件`;
    group.querySelector(".fm-bulk-progress-caption strong")!.textContent = label;
    group.querySelector(".fm-bulk-progress-caption span")!.textContent = count;
    const meter = group.querySelector<HTMLElement>(".fm-bulk-meter")!;
    if (!scanning) meter.setAttribute("aria-valuenow", String(view.percent));
    else meter.removeAttribute("aria-valuenow");
    meter.setAttribute("aria-valuetext", `${label}・${count}`);
    // 複数目盛り分の応答でも1個ずつ点灯。目標は実作業で到達した地点まで。
    if (meterJob !== state.id || scanning || (!active && state.status !== "done")) {
      if (meterTimer !== null) clearTimeout(meterTimer);
      meterTimer = null;
      meterLit = active ? 0 : view.lit;
      meterJob = state.id;
    }
    meterNode = meter; meterTarget = view.lit; meterActive = active;
    meterLit = Math.min(meterLit, meterTarget);
    if (!active && state.status === "done" && !previous) meterLit = meterTarget;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) meterLit = meterTarget;
    paintMeter();
    if (meterLit < meterTarget && meterTimer === null) meterTimer = setTimeout(advanceMeter, 180);
    const time = scanning ? "残り時間を計算中…" : view.remainingMs == null ? ""
      : view.remainingMs < 60_000 ? "残り約1分以内" : `残り約${Math.ceil(view.remainingMs / 60_000)}分`;
    group.querySelector(".fm-bulk-eta")!.textContent = time;
    return group;
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
    // 注意書きは更新のたびに作り直さず、ホバー・フォーカス・スクロールを保つ。
    let heading = mounted.querySelector<HTMLElement>(".fm-bulk-heading");
    if (!heading) {
      heading = element("div", "", "fm-bulk-heading");
      const title = element("div", "", "fm-bulk-title");
      title.append(element("span", "一括値下げ"), element("span", "フリマネ", "fm-bulk-brand"));
      heading.append(title, helpButton());
      mounted.append(heading);
    }
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
    const previousContent = mounted.querySelector(".fm-bulk-content");
    const previousProgress = mounted.querySelector<HTMLElement>(".fm-bulk-progress");
    if (previousContent) previousContent.replaceWith(content);
    else mounted.append(content);
    if (state.status !== "idle") {
      if (active || state.candidates?.length) content.append(progressDisplay(previousProgress));
      const status = element("p", active ? "" : state.message ?? "", "fm-bulk-status");
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      if (active) {
        const progress = P.progress(state);
        status.classList.add("fm-bulk-sr-only");
        status.textContent = state.status === "scanning" ? `対象確認中・${state.scanned ?? 0}件確認` : `${progress.processed} / ${progress.total}件処理済み`;
      }
      content.append(status);
      if (active && !owns) content.append(element("p", "開始したタブで操作してください。", "fm-bulk-note"));
      if (state.rows?.length) {
        const details = element("details");
        details.open = detailsOpen;
        details.append(element("summary", "対象と結果を見る"));
        details.append(element("p", `確認 ${state.scanned ?? 0}件 ／ 対象 ${state.candidates?.length ?? 0}件 ／ 完了 ${state.completed ?? 0}件 ／ 対象外・除外 ${state.skipped ?? 0}件`, "fm-bulk-counts"));
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
    if (focusedLabel && !heading.contains(document.activeElement)) [...content.querySelectorAll<HTMLElement>("button, summary")].find(node => node.textContent === focusedLabel)?.focus({ preventScroll: true });
  }

  let polling = false;
  async function poll() {
    mount();
    if (!mounted || pending || polling) return;
    polling = true;
    const epoch = actionEpoch;
    try {
      const response = await request("STATUS");
      if (epoch !== actionEpoch) return;
      state = response.state; owns = response.owns; render();
    }
    catch (error) { showError(error); }
    finally { polling = false; }
  }

  // SPAで出品中から取引中へ移動した場合も取り除く。
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mount(); }, 200);
  }).observe(document, { childList: true, subtree: true });
  // 実行中だけ拡張内の状態を細かく取得する。メルカリへの通信・待機は増やさない。
  let refreshTicks = 0;
  setInterval(() => {
    if (++refreshTicks % 10 === 0 || ["scanning", "running"].includes(state.status)) void poll();
  }, 500);
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
