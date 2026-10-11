(() => {
  const api = (globalThis as any).chrome;
  const P = (globalThis as any).FurimaneBulkPolicy;
  if (!api?.runtime?.onMessage || !P) return;
  let job: any = null;
  let ledger: Record<string, number> = {};
  const busy = () => job && ["scanning", "running"].includes(job.status);
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const errorText = (error: unknown) => error instanceof Error ? error.message : "処理を続けられませんでした。";
  const initial = api.storage.local.get([P.STATE_KEY, P.LEDGER_KEY]).then((saved: any) => {
    ledger = saved[P.LEDGER_KEY] ?? {};
    if (saved[P.STATE_KEY]) {
      job = { ...saved[P.STATE_KEY], token: null, workerTab: null };
      if (["scanning", "ready", "running"].includes(job.status)) {
        job.status = "interrupted";
        job.message = "前回の処理が中断しました。自動再開はしません。確認中の商品は24時間、再実行の対象外です。";
      }
    }
  });

  function summary() {
    if (!job) return { status: "idle" };
    // トークン・実行権限・タブ情報を保存データや表示データに含めない。
    const { id, status, message, startedAt, seller, scanned, rows, candidates, completed, skipped, attempted, ownerTab, workProgress } = job;
    // 表示専用の計測。対象判定に使うサーバー時刻とは混ぜない。
    const progressTiming = status === "running" ? {
      samples: job.workSamples ?? 0, workMs: job.workMs ?? 0, phase: job.phase ?? "working",
      currentWorkMs: job.workStarted == null ? 0 : Math.max(0, performance.now() - job.workStarted),
      waitRemainingMs: job.waitUntil == null ? 0 : Math.max(0, job.waitUntil - performance.now()),
    } : null;
    return { id, status, message, startedAt, seller, scanned, rows, candidates, completed, skipped, attempted, ownerTab, workProgress, progressTiming };
  }

  async function persist() { await api.storage.local.set({ [P.STATE_KEY]: summary() }); }

  function assertActive(current: any) {
    if (job !== current || current.cancelled || !busy()) throw new Error("停止しました。");
    if (Date.now() - current.heartbeat > 30_000) throw new Error("出品中ページとの接続が切れたため停止しました。");
  }

  async function assertOwner(current: any) {
    assertActive(current);
    const tab = await api.tabs.get(current.ownerTab);
    assertActive(current);
    if (!P.listingsPage(tab.url ?? "")) throw new Error("出品中ページを離れたため停止しました。");
  }

  async function read(path: string, token: string, params: Record<string, string> = {}) {
    const url = new URL(`https://api.mercari.jp/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: "GET", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", authorization: token, "x-platform": "web" },
    });
    if (!response.ok) throw new Error(`商品情報を取得できませんでした（${response.status}）。ログイン状態を確認してください。`);
    const serverAt = Date.parse(response.headers.get("date") ?? "");
    if (!Number.isFinite(serverAt)) throw new Error("正確な時刻を確認できないため停止しました。");
    const payload = await response.json();
    if (payload?.result === "error" || payload?.result === "fail") throw new Error("メルカリからエラーが返ったため停止しました。");
    return { payload, serverAt };
  }

  async function profile(token: string) {
    const response = await read("users/get_profile", token, { _user_format: "profile" });
    const source = response.payload?.data ?? response.payload;
    const seller = String(source?.id ?? source?.profile?.id ?? "");
    if (!/^\d+$/.test(seller)) throw new Error("ログイン中の出品者を確認できませんでした。");
    return { seller, serverAt: response.serverAt };
  }

  async function detail(current: any, id: string) {
    const response = await read("items/get", current.token, { id, _item_photo_format: "detail", include_product_page_component: "true" });
    return { item: P.item(response.payload, id), serverAt: response.serverAt };
  }

  function addRow(current: any, value: any, reason: string | null) {
    current.rows.push({ id: value.id, title: value.title, price: value.price, updated: value.updated,
      status: reason ? "対象外" : "対象", reason });
    if (reason) current.skipped++;
    else current.candidates.push(value);
  }

  async function scan(current: any) {
    const start = performance.now();
    const account = await profile(current.token);
    assertActive(current);
    current.seller = account.seller;
    // 応答の往復時間も差し引き、ボタンを押した時点より後へ基準を動かさない。
    current.startedAt = account.serverAt - Math.ceil(performance.now() - start) - current.requestAge;
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      await assertOwner(current);
      const params: Record<string, string> = {
        seller_id: current.seller, status: "on_sale", sort_type: "updated", order_by: "desc",
        limit: "30", with_auction: "true", with_total_item_count: "true", with_action_hints: "true",
      };
      if (cursor) params.max_pager_id = cursor;
      const { payload } = await read("items/get_items", current.token, params);
      assertActive(current);
      if (!Array.isArray(payload?.data)) throw new Error("出品一覧の形式を確認できませんでした。");
      for (const value of payload.data) {
        const id = String(value?.id ?? value?.item?.id ?? "");
        if (!/^m\d+$/.test(id)) throw new Error("一覧の商品IDを確認できませんでした。");
        ids.add(id);
      }
      current.message = `出品一覧を取得中… ${ids.size}件`;
      cursor = P.nextPage(payload, payload.data);
      if (!cursor) break;
      if (cursors.has(cursor) || page === 199) throw new Error("一覧を最後まで取得できなかったため停止しました。再確認してください。");
      cursors.add(cursor);
      await pause(current, 1000 + Math.random() * 1000);
    }
    for (const id of ids) {
      await assertOwner(current);
      const { item } = await detail(current, id);
      assertActive(current);
      addRow(current, item, P.reason(item, current.seller, current.startedAt, ledger[`${current.seller}/${id}`]));
      current.scanned++;
      current.message = `更新日時を確認中… ${current.scanned} / ${ids.size}件`;
      await pause(current, 600 + Math.random() * 600);
    }
    await assertOwner(current);
    if (!current.candidates.length) {
      current.status = "done";
      current.message = "今回の対象商品はありません。";
      await persist();
      return;
    }
    // 1回のクリックで対象確認から実行へ進む。基準時刻は開始時のまま固定する。
    current.status = "running";
    current.message = `${current.candidates.length}件の値下げを開始します…`;
    await persist();
    await assertOwner(current);
    await run(current);
  }

  async function pause(current: any, ms: number) {
    // 長い待機も小分けにし、停止を待ち時間の途中で受け付ける。
    const end = performance.now() + ms;
    while (performance.now() < end) {
      assertActive(current);
      await sleep(Math.min(500, end - performance.now()));
    }
    assertActive(current);
  }

  async function readyPage(current: any, stage: "ITEM" | "EDITOR") {
    const expected = `${P.ORIGIN}/${stage === "ITEM" ? "item" : "sell/edit"}/${current.current.id}`;
    for (let retry = 0; retry < 40; retry++) {
      await assertOwner(current);
      const tab = await api.tabs.get(current.workerTab);
      if (tab.url !== expected) {
        const openingEditor = stage === "EDITOR" && tab.url === `${P.ORIGIN}/item/${current.current.id}`;
        if (tab.status === "complete" && !openingEditor) throw new Error("対象の商品画面を開けませんでした。ログイン状態を確認してください。");
      } else {
        let result: any;
        try {
          result = await api.tabs.sendMessage(current.workerTab, { type: `${P.PREFIX}${stage}_READY`, itemId: current.current.id });
          // 既存の−100円入力スクリプトも読み込み済みであることを確認する。
          if (stage === "EDITOR" && result?.ready) {
            const legacy = await api.tabs.sendMessage(current.workerTab, { type: "FURIMANE_PRICE_ADJUST_READY", itemId: current.current.id });
            result = { ready: legacy?.ready === true };
          }
        } catch { result = null; /* 読み込み中の確認だけを再送し、操作は再送しない。 */ }
        if (result?.error) throw new Error(result.error);
        if (result?.ready) return;
      }
      await pause(current, 500);
    }
    throw new Error(stage === "ITEM" ? "商品ページの「商品の編集」を確認できませんでした。" : "編集画面の価格欄を確認できませんでした。");
  }

  async function closeWorker(current: any) {
    if (!Number.isInteger(current.workerTab)) return;
    const tabId = current.workerTab;
    current.workerTab = null;
    try {
      const tab = await api.tabs.get(tabId);
      const expected = [`${P.ORIGIN}/item/${current.current.id}`, `${P.ORIGIN}/sell/edit/${current.current.id}`];
      if (expected.includes(tab.url)) await api.tabs.remove(tabId);
    } catch { /* すでに閉じられた専用タブは処理しない。 */ }
    current.workerTab = null;
  }

  async function run(current: any) {
    const account = await profile(current.token);
    if (account.seller !== current.seller) throw new Error("ログイン中のアカウントが変わったため停止しました。");
    for (const candidate of current.candidates) {
      current.phase = "working";
      // 表示専用。実際に通過した段階だけ進め、保存確認前には1件完了にしない。
      current.workProgress = 0;
      current.workStarted = performance.now();
      current.waitUntil = null;
      await assertOwner(current);
      const row = current.rows.find((value: any) => value.id === candidate.id);
      const fresh = await detail(current, candidate.id);
      assertActive(current);
      const reason = P.reason(fresh.item, current.seller, current.startedAt, ledger[`${current.seller}/${candidate.id}`]);
      if (reason || !P.unchanged(candidate, fresh.item)) {
        row.status = "除外"; row.reason = reason ?? "確認後に商品情報が変わった"; current.skipped++;
        current.workStarted = null;
        await persist();
        continue;
      }
      current.current = candidate;
      current.workProgress = 0.1;
      current.authorized = false;
      current.authorizing = false;
      current.message = `値下げ中… ${current.completed + 1} / ${current.candidates.length}件`;
      const tab = await api.tabs.create({ url: `${P.ORIGIN}/item/${candidate.id}`, active: false });
      current.workerTab = tab.id;
      current.workProgress = 0.2;
      await readyPage(current, "ITEM");
      current.workProgress = 0.35;
      await assertOwner(current);
      // 商品ページの実リンクから編集へ進む。商品ごとにこの順序を完了させる。
      const opened = await api.tabs.sendMessage(current.workerTab, { type: `${P.PREFIX}ITEM_OPEN_EDIT`, itemId: candidate.id });
      if (!opened?.opened) throw new Error(opened?.error ?? "商品の編集へ進めませんでした。");
      current.workProgress = 0.45;
      await readyPage(current, "EDITOR");
      current.workProgress = 0.6;
      await assertOwner(current);
      // 個別の−100円と同じ入力処理を再利用する。入力も保存も1回だけ。
      const prepared = await api.tabs.sendMessage(current.workerTab, {
        type: "APPLY_FURIMANE_PRICE_DROP_ON_EDIT", delta: -100, minimumPrice: 300,
        bulkJobId: current.id, itemId: candidate.id, expectedPrice: candidate.price,
      });
      if (!prepared?.success || prepared.currentPrice !== candidate.price || prepared.nextPrice !== candidate.price - 100) {
        throw new Error(prepared?.reason ?? "−100円の入力を確認できませんでした。");
      }
      current.workProgress = 0.7;
      await assertOwner(current);
      // 保存メッセージは1回だけ。応答が失われても同じ操作を再送しない。
      let reply: any;
      try {
        reply = await api.tabs.sendMessage(current.workerTab, {
          type: `${P.PREFIX}EDITOR_APPLY`, jobId: current.id, itemId: candidate.id, price: candidate.price,
        });
      } catch { reply = null; }
      if (reply?.error) throw new Error(reply.error);
      if (!current.authorized) throw new Error("保存前の最終確認が完了しなかったため停止しました。");
      current.workProgress = 0.9;
      let verified = false;
      // 保存済みの可能性がある1件は、停止要求後も結果だけを確認する。
      for (let check = 0; check < 6; check++) {
        await sleep(2000);
        const result = await detail(current, candidate.id);
        if (result.item.seller === current.seller && result.item.price === candidate.price - 100
          && result.item.updated !== null && result.item.updated > candidate.updated) {
          verified = true;
          break;
        }
        if (result.item.price !== candidate.price) break;
      }
      if (!verified) throw new Error("保存結果を確認できませんでした。該当商品の価格を手動で確認してください。自動再送はしません。");
      row.status = "完了"; row.reason = null; current.completed++;
      current.workProgress = 0;
      current.workMs = (current.workMs ?? 0) + performance.now() - current.workStarted;
      current.workSamples = (current.workSamples ?? 0) + 1;
      current.workStarted = null;
      await persist();
      await closeWorker(current);
      if (candidate !== current.candidates.at(-1)) {
        // 保存できた件数で区切る。20件ごとの休憩は通常待機に置き換え、二重に待たない。
        const batchBreak = current.completed % 20 === 0;
        const waitMs = batchBreak ? 20_000 + Math.random() * 10_000 : 3000 + Math.random() * 4000;
        current.phase = batchBreak ? "break" : "waiting";
        current.waitUntil = performance.now() + waitMs;
        current.message = batchBreak
          ? `${current.completed}件完了。20〜30秒休憩してから続けます…`
          : `次の商品まで待機中… 完了 ${current.completed}件`;
        await pause(current, waitMs);
      }
    }
    assertActive(current);
    current.status = "done";
    current.message = `${current.completed}件の値下げが完了しました。`;
    await persist();
  }

  async function launch(current: any, operation: (current: any) => Promise<void>) {
    try { await operation(current); }
    catch (error) {
      current.status = current.cancelled ? "stopped" : "error";
      current.message = current.cancelled ? "停止しました。保存を開始した商品の結果を確認してください。" : errorText(error);
      await persist().catch(() => {});
    } finally {
      if (!["running", "scanning"].includes(current.status)) current.token = null;
    }
  }

  async function authorize(message: any, sender: any) {
    const current = job;
    if (!current || sender.frameId !== 0 || sender.tab?.id !== current.workerTab || current.status !== "running"
      || current.id !== message.jobId || current.current?.id !== message.itemId || current.authorized || current.authorizing
      || new URL(sender.url).origin !== P.ORIGIN) throw new Error("この編集画面では一括処理を実行できません。");
    current.authorizing = true;
    const editor = await api.tabs.get(sender.tab.id);
    if (editor.url !== `${P.ORIGIN}/sell/edit/${message.itemId}` || editor.pendingUrl) throw new Error("編集対象のページが変わったため停止しました。");
    await assertOwner(current);
    if (typeof message.accessToken !== "string" || message.accessToken !== current.token) throw new Error("ログイン情報が変わったため停止しました。");
    const account = await profile(message.accessToken);
    const fresh = await detail(current, message.itemId);
    await assertOwner(current);
    if (account.seller !== current.seller || P.reason(fresh.item, current.seller, current.startedAt, ledger[`${current.seller}/${message.itemId}`])
      || !P.unchanged(current.current, fresh.item)) throw new Error("保存前に商品情報が変わったため停止しました。");
    // 保存ボタンより先に記録する。不確かな成功を再送して二重値下げにしない。
    ledger[`${current.seller}/${message.itemId}`] = fresh.serverAt;
    await api.storage.local.set({ [P.LEDGER_KEY]: ledger });
    await assertOwner(current);
    current.authorized = true;
    current.attempted++;
    const row = current.rows.find((value: any) => value.id === message.itemId);
    row.status = "確認中";
    await persist();
    assertActive(current);
    return { allowed: true, nextPrice: current.current.price - 100 };
  }

  async function handle(message: any, sender: any) {
    await initial;
    const action = message.type.slice(P.PREFIX.length);
    if (action === "AUTHORIZE") return authorize(message, sender);
    let senderOrigin = "";
    try { senderOrigin = new URL(sender.url).origin; } catch { /* URL不明は許可しない。 */ }
    if (sender.frameId !== 0 || senderOrigin !== P.ORIGIN || (sender.origin && sender.origin !== P.ORIGIN)
      || !Number.isInteger(sender.tab?.id)) {
      throw new Error("出品中ページから操作してください。");
    }
    // SPA内の移動ではsender.urlに元の文書URLが残ることがある。
    // 送信元のorigin/frameを確認した上で、Chromeが持つ現在のタブURLで判定する。
    const currentTab = await api.tabs.get(sender.tab.id);
    if (!P.listingsPage(currentTab.url ?? "") || (currentTab.pendingUrl && !P.listingsPage(currentTab.pendingUrl))) {
      throw new Error("出品中ページから操作してください。");
    }
    if (action === "STATUS") {
      if (busy() && job.ownerTab === sender.tab.id && job.instance === message.instance) {
        job.heartbeat = Date.now();
        if (message.accessToken !== job.token) job.cancelled = true;
      }
      return { state: summary(), owns: job?.ownerTab === sender.tab.id && job?.instance === message.instance };
    }
    if (action === "START") {
      if (busy()) throw new Error("別の一括処理が進行中です。先に完了または停止してください。");
      if (typeof message.accessToken !== "string" || !message.accessToken.trim()) throw new Error("メルカリにログインしてください。");
      job = {
        id: crypto.randomUUID(), instance: message.instance, ownerTab: sender.tab.id, token: message.accessToken,
        heartbeat: Date.now(), requestAge: Math.max(0, Math.min(60_000, Number(message.requestAge) || 0)),
        status: "scanning", message: "出品一覧を確認しています…", scanned: 0, completed: 0, skipped: 0,
        attempted: 0, rows: [], candidates: [], cancelled: false, workerTab: null,
      };
      try { await persist(); }
      catch (error) { job.status = "error"; job.token = null; throw error; }
      void launch(job, scan);
      return { state: summary(), owns: true };
    }
    if (!job || job.ownerTab !== sender.tab.id || message.jobId !== job.id) throw new Error("開始した出品中ページで操作してください。");
    if (action === "CANCEL") {
      job.cancelled = true;
      job.message = "停止を受け付けました。保存を開始した商品の結果を確認しています…";
      return { state: summary(), owns: true };
    }
    throw new Error("操作を確認できませんでした。");
  }

  api.runtime.onMessage.addListener((message: any, sender: any, respond: (result: any) => void) => {
    if (!message?.type?.startsWith(P.PREFIX) || message.type.includes("EDITOR_") || message.type.includes("ITEM_")) return false;
    void handle(message, sender).then(respond).catch((error: unknown) => respond({ error: errorText(error) }));
    return true;
  });
  api.tabs.onRemoved.addListener((tabId: number) => {
    if (busy() && (tabId === job.ownerTab || tabId === job.workerTab)) job.cancelled = true;
  });
  api.tabs.onUpdated.addListener((tabId: number, change: any) => {
    if (busy() && tabId === job.ownerTab && (change.status === "loading" || (change.url && !P.listingsPage(change.url)))) job.cancelled = true;
  });
})();
