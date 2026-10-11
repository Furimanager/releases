(() => {
  (() => {
    const endpoints = { mercari: "https://jp.mercari.com/sell/create", yahoo: "https://paypayfleamarket-sec.yahoo.co.jp/item/add" };
    const origins = { mercari: "https://jp.mercari.com", yahoo: "https://paypayfleamarket.yahoo.co.jp" };
    function sourceOf(value) {
      try {
        const url = new URL(value);
        for (const platform of ["mercari", "yahoo"]) {
          const id = url.pathname.match(platform === "mercari" ? /^\/item\/(m\d+)\/?$/ : /^\/item\/(z\d+)\/?$/)?.[1];
          if (url.origin === origins[platform] && id && !url.username && !url.password) return { platform, id, url: `${url.origin}/item/${id}` };
        }
      } catch {
      }
      return null;
    }
    function imageAllowed(value, platform) {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && (platform === "yahoo" ? url.origin === "https://auctions.c.yimg.jp" && url.pathname.startsWith("/images.auctions.yahoo.co.jp/") : url.hostname.endsWith(".mercdn.net"));
      } catch {
        return false;
      }
    }
    function normalize(raw, currentUrl) {
      const source = sourceOf(currentUrl);
      if (!source || !raw || raw.itemId !== source.id || sourceOf(raw.itemUrl)?.url !== source.url) throw new Error("\u5143\u306E\u5546\u54C1\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5546\u54C1\u30DA\u30FC\u30B8\u3092\u958B\u304D\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 500 || typeof raw.description !== "string" || raw.description.length > 2e4 || !Number.isSafeInteger(raw.price) || raw.price < 300 || raw.price > 9999999) throw new Error("\u5546\u54C1\u540D\u30FB\u8AAC\u660E\u30FB\u4FA1\u683C\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      if (!Array.isArray(raw.imageUrls) || !raw.imageUrls.length || raw.imageUrls.length > 20 || raw.imageUrls.some((v) => !imageAllowed(v, source.platform))) throw new Error("\u5546\u54C1\u753B\u50CF\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      const text = (value) => typeof value === "string" ? value.slice(0, 500) : "";
      const list = (value) => Array.isArray(value) ? value.slice(0, 20).map(text).filter(Boolean) : [];
      const rows = source.platform === "yahoo" ? raw.rows ?? {} : {};
      const tags = list(raw.hashtags);
      const extra = tags.filter((tag) => !raw.description.split(/\s+/).includes(tag));
      return {
        source: source.platform,
        target: source.platform === "mercari" ? "yahoo" : "mercari",
        itemId: source.id,
        itemUrl: source.url,
        title: raw.title,
        description: raw.description + (extra.length ? `${raw.description ? "\n\n" : ""}${extra.join(" ")}` : ""),
        price: raw.price,
        imageUrls: [...new Set(raw.imageUrls)],
        categoryPath: list(raw.categoryPath),
        condition: text(rows["\u5546\u54C1\u306E\u72B6\u614B"] ?? raw.condition),
        shippingFrom: text(rows["\u767A\u9001\u5143\u306E\u5730\u57DF"] ?? raw.shippingFrom),
        shippingDays: text(rows["\u767A\u9001\u307E\u3067\u306E\u65E5\u6570"] ?? raw.shippingDays),
        shippingPayer: source.platform === "yahoo" ? "\u9001\u6599\u8FBC\u307F(\u51FA\u54C1\u8005\u8CA0\u62C5)" : text(raw.shippingPayer),
        shippingMethod: text(rows["\u914D\u9001\u306E\u65B9\u6CD5"] ?? raw.shippingMethod),
        brand: text(raw.brand),
        size: text(raw.size)
      };
    }
    const optionText = (value) => typeof value === "string" ? value.normalize("NFKC").replace(/[〜～]/g, "~").replace(/\s/g, "") : "";
    function metadata(item) {
      const yahoo = item.target === "yahoo";
      const sourceCondition = optionText(item.condition);
      const common = ["\u672A\u4F7F\u7528\u306B\u8FD1\u3044", "\u76EE\u7ACB\u3063\u305F\u50B7\u3084\u6C5A\u308C\u306A\u3057", "\u3084\u3084\u50B7\u3084\u6C5A\u308C\u3042\u308A", "\u50B7\u3084\u6C5A\u308C\u3042\u308A"];
      const condition = common.includes(sourceCondition) ? sourceCondition : sourceCondition === (yahoo ? "\u65B0\u54C1\u3001\u672A\u4F7F\u7528" : "\u672A\u4F7F\u7528") ? yahoo ? "\u672A\u4F7F\u7528" : "\u65B0\u54C1\u3001\u672A\u4F7F\u7528" : null;
      const rawMethod = optionText(item.shippingMethod);
      const method = item.source === "mercari" ? rawMethod.match(/^(ゆうゆうメルカリ便|らくらくメルカリ便)(?:郵便局\/コンビニ受取|匿名配送)*$/)?.[1] ?? rawMethod : rawMethod;
      const payer = optionText(item.shippingPayer);
      const prepaid = item.source === "yahoo" || payer === "\u9001\u6599\u8FBC\u307F(\u51FA\u54C1\u8005\u8CA0\u62C5)";
      const carrier = prepaid ? method === (yahoo ? "\u3086\u3046\u3086\u3046\u30E1\u30EB\u30AB\u30EA\u4FBF" : "\u304A\u3066\u304C\u308B\u914D\u9001(\u65E5\u672C\u90F5\u4FBF)") ? "post" : method === (yahoo ? "\u3089\u304F\u3089\u304F\u30E1\u30EB\u30AB\u30EA\u4FBF" : "\u304A\u3066\u304C\u308B\u914D\u9001(\u30E4\u30DE\u30C8\u904B\u8F38)") ? "yamato" : null : null;
      const shippingMethod = carrier === "post" ? yahoo ? "\u304A\u3066\u304C\u308B\u914D\u9001\uFF08\u65E5\u672C\u90F5\u4FBF\uFF09" : "\u3086\u3046\u3086\u3046\u30E1\u30EB\u30AB\u30EA\u4FBF" : carrier === "yamato" ? yahoo ? "\u304A\u3066\u304C\u308B\u914D\u9001\uFF08\u30E4\u30DE\u30C8\u904B\u8F38\uFF09" : "\u3089\u304F\u3089\u304F\u30E1\u30EB\u30AB\u30EA\u4FBF" : null;
      const days = optionText(item.shippingDays).replace(/で発送$/, "");
      const shippingDays = ["1~2\u65E5", "2~3\u65E5"].includes(days) ? days + (yahoo ? "" : "\u3067\u767A\u9001") : days === (yahoo ? "4~7\u65E5" : "3~7\u65E5") ? yahoo ? "3~7\u65E5" : "4~7\u65E5\u3067\u767A\u9001" : null;
      const prefectures = "\u5317\u6D77\u9053 \u9752\u68EE\u770C \u5CA9\u624B\u770C \u5BAE\u57CE\u770C \u79CB\u7530\u770C \u5C71\u5F62\u770C \u798F\u5CF6\u770C \u8328\u57CE\u770C \u6803\u6728\u770C \u7FA4\u99AC\u770C \u57FC\u7389\u770C \u5343\u8449\u770C \u6771\u4EAC\u90FD \u795E\u5948\u5DDD\u770C \u65B0\u6F5F\u770C \u5BCC\u5C71\u770C \u77F3\u5DDD\u770C \u798F\u4E95\u770C \u5C71\u68A8\u770C \u9577\u91CE\u770C \u5C90\u961C\u770C \u9759\u5CA1\u770C \u611B\u77E5\u770C \u4E09\u91CD\u770C \u6ECB\u8CC0\u770C \u4EAC\u90FD\u5E9C \u5927\u962A\u5E9C \u5175\u5EAB\u770C \u5948\u826F\u770C \u548C\u6B4C\u5C71\u770C \u9CE5\u53D6\u770C \u5CF6\u6839\u770C \u5CA1\u5C71\u770C \u5E83\u5CF6\u770C \u5C71\u53E3\u770C \u5FB3\u5CF6\u770C \u9999\u5DDD\u770C \u611B\u5A9B\u770C \u9AD8\u77E5\u770C \u798F\u5CA1\u770C \u4F50\u8CC0\u770C \u9577\u5D0E\u770C \u718A\u672C\u770C \u5927\u5206\u770C \u5BAE\u5D0E\u770C \u9E7F\u5150\u5CF6\u770C \u6C96\u7E04\u770C".split(" ");
      const shippingFrom = prefectures.find((p) => p === optionText(item.shippingFrom)) ?? null;
      return { condition, carrier, shippingMethod, shippingDays, shippingFrom, shippingPayer: prepaid ? "\u9001\u6599\u8FBC\u307F(\u51FA\u54C1\u8005\u8CA0\u62C5)" : null };
    }
    function selectExact(field, value) {
      if (!field || !value || field.disabled) return false;
      const matches = Array.from(field.options).filter((option) => !option.disabled && optionText(option.label || option.textContent) === optionText(value));
      if (matches.length !== 1) return false;
      field.value = matches[0].value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return selectedExact(field, value);
    }
    function selectedExact(field, value) {
      return !!value && !!field && optionText(field.selectedOptions[0]?.label || field.selectedOptions[0]?.textContent) === optionText(value);
    }
    const api = { endpoints, origins, sourceOf, imageAllowed, normalize, metadata, optionText, selectExact, selectedExact, maxAge: 10 * 60 * 1e3 };
    globalThis.FurimanagerCrossListing = api;
    if (typeof document === "undefined") return;
    const chromeApi = globalThis.chrome;
    let busy = false;
    function status(message, item) {
      let box = document.getElementById("furimanager-cross-status");
      if (!box) {
        box = document.createElement("aside");
        box.id = "furimanager-cross-status";
        box.setAttribute("role", "status");
        box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(420px,calc(100vw - 32px));max-height:45vh;overflow:auto;background:#150c2b;color:#fff;padding:16px;border:1px solid #ec4899;border-radius:12px;font:13px/1.7 sans-serif;white-space:pre-wrap;box-sizing:border-box";
        document.body.append(box);
      }
      box.replaceChildren();
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "\u9589\u3058\u308B";
      close.style.cssText = "float:right;background:transparent;color:#fff;border:0;text-decoration:underline;cursor:pointer;margin-left:12px";
      close.onclick = () => box?.remove();
      const body = document.createElement("div");
      body.textContent = message;
      box.append(close, body);
      if (item) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "\u5143\u306E\u5546\u54C1\u60C5\u5831\u3092\u898B\u308B";
        const content = document.createElement("div");
        content.textContent = `\u5546\u54C1\u540D\uFF1A${item.title}
\u4FA1\u683C\uFF1A${item.price.toLocaleString()}\u5186
\u30AB\u30C6\u30B4\u30EA\uFF1A${item.categoryPath.join(" > ")}
\u72B6\u614B\uFF1A${item.condition}
\u914D\u9001\uFF1A${item.shippingMethod}
\u767A\u9001\u5143\uFF1A${item.shippingFrom}
\u65E5\u6570\uFF1A${item.shippingDays}
\u30D6\u30E9\u30F3\u30C9\uFF1A${item.brand}
\u30B5\u30A4\u30BA\uFF1A${item.size}

\u8AAC\u660E\uFF1A
${item.description}`;
        details.append(summary, content);
        box.append(details);
      }
    }
    api.mount = (anchor, collect, itemUrl) => {
      const source = sourceOf(itemUrl);
      if (!source) return;
      const mountAnchor = source.platform === "mercari" ? anchor.closest(".slick-slider") ?? anchor : anchor;
      document.querySelectorAll(".furimanager-cross-link").forEach((node) => {
        if (node !== mountAnchor.nextElementSibling) node.remove();
      });
      const existing = mountAnchor.nextElementSibling;
      if (existing?.classList.contains("furimanager-cross-link")) {
        if (existing.dataset.sourceUrl === source.url) return;
        existing.remove();
      }
      const wrap = document.createElement("div");
      wrap.className = "furimanager-cross-link";
      wrap.dataset.sourceUrl = source.url;
      wrap.style.cssText = "display:block;clear:both;margin:0;padding:6px 0 10px;background:#fff;max-width:100%;line-height:1.5";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${source.platform === "mercari" ? "Yahoo!\u30D5\u30EA\u30DE" : "\u30E1\u30EB\u30AB\u30EA"}\u306B\u30B3\u30D4\u30FC\u51FA\u54C1`;
      button.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:4px 0;border:0;border-radius:0;background:transparent;box-shadow:none;color:#e52e88;font:500 12px/1.6 sans-serif;cursor:pointer;text-align:left";
      button.insertAdjacentHTML("afterbegin", '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>');
      button.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        busy = true;
        button.disabled = true;
        try {
          const raw = await collect();
          const item = normalize(raw, location.href);
          if (item.itemUrl !== source.url) throw new Error("\u5546\u54C1\u304C\u5207\u308A\u66FF\u308F\u308A\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          const result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_OPEN", item });
          if (!result?.success) throw new Error(result?.message || "\u51FA\u54C1\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u62E1\u5F35\u6A5F\u80FD\u3068\u5546\u54C1\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3001\u3082\u3046\u4E00\u5EA6\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          status("\u65B0\u3057\u3044\u30BF\u30D6\u3067\u30B3\u30D4\u30FC\u51FA\u54C1\u3092\u958B\u304D\u307E\u3057\u305F\u3002\u5165\u529B\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u51FA\u54C1\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        } catch (error) {
          status(error instanceof Error ? error.message : "\u30B3\u30D4\u30FC\u51FA\u54C1\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        } finally {
          busy = false;
          button.disabled = false;
        }
      };
      wrap.append(button);
      mountAnchor.insertAdjacentElement("afterend", wrap);
    };
    api.status = status;
    api.wait = async (find, check = () => {
    }, timeout = 15e3) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        check();
        const value = find();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("\u51FA\u54C1\u30D5\u30A9\u30FC\u30E0\u306E\u8AAD\u307F\u8FBC\u307F\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    };
    api.receive = async (target, fill) => {
      if (location.origin + location.pathname !== endpoints[target]) return false;
      const marked = location.hash.startsWith("#furimanager-cross=");
      let result;
      try {
        result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_PEEK" });
      } catch {
        if (!marked) return false;
        status("\u62E1\u5F35\u6A5F\u80FD\u3068\u306E\u63A5\u7D9A\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5546\u54C1\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        return true;
      }
      if (!result?.handled) {
        if (marked) {
          status("\u30B3\u30D4\u30FC\u51FA\u54C1\u30C7\u30FC\u30BF\u306E\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          return true;
        }
        return false;
      }
      if (!result.success) {
        status(result.message);
        return true;
      }
      const job = result.job;
      let url = location.href, expectedPath = null, writing = false, edited = false;
      const onEdit = (event) => {
        if (!writing && event.isTrusted && !event.target?.closest?.("#furimanager-cross-status")) edited = true;
      };
      for (const event of ["input", "change", "click", "drop"]) document.addEventListener(event, onEdit, true);
      const check = () => {
        if (!edited && expectedPath && location.origin === origins.mercari && location.pathname === expectedPath) {
          url = location.href;
          expectedPath = null;
        }
        if (location.href !== url || edited) throw new Error("\u753B\u9762\u306E\u79FB\u52D5\u307E\u305F\u306F\u624B\u52D5\u5165\u529B\u3092\u78BA\u8A8D\u3057\u305F\u305F\u3081\u3001\u81EA\u52D5\u5165\u529B\u3092\u6B62\u3081\u307E\u3057\u305F\u3002\u5165\u529B\u6E08\u307F\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      };
      check.write = (action) => {
        check();
        writing = true;
        try {
          action();
        } finally {
          writing = false;
        }
        check();
      };
      check.navigate = async (path, action) => {
        check();
        if (target !== "mercari" || !["/sell/create", "/sell/conditions", "/sell/shipping_methods"].includes(path)) throw new Error("\u30B3\u30D4\u30FC\u5165\u529B\u306E\u5BFE\u8C61\u5916\u306E\u753B\u9762\u3067\u3059\u3002");
        expectedPath = path;
        try {
          check.write(action);
          await api.wait(() => location.pathname === path, check, 8e3);
        } finally {
          expectedPath = null;
        }
      };
      try {
        status("\u30B3\u30D4\u30FC\u51FA\u54C1\u306E\u5546\u54C1\u60C5\u5831\u3092\u5165\u529B\u3057\u3066\u3044\u307E\u3059\u2026");
        await fill(job.item, job, check);
      } catch (error) {
        status(error instanceof Error ? error.message : "\u30B3\u30D4\u30FC\u51FA\u54C1\u306E\u5165\u529B\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002", job.item);
      } finally {
        for (const event of ["input", "change", "click", "drop"]) document.removeEventListener(event, onEdit, true);
        try {
          await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_FINISH", token: job.token });
        } catch {
        }
      }
      return true;
    };
    api.claim = async (job, check) => {
      check();
      const result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_CLAIM" });
      check();
      if (!result?.success || result.job?.token !== job.token) throw new Error(result?.message || "\u30B3\u30D4\u30FC\u51FA\u54C1\u30C7\u30FC\u30BF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    };
    api.files = async (job, check) => {
      const files = [];
      for (let index = 0; index < job.item.imageUrls.length; index++) {
        const response = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_IMAGE", token: job.token, index });
        check();
        if (!response?.success || !/^data:image\/(jpeg|png|webp);base64,/.test(response.dataUrl ?? "")) throw new Error(`\u753B\u50CF${index + 1}\u679A\u76EE\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
        const blob = await (await fetch(response.dataUrl)).blob();
        check();
        files.push(new File([blob], `furimane-copy-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type }));
      }
      return files;
    };
    api.setText = (field, value, label, warnings) => {
      if (field.maxLength > 0 && value.length > field.maxLength) {
        warnings.push(`${label}\uFF08${field.maxLength}\u6587\u5B57\u4EE5\u5185\u306B\u7DE8\u96C6\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5143\u306E\u5168\u6587\u306F\u4E0B\u306B\u8868\u793A\uFF09`);
        return;
      }
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    };
    api.setTitle = (field, item, warnings) => {
      const siteLimit = item.target === "mercari" ? 40 : 65;
      const limit = field.maxLength >= 0 ? Math.min(field.maxLength, siteLimit) : siteLimit;
      let value = item.title;
      if (value.length > limit) {
        value = value.slice(0, limit);
        if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
        const site = item.target === "mercari" ? "\u30E1\u30EB\u30AB\u30EA" : "Yahoo!\u30D5\u30EA\u30DE";
        warnings.push(`${site}\u306E\u5546\u54C1\u540D\u306F${limit}\u6587\u5B57\u307E\u3067\u306E\u305F\u3081\u3001\u5148\u982D${value.length}\u6587\u5B57\u3092\u5165\u529B\u3057\u307E\u3057\u305F\uFF08\u5143\u306F${item.title.length}\u6587\u5B57\uFF09\u3002\u5185\u5BB9\u3092\u78BA\u8A8D\u30FB\u8ABF\u6574\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5143\u306E\u5168\u6587\u306F\u4E0B\u306B\u8868\u793A\u3057\u3066\u3044\u307E\u3059`);
      }
      api.setText(field, value, "\u5546\u54C1\u540D", warnings);
      return value;
    };
    api.complete = (item, warnings) => {
      const notes = [...new Set(warnings)].map((value) => value === "\u30AB\u30C6\u30B4\u30EA" ? "\u30AB\u30C6\u30B4\u30EA\uFF1A\u51FA\u54C1\u5148\u306E\u5206\u985E\u304B\u3089\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044" : value);
      status(`\u5165\u529B\u3067\u304D\u305F\u9805\u76EE\u3092\u53CD\u6620\u3057\u307E\u3057\u305F\u3002
\u51FA\u54C1\u524D\u306B\u78BA\u8A8D\uFF1A
${notes.map((value) => `\u30FB${value}`).join("\n")}
\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u3001\u6700\u5F8C\u306E\u51FA\u54C1\u30DC\u30BF\u30F3\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002`, item);
    };
  })();
})();
