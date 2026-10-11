// メルカリと同じ「入力補助→最後は本人が確定」のYahoo!フリマ版。
// メルカリのpending・DOM・自動運用タスクとは分離する。
(() => {
  const dom = (globalThis as any).FurimanagerYahooDom;
  const chromeApi = (globalThis as any).chrome;
  if (!dom || !chromeApi?.storage?.local || ![dom.ORIGIN, dom.SELL_ORIGIN].includes(location.origin)) return;
  const NAV_KEY = "furimanager_yahoo_navigation";
  const JOB_PREFIX = "furimanager_yahoo_relist_";
  const MAX_AGE_MS = 120000;
  type Action = "relist" | "draft" | "decrease" | "increase" | "stop" | "delete" | "inventory";
  type Navigation = { itemId: string; action: Action; savedAt: number };
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

  function notify(message: string): void {
    let box = document.getElementById("furimanager-yahoo-status");
    if (!box) {
      box = document.createElement("div");
      box.id = "furimanager-yahoo-status";
      box.setAttribute("role", "status");
      box.addEventListener("click", () => box?.remove());
      document.body.append(box);
    }
    box.textContent = `フリマネ\n${message}`;
  }

  function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "処理を続けられませんでした。";
    return /Extension context invalidated/i.test(message)
      ? "拡張機能が再読み込みされました。この商品ページを再読み込みして、もう一度操作してください。"
      : message;
  }

  // 通信待ちの間に別画面へ移ったり本人が編集したら、残りの自動入力を止める。
  function createFormGuard(form: Element) {
    const sourceUrl = location.href;
    let edited = false;
    let writing = false;
    const events = ["input", "change", "click", "drop"];
    const onEdit = (event: Event) => {
      // 画像選択はformの外（Reactのポータル）に表示される。
      if (event.isTrusted && !writing && (form.contains(event.target as Node) || document.querySelector("#addimg")?.contains(event.target as Node))) edited = true;
    };
    for (const name of events) document.addEventListener(name, onEdit, true);
    return {
      check() {
        if (location.href !== sourceUrl || !form.isConnected || document.querySelector("main form") !== form) {
          throw new Error("画面が切り替わったため自動入力を止めました。元の商品ページからやり直してください。");
        }
        if (edited) throw new Error("手動操作を確認したため自動入力を止めました。入力済みの内容を確認してください。");
      },
      // radio.click()はブラウザーがtrustedなinput/changeを発火する。
      // 同期的な自動操作の間だけ除外し、通信待ち中の本人操作は検知する。
      write(action: () => void) {
        writing = true;
        try { action(); } finally { writing = false; }
      },
      dispose() { for (const name of events) document.removeEventListener(name, onEdit, true); },
    };
  }

  function readNavigation(): Navigation | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(NAV_KEY) || "null");
      if (value && /^z\d+$/.test(value.itemId) && ["relist", "draft", "decrease", "increase", "stop", "delete", "inventory"].includes(value.action) &&
        typeof value.savedAt === "number" && Date.now() >= value.savedAt && Date.now() - value.savedAt <= MAX_AGE_MS) return value;
    } catch { /* 壊れた一時データは引き継がない。 */ }
    sessionStorage.removeItem(NAV_KEY);
    return null;
  }

  async function waitFor<T>(find: () => T | null, timeout = 8000): Promise<T> {
    const start = Date.now();
    const sourceUrl = location.href;
    while (Date.now() - start < timeout) {
      if (location.href !== sourceUrl) throw new Error("画面が切り替わったため処理を止めました。");
      const value = find();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error("対象の入力欄が見つかりませんでした。画面の内容を確認してください。");
  }

  function toolbar(mount: HTMLElement, id: string): void {
    const existing = mount.querySelector<HTMLElement>(".furimanager-yahoo-toolbar");
    if (existing?.dataset.itemId === id) return;
    existing?.remove();
    const bar = document.createElement("div");
    bar.className = "furimanager-yahoo-toolbar";
    bar.dataset.itemId = id;
    bar.setAttribute("aria-label", "フリマネ 商品操作");
    const definitions: [Action, string][] = [["inventory", "在庫連携"], ["relist", "再出品"], ["decrease", "-100"], ["increase", "+100"], ["draft", "下書き"], ["stop", "停止"], ["delete", "削除"]];
    for (const [action, label] of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.furimanagerYahooAction = action;
      button.addEventListener("click", event => {
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

  function scan(): void {
    if (running) return;
    if (location.origin === dom.ORIGIN && location.pathname === "/my/item/selling") {
      for (const card of document.querySelectorAll<HTMLElement>("#itm > div")) {
        const link = card.querySelector<HTMLAnchorElement>(":scope > a[href]");
        const id = link && dom.itemId(link.href);
        if (id) toolbar(card, id); // 商品リンクの外へ付け、ボタンとリンクを入れ子にしない。
      }
    }
    const id = dom.itemId(location.href);
    if (!id) return;
    const pending = readNavigation();
    if (pending && pending.itemId !== id) { sessionStorage.removeItem(NAV_KEY); return; }
    if (location.pathname === `/item/${id}`) {
      const edit = dom.editLink(document, id);
      if (edit) toolbar(edit.parentElement, id);
      // 他サービスへのコピーは元商品を変更しない。画像の下へ文字リンクを置く。
      const gallery = document.querySelector("main .slick-slider");
      const copyAnchor = edit?.parentElement?.querySelector(".furimanager-yahoo-toolbar") ?? gallery;
      if (copyAnchor) (globalThis as any).FurimanagerCrossListing?.mount(copyAnchor, () => dom.collectItem(document, location.href), location.href);
      if (!edit) return; // 自分の商品であることを編集リンクで確認。
      if (pending) void runNavigation(pending);
    } else if (location.pathname === `/item/${id}/edit` && pending && document.querySelector("main form")) {
      void runNavigation(pending);
    }
  }

  async function runNavigation(pending: Navigation): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (dom.itemId(location.href) !== pending.itemId) throw new Error("商品が切り替わったため処理を止めました。");
      if (location.pathname === `/item/${pending.itemId}`) {
        const edit = dom.editLink(document, pending.itemId);
        if (!edit) throw new Error("自分の商品の編集リンクを確認できませんでした。");
        if (pending.action === "inventory") {
          const item = await waitFor(() => dom.collectItem(document, location.href));
          const response = await chromeApi.runtime.sendMessage({ type: "OPEN_INVENTORY_LINK", payload: {
            platform: "paypay_flea", yahooItemId: item.itemId, listingUrl: item.itemUrl,
            listingTitle: item.title, listingPrice: item.price, listingStatus: "active",
            imageUrl: item.imageUrls[0] ?? null, capturedAt: new Date().toISOString()
          } });
          if (!response?.success) throw new Error(response?.message || "在庫連携ページを開けませんでした。");
          sessionStorage.removeItem(NAV_KEY);
          notify("在庫連携ページを開きました。");
        } else if (pending.action === "relist" || pending.action === "draft") {
          const item = await waitFor(() => dom.collectItem(document, location.href));
          if (!item.imageUrls.length || !item.categoryPath.length) throw new Error("画像またはカテゴリを取得できないため、新規出品画面を開きませんでした。");
          const token = crypto.randomUUID();
          await chromeApi.storage.local.set({ [JOB_PREFIX + token]: { item, mode: pending.action, savedAt: Date.now() } });
          const response = await chromeApi.runtime.sendMessage({ type: "OPEN_YAHOO_RELIST", token });
          if (!response?.success) {
            await chromeApi.storage.local.remove(JOB_PREFIX + token);
            throw new Error("新規出品画面を開けませんでした。");
          }
          sessionStorage.removeItem(NAV_KEY);
          notify("新しいタブで出品内容を入力します。最後の確定は画面で確認してください。");
        } else {
          location.assign(edit.href);
        }
      } else {
        sessionStorage.removeItem(NAV_KEY); // 再描画・再読み込みで同じ100円を重ねて変更しない。
        const form = document.querySelector("main form");
        if (!form) throw new Error("編集フォームが見つかりませんでした。");
        if (pending.action === "decrease" || pending.action === "increase") {
          const field = await waitFor<HTMLInputElement>(() => {
            const candidate = dom.priceField(form);
            return candidate && dom.price(candidate.value) !== null ? candidate : null;
          });
          const current = dom.price(field.value);
          const next = current === null ? null : dom.adjustedPrice(current, pending.action === "decrease" ? -100 : 100);
          if (next === null) throw new Error("販売価格の範囲（300〜9,999,999円）で100円変更できませんでした。");
          dom.setPriceValue(field, String(next));
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!form.isConnected || dom.itemId(location.href) !== pending.itemId || dom.priceField(form)?.value !== String(next)) throw new Error("価格欄への反映を確認できませんでした。");
          notify(`${current.toLocaleString()}円 → ${next.toLocaleString()}円を入力しました。\n内容を確認して「変更する」を押してください。`);
        } else if (pending.action === "stop" || pending.action === "delete") {
          // Yahooの停止はこのボタンで即確定する。メルカリと同じく最終操作は本人に渡す。
          const label = pending.action === "delete" ? "商品を削除する" : "出品を停止する";
          const button = dom.exactButton(form, label);
          if (!button) throw new Error(pending.action === "stop" ? "停止ボタンが見つかりませんでした。公開停止中の商品は再開せず、そのままにしています。" : "削除ボタンが見つかりませんでした。");
          button.scrollIntoView({ block: "center" });
          notify(`対象商品の「${label}」を確認してください。確定操作は手動で行ってください。`);
        }
      }
    } catch (error) {
      sessionStorage.removeItem(NAV_KEY);
      notify(errorMessage(error));
    } finally { running = false; }
  }

  function onScreen(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }

  function openPicker(section: HTMLElement): HTMLElement | null {
    const closeButtons = Array.from(section.querySelectorAll<HTMLImageElement>('button img[alt="閉じるボタン"]')).filter(onScreen);
    return closeButtons.length === 1 ? closeButtons[0].closest("button")?.parentElement?.parentElement ?? null : null;
  }

  function pickerMatches(form: Element, name: string, values: string[]): boolean {
    const selected = dom.fieldSection(form, name)?.children[1];
    if (!selected || !values.length) return false;
    // 商品状態の親要素には非表示の候補・説明も含まれる。選択表示のpだけを照合する。
    const display = name === "商品の状態" ? selected.querySelector("p") : selected;
    if (!display) return false;
    const actual = dom.text(display.textContent).split(/\s*>\s*/);
    return actual.length === values.length && values.every((value, index) => actual[index] === value);
  }

  async function fillPicker(form: Element, name: string, values: string[], check = () => {}): Promise<boolean> {
    check();
    const section = dom.fieldSection(form, name);
    if (!section || !values.length) return false;
    const control = section.children[1] as HTMLElement | undefined;
    if (!control) return false;
    control.querySelector("p")?.click();
    try {
      for (const value of values) {
        const choice = await waitFor<HTMLElement>(() => {
          check();
          const panel = openPicker(section);
          if (!panel) return null;
          const options = Array.from(panel.querySelectorAll<HTMLElement>(name === "カテゴリ" ? "li" : "p")).filter(element =>
            dom.text(element.textContent) === value && (name !== "カテゴリ" || !element.querySelector("button"))
          );
          return options.length === 1 ? options[0] : null;
        }, 3500);
        check();
        choice.scrollIntoView({ block: "center" });
        choice.click();
        await new Promise(resolve => setTimeout(resolve, 200));
        check();
      }
      // 選択後の遅延描画も待ち、古いcontrolや途中の親カテゴリで判定しない。
      return await waitFor(() => { check(); return pickerMatches(form, name, values) ? true : null; }, 3500);
    } catch { check(); return pickerMatches(form, name, values); }
    finally {
      // 中断時は、本人が操作しているパネルまで勝手に閉じない。
      let current = true;
      try { check(); } catch { current = false; }
      if (current) openPicker(section)?.querySelector<HTMLImageElement>('button img[alt="閉じるボタン"]')?.closest("button")?.click();
    }
  }

  async function fillImages(form: Element, urls: string[], check = () => {}, prepared?: File[]): Promise<boolean> {
    check();
    if (!urls.length || urls.length > 20 || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) return false;
    const files = new DataTransfer();
    if (prepared) prepared.forEach(file => files.items.add(file));
    for (let index = 0; !prepared && index < urls.length; index++) {
      const response = await chromeApi.runtime.sendMessage({ type: "FETCH_YAHOO_IMAGE_AS_DATA_URL", url: urls[index] });
      check();
      if (!response?.success || !/^data:image\/(jpeg|png|webp);base64,/.test(response.dataUrl ?? "")) throw new Error(`画像${index + 1}枚目の取得に失敗しました。元の商品からやり直してください。`);
      const blob = await (await fetch(response.dataUrl)).blob();
      check();
      files.items.add(new File([blob], `furimanager-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type }));
    }
    // 2026-09-30実DOM: 追加ボタンで開く画像モーダル内のalbumが選択用input。
    // dropだけでは取り込まれないため、ファイル選択と同じchangeで渡す。
    const addButton = dom.exactButton(form, "画像を追加する");
    check();
    // 通信中に画像が入った場合は、第三者の自動入力も含め重ねて追加しない。
    if (form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("画像が追加されたため自動入力を止めました。画像の内容を確認してください。");
    if (!addButton) return false;
    if (document.querySelector('#addimg[role="dialog"]')) throw new Error("画像選択画面が既に開いているため自動入力を止めました。");
    addButton.click();
    const album = await waitFor<HTMLInputElement>(() => {
      check();
      return dom.unique(document, '#addimg[role="dialog"] input#album[type="file"][multiple]');
    });
    check();
    if (form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("画像が追加されたため自動入力を止めました。画像の内容を確認してください。");
    album.files = files.files;
    album.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      await waitFor(() => {
        check();
        return form.querySelectorAll('img[src^="https://auctions.c.yimg.jp/"]').length === urls.length ? true : null;
      }, 20000);
      return true;
    } catch { check(); return false; }
  }

  function selectedHashtags(form: Element): string[] {
    return Array.from(form.querySelectorAll("#item-description p"))
      .filter(element => element.parentElement?.querySelector('button[aria-label="削除"]'))
      .map(element => dom.text(element.textContent));
  }

  async function fillHashtags(form: Element, hashtags: string[], check = () => {}, write = (action: () => void) => action()): Promise<boolean> {
    const expected = [...new Set(hashtags)];
    for (const tag of expected) {
      check();
      if (selectedHashtags(form).includes(tag)) continue;
      const field = dom.unique(form, 'input[placeholder="ハッシュタグを追加する"]') as HTMLInputElement | null;
      const value = tag.startsWith("#") ? tag.slice(1) : "";
      // 途中の手入力や、Yahooの入力上限を超える値を上書き・短縮しない。
      if (!field || field.value || !value || /[\s#]/.test(value) || (field.maxLength > 0 && value.length > field.maxLength)) return false;
      write(() => { field.focus({ preventScroll: true }); dom.setValue(field, value); });
      // Reactの入力値が更新されてからEnterを送り、候補の先頭を勝手に選ばない。
      await new Promise(resolve => setTimeout(resolve, 150));
      check();
      if (!field.isConnected || field.value !== value) return false;
      write(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
      try {
        await waitFor(() => { check(); return selectedHashtags(form).includes(tag) && !field.value ? true : null; }, 3500);
      } catch { check(); return false; }
      write(() => field.blur());
    }
    check();
    // カテゴリから増えた余分なタグがある場合も「一致」とは案内しない。
    const actual = selectedHashtags(form);
    return actual.length === expected.length && expected.every(tag => actual.includes(tag));
  }

  async function fillRelist(): Promise<void> {
    const token = location.hash.match(/^#furimanager-yahoo=([0-9a-f-]{36})$/)?.[1];
    if (location.origin !== dom.SELL_ORIGIN || location.pathname !== "/item/add" || !token) return;
    const sourceUrl = location.href;
    const key = JOB_PREFIX + token;
    let guard: ReturnType<typeof createFormGuard> | undefined;
    running = true;
    try {
      const state = await chromeApi.storage.local.get(key);
      if (location.href !== sourceUrl) throw new Error("画面が切り替わったため自動入力を止めました。");
      const job = state[key];
      if (!job || typeof job.savedAt !== "number" || Date.now() < job.savedAt || Date.now() - job.savedAt > MAX_AGE_MS) throw new Error("引き継ぐ出品データが期限切れです。商品ページからやり直してください。");
      const item = job.item;
      if (!["relist", "draft"].includes(job.mode) || !item || dom.itemId(item.itemUrl) !== item.itemId || !Array.isArray(item.imageUrls) || item.imageUrls.some((url: string) => !dom.imageUrl(url))) throw new Error("出品データを確認できませんでした。");
      const form = await waitFor<Element>(() => {
        const candidate = document.querySelector("main form");
        // Reactのフォーム外枠だけが先に描画される場合も、入力欄が揃うまで待つ。
        return candidate && dom.unique(candidate, 'input[placeholder="商品名を入力してください（必須）"]') && dom.unique(candidate, "textarea") && dom.priceField(candidate) ? candidate : null;
      });
      if (location.href !== sourceUrl || !form.isConnected || document.querySelector("main form") !== form) throw new Error("画面が切り替わったため自動入力を止めました。");
      const title = dom.unique(form, 'input[placeholder="商品名を入力してください（必須）"]');
      const description = dom.unique(form, "textarea");
      const amount = dom.priceField(form);
      if (!title || !description || !amount) throw new Error("出品フォームの項目が変わっています。自動入力を止めました。");
      if (title.value || description.value || amount.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("入力済みの内容があるため、上書きせず止めました。空の新規出品画面からやり直してください。");
      history.replaceState(history.state, "", location.pathname + location.search);
      guard = createFormGuard(form);
      const check = guard.check;
      await chromeApi.storage.local.remove(key); // このタブで一度だけ使う。
      check();
      if (title.value || description.value || amount.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("入力済みの内容があるため、上書きせず止めました。");
      notify("商品情報を入力しています…");
      const missing: string[] = [];
      dom.setValue(title, item.title);
      dom.setValue(description, item.description);
      if (!(await fillPicker(form, "カテゴリ", item.categoryPath, check))) missing.push("カテゴリ");
      check();
      if (!(await fillPicker(form, "商品の状態", [item.rows["商品の状態"]].filter(Boolean), check))) missing.push("商品の状態");
      check();
      const shippingName = item.rows["配送の方法"] === "おてがる配送（日本郵便）" ? "JAPAN_POST" : item.rows["配送の方法"] === "おてがる配送（ヤマト運輸）" ? "YAMATO" : null;
      const shipping = shippingName && dom.unique(form, `input[type="radio"][name="${shippingName}"]`);
      if (shipping) { if (!shipping.checked) guard.write(() => shipping.click()); } else missing.push("配送方法");
      if (!dom.selectText(form.querySelector('select[name="timeToShip"]'), item.rows["発送までの日数"])) missing.push("発送までの日数");
      if (!dom.selectText(form.querySelector('select[name="prefectures"]'), item.rows["発送元の地域"])) missing.push("発送元の地域");
      const handled = new Set(["カテゴリ", "商品の状態", "配送の方法", "発送までの日数", "発送元の地域", "商品ID"]);
      for (const [name, value] of Object.entries(item.rows) as [string, string][]) {
        if (handled.has(name) || !value) continue;
        const select = Array.from(form.querySelectorAll<HTMLSelectElement>("select")).find(element => element.name === name) ?? null;
        if (!dom.selectText(select, value)) missing.push(`${name}：${value}`);
      }
      // TODO: ブランド候補・複数選択属性は実DOM検証後に対応する。
      if (!(await fillHashtags(form, item.hashtags, check, guard.write))) missing.push(`ハッシュタグ（元の内容）：${item.hashtags.join(" ") || "なし"}`);
      if (!(await fillImages(form, item.imageUrls, check))) missing.push("画像（自動追加を確認できませんでした）");
      check();
      // 画像・カテゴリ変更による価格初期化を避け、元の価格を最後にもう一度反映。
      const finalPrice = dom.priceField(form);
      if (finalPrice && Number.isSafeInteger(item.price) && item.price >= 300 && item.price <= 9999999) guard.write(() => dom.setPriceValue(finalPrice, String(item.price)));
      else missing.push("販売価格");
      await new Promise(resolve => setTimeout(resolve, 300));
      check();
      if (title.value !== item.title) missing.push("商品名");
      if (description.value !== item.description) missing.push("商品説明");
      if (!finalPrice || dom.price(finalPrice.value) !== item.price) missing.push("販売価格の一致");
      const finalLabel = job.mode === "draft" ? "下書きに保存する" : "出品する";
      const finalButton = dom.exactButton(form, finalLabel);
      if (!finalButton || finalButton.disabled) missing.push(`「${finalLabel}」の有効化`);
      // 画像取得中にYahoo側のカテゴリ描画が確定する場合も、最終表示を再照合する。
      const categoryWarning = missing.indexOf("カテゴリ");
      if (categoryWarning >= 0 && pickerMatches(form, "カテゴリ", item.categoryPath)) missing.splice(categoryWarning, 1);
      notify(missing.length
        ? `入力できた項目を反映しました。次の項目は手動で確認してください。\n・${[...new Set(missing)].join("\n・")}\n元の価格：${item.price.toLocaleString()}円\n最後に「${finalLabel}」を押してください。`
        : `入力が完了しました。元の価格：${item.price.toLocaleString()}円\n内容を確認して「${finalLabel}」を押してください。`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      guard?.dispose();
      try { await chromeApi.storage.local.remove(key); } catch { /* 拡張更新後は古い接続で片付けられない。 */ }
      running = false;
    }
  }

  function scheduleScan(): void {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 250);
  }
  async function fillCrossListing(item: any, job: any, check: () => void): Promise<void> {
    const cross = (globalThis as any).FurimanagerCrossListing;
    const form = await cross.wait(() => {
      const f = document.querySelector("main form");
      return f && dom.unique(f, 'input[placeholder="商品名を入力してください（必須）"]') && dom.unique(f, "textarea") && dom.priceField(f) ? f : null;
    }, check);
    const fields = () => ({ title: dom.unique(form, 'input[placeholder="商品名を入力してください（必須）"]'), description: dom.unique(form, "textarea"), price: dom.priceField(form) });
    const empty = () => {
      check(); const f = fields();
      if (!form.isConnected || !f.title || !f.description || !f.price || f.title.value || f.description.value || f.price.value || form.querySelector('img[src^="https://auctions.c.yimg.jp/"]')) throw new Error("入力済みの内容があるため、上書きせず止めました。空の出品画面でやり直してください。");
    };
    const originalCheck = check;
    check = () => {
      originalCheck();
      if (!form.isConnected || document.querySelector("main form") !== form) throw new Error("出品フォームが切り替わったため、自動入力を止めました。");
    };
    empty(); await cross.claim(job, check); const files = await cross.files(job, check); empty();
    const warnings = ["カテゴリ"];
    const values = cross.metadata(item);
    if (!(await fillImages(form, item.imageUrls, check, files))) warnings.push("画像の追加枚数");
    check(); const f = fields();
    if (!f.title || !f.description || !f.price || f.title.value || f.description.value || f.price.value) throw new Error("別の入力内容を確認したため、上書きせず止めました。");
    const expectedTitle = cross.setTitle(f.title, item, warnings);
    cross.setText(f.description, item.description, "説明", warnings);
    dom.setPriceValue(f.price, String(item.price));
    if (!values.condition || !(await fillPicker(form, "商品の状態", [values.condition], check))) warnings.push("商品の状態");
    check();
    const shippingSelector = values.carrier ? `input[type="radio"][name="${values.carrier === "post" ? "JAPAN_POST" : "YAMATO"}"]` : null;
    const shipping = shippingSelector ? dom.unique(form, shippingSelector) : null;
    if (shipping && !shipping.disabled) {
      if (!shipping.checked) {
        // radio.click由来の同期changeを、本人の手入力と取り違えない。
        if ((originalCheck as any).write) (originalCheck as any).write(() => shipping.click()); else shipping.click();
      }
    } else warnings.push("配送方法");
    check();
    if (!values.shippingPayer) warnings.push("送料負担（Yahoo!フリマは出品者負担です）");
    if (!cross.selectExact(form.querySelector('select[name="timeToShip"]'), values.shippingDays)) warnings.push("発送までの日数");
    if (!cross.selectExact(form.querySelector('select[name="prefectures"]'), values.shippingFrom)) warnings.push("発送元の地域（選択してください）");
    if (item.brand) warnings.push("ブランド"); if (item.size) warnings.push("サイズ");
    await new Promise(resolve => setTimeout(resolve, 400)); check();
    const final = fields();
    if (final.title?.value !== expectedTitle) warnings.push("商品名の一致");
    if (final.description?.value !== item.description) warnings.push("説明の一致");
    if (dom.price(final.price?.value ?? "") !== item.price) warnings.push("価格の一致");
    if (values.condition && !pickerMatches(form, "商品の状態", [values.condition])) warnings.push("商品の状態");
    if (shippingSelector && !dom.unique(form, shippingSelector)?.checked) warnings.push("配送方法");
    if (values.shippingDays && !cross.selectedExact(form.querySelector('select[name="timeToShip"]'), values.shippingDays)) warnings.push("発送までの日数");
    if (values.shippingFrom && !cross.selectedExact(form.querySelector('select[name="prefectures"]'), values.shippingFrom)) warnings.push("発送元の地域");
    cross.complete(item, warnings);
  }
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (lastUrl !== location.href) { lastUrl = location.href; scheduleScan(); } }, 500);
  const cross = (globalThis as any).FurimanagerCrossListing;
  void (async () => {
    if (!(await cross?.receive("yahoo", fillCrossListing))) await fillRelist();
    scan();
  })();
})();
