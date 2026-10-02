(() => {
  (() => {
    const ORIGIN = "https://paypayfleamarket.yahoo.co.jp";
    const SELL_ORIGIN = "https://paypayfleamarket-sec.yahoo.co.jp";
    const text = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    function itemId(url) {
      try {
        const parsed = new URL(url, ORIGIN);
        return parsed.origin === ORIGIN ? parsed.pathname.match(/^\/item\/(z\d+)(?:\/edit)?\/?$/)?.[1] ?? null : null;
      } catch {
        return null;
      }
    }
    function price(value) {
      const normalized = value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/\s/g, "");
      if (!/^[¥￥]?(?:\d+|\d{1,3}(?:,\d{3})+)円?$/.test(normalized)) return null;
      const result = Number(normalized.replace(/[¥￥円,]/g, ""));
      return Number.isSafeInteger(result) ? result : null;
    }
    function adjustedPrice(current, delta) {
      const next = current + delta;
      return Number.isSafeInteger(current) && (delta === -100 || delta === 100) && next >= 300 && next <= 9999999 ? next : null;
    }
    function imageUrl(value) {
      try {
        const url = new URL(value);
        return url.origin === "https://auctions.c.yimg.jp" && url.pathname.startsWith("/images.auctions.yahoo.co.jp/") && !url.username && !url.password ? url.href : null;
      } catch {
        return null;
      }
    }
    function editLink(root, id) {
      return Array.from(root.querySelectorAll("a[href]")).find(
        (link) => itemId(link.href) === id && new URL(link.href).pathname === `/item/${id}/edit` && text(link.textContent) === "\u7DE8\u96C6\u3059\u308B"
      ) ?? null;
    }
    function collectItem(root, url) {
      const id = itemId(url);
      const title = root.querySelector("h1")?.textContent?.trim() ?? "";
      const priceElement = root.querySelector('[class*="ItemPrice__Component"]');
      const amount = price(priceElement?.innerText ?? priceElement?.textContent ?? "");
      const table = root.querySelector('table[class*="ItemTable__Component"]');
      const rows = {};
      let categoryPath = [];
      for (const row of Array.from(table?.querySelectorAll("tr") ?? [])) {
        const label = text(row.querySelector("th")?.textContent);
        const cell = row.querySelector("td");
        if (!label || !cell || row.className.includes("furima-assist")) continue;
        rows[label] = cell.textContent?.trim() ?? "";
        if (label === "\u30AB\u30C6\u30B4\u30EA") categoryPath = Array.from(cell.querySelectorAll('a[href*="/category/"]')).map((link) => text(link.textContent).replace(/^>\s*/, ""));
      }
      const images = Array.from(root.querySelectorAll(".slick-slide:not(.slick-cloned) img")).map((image) => imageUrl(image.getAttribute("src") || image.dataset.src || "")).filter((value) => value !== null);
      if (!id || !title || amount === null || amount < 300 || amount > 9999999 || !table || rows["\u5546\u54C1ID"] !== id) return null;
      return {
        itemId: id,
        itemUrl: `${ORIGIN}/item/${id}`,
        title,
        price: amount,
        description: root.querySelector('[class*="ItemText__Text"]')?.textContent?.trim() ?? "",
        imageUrls: [...new Set(images)],
        categoryPath,
        rows,
        hashtags: Array.from(root.querySelectorAll('main a[href*="/hashtag/"]')).map((link) => text(link.textContent))
      };
    }
    function unique(root, selector) {
      const elements = root.querySelectorAll(selector);
      return elements.length === 1 ? elements[0] : null;
    }
    function priceField(root) {
      const labels = Array.from(root.querySelectorAll("label")).filter((label) => text(label.querySelector("span")?.textContent).startsWith("\u8CA9\u58F2\u4FA1\u683C"));
      if (labels.length !== 1) return null;
      return unique(labels[0].nextElementSibling ?? labels[0], 'input[type="tel"][placeholder="0"]');
    }
    function fieldSection(root, name) {
      const headings = Array.from(root.querySelectorAll("span")).filter(
        (element) => text(element.textContent) === name && element.parentElement?.querySelector("div")?.textContent === "\u5FC5\u9808"
      );
      return headings.length === 1 ? headings[0].parentElement?.parentElement ?? null : null;
    }
    function setValue(field, value) {
      const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function setPriceValue(field, value) {
      field.focus({ preventScroll: true });
      setValue(field, value);
      field.blur();
    }
    const shippingText = (value) => text(value).replace(/で発送$/, "").replace(/[〜～]/g, "~");
    function selectText(field, value) {
      if (!field || !value) return false;
      const matches = Array.from(field.options).filter((option) => !option.disabled && shippingText(option.textContent ?? "") === shippingText(value));
      if (matches.length !== 1) return false;
      setValue(field, matches[0].value);
      return field.value === matches[0].value;
    }
    function exactButton(root, label) {
      const buttons = Array.from(root.querySelectorAll("button")).filter((button) => text(button.textContent) === label);
      return buttons.length === 1 ? buttons[0] : null;
    }
    globalThis.FurimanagerYahooDom = {
      ORIGIN,
      SELL_ORIGIN,
      text,
      itemId,
      price,
      adjustedPrice,
      imageUrl,
      editLink,
      collectItem,
      unique,
      priceField,
      fieldSection,
      setValue,
      setPriceValue,
      selectText,
      exactButton
    };
  })();
})();
