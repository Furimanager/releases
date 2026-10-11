(() => {
  (() => {
    const api = globalThis.chrome;
    const P = globalThis.FurimaneBulkPolicy;
    if (!api?.runtime?.sendMessage || !P) return;
    const instance = crypto.randomUUID();
    const ROOT_ID = "furimane-bulk-price";
    let state = { status: "idle" };
    let owns = false;
    let pending = false;
    let actionEpoch = 0;
    let mounted = null;
    let lastRender = "";
    let editorTouched = false;
    for (const name of ["input", "change", "pointerdown", "keydown"]) {
      document.addEventListener(name, (event) => {
        if (event.isTrusted && /^\/sell\/edit\/m\d+$/.test(location.pathname)) editorTouched = true;
      }, true);
    }
    function accessToken() {
      try {
        return JSON.parse(localStorage.getItem("authTokenData") ?? "null")?.accessToken ?? null;
      } catch {
        return null;
      }
    }
    async function request(action, fields = {}) {
      const response = await api.runtime.sendMessage({
        type: `${P.PREFIX}${action}`,
        instance,
        accessToken: accessToken(),
        jobId: state.id,
        ...fields
      });
      if (!response || response.error) throw new Error(response?.error ?? "\u62E1\u5F35\u6A5F\u80FD\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return response;
    }
    function element(tag, text = "", className = "") {
      const node = document.createElement(tag);
      node.textContent = text;
      node.className = className;
      return node;
    }
    function activeRoot() {
      if (!P.listingsPage(location.href)) return null;
      return document.querySelector("#my-page-main-content") ?? document.querySelector("main");
    }
    function mount() {
      const root = activeRoot();
      if (!root) {
        mounted?.remove();
        mounted = null;
        return;
      }
      const tabs = root.querySelector('[data-testid="tab-to-listing"]')?.closest("nav") ?? root.querySelector('[role="tablist"]');
      const list = root.querySelector('[data-testid="listed-item-list"]');
      if (!tabs && !list) return;
      if (mounted?.isConnected) {
        if (tabs && tabs.nextElementSibling !== mounted) tabs.after(mounted);
        else if (!tabs && list?.previousElementSibling !== mounted) list.before(mounted);
        return;
      }
      mounted = element("section", "", "fm-bulk");
      mounted.id = ROOT_ID;
      mounted.setAttribute("aria-label", "\u4E00\u62EC\u5024\u4E0B\u3052\uFF08\u30D5\u30EA\u30DE\u30CD\uFF09");
      if (tabs) tabs.after(mounted);
      else list.before(mounted);
      lastRender = "";
      render();
    }
    async function operate(action) {
      if (pending) return;
      pending = true;
      actionEpoch++;
      mounted?.querySelector(".fm-bulk-error")?.remove();
      const clickedAt = performance.now();
      render();
      try {
        const response = await request(action, { requestAge: performance.now() - clickedAt });
        state = response.state;
        owns = response.owns;
      } catch (error) {
        showError(error);
      } finally {
        pending = false;
        render();
      }
    }
    function showError(error) {
      const text = error instanceof Error ? error.message : "\u51E6\u7406\u3092\u7D9A\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002";
      if (!mounted) return;
      let errorNode = mounted.querySelector(".fm-bulk-error");
      if (!errorNode) {
        errorNode = element("p", "", "fm-bulk-error");
        errorNode.setAttribute("role", "alert");
        (mounted.querySelector(".fm-bulk-content") ?? mounted).append(errorNode);
      }
      errorNode.textContent = text;
    }
    function button(label, action, secondary = false) {
      const node = element("button", label, secondary ? "fm-bulk-secondary" : "fm-bulk-primary");
      node.type = "button";
      node.disabled = pending;
      node.addEventListener("click", (event) => {
        if (event.isTrusted) void operate(action);
      });
      return node;
    }
    let helpPinned = false;
    function showHelp(open) {
      const toggle = mounted?.querySelector(".fm-bulk-help-button");
      const popup = mounted?.querySelector(".fm-bulk-help-popover");
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
      toggle.setAttribute("aria-label", "\u6CE8\u610F\u66F8\u304D\u3068\u6240\u8981\u6642\u9593\u306E\u76EE\u5B89");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "fm-bulk-help-popover");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "10");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M12 8v4m0 4h.01");
      svg.append(circle, path);
      toggle.append(svg);
      const popup = element("div", "", "fm-bulk-help-popover");
      popup.id = "fm-bulk-help-popover";
      popup.hidden = true;
      const panel = element("div", "", "fm-bulk-help-panel");
      panel.setAttribute("role", "note");
      panel.setAttribute("aria-label", "\u4E00\u62EC\u5024\u4E0B\u3052\u306E\u6CE8\u610F\u66F8\u304D");
      panel.tabIndex = 0;
      panel.append(element("strong", "\u5B9F\u884C\u4E2D\u306E\u304A\u9858\u3044"));
      const list = element("ul");
      for (const [before, emphasis, after] of [
        ["", "\u3053\u306E\u753B\u9762\u3092\u8868\u793A\u3057\u305F\u307E\u307E", "\u304A\u5F85\u3061\u304F\u3060\u3055\u3044\u3002"],
        ["\u5BFE\u8C61\u5546\u54C1\u306E", "\u7DE8\u96C6\u30FB\u4FA1\u683C\u5909\u66F4", "\u306F\u3001\u7D42\u308F\u308B\u307E\u3067\u304A\u5F85\u3061\u304F\u3060\u3055\u3044\u3002"],
        ["\u5024\u4E0B\u3052\u7528\u306B\u958B\u304F", "\u5546\u54C1\u30FB\u7DE8\u96C6\u753B\u9762\u306E\u30BF\u30D6", "\u306F\u64CD\u4F5C\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002"]
      ]) {
        const item = element("li");
        item.append(before, element("strong", emphasis), after);
        list.append(item);
      }
      panel.append(list, element("p", "\u203B\u518D\u8AAD\u307F\u8FBC\u307F\u3084\u753B\u9762\u306E\u5207\u308A\u66FF\u3048\u3001\u30D1\u30BD\u30B3\u30F3\u306E\u30B9\u30EA\u30FC\u30D7\u3067\u3001\u9014\u4E2D\u3067\u6B62\u307E\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002", "fm-bulk-note"));
      const pacing = element("p", "", "fm-bulk-pacing-note");
      pacing.append("\u64CD\u4F5C\u304C\u96C6\u4E2D\u3057\u306A\u3044\u3088\u3046\u3001", element("strong", "\u30E9\u30F3\u30C0\u30E0\u306B\u9593\u9694\u3092\u3042\u3051\u3066"), "\u5024\u4E0B\u3052\u3057\u307E\u3059\u3002\u5F85\u3061\u6642\u9593\u304C\u7D42\u308F\u308B\u3068\u3001\u81EA\u52D5\u3067\u6B21\u306E\u5546\u54C1\u3078\u9032\u307F\u307E\u3059\u3002");
      panel.append(pacing);
      panel.append(element("strong", "\u304B\u304B\u308B\u6642\u9593\u306E\u76EE\u5B89"));
      for (const [count, time] of [["20\u4EF6", "\u7D044\u301C6\u5206"], ["50\u4EF6", "\u7D0410\u301C15\u5206"], ["100\u4EF6", "\u7D0420\u301C30\u5206"]]) {
        const guide = element("p");
        guide.append(`${count} \u2192 `, element("strong", time));
        panel.append(guide);
      }
      const estimate = element("p", "", "fm-bulk-note");
      estimate.append(element("strong", "\u6642\u9593\u306F\u3042\u304F\u307E\u3067\u76EE\u5B89\u3067\u3059\u3002"), "\u5546\u54C1\u306E\u78BA\u8A8D\u3084\u901A\u4FE1\u72B6\u6CC1\u306B\u3088\u3063\u3066\u524D\u5F8C\u3057\u307E\u3059\u3002\u5B9F\u884C\u4E2D\u306F\u3001\u6B8B\u308A\u6642\u9593\u3092\u753B\u9762\u306B\u8868\u793A\u3057\u307E\u3059\u3002");
      panel.append(estimate);
      popup.append(panel);
      help.append(toggle, popup);
      help.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") showHelp(true);
      });
      help.addEventListener("pointerleave", () => {
        if (!helpPinned && !help.matches(":focus-within")) showHelp(false);
      });
      help.addEventListener("focusin", () => showHelp(true));
      help.addEventListener("focusout", (event) => {
        if (!help.contains(event.relatedTarget)) {
          helpPinned = false;
          showHelp(false);
        }
      });
      toggle.addEventListener("click", () => {
        helpPinned = !helpPinned;
        showHelp(helpPinned);
      });
      return help;
    }
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const help = mounted?.querySelector(".fm-bulk-help");
      if (help?.contains(document.activeElement)) help.querySelector("button")?.focus({ preventScroll: true });
      helpPinned = false;
      showHelp(false);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!mounted?.querySelector(".fm-bulk-help")?.contains(event.target)) {
        helpPinned = false;
        showHelp(false);
      }
    });
    let meterJob = null;
    let meterLit = 0;
    let meterTarget = 0;
    let meterActive = false;
    let meterNode = null;
    let meterTimer = null;
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
    function progressDisplay(previous) {
      const view = P.progress(state);
      const scanning = state.status === "scanning";
      const active = scanning || state.status === "running";
      const group = previous ?? element("div", "", "fm-bulk-progress");
      if (!previous) {
        const caption = element("div", "", "fm-bulk-progress-caption");
        caption.append(element("strong"), element("span"));
        const meter2 = element("div", "", "fm-bulk-meter");
        meter2.setAttribute("role", "progressbar");
        meter2.setAttribute("aria-label", "\u4E00\u62EC\u5024\u4E0B\u3052\u306E\u9032\u6357");
        meter2.setAttribute("aria-valuemin", "0");
        meter2.setAttribute("aria-valuemax", "100");
        for (let index = 0; index < 10; index++) {
          const square = element("span", "", "fm-bulk-segment");
          square.setAttribute("aria-hidden", "true");
          meter2.append(square);
        }
        const track = element("div", "", "fm-bulk-progress-track");
        track.append(meter2, element("span", "", "fm-bulk-eta"));
        group.append(caption, track);
      }
      const label = scanning ? "\u5BFE\u8C61\u3092\u78BA\u8A8D\u4E2D" : active ? "\u4E00\u62EC\u5024\u4E0B\u3052\u3092\u5B9F\u884C\u4E2D" : state.status === "done" ? "\u5B8C\u4E86" : "\u505C\u6B62\u4E2D";
      const count = scanning ? `${state.scanned ?? 0}\u4EF6\u78BA\u8A8D` : `${view.processed} / ${view.total}\u4EF6`;
      group.querySelector(".fm-bulk-progress-caption strong").textContent = label;
      group.querySelector(".fm-bulk-progress-caption span").textContent = count;
      const meter = group.querySelector(".fm-bulk-meter");
      if (!scanning) meter.setAttribute("aria-valuenow", String(view.percent));
      else meter.removeAttribute("aria-valuenow");
      meter.setAttribute("aria-valuetext", `${label}\u30FB${count}`);
      if (meterJob !== state.id || scanning || !active && state.status !== "done") {
        if (meterTimer !== null) clearTimeout(meterTimer);
        meterTimer = null;
        meterLit = active ? 0 : view.lit;
        meterJob = state.id;
      }
      meterNode = meter;
      meterTarget = view.lit;
      meterActive = active;
      meterLit = Math.min(meterLit, meterTarget);
      if (!active && state.status === "done" && !previous) meterLit = meterTarget;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) meterLit = meterTarget;
      paintMeter();
      if (meterLit < meterTarget && meterTimer === null) meterTimer = setTimeout(advanceMeter, 180);
      const time = scanning ? "\u6B8B\u308A\u6642\u9593\u3092\u8A08\u7B97\u4E2D\u2026" : view.remainingMs == null ? "" : view.remainingMs < 6e4 ? "\u6B8B\u308A\u7D041\u5206\u4EE5\u5185" : `\u6B8B\u308A\u7D04${Math.ceil(view.remainingMs / 6e4)}\u5206`;
      group.querySelector(".fm-bulk-eta").textContent = time;
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
      let heading = mounted.querySelector(".fm-bulk-heading");
      if (!heading) {
        heading = element("div", "", "fm-bulk-heading");
        const title = element("div", "", "fm-bulk-title");
        title.append(element("span", "\u4E00\u62EC\u5024\u4E0B\u3052"), element("span", "\u30D5\u30EA\u30DE\u30CD", "fm-bulk-brand"));
        heading.append(title, helpButton());
        mounted.append(heading);
      }
      const content = element("div", "", "fm-bulk-content");
      const toolbar = element("div", "", "fm-bulk-toolbar");
      const label = element("p", "\u66F4\u65B0\u304B\u308924\u6642\u9593\u4EE5\u4E0A\u7D4C\u904E\u3057\u305F\u5546\u54C1\u3092\u3001\u54041\u56DE100\u5186\u5024\u4E0B\u3052", "fm-bulk-hint");
      const actions = element("div", "", "fm-bulk-actions");
      const active = ["scanning", "running"].includes(state.status);
      if (!active) {
        const start = button(pending ? "\u78BA\u8A8D\u4E2D\u2026" : "\u4E00\u62EC \u2212100\u5186", "START");
        start.title = "\u5BFE\u8C61\u5546\u54C1\u3092\u81EA\u52D5\u78BA\u8A8D\u3057\u3001\u305D\u306E\u307E\u307E\u54041\u56DE100\u5186\u5024\u4E0B\u3052\u3057\u307E\u3059";
        actions.append(start);
      }
      if (active && owns) actions.append(button("\u505C\u6B62", "CANCEL", true));
      toolbar.append(label, actions);
      content.append(toolbar);
      const previousContent = mounted.querySelector(".fm-bulk-content");
      const previousProgress = mounted.querySelector(".fm-bulk-progress");
      if (previousContent) previousContent.replaceWith(content);
      else mounted.append(content);
      if (state.status !== "idle") {
        if (active || state.candidates?.length) content.append(progressDisplay(previousProgress));
        const status = element("p", active ? "" : state.message ?? "", "fm-bulk-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        if (active) {
          const progress = P.progress(state);
          status.classList.add("fm-bulk-sr-only");
          status.textContent = state.status === "scanning" ? `\u5BFE\u8C61\u78BA\u8A8D\u4E2D\u30FB${state.scanned ?? 0}\u4EF6\u78BA\u8A8D` : `${progress.processed} / ${progress.total}\u4EF6\u51E6\u7406\u6E08\u307F`;
        }
        content.append(status);
        if (active && !owns) content.append(element("p", "\u958B\u59CB\u3057\u305F\u30BF\u30D6\u3067\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "fm-bulk-note"));
        if (state.rows?.length) {
          const details = element("details");
          details.open = detailsOpen;
          details.append(element("summary", "\u5BFE\u8C61\u3068\u7D50\u679C\u3092\u898B\u308B"));
          details.append(element("p", `\u78BA\u8A8D ${state.scanned ?? 0}\u4EF6 \uFF0F \u5BFE\u8C61 ${state.candidates?.length ?? 0}\u4EF6 \uFF0F \u5B8C\u4E86 ${state.completed ?? 0}\u4EF6 \uFF0F \u5BFE\u8C61\u5916\u30FB\u9664\u5916 ${state.skipped ?? 0}\u4EF6`, "fm-bulk-counts"));
          const rows = element("div", "", "fm-bulk-results");
          for (const row of state.rows) {
            const entry = element("div", "", "fm-bulk-result");
            const link = element("a", row.title);
            link.href = `${P.ORIGIN}/item/${row.id}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            const price = Number.isSafeInteger(row.price) ? `\xA5${row.price.toLocaleString("ja-JP")}` : "\u4FA1\u683C\u4E0D\u660E";
            entry.append(link, element("span", ["\u5BFE\u8C61", "\u5B8C\u4E86", "\u78BA\u8A8D\u4E2D"].includes(row.status) ? `${price} \u2192 \xA5${(row.price - 100).toLocaleString("ja-JP")} \xB7 ${row.status}` : `${price} \xB7 ${row.reason ?? row.status}`));
            rows.append(entry);
          }
          details.append(rows);
          content.append(details);
          rows.scrollTop = resultScroll;
        }
      }
      if (error) content.append(error);
      if (focusedLabel && !heading.contains(document.activeElement)) [...content.querySelectorAll("button, summary")].find((node) => node.textContent === focusedLabel)?.focus({ preventScroll: true });
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
        state = response.state;
        owns = response.owns;
        render();
      } catch (error) {
        showError(error);
      } finally {
        polling = false;
      }
    }
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        mount();
      }, 200);
    }).observe(document, { childList: true, subtree: true });
    let refreshTicks = 0;
    setInterval(() => {
      if (++refreshTicks % 10 === 0 || ["scanning", "running"].includes(state.status)) void poll();
    }, 500);
    void poll();
    let editorUsed = false;
    let itemOpened = false;
    function itemEditLink(itemId) {
      if (!/^m\d+$/.test(itemId) || location.href !== `${P.ORIGIN}/item/${itemId}`) throw new Error("\u5BFE\u8C61\u306E\u5546\u54C1\u30DA\u30FC\u30B8\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
      const links = [...document.querySelectorAll(`a[href="/sell/edit/${itemId}"], a[href="${P.ORIGIN}/sell/edit/${itemId}"]`)].filter((link) => link.textContent?.trim() === "\u5546\u54C1\u306E\u7DE8\u96C6" && link.getClientRects().length > 0);
      if (links.length !== 1) throw new Error("\u5546\u54C1\u30DA\u30FC\u30B8\u306E\u300C\u5546\u54C1\u306E\u7DE8\u96C6\u300D\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      return links[0];
    }
    function editorFields(itemId) {
      if (editorTouched) throw new Error("\u7DE8\u96C6\u753B\u9762\u304C\u64CD\u4F5C\u3055\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002\u4FDD\u5B58\u306F\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002");
      if (location.href !== `${P.ORIGIN}/sell/edit/${itemId}`) throw new Error("\u7DE8\u96C6\u5BFE\u8C61\u306E\u30DA\u30FC\u30B8\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      const inputs = [...document.querySelectorAll('input[name="price"][data-testid="price-text-input"], input[name="price"][data-testid="price-input"]')];
      const buttons = [...document.querySelectorAll('button[data-testid="edit-button"]')];
      if (inputs.length !== 1 || buttons.length !== 1 || buttons[0].textContent?.trim() !== "\u5909\u66F4\u3059\u308B" || inputs[0].disabled || inputs[0].readOnly || buttons[0].disabled) throw new Error("\u4FA1\u683C\u6B04\u307E\u305F\u306F\u5909\u66F4\u30DC\u30BF\u30F3\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      return { price: inputs[0], submit: buttons[0] };
    }
    async function apply(message, respond) {
      if (editorUsed) throw new Error("\u3053\u306E\u7DE8\u96C6\u753B\u9762\u3067\u306F\u65E2\u306B\u5B9F\u884C\u6E08\u307F\u3067\u3059\u3002");
      editorUsed = true;
      const fields = editorFields(message.itemId);
      if (!Number.isSafeInteger(message.price) || message.price < 400 || Number(fields.price.value) !== message.price - 100) throw new Error("\u2212100\u5186\u306E\u5165\u529B\u304C\u4E00\u81F4\u3057\u306A\u3044\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      let touched = false;
      const onInput = (event) => {
        if (event.isTrusted) touched = true;
      };
      const events = ["input", "change", "pointerdown", "keydown"];
      events.forEach((name) => document.addEventListener(name, onInput, true));
      const assertForm = () => {
        const fresh = editorFields(message.itemId);
        if (touched || fresh.price !== fields.price || fresh.submit !== fields.submit || !fields.price.isConnected) {
          throw new Error("\u7DE8\u96C6\u753B\u9762\u304C\u64CD\u4F5C\u3055\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002\u4FDD\u5B58\u306F\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002");
        }
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 700));
        assertForm();
        const result = await request("AUTHORIZE", { jobId: message.jobId, itemId: message.itemId });
        assertForm();
        if (!result.allowed || result.nextPrice !== message.price - 100 || Number(fields.price.value) !== result.nextPrice) throw new Error("\u4FDD\u5B58\u76F4\u524D\u306E\u4FA1\u683C\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002");
        respond({ submitted: true });
        fields.submit.click();
      } finally {
        events.forEach((name) => document.removeEventListener(name, onInput, true));
      }
    }
    api.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== api.runtime.id || sender.tab) return false;
      if (message?.type === `${P.PREFIX}ITEM_READY`) {
        try {
          itemEditLink(message.itemId);
          respond({ ready: !itemOpened });
        } catch {
          respond({ ready: false });
        }
        return false;
      }
      if (message?.type === `${P.PREFIX}ITEM_OPEN_EDIT`) {
        try {
          if (itemOpened) throw new Error("\u3053\u306E\u5546\u54C1\u3067\u306F\u65E2\u306B\u7DE8\u96C6\u3078\u9032\u3093\u3067\u3044\u307E\u3059\u3002");
          const link = itemEditLink(message.itemId);
          itemOpened = true;
          respond({ opened: true });
          location.assign(link.href);
        } catch (error) {
          respond({ error: error instanceof Error ? error.message : "\u7DE8\u96C6\u3078\u9032\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
        }
        return false;
      }
      if (message?.type === `${P.PREFIX}EDITOR_READY`) {
        if (editorTouched) {
          respond({ error: "\u7DE8\u96C6\u753B\u9762\u304C\u64CD\u4F5C\u3055\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002" });
          return false;
        }
        try {
          editorFields(message.itemId);
          respond({ ready: !editorUsed });
        } catch {
          respond({ ready: false });
        }
        return false;
      }
      if (message?.type !== `${P.PREFIX}EDITOR_APPLY`) return false;
      void apply(message, respond).catch((error) => respond({ error: error instanceof Error ? error.message : "\u4FDD\u5B58\u524D\u306B\u505C\u6B62\u3057\u307E\u3057\u305F\u3002" }));
      return true;
    });
  })();
})();
