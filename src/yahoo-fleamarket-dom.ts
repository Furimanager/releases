// Yahoo!フリマの画面から読み取る部分。2026-09-18の実DOMで確認した目印を使う。
// 他社拡張の実装は移植せず、画面上の項目名・URL・属性から組み立てる。
(() => {
  const ORIGIN = "https://paypayfleamarket.yahoo.co.jp";
  const SELL_ORIGIN = "https://paypayfleamarket-sec.yahoo.co.jp";
  const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

  function itemId(url: string): string | null {
    try {
      const parsed = new URL(url, ORIGIN);
      return parsed.origin === ORIGIN ? parsed.pathname.match(/^\/item\/(z\d+)(?:\/edit)?\/?$/)?.[1] ?? null : null;
    } catch { return null; }
  }

  function price(value: string): number | null {
    const normalized = value.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s/g, "");
    // 「1000円1000円」の連結を10001000円として扱わない。
    if (!/^[¥￥]?(?:\d+|\d{1,3}(?:,\d{3})+)円?$/.test(normalized)) return null;
    const result = Number(normalized.replace(/[¥￥円,]/g, ""));
    return Number.isSafeInteger(result) ? result : null;
  }

  function adjustedPrice(current: number, delta: number): number | null {
    // 下限へ丸めて「100円」と異なる値を変更することはしない。
    const next = current + delta;
    return Number.isSafeInteger(current) && (delta === -100 || delta === 100) && next >= 300 && next <= 9999999 ? next : null;
  }

  function imageUrl(value: string): string | null {
    try {
      const url = new URL(value);
      return url.origin === "https://auctions.c.yimg.jp" && url.pathname.startsWith("/images.auctions.yahoo.co.jp/") && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function editLink(root: ParentNode, id: string): HTMLAnchorElement | null {
    return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).find(link =>
      itemId(link.href) === id && new URL(link.href).pathname === `/item/${id}/edit` && text(link.textContent) === "編集する"
    ) ?? null;
  }

  function collectItem(root: ParentNode, url: string) {
    const id = itemId(url);
    // 商品名の全角スペース・連続スペースも出品者が入力した内容として保つ。
    const title = root.querySelector("h1")?.textContent?.trim() ?? "";
    const priceElement = root.querySelector<HTMLElement>('[class*="ItemPrice__Component"]');
    // 現行DOMはPC用・スマホ用の価格が同居する。表示中の文字だけを読む。
    const amount = price(priceElement?.innerText ?? priceElement?.textContent ?? "");
    const table = root.querySelector('table[class*="ItemTable__Component"]');
    const rows: Record<string, string> = {};
    let categoryPath: string[] = [];
    for (const row of Array.from(table?.querySelectorAll("tr") ?? [])) {
      const label = text(row.querySelector("th")?.textContent);
      const cell = row.querySelector("td");
      if (!label || !cell || row.className.includes("furima-assist")) continue;
      rows[label] = cell.textContent?.trim() ?? "";
      if (label === "カテゴリ") categoryPath = Array.from(cell.querySelectorAll('a[href*="/category/"]')).map(link => text(link.textContent).replace(/^>\s*/, ""));
    }
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('.slick-slide:not(.slick-cloned) img'))
      .map(image => imageUrl(image.getAttribute("src") || image.dataset.src || ""))
      .filter((value): value is string => value !== null);
    if (!id || !title || amount === null || amount < 300 || amount > 9999999 || !table || rows["商品ID"] !== id) return null;
    return {
      itemId: id, itemUrl: `${ORIGIN}/item/${id}`, title, price: amount,
      description: root.querySelector('[class*="ItemText__Text"]')?.textContent?.trim() ?? "",
      imageUrls: [...new Set(images)], categoryPath, rows,
      hashtags: Array.from(root.querySelectorAll('main a[href*="/hashtag/"]')).map(link => text(link.textContent)),
    };
  }

  function unique<T extends Element>(root: ParentNode, selector: string): T | null {
    const elements = root.querySelectorAll<T>(selector);
    return elements.length === 1 ? elements[0] : null;
  }

  function priceField(root: ParentNode): HTMLInputElement | null {
    // 電話番号や検索入力を拾わないよう、販売価格ラベルの直下だけを見る。
    const labels = Array.from(root.querySelectorAll("label")).filter(label => text(label.querySelector("span")?.textContent).startsWith("販売価格"));
    if (labels.length !== 1) return null;
    return unique<HTMLInputElement>(labels[0].nextElementSibling ?? labels[0], 'input[type="tel"][placeholder="0"]');
  }

  function fieldSection(root: ParentNode, name: string): HTMLElement | null {
    // カテゴリと状態はlabelではなく、必須マーク付き見出しのspan。
    const headings = Array.from(root.querySelectorAll<HTMLElement>("span")).filter(element =>
      text(element.textContent) === name && element.parentElement?.querySelector("div")?.textContent === "必須"
    );
    return headings.length === 1 ? headings[0].parentElement?.parentElement ?? null : null;
  }

  function setValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setPriceValue(field: HTMLInputElement, value: string): void {
    // Yahooの価格はフォーカスが外れた時に保存用の金額・手数料が確定する。
    // 表示値だけを書き換えると「変更する」で元の価格が送られるため、確定まで行う。
    field.focus({ preventScroll: true });
    setValue(field, value);
    field.blur();
  }

  const shippingText = (value: string) => text(value).replace(/で発送$/, "").replace(/[〜～]/g, "~");
  function selectText(field: HTMLSelectElement | null, value: string): boolean {
    if (!field || !value) return false;
    const matches = Array.from(field.options).filter(option => !option.disabled && shippingText(option.textContent ?? "") === shippingText(value));
    if (matches.length !== 1) return false;
    setValue(field, matches[0].value);
    return field.value === matches[0].value;
  }

  function exactButton(root: ParentNode, label: string): HTMLButtonElement | null {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter(button => text(button.textContent) === label);
    return buttons.length === 1 ? buttons[0] : null;
  }

  (globalThis as any).FurimanagerYahooDom = {
    ORIGIN, SELL_ORIGIN, text, itemId, price, adjustedPrice, imageUrl, editLink, collectItem,
    unique, priceField, fieldSection, setValue, setPriceValue, selectText, exactButton,
  };
})();
