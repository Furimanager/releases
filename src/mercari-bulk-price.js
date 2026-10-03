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
      mounted.setAttribute("aria-label", "\u30D5\u30EA\u30DE\u30CD \u4E00\u62EC\u5024\u4E0B\u3052");
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
    function render() {
      if (!mounted) return;
      const key = JSON.stringify([state, pending, owns]);
      if (key === lastRender) return;
      lastRender = key;
      const error = mounted.querySelector(".fm-bulk-error");
      const detailsOpen = mounted.querySelector("details")?.open ?? false;
      const resultScroll = mounted.querySelector(".fm-bulk-results")?.scrollTop ?? 0;
      const focusedLabel = mounted.contains(document.activeElement) ? document.activeElement?.textContent : null;
      const heading = element("div", "\u30D5\u30EA\u30DE\u30CD \u4E00\u62EC\u5024\u4E0B\u3052", "fm-bulk-heading");
      const content = element("div", "", "fm-bulk-content");
      const toolbar = element("div", "", "fm-bulk-toolbar");
      const label = element("p", "\u66F4\u65B0\u304B\u308924\u6642\u9593\u4EE5\u4E0A\u7D4C\u904E\u3057\u305F\u5546\u54C1\u3092\u3001\u54041\u56DE100\u5186\u5024\u4E0B\u3052", "fm-bulk-hint");
      const actions = element("div", "", "fm-bulk-actions");
      const active = ["scanning", "ready", "running"].includes(state.status);
      if (!active) {
        const start = button(pending ? "\u78BA\u8A8D\u4E2D\u2026" : "\u4E00\u62EC \u2212100\u5186", "START");
        start.title = "\u5BFE\u8C61\u5546\u54C1\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u3001\u54041\u56DE100\u5186\u5024\u4E0B\u3052\u3057\u307E\u3059";
        actions.append(start);
      }
      if (state.status === "ready" && owns && state.candidates?.length) actions.append(button(`${state.candidates.length}\u4EF6\u3092\u2212100\u5186`, "EXECUTE"));
      if (active && owns) actions.append(button(state.status === "ready" ? "\u30AD\u30E3\u30F3\u30BB\u30EB" : "\u505C\u6B62", "CANCEL", true));
      toolbar.append(label, actions);
      content.append(toolbar);
      mounted.replaceChildren(heading, content);
      if (state.status !== "idle") {
        const status = element("p", state.message ?? "\u78BA\u8A8D\u4E2D\u2026", "fm-bulk-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        content.append(status);
        if (active && !owns) content.append(element("p", "\u958B\u59CB\u3057\u305F\u30BF\u30D6\u3067\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "fm-bulk-note"));
        content.append(element("p", `\u78BA\u8A8D ${state.scanned ?? 0}\u4EF6 \uFF0F \u5BFE\u8C61 ${state.candidates?.length ?? 0}\u4EF6 \uFF0F \u5B8C\u4E86 ${state.completed ?? 0}\u4EF6 \uFF0F \u5BFE\u8C61\u5916\u30FB\u9664\u5916 ${state.skipped ?? 0}\u4EF6`, "fm-bulk-counts"));
        if (["ready", "running"].includes(state.status)) {
          content.append(element("p", "400\u5186\u672A\u6E80\u30FB\u65E5\u6642\u4E0D\u660E\u306E\u5546\u54C1\u306A\u3069\u306F\u5BFE\u8C61\u5916\u3067\u3059\u3002\u5B9F\u884C\u4E2D\u306F\u3053\u306E\u4E00\u89A7\u3092\u958B\u3044\u305F\u307E\u307E\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u505C\u6B62\u6642\u3082\u4FDD\u5B58\u3092\u958B\u59CB\u3057\u305F1\u4EF6\u306F\u7D50\u679C\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002", "fm-bulk-note"));
        }
        if (state.rows?.length) {
          const details = element("details");
          details.open = detailsOpen;
          details.append(element("summary", "\u5BFE\u8C61\u3068\u7D50\u679C\u3092\u898B\u308B"));
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
      if (focusedLabel) [...mounted.querySelectorAll("button, summary")].find((node) => node.textContent === focusedLabel)?.focus({ preventScroll: true });
    }
    async function poll() {
      mount();
      if (!mounted || pending) return;
      const epoch = actionEpoch;
      try {
        const response = await request("STATUS");
        if (epoch !== actionEpoch) return;
        state = response.state;
        owns = response.owns;
        render();
      } catch (error) {
        showError(error);
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
    setInterval(() => {
      void poll();
    }, 5e3);
    void poll();
    let editorUsed = false;
    function editorFields(itemId) {
      if (editorTouched) throw new Error("\u7DE8\u96C6\u753B\u9762\u304C\u64CD\u4F5C\u3055\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002\u4FDD\u5B58\u306F\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002");
      if (location.href !== `${P.ORIGIN}/sell/edit/${itemId}`) throw new Error("\u7DE8\u96C6\u5BFE\u8C61\u306E\u30DA\u30FC\u30B8\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      const inputs = [...document.querySelectorAll('input[data-testid="price-input"][name="price"]')];
      const buttons = [...document.querySelectorAll('button[data-testid="edit-button"]')];
      if (inputs.length !== 1 || buttons.length !== 1 || buttons[0].textContent?.trim() !== "\u5909\u66F4\u3059\u308B" || inputs[0].disabled || inputs[0].readOnly || buttons[0].disabled) throw new Error("\u4FA1\u683C\u6B04\u307E\u305F\u306F\u5909\u66F4\u30DC\u30BF\u30F3\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      return { price: inputs[0], submit: buttons[0] };
    }
    async function apply(message, respond) {
      if (editorUsed) throw new Error("\u3053\u306E\u7DE8\u96C6\u753B\u9762\u3067\u306F\u65E2\u306B\u5B9F\u884C\u6E08\u307F\u3067\u3059\u3002");
      editorUsed = true;
      const fields = editorFields(message.itemId);
      if (!Number.isSafeInteger(message.price) || message.price < 400 || Number(fields.price.value) !== message.price) throw new Error("\u4FA1\u683C\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
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
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setValue) throw new Error("\u4FA1\u683C\u6B04\u3078\u5165\u529B\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        setValue.call(fields.price, String(message.price - 100));
        fields.price.dispatchEvent(new Event("input", { bubbles: true }));
        fields.price.dispatchEvent(new Event("change", { bubbles: true }));
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
