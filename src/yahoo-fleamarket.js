(() => {
  (() => {
    const dom = globalThis.FurimanagerYahooDom;
    const chromeApi = globalThis.chrome;
    if (!dom || !chromeApi?.storage?.local || ![dom.ORIGIN, dom.SELL_ORIGIN].includes(location.origin)) return;
    const NAV_KEY = "furimanager_yahoo_navigation";
    const JOB_PREFIX = "furimanager_yahoo_relist_";
    const MAX_AGE_MS = 12e4;
    let running = false;
    let queued = false;
    let lastUrl = location.href;
    const style = document.createElement("style");
    style.textContent = `
    .furimanager-yahoo-toolbar {display:flex;flex-wrap:wrap;gap:6px;padding:10px;margin:6px 0;background:#ffd8eb;border-radius:10px;box-sizing:border-box;max-width:100%}
    .furimanager-yahoo-toolbar button {min-height:34px;padding:0 10px;border:0;border-radius:10px;background:#ff4fa3;color:#fff;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
    .furimanager-yahoo-toolbar button:hover {background:#f13d94}
    .furimanager-yahoo-toolbar button:disabled {opacity:.55;cursor:wait}
    #furimanager-yahoo-status {position:fixed;bottom:16px;right:16px;z-index:2147483646;max-width:min(460px,calc(100vw - 32px));max-height:50vh;overflow:auto;box-sizing:border-box;padding:14px 18px;background:#150c2b;color:white;border:1px solid #ec4899;border-radius:12px;font-size:14px;line-height:1.65;white-space:pre-wrap}
    @media(max-width:640px){.furimanager-yahoo-toolbar button{min-height:40px;font-size:13px}}
  `;
    document.head.append(style);
    function notify(message) {
      let box = document.getElementById("furimanager-yahoo-status");
      if (!box) {
        box = document.createElement("div");
        box.id = "furimanager-yahoo-status";
        box.setAttribute("role", "status");
        box.addEventListener("click", () => box?.remove());
        document.body.append(box);
      }
      box.textContent = `\u30D5\u30EA\u30DE\u30CD
${message}`;
    }
    function errorMessage(error) {
      const message = error instanceof Error ? error.message : "\u51E6\u7406\u3092\u7D9A\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002";
      return /Extension context invalidated/i.test(message) ? "\u62E1\u5F35\u6A5F\u80FD\u304C\u518D\u8AAD\u307F\u8FBC\u307F\u3055\u308C\u307E\u3057\u305F\u3002\u3053\u306E\u5546\u54C1\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3001\u3082\u3046\u4E00\u5EA6\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : message;
    }
    function createFormGuard(form) {
      const sourceUrl = location.href;
      let edited = false;
      let writing = false;
      const events = ["input", "change", "click", "drop"];
      const onEdit = (event) => {
        if (event.isTrusted && !writing && (form.contains(event.target) || document.querySelector("#addimg")?.contains(event.target))) edited = true;
      };
      for (const name of events) document.addEventListener(name, onEdit, true);
      return {
        check() {
          if (location.href !== sourceUrl || !form.isConnected || document.querySelector("main form") !== form) {
            throw new Error("\u753B\u9762\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002\u5143\u306E\u5546\u54C1\u30DA\u30FC\u30B8\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          }
          if (edited) throw new Error("\u624B\u52D5\u64CD\u4F5C\u3092\u78BA\u8A8D\u3057\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002\u5165\u529B\u6E08\u307F\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        },
        // radio.click()はブラウザーがtrustedなinput/changeを発火する。
        // 同期的な自動操作の間だけ除外し、通信待ち中の本人操作は検知する。
        write(action) {
          writing = true;
          try {
            action();
          } finally {
            writing = false;
          }
        },
        dispose() {
          for (const name of events) document.removeEventListener(name, onEdit, true);
        }
      };
    }
    function readNavigation() {
      try {
        const value = JSON.parse(sessionStorage.getItem(NAV_KEY) || "null");
        if (value && /^z\d+$/.test(value.itemId) && ["relist", "draft", "decrease", "increase", "stop", "delete", "inventory"].includes(value.action) && typeof value.savedAt === "number" && Date.now() >= value.savedAt && Date.now() - value.savedAt <= MAX_AGE_MS) return value;
      } catch {
      }
      sessionStorage.removeItem(NAV_KEY);
      return null;
    }
    async function waitFor(find, timeout = 8e3) {
      const start = Date.now();
      const sourceUrl = location.href;
      while (Date.now() - start < timeout) {
        if (location.href !== sourceUrl) throw new Error("\u753B\u9762\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u51E6\u7406\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
        const value = find();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("\u5BFE\u8C61\u306E\u5165\u529B\u6B04\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u753B\u9762\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
    function toolbar(mount, id) {
      const existing = mount.querySelector(".furimanager-yahoo-toolbar");
      if (existing?.dataset.itemId === id) return;
      existing?.remove();
      const bar = document.createElement("div");
      bar.className = "furimanager-yahoo-toolbar";
      bar.dataset.itemId = id;
      bar.setAttribute("aria-label", "\u30D5\u30EA\u30DE\u30CD \u5546\u54C1\u64CD\u4F5C");
      const definitions = [["inventory", "\u5728\u5EAB\u9023\u643A"], ["relist", "\u518D\u51FA\u54C1"], ["decrease", "-100"], ["increase", "+100"], ["draft", "\u4E0B\u66F8\u304D"], ["stop", "\u505C\u6B62"], ["delete", "\u524A\u9664"]];
      for (const [action, label] of definitions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.furimanagerYahooAction = action;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (running) return;
          const navigation = { itemId: id, action, savedAt: Date.now() };
          sessionStorage.setItem(NAV_KEY, JSON.stringify(navigation));
          if (location.pathname === `/item/${id}`) void runNavigation(navigation);
          else location.assign(`${dom.ORIGIN}/item/${id}`);
        });
        bar.append(button);
      }
      mount.append(bar);
    }
    function scan() {
      if (running) return;
      if (location.origin === dom.ORIGIN && location.pathname === "/my/item/selling") {
        for (const card of document.querySelectorAll("#itm > div")) {
          const link = card.querySelector(":scope > a[href]");
          const id2 = link && dom.itemId(link.href);
          if (id2) toolbar(card, id2);
        }
      }
      const id = dom.itemId(location.href);
      if (!id) return;
      const pending = readNavigation();
      if (pending && pending.itemId !== id) {
        sessionStorage.removeItem(NAV_KEY);
        return;
      }
      if (location.pathname === `/item/${id}`) {
        const edit = dom.editLink(document, id);
        if (edit) toolbar(edit.parentElement, id);
        const gallery = document.querySelector("main .slick-slider");
        const copyAnchor = edit?.parentElement?.querySelector(".furimanager-yahoo-toolbar") ?? gallery;
        if (copyAnchor) globalThis.FurimanagerCrossListing?.mount(copyAnchor, () => dom.collectItem(document, location.href), location.href);
        if (!edit) return;
        if (pending) void runNavigation(pending);
      } else if (location.pathname === `/item/${id}/edit` && pending && document.querySelector("main form")) {
        void runNavigation(pending);
      }
    }
    async function runNavigation(pending) {
      if (running) return;
      running = true;
      try {
        if (dom.itemId(location.href) !== pending.itemId) throw new Error("\u5546\u54C1\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u51E6\u7406\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
        if (location.pathname === `/item/${pending.itemId}`) {
          const edit = dom.editLink(document, pending.itemId);
          if (!edit) throw new Error("\u81EA\u5206\u306E\u5546\u54C1\u306E\u7DE8\u96C6\u30EA\u30F3\u30AF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
          if (pending.action === "inventory") {
            const item = await waitFor(() => dom.collectItem(document, location.href));
            const response = await chromeApi.runtime.sendMessage({ type: "OPEN_INVENTORY_LINK", payload: {
              platform: "paypay_flea",
              yahooItemId: item.itemId,
              listingUrl: item.itemUrl,
              listingTitle: item.title,
              listingPrice: item.price,
              listingStatus: "active",
              imageUrl: item.imageUrls[0] ?? null,
              capturedAt: (/* @__PURE__ */ new Date()).toISOString()
            } });
            if (!response?.success) throw new Error(response?.message || "\u5728\u5EAB\u9023\u643A\u30DA\u30FC\u30B8\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            sessionStorage.removeItem(NAV_KEY);
            notify("\u5728\u5EAB\u9023\u643A\u30DA\u30FC\u30B8\u3092\u958B\u304D\u307E\u3057\u305F\u3002");
          } else if (pending.action === "relist" || pending.action === "draft") {
            const item = await waitFor(() => dom.collectItem(document, location.href));
            if (!item.imageUrls.length || !item.categoryPath.length) throw new Error("\u753B\u50CF\u307E\u305F\u306F\u30AB\u30C6\u30B4\u30EA\u3092\u53D6\u5F97\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u65B0\u898F\u51FA\u54C1\u753B\u9762\u3092\u958B\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            const token = crypto.randomUUID();
            await chromeApi.storage.local.set({ [JOB_PREFIX + token]: { item, mode: pending.action, savedAt: Date.now() } });
            const response = await chromeApi.runtime.sendMessage({ type: "OPEN_YAHOO_RELIST", token });
            if (!response?.success) {
              await chromeApi.storage.local.remove(JOB_PREFIX + token);
              throw new Error("\u65B0\u898F\u51FA\u54C1\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            }
            sessionStorage.removeItem(NAV_KEY);
            notify("\u65B0\u3057\u3044\u30BF\u30D6\u3067\u51FA\u54C1\u5185\u5BB9\u3092\u5165\u529B\u3057\u307E\u3059\u3002\u6700\u5F8C\u306E\u78BA\u5B9A\u306F\u753B\u9762\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          } else {
            location.assign(edit.href);
          }
        } else {
          sessionStorage.removeItem(NAV_KEY);
          const form = document.querySelector("main form");
          if (!form) throw new Error("\u7DE8\u96C6\u30D5\u30A9\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
          if (pending.action === "decrease" || pending.action === "increase") {
            const field = await waitFor(() => {
              const candidate = dom.priceField(form);
              return candidate && dom.price(candidate.value) !== null ? candidate : null;
            });
            const current = dom.price(field.value);
            const next = current === null ? null : dom.adjustedPrice(current, pending.action === "decrease" ? -100 : 100);
            if (next === null) throw new Error("\u8CA9\u58F2\u4FA1\u683C\u306E\u7BC4\u56F2\uFF08300\u301C9,999,999\u5186\uFF09\u3067100\u5186\u5909\u66F4\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            dom.setPriceValue(field, String(next));
            await new Promise((resolve) => setTimeout(resolve, 300));
            if (!form.isConnected || dom.itemId(location.href) !== pending.itemId || dom.priceField(form)?.value !== String(next)) throw new Error("\u4FA1\u683C\u6B04\u3078\u306E\u53CD\u6620\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            notify(`${current.toLocaleString()}\u5186 \u2192 ${next.toLocaleString()}\u5186\u3092\u5165\u529B\u3057\u307E\u3057\u305F\u3002
\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u300C\u5909\u66F4\u3059\u308B\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
          } else if (pending.action === "stop" || pending.action === "delete") {
            const label = pending.action === "delete" ? "\u5546\u54C1\u3092\u524A\u9664\u3059\u308B" : "\u51FA\u54C1\u3092\u505C\u6B62\u3059\u308B";
            const button = dom.exactButton(form, label);
            if (!button) throw new Error(pending.action === "stop" ? "\u505C\u6B62\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u516C\u958B\u505C\u6B62\u4E2D\u306E\u5546\u54C1\u306F\u518D\u958B\u305B\u305A\u3001\u305D\u306E\u307E\u307E\u306B\u3057\u3066\u3044\u307E\u3059\u3002" : "\u524A\u9664\u30DC\u30BF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
            button.scrollIntoView({ block: "center" });
            notify(`\u5BFE\u8C61\u5546\u54C1\u306E\u300C${label}\u300D\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u78BA\u5B9A\u64CD\u4F5C\u306F\u624B\u52D5\u3067\u884C\u3063\u3066\u304F\u3060\u3055\u3044\u3002`);
          }
        }
      } catch (error) {
        sessionStorage.removeItem(NAV_KEY);
        notify(errorMessage(error));
      } finally {
        running = false;
      }
    }
    function onScreen(element) {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }
    function openPicker(section) {
      const closeButtons = Array.from(section.querySelectorAll('button img[alt="\u9589\u3058\u308B\u30DC\u30BF\u30F3"]')).filter(onScreen);
      return closeButtons.length === 1 ? closeButtons[0].closest("button")?.parentElement?.parentElement ?? null : null;
    }
    function pickerMatches(form, name, values) {
      const selected = dom.fieldSection(form, name)?.children[1];
      if (!selected || !values.length) return false;
      const display = name === "\u5546\u54C1\u306E\u72B6\u614B" ? selected.querySelector("p") : selected;
      if (!display) return false;
      const actual = dom.text(display.textContent).split(/\s*>\s*/);
      return actual.length === values.length && values.every((value, index) => actual[index] === value);
    }
    async function fillPicker(form, name, values, check = () => {
    }) {
      check();
      const section = dom.fieldSection(form, name);
      if (!section || !values.length) return false;
      const control = section.children[1];
      if (!control) return false;
      control.querySelector("p")?.click();
      try {
        for (const value of values) {
          const choice = await waitFor(() => {
            check();
            const panel = openPicker(section);
            if (!panel) return null;
            const options = Array.from(panel.querySelectorAll(name === "\u30AB\u30C6\u30B4\u30EA" ? "li" : "p")).filter(
              (element) => dom.text(element.textContent) === value && (name !== "\u30AB\u30C6\u30B4\u30EA" || !element.querySelector("button"))
            );
            return options.length === 1 ? options[0] : null;
          }, 3500);
          check();
          choice.scrollIntoView({ block: "center" });
          choice.click();
          await new Promise((resolve) => setTimeout(resolve, 200));
          check();
        }
        return await waitFor(() => {
          check();
          return pickerMatches(form, name, values) ? true : null;
        }, 3500);
      } catch {
        check();
        return pickerMatches(form, name, values);
      } finally {
        let current = true;
        try {
          check();
        } catch {
          current = false;
        }
        if (current) openPicker(section)?.querySelector('button img[alt="\u9589\u3058\u308B\u30DC\u30BF\u30F3"]')?.closest("button")?.click();
      }
    }
    async function fillImages(form, urls, check = () => {
    }, prepared) {
      check();
      if (!urls.length || urls.length > 20 || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) return false;
      const files = new DataTransfer();
      if (prepared) prepared.forEach((file) => files.items.add(file));
      for (let index = 0; !prepared && index < urls.length; index++) {
        const response = await chromeApi.runtime.sendMessage({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: urls[index] });
        check();
        if (!response?.success || !/^data:image\/(jpeg|png|webp);base64,/.test(response.dataUrl ?? "")) throw new Error(`\u753B\u50CF${index + 1}\u679A\u76EE\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
        const blob = await (await fetch(response.dataUrl)).blob();
        check();
        files.items.add(new File([blob], `furimanager-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type }));
      }
      const addButton = dom.exactButton(form, "\u753B\u50CF\u3092\u8FFD\u52A0\u3059\u308B");
      check();
      if (form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("\u753B\u50CF\u304C\u8FFD\u52A0\u3055\u308C\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002\u753B\u50CF\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      if (!addButton) return false;
      if (document.querySelector('#addimg[role="dialog"]')) throw new Error("\u753B\u50CF\u9078\u629E\u753B\u9762\u304C\u65E2\u306B\u958B\u3044\u3066\u3044\u308B\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
      addButton.click();
      const album = await waitFor(() => {
        check();
        return dom.unique(document, '#addimg[role="dialog"] input#album[type="file"][multiple]');
      });
      check();
      if (form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("\u753B\u50CF\u304C\u8FFD\u52A0\u3055\u308C\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002\u753B\u50CF\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      album.files = files.files;
      album.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        await waitFor(() => {
          check();
          return form.querySelectorAll('img[src^="https://auctions.c.yimg.jp/"]').length === urls.length ? true : null;
        }, 2e4);
        return true;
      } catch {
        check();
        return false;
      }
    }
    function selectedHashtags(form) {
      return Array.from(form.querySelectorAll("#item-description p")).filter((element) => element.parentElement?.querySelector('button[aria-label="\u524A\u9664"]')).map((element) => dom.text(element.textContent));
    }
    async function fillHashtags(form, hashtags, check = () => {
    }, write = (action) => action()) {
      const expected = [...new Set(hashtags)];
      for (const tag of expected) {
        check();
        if (selectedHashtags(form).includes(tag)) continue;
        const field = dom.unique(form, 'input[placeholder="\u30CF\u30C3\u30B7\u30E5\u30BF\u30B0\u3092\u8FFD\u52A0\u3059\u308B"]');
        const value = tag.startsWith("#") ? tag.slice(1) : "";
        if (!field || field.value || !value || /[\s#]/.test(value) || field.maxLength > 0 && value.length > field.maxLength) return false;
        write(() => {
          field.focus({ preventScroll: true });
          dom.setValue(field, value);
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        check();
        if (!field.isConnected || field.value !== value) return false;
        write(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
        try {
          await waitFor(() => {
            check();
            return selectedHashtags(form).includes(tag) && !field.value ? true : null;
          }, 3500);
        } catch {
          check();
          return false;
        }
        write(() => field.blur());
      }
      check();
      const actual = selectedHashtags(form);
      return actual.length === expected.length && expected.every((tag) => actual.includes(tag));
    }
    async function fillRelist() {
      const token = location.hash.match(/^#furimanager-yahoo=([0-9a-f-]{36})$/)?.[1];
      if (location.origin !== dom.SELL_ORIGIN || location.pathname !== "/item/add" || !token) return;
      const sourceUrl = location.href;
      const key = JOB_PREFIX + token;
      let guard;
      running = true;
      try {
        const state = await chromeApi.storage.local.get(key);
        if (location.href !== sourceUrl) throw new Error("\u753B\u9762\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
        const job = state[key];
        if (!job || typeof job.savedAt !== "number" || Date.now() < job.savedAt || Date.now() - job.savedAt > MAX_AGE_MS) throw new Error("\u5F15\u304D\u7D99\u3050\u51FA\u54C1\u30C7\u30FC\u30BF\u304C\u671F\u9650\u5207\u308C\u3067\u3059\u3002\u5546\u54C1\u30DA\u30FC\u30B8\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        const item = job.item;
        if (!["relist", "draft"].includes(job.mode) || !item || dom.itemId(item.itemUrl) !== item.itemId || !Array.isArray(item.imageUrls) || item.imageUrls.some((url) => !dom.imageUrl(url))) throw new Error("\u51FA\u54C1\u30C7\u30FC\u30BF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        const form = await waitFor(() => {
          const candidate = document.querySelector("main form");
          return candidate && dom.unique(candidate, 'input[placeholder="\u5546\u54C1\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5FC5\u9808\uFF09"]') && dom.unique(candidate, "textarea") && dom.priceField(candidate) ? candidate : null;
        });
        if (location.href !== sourceUrl || !form.isConnected || document.querySelector("main form") !== form) throw new Error("\u753B\u9762\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
        const title = dom.unique(form, 'input[placeholder="\u5546\u54C1\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5FC5\u9808\uFF09"]');
        const description = dom.unique(form, "textarea");
        const amount = dom.priceField(form);
        if (!title || !description || !amount) throw new Error("\u51FA\u54C1\u30D5\u30A9\u30FC\u30E0\u306E\u9805\u76EE\u304C\u5909\u308F\u3063\u3066\u3044\u307E\u3059\u3002\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
        if (title.value || description.value || amount.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("\u5165\u529B\u6E08\u307F\u306E\u5185\u5BB9\u304C\u3042\u308B\u305F\u3081\u3001\u4E0A\u66F8\u304D\u305B\u305A\u6B62\u3081\u307E\u3057\u305F\u3002\u7A7A\u306E\u65B0\u898F\u51FA\u54C1\u753B\u9762\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        history.replaceState(history.state, "", location.pathname + location.search);
        guard = createFormGuard(form);
        const check = guard.check;
        await chromeApi.storage.local.remove(key);
        check();
        if (title.value || description.value || amount.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("\u5165\u529B\u6E08\u307F\u306E\u5185\u5BB9\u304C\u3042\u308B\u305F\u3081\u3001\u4E0A\u66F8\u304D\u305B\u305A\u6B62\u3081\u307E\u3057\u305F\u3002");
        notify("\u5546\u54C1\u60C5\u5831\u3092\u5165\u529B\u3057\u3066\u3044\u307E\u3059\u2026");
        const missing = [];
        dom.setValue(title, item.title);
        dom.setValue(description, item.description);
        if (!await fillPicker(form, "\u30AB\u30C6\u30B4\u30EA", item.categoryPath, check)) missing.push("\u30AB\u30C6\u30B4\u30EA");
        check();
        if (!await fillPicker(form, "\u5546\u54C1\u306E\u72B6\u614B", [item.rows["\u5546\u54C1\u306E\u72B6\u614B"]].filter(Boolean), check)) missing.push("\u5546\u54C1\u306E\u72B6\u614B");
        check();
        const shippingName = item.rows["\u914D\u9001\u306E\u65B9\u6CD5"] === "\u304A\u3066\u304C\u308B\u914D\u9001\uFF08\u65E5\u672C\u90F5\u4FBF\uFF09" ? "JAPAN_POST" : item.rows["\u914D\u9001\u306E\u65B9\u6CD5"] === "\u304A\u3066\u304C\u308B\u914D\u9001\uFF08\u30E4\u30DE\u30C8\u904B\u8F38\uFF09" ? "YAMATO" : null;
        const shipping = shippingName && dom.unique(form, `input[type="radio"][name="${shippingName}"]`);
        if (shipping) {
          if (!shipping.checked) guard.write(() => shipping.click());
        } else missing.push("\u914D\u9001\u65B9\u6CD5");
        if (!dom.selectText(form.querySelector('select[name="timeToShip"]'), item.rows["\u767A\u9001\u307E\u3067\u306E\u65E5\u6570"])) missing.push("\u767A\u9001\u307E\u3067\u306E\u65E5\u6570");
        if (!dom.selectText(form.querySelector('select[name="prefectures"]'), item.rows["\u767A\u9001\u5143\u306E\u5730\u57DF"])) missing.push("\u767A\u9001\u5143\u306E\u5730\u57DF");
        const handled = /* @__PURE__ */ new Set(["\u30AB\u30C6\u30B4\u30EA", "\u5546\u54C1\u306E\u72B6\u614B", "\u914D\u9001\u306E\u65B9\u6CD5", "\u767A\u9001\u307E\u3067\u306E\u65E5\u6570", "\u767A\u9001\u5143\u306E\u5730\u57DF", "\u5546\u54C1ID"]);
        for (const [name, value] of Object.entries(item.rows)) {
          if (handled.has(name) || !value) continue;
          const select = Array.from(form.querySelectorAll("select")).find((element) => element.name === name) ?? null;
          if (!dom.selectText(select, value)) missing.push(`${name}\uFF1A${value}`);
        }
        if (!await fillHashtags(form, item.hashtags, check, guard.write)) missing.push(`\u30CF\u30C3\u30B7\u30E5\u30BF\u30B0\uFF08\u5143\u306E\u5185\u5BB9\uFF09\uFF1A${item.hashtags.join(" ") || "\u306A\u3057"}`);
        if (!await fillImages(form, item.imageUrls, check)) missing.push("\u753B\u50CF\uFF08\u81EA\u52D5\u8FFD\u52A0\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF09");
        check();
        const finalPrice = dom.priceField(form);
        if (finalPrice && Number.isSafeInteger(item.price) && item.price >= 300 && item.price <= 9999999) guard.write(() => dom.setPriceValue(finalPrice, String(item.price)));
        else missing.push("\u8CA9\u58F2\u4FA1\u683C");
        await new Promise((resolve) => setTimeout(resolve, 300));
        check();
        if (title.value !== item.title) missing.push("\u5546\u54C1\u540D");
        if (description.value !== item.description) missing.push("\u5546\u54C1\u8AAC\u660E");
        if (!finalPrice || dom.price(finalPrice.value) !== item.price) missing.push("\u8CA9\u58F2\u4FA1\u683C\u306E\u4E00\u81F4");
        const finalLabel = job.mode === "draft" ? "\u4E0B\u66F8\u304D\u306B\u4FDD\u5B58\u3059\u308B" : "\u51FA\u54C1\u3059\u308B";
        const finalButton = dom.exactButton(form, finalLabel);
        if (!finalButton || finalButton.disabled) missing.push(`\u300C${finalLabel}\u300D\u306E\u6709\u52B9\u5316`);
        const categoryWarning = missing.indexOf("\u30AB\u30C6\u30B4\u30EA");
        if (categoryWarning >= 0 && pickerMatches(form, "\u30AB\u30C6\u30B4\u30EA", item.categoryPath)) missing.splice(categoryWarning, 1);
        notify(missing.length ? `\u5165\u529B\u3067\u304D\u305F\u9805\u76EE\u3092\u53CD\u6620\u3057\u307E\u3057\u305F\u3002\u6B21\u306E\u9805\u76EE\u306F\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002
\u30FB${[...new Set(missing)].join("\n\u30FB")}
\u5143\u306E\u4FA1\u683C\uFF1A${item.price.toLocaleString()}\u5186
\u6700\u5F8C\u306B\u300C${finalLabel}\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002` : `\u5165\u529B\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u4FA1\u683C\uFF1A${item.price.toLocaleString()}\u5186
\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u300C${finalLabel}\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
      } catch (error) {
        notify(errorMessage(error));
      } finally {
        guard?.dispose();
        try {
          await chromeApi.storage.local.remove(key);
        } catch {
        }
        running = false;
      }
    }
    function scheduleScan() {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        scan();
      }, 250);
    }
    async function fillCrossListing(item, job, check) {
      const cross2 = globalThis.FurimanagerCrossListing;
      const form = await cross2.wait(() => {
        const f2 = document.querySelector("main form");
        return f2 && dom.unique(f2, 'input[placeholder="\u5546\u54C1\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5FC5\u9808\uFF09"]') && dom.unique(f2, "textarea") && dom.priceField(f2) ? f2 : null;
      }, check);
      const fields = () => ({ title: dom.unique(form, 'input[placeholder="\u5546\u54C1\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5FC5\u9808\uFF09"]'), description: dom.unique(form, "textarea"), price: dom.priceField(form) });
      const empty = () => {
        check();
        const f2 = fields();
        if (!form.isConnected || !f2.title || !f2.description || !f2.price || f2.title.value || f2.description.value || f2.price.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("\u5165\u529B\u6E08\u307F\u306E\u5185\u5BB9\u304C\u3042\u308B\u305F\u3081\u3001\u4E0A\u66F8\u304D\u305B\u305A\u6B62\u3081\u307E\u3057\u305F\u3002\u7A7A\u306E\u51FA\u54C1\u753B\u9762\u3067\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      };
      const originalCheck = check;
      check = () => {
        originalCheck();
        if (!form.isConnected || document.querySelector("main form") !== form) throw new Error("\u51FA\u54C1\u30D5\u30A9\u30FC\u30E0\u304C\u5207\u308A\u66FF\u308F\u3063\u305F\u305F\u3081\u3001\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002");
      };
      empty();
      await cross2.claim(job, check);
      const files = await cross2.files(job, check);
      empty();
      const warnings = ["\u30AB\u30C6\u30B4\u30EA"];
      const values = cross2.metadata(item);
      if (!await fillImages(form, item.imageUrls, check, files)) warnings.push("\u753B\u50CF\u306E\u8FFD\u52A0\u679A\u6570");
      check();
      const f = fields();
      if (!f.title || !f.description || !f.price || f.title.value || f.description.value || f.price.value) throw new Error("\u5225\u306E\u5165\u529B\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u305F\u305F\u3081\u3001\u4E0A\u66F8\u304D\u305B\u305A\u6B62\u3081\u307E\u3057\u305F\u3002");
      const expectedTitle = cross2.setTitle(f.title, item, warnings);
      cross2.setText(f.description, item.description, "\u8AAC\u660E", warnings);
      dom.setPriceValue(f.price, String(item.price));
      if (!values.condition || !await fillPicker(form, "\u5546\u54C1\u306E\u72B6\u614B", [values.condition], check)) warnings.push("\u5546\u54C1\u306E\u72B6\u614B");
      check();
      const shippingSelector = values.carrier ? `input[type="radio"][name="${values.carrier === "post" ? "JAPAN_POST" : "YAMATO"}"]` : null;
      const shipping = shippingSelector ? dom.unique(form, shippingSelector) : null;
      if (shipping && !shipping.disabled) {
        if (!shipping.checked) {
          if (originalCheck.write) originalCheck.write(() => shipping.click());
          else shipping.click();
        }
      } else warnings.push("\u914D\u9001\u65B9\u6CD5");
      check();
      if (!values.shippingPayer) warnings.push("\u9001\u6599\u8CA0\u62C5\uFF08Yahoo!\u30D5\u30EA\u30DE\u306F\u51FA\u54C1\u8005\u8CA0\u62C5\u3067\u3059\uFF09");
      if (!cross2.selectExact(form.querySelector('select[name="timeToShip"]'), values.shippingDays)) warnings.push("\u767A\u9001\u307E\u3067\u306E\u65E5\u6570");
      if (!cross2.selectExact(form.querySelector('select[name="prefectures"]'), values.shippingFrom)) warnings.push("\u767A\u9001\u5143\u306E\u5730\u57DF\uFF08\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\uFF09");
      if (item.brand) warnings.push("\u30D6\u30E9\u30F3\u30C9");
      if (item.size) warnings.push("\u30B5\u30A4\u30BA");
      await new Promise((resolve) => setTimeout(resolve, 400));
      check();
      const final = fields();
      if (final.title?.value !== expectedTitle) warnings.push("\u5546\u54C1\u540D\u306E\u4E00\u81F4");
      if (final.description?.value !== item.description) warnings.push("\u8AAC\u660E\u306E\u4E00\u81F4");
      if (dom.price(final.price?.value ?? "") !== item.price) warnings.push("\u4FA1\u683C\u306E\u4E00\u81F4");
      if (values.condition && !pickerMatches(form, "\u5546\u54C1\u306E\u72B6\u614B", [values.condition])) warnings.push("\u5546\u54C1\u306E\u72B6\u614B");
      if (shippingSelector && !dom.unique(form, shippingSelector)?.checked) warnings.push("\u914D\u9001\u65B9\u6CD5");
      if (values.shippingDays && !cross2.selectedExact(form.querySelector('select[name="timeToShip"]'), values.shippingDays)) warnings.push("\u767A\u9001\u307E\u3067\u306E\u65E5\u6570");
      if (values.shippingFrom && !cross2.selectedExact(form.querySelector('select[name="prefectures"]'), values.shippingFrom)) warnings.push("\u767A\u9001\u5143\u306E\u5730\u57DF");
      cross2.complete(item, warnings);
    }
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        scheduleScan();
      }
    }, 500);
    const cross = globalThis.FurimanagerCrossListing;
    void (async () => {
      if (!await cross?.receive("yahoo", fillCrossListing)) await fillRelist();
      scan();
    })();
  })();
})();
