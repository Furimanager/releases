// サービス間コピー専用。既存の再出品pendingや元商品の変更処理とは共有しない。
(() => {
  const endpoints = { mercari: "https://jp.mercari.com/sell/create", yahoo: "https://paypayfleamarket-sec.yahoo.co.jp/item/add" };
  const origins = { mercari: "https://jp.mercari.com", yahoo: "https://paypayfleamarket.yahoo.co.jp" };
  type Platform = "mercari" | "yahoo";
  function sourceOf(value: string) {
    try {
      const url = new URL(value);
      for (const platform of ["mercari", "yahoo"] as Platform[]) {
        const id = url.pathname.match(platform === "mercari" ? /^\/item\/(m\d+)\/?$/ : /^\/item\/(z\d+)\/?$/)?.[1];
        if (url.origin === origins[platform] && id && !url.username && !url.password) return { platform, id, url: `${url.origin}/item/${id}` };
      }
    } catch { /* 他サイトのURLは受け付けない。 */ }
    return null;
  }
  function imageAllowed(value: unknown, platform: Platform): boolean {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && (platform === "yahoo"
        ? url.origin === "https://auctions.c.yimg.jp" && url.pathname.startsWith("/images.auctions.yahoo.co.jp/")
        : url.hostname.endsWith(".mercdn.net"));
    } catch { return false; }
  }
  function normalize(raw: any, currentUrl: string) {
    const source = sourceOf(currentUrl);
    if (!source || !raw || raw.itemId !== source.id || sourceOf(raw.itemUrl)?.url !== source.url) throw new Error("元の商品を確認できませんでした。商品ページを開き直してください。");
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 500 || typeof raw.description !== "string" || raw.description.length > 20000 || !Number.isSafeInteger(raw.price) || raw.price < 300 || raw.price > 9999999) throw new Error("商品名・説明・価格を取得できませんでした。");
    if (!Array.isArray(raw.imageUrls) || !raw.imageUrls.length || raw.imageUrls.length > 20 || raw.imageUrls.some((v: unknown) => !imageAllowed(v, source.platform))) throw new Error("商品画像を取得できませんでした。");
    const text = (value: unknown) => typeof value === "string" ? value.slice(0, 500) : "";
    const list = (value: unknown) => Array.isArray(value) ? value.slice(0, 20).map(text).filter(Boolean) : [];
    const rows = source.platform === "yahoo" ? raw.rows ?? {} : {};
    const tags = list(raw.hashtags);
    // Yahoo専用のタグ欄はメルカリにないため、説明の末尾へ重複なく残す。
    const extra = tags.filter(tag => !raw.description.split(/\s+/).includes(tag));
    return { source: source.platform, target: source.platform === "mercari" ? "yahoo" : "mercari", itemId: source.id, itemUrl: source.url,
      title: raw.title, description: raw.description + (extra.length ? `${raw.description ? "\n\n" : ""}${extra.join(" ")}` : ""), price: raw.price,
      imageUrls: [...new Set(raw.imageUrls)] as string[], categoryPath: list(raw.categoryPath), condition: text(rows["商品の状態"] ?? raw.condition),
      shippingFrom: text(rows["発送元の地域"] ?? raw.shippingFrom), shippingDays: text(rows["発送までの日数"] ?? raw.shippingDays),
      shippingPayer: source.platform === "yahoo" ? "送料込み(出品者負担)" : text(raw.shippingPayer),
      shippingMethod: text(rows["配送の方法"] ?? raw.shippingMethod), brand: text(raw.brand), size: text(raw.size) };
  }
  const optionText = (value: unknown): string => typeof value === "string" ? value.normalize("NFKC").replace(/[〜～]/g, "~").replace(/\s/g, "") : "";
  function metadata(item: any) {
    // コピー元の表記を各サイトの選択肢へ合わせる。意味が一致しない状態は推測しない。
    const yahoo = item.target === "yahoo";
    const sourceCondition = optionText(item.condition);
    const common = ["未使用に近い", "目立った傷や汚れなし", "やや傷や汚れあり", "傷や汚れあり"];
    const condition = common.includes(sourceCondition) ? sourceCondition
      : sourceCondition === (yahoo ? "新品、未使用" : "未使用") ? (yahoo ? "未使用" : "新品、未使用") : null;
    const rawMethod = optionText(item.shippingMethod);
    // メルカリの詳細欄は配送名の後ろに受取方法・匿名配送のバッジが連結される。
    // 実画面で確認したバッジだけを除き、未知の配送名は推測しない。
    const method = item.source === "mercari"
      ? rawMethod.match(/^(ゆうゆうメルカリ便|らくらくメルカリ便)(?:郵便局\/コンビニ受取|匿名配送)*$/)?.[1] ?? rawMethod
      : rawMethod;
    const payer = optionText(item.shippingPayer);
    const prepaid = item.source === "yahoo" || payer === "送料込み(出品者負担)";
    const carrier = prepaid ? (method === (yahoo ? "ゆうゆうメルカリ便" : "おてがる配送(日本郵便)") ? "post"
      : method === (yahoo ? "らくらくメルカリ便" : "おてがる配送(ヤマト運輸)") ? "yamato" : null) : null;
    const shippingMethod = carrier === "post" ? (yahoo ? "おてがる配送（日本郵便）" : "ゆうゆうメルカリ便")
      : carrier === "yamato" ? (yahoo ? "おてがる配送（ヤマト運輸）" : "らくらくメルカリ便") : null;
    const days = optionText(item.shippingDays).replace(/で発送$/, "");
    const shippingDays = ["1~2日", "2~3日"].includes(days) ? days + (yahoo ? "" : "で発送")
      : days === (yahoo ? "4~7日" : "3~7日") ? (yahoo ? "3~7日" : "4~7日で発送") : null;
    const prefectures = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
    const shippingFrom = prefectures.find(p => p === optionText(item.shippingFrom)) ?? null;
    return { condition, carrier, shippingMethod, shippingDays, shippingFrom, shippingPayer: prepaid ? "送料込み(出品者負担)" : null };
  }
  // 未対応・候補なしの場合にselectedを解除しない。北海道などの先頭項目への誤変更を防ぐ。
  function selectExact(field: HTMLSelectElement | null, value: string | null): boolean {
    if (!field || !value || field.disabled) return false;
    const matches = Array.from(field.options).filter(option => !option.disabled && optionText(option.label || option.textContent) === optionText(value));
    if (matches.length !== 1) return false;
    field.value = matches[0].value;
    field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
    return selectedExact(field, value);
  }
  function selectedExact(field: HTMLSelectElement | null, value: string | null): boolean {
    return !!value && !!field && optionText(field.selectedOptions[0]?.label || field.selectedOptions[0]?.textContent) === optionText(value);
  }
  const api: any = { endpoints, origins, sourceOf, imageAllowed, normalize, metadata, optionText, selectExact, selectedExact, maxAge: 10 * 60 * 1000 };
  (globalThis as any).FurimanagerCrossListing = api;
  if (typeof document === "undefined") return;
  const chromeApi = (globalThis as any).chrome;
  let busy = false;
  function status(message: string, item?: any) {
    let box = document.getElementById("furimanager-cross-status");
    if (!box) {
      box = document.createElement("aside"); box.id = "furimanager-cross-status"; box.setAttribute("role", "status");
      box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(420px,calc(100vw - 32px));max-height:45vh;overflow:auto;background:#150c2b;color:#fff;padding:16px;border:1px solid #ec4899;border-radius:12px;font:13px/1.7 sans-serif;white-space:pre-wrap;box-sizing:border-box";
      document.body.append(box);
    }
    box.replaceChildren();
    const close = document.createElement("button"); close.type = "button"; close.textContent = "閉じる"; close.style.cssText = "float:right;background:transparent;color:#fff;border:0;text-decoration:underline;cursor:pointer;margin-left:12px"; close.onclick = () => box?.remove();
    const body = document.createElement("div"); body.textContent = message; box.append(close, body);
    if (item) {
      const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "元の商品情報を見る";
      const content = document.createElement("div"); content.textContent = `商品名：${item.title}\n価格：${item.price.toLocaleString()}円\nカテゴリ：${item.categoryPath.join(" > ")}\n状態：${item.condition}\n配送：${item.shippingMethod}\n発送元：${item.shippingFrom}\n日数：${item.shippingDays}\nブランド：${item.brand}\nサイズ：${item.size}\n\n説明：\n${item.description}`;
      details.append(summary, content); box.append(details);
    }
  }
  api.mount = (anchor: Element, collect: () => Promise<any> | any, itemUrl: string) => {
    const source = sourceOf(itemUrl); if (!source) return;
    // 画像スライド内を伸ばすと背景色や画像検索ボタンがリンクに重なるため、直下へ置く。
    const mountAnchor = source.platform === "mercari" ? anchor.closest(".slick-slider") ?? anchor : anchor;
    // ログイン情報の遅延描画で、画像下→操作欄下へ位置が変わっても一つだけにする。
    document.querySelectorAll(".furimanager-cross-link").forEach(node => { if (node !== mountAnchor.nextElementSibling) node.remove(); });
    const existing = mountAnchor.nextElementSibling as HTMLElement | null;
    if (existing?.classList.contains("furimanager-cross-link")) {
      if (existing.dataset.sourceUrl === source.url) return;
      existing.remove();
    }
    const wrap = document.createElement("div"); wrap.className = "furimanager-cross-link"; wrap.dataset.sourceUrl = source.url;
    wrap.style.cssText = "display:block;clear:both;margin:0;padding:6px 0 10px;background:#fff;max-width:100%;line-height:1.5";
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${source.platform === "mercari" ? "Yahoo!フリマ" : "メルカリ"}にコピー出品`;
    button.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:4px 0;border:0;border-radius:0;background:transparent;box-shadow:none;color:#e52e88;font:500 12px/1.6 sans-serif;cursor:pointer;text-align:left";
    // Lucide Copyの線画。ブランドロゴは追加しない。
    button.insertAdjacentHTML("afterbegin", '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>');
    button.onclick = async event => {
      event.preventDefault(); event.stopPropagation(); if (busy) return; busy = true; button.disabled = true;
      try {
        const raw = await collect();
        const item = normalize(raw, location.href);
        if (item.itemUrl !== source.url) throw new Error("商品が切り替わりました。もう一度操作してください。");
        const result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_OPEN", item });
        if (!result?.success) throw new Error(result?.message || "出品画面を開けませんでした。拡張機能と商品ページを再読み込みして、もう一度操作してください。");
        status("新しいタブでコピー出品を開きました。入力内容を確認してから出品してください。");
      } catch (error) { status(error instanceof Error ? error.message : "コピー出品を開始できませんでした。"); }
      finally { busy = false; button.disabled = false; }
    };
    wrap.append(button); mountAnchor.insertAdjacentElement("afterend", wrap);
  };
  api.status = status;
  api.wait = async (find: () => any, check = () => {}, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { check(); const value = find(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error("出品フォームの読み込みを確認できませんでした。元の商品からやり直してください。");
  };
  api.receive = async (target: Platform, fill: (item: any, job: any, check: () => void) => Promise<void>): Promise<boolean> => {
    if (location.origin + location.pathname !== endpoints[target]) return false;
    const marked = location.hash.startsWith("#furimanager-cross=");
    let result;
    try { result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_PEEK" }); }
    catch {
      // 更新直後などの通信失敗で、通常の同一サイト再出品まで止めない。
      if (!marked) return false;
      status("拡張機能との接続を確認できませんでした。商品ページを再読み込みしてやり直してください。"); return true;
    }
    if (!result?.handled) { if (marked) { status("コピー出品データの期限が切れています。元の商品からやり直してください。"); return true; } return false; }
    if (!result.success) { status(result.message); return true; }
    const job = result.job;
    let url = location.href, expectedPath: string | null = null, writing = false, edited = false;
    const onEdit = (event: Event) => { if (!writing && event.isTrusted && !(event.target as Element)?.closest?.("#furimanager-cross-status")) edited = true; };
    for (const event of ["input", "change", "click", "drop"]) document.addEventListener(event, onEdit, true);
    const check: any = () => {
      if (!edited && expectedPath && location.origin === origins.mercari && location.pathname === expectedPath) { url = location.href; expectedPath = null; }
      if (location.href !== url || edited) throw new Error("画面の移動または手動入力を確認したため、自動入力を止めました。入力済みの内容を確認してください。");
    };
    check.write = (action: () => void) => { check(); writing = true; try { action(); } finally { writing = false; } check(); };
    check.navigate = async (path: string, action: () => void) => {
      check();
      if (target !== "mercari" || !["/sell/create", "/sell/conditions", "/sell/shipping_methods"].includes(path)) throw new Error("コピー入力の対象外の画面です。");
      expectedPath = path;
      try { check.write(action); await api.wait(() => location.pathname === path, check, 8000); }
      finally { expectedPath = null; }
    };
    try { status("コピー出品の商品情報を入力しています…"); await fill(job.item, job, check); }
    catch (error) { status(error instanceof Error ? error.message : "コピー出品の入力に失敗しました。", job.item); }
    finally {
      for (const event of ["input", "change", "click", "drop"]) document.removeEventListener(event, onEdit, true);
      try { await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_FINISH", token: job.token }); } catch { /* claimedのままでも再入力は拒否される。 */ }
    }
    return true;
  };
  api.claim = async (job: any, check: () => void) => {
    // 認証画面へ飛ぶ前の空ページでは消費しない。フォーム確認後に一回だけ確保する。
    check(); const result = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_CLAIM" }); check();
    if (!result?.success || result.job?.token !== job.token) throw new Error(result?.message || "コピー出品データを確認できませんでした。");
  };
  api.files = async (job: any, check: () => void) => {
    const files: File[] = [];
    for (let index = 0; index < job.item.imageUrls.length; index++) {
      const response = await chromeApi.runtime.sendMessage({ type: "CROSS_LISTING_IMAGE", token: job.token, index }); check();
      if (!response?.success || !/^data:image\/(jpeg|png|webp);base64,/.test(response.dataUrl ?? "")) throw new Error(`画像${index + 1}枚目の取得に失敗しました。元の商品からやり直してください。`);
      const blob = await (await fetch(response.dataUrl)).blob(); check();
      files.push(new File([blob], `furimane-copy-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type }));
    }
    return files;
  };
  api.setText = (field: HTMLInputElement | HTMLTextAreaElement, value: string, label: string, warnings: string[]) => {
    if (field.maxLength > 0 && value.length > field.maxLength) { warnings.push(`${label}（${field.maxLength}文字以内に編集してください。元の全文は下に表示）`); return; }
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  api.setTitle = (field: HTMLInputElement, item: any, warnings: string[]): string => {
    // サイト側がmaxLength属性を付けない場合も、確認済みの商品名上限を守る。
    const siteLimit = item.target === "mercari" ? 40 : 65;
    const limit = field.maxLength >= 0 ? Math.min(field.maxLength, siteLimit) : siteLimit;
    let value = item.title;
    if (value.length > limit) {
      value = value.slice(0, limit);
      // 絵文字などのサロゲートペアを途中で切らない。
      if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
      const site = item.target === "mercari" ? "メルカリ" : "Yahoo!フリマ";
      warnings.push(`${site}の商品名は${limit}文字までのため、先頭${value.length}文字を入力しました（元は${item.title.length}文字）。内容を確認・調整してください。元の全文は下に表示しています`);
    }
    api.setText(field, value, "商品名", warnings);
    return value;
  };
  api.complete = (item: any, warnings: string[]) => {
    const notes = [...new Set(warnings)].map(value => value === "カテゴリ" ? "カテゴリ：出品先の分類から選択してください" : value);
    status(`入力できた項目を反映しました。\n出品前に確認：\n${notes.map(value => `・${value}`).join("\n")}\n内容を確認して、最後の出品ボタンを押してください。`, item);
  };
})();
