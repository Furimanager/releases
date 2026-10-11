(() => {
  (() => {
    const api = globalThis.chrome;
    const P = globalThis.FurimaneBulkPolicy;
    if (!api?.runtime?.onMessage || !P) return;
    let job = null;
    let ledger = {};
    const busy = () => job && ["scanning", "running"].includes(job.status);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const errorText = (error) => error instanceof Error ? error.message : "\u51E6\u7406\u3092\u7D9A\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002";
    const initial = api.storage.local.get([P.STATE_KEY, P.LEDGER_KEY]).then((saved) => {
      ledger = saved[P.LEDGER_KEY] ?? {};
      if (saved[P.STATE_KEY]) {
        job = { ...saved[P.STATE_KEY], token: null, workerTab: null };
        if (["scanning", "ready", "running"].includes(job.status)) {
          job.status = "interrupted";
          job.message = "\u524D\u56DE\u306E\u51E6\u7406\u304C\u4E2D\u65AD\u3057\u307E\u3057\u305F\u3002\u81EA\u52D5\u518D\u958B\u306F\u3057\u307E\u305B\u3093\u3002\u78BA\u8A8D\u4E2D\u306E\u5546\u54C1\u306F24\u6642\u9593\u3001\u518D\u5B9F\u884C\u306E\u5BFE\u8C61\u5916\u3067\u3059\u3002";
        }
      }
    });
    function summary() {
      if (!job) return { status: "idle" };
      const { id, status, message, startedAt, seller, scanned, rows, candidates, completed, skipped, attempted, ownerTab, workProgress } = job;
      const progressTiming = status === "running" ? {
        samples: job.workSamples ?? 0,
        workMs: job.workMs ?? 0,
        phase: job.phase ?? "working",
        currentWorkMs: job.workStarted == null ? 0 : Math.max(0, performance.now() - job.workStarted),
        waitRemainingMs: job.waitUntil == null ? 0 : Math.max(0, job.waitUntil - performance.now())
      } : null;
      return { id, status, message, startedAt, seller, scanned, rows, candidates, completed, skipped, attempted, ownerTab, workProgress, progressTiming };
    }
    async function persist() {
      await api.storage.local.set({ [P.STATE_KEY]: summary() });
    }
    function assertActive(current) {
      if (job !== current || current.cancelled || !busy()) throw new Error("\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      if (Date.now() - current.heartbeat > 3e4) throw new Error("\u51FA\u54C1\u4E2D\u30DA\u30FC\u30B8\u3068\u306E\u63A5\u7D9A\u304C\u5207\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
    }
    async function assertOwner(current) {
      assertActive(current);
      const tab = await api.tabs.get(current.ownerTab);
      assertActive(current);
      if (!P.listingsPage(tab.url ?? "")) throw new Error("\u51FA\u54C1\u4E2D\u30DA\u30FC\u30B8\u3092\u96E2\u308C\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
    }
    async function read(path, token, params = {}) {
      const url = new URL(`https://api.mercari.jp/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(15e3),
        headers: { accept: "application/json", authorization: token, "x-platform": "web" }
      });
      if (!response.ok) throw new Error(`\u5546\u54C1\u60C5\u5831\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF08${response.status}\uFF09\u3002\u30ED\u30B0\u30A4\u30F3\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
      const serverAt = Date.parse(response.headers.get("date") ?? "");
      if (!Number.isFinite(serverAt)) throw new Error("\u6B63\u78BA\u306A\u6642\u523B\u3092\u78BA\u8A8D\u3067\u304D\u306A\u3044\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      const payload = await response.json();
      if (payload?.result === "error" || payload?.result === "fail") throw new Error("\u30E1\u30EB\u30AB\u30EA\u304B\u3089\u30A8\u30E9\u30FC\u304C\u8FD4\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      return { payload, serverAt };
    }
    async function profile(token) {
      const response = await read("users/get_profile", token, { _user_format: "profile" });
      const source = response.payload?.data ?? response.payload;
      const seller = String(source?.id ?? source?.profile?.id ?? "");
      if (!/^\d+$/.test(seller)) throw new Error("\u30ED\u30B0\u30A4\u30F3\u4E2D\u306E\u51FA\u54C1\u8005\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      return { seller, serverAt: response.serverAt };
    }
    async function detail(current, id) {
      const response = await read("items/get", current.token, { id, _item_photo_format: "detail", include_product_page_component: "true" });
      return { item: P.item(response.payload, id), serverAt: response.serverAt };
    }
    function addRow(current, value, reason) {
      current.rows.push({
        id: value.id,
        title: value.title,
        price: value.price,
        updated: value.updated,
        status: reason ? "\u5BFE\u8C61\u5916" : "\u5BFE\u8C61",
        reason
      });
      if (reason) current.skipped++;
      else current.candidates.push(value);
    }
    async function scan(current) {
      const start = performance.now();
      const account = await profile(current.token);
      assertActive(current);
      current.seller = account.seller;
      current.startedAt = account.serverAt - Math.ceil(performance.now() - start) - current.requestAge;
      const ids = /* @__PURE__ */ new Set();
      const cursors = /* @__PURE__ */ new Set();
      let cursor = null;
      for (let page = 0; page < 200; page++) {
        await assertOwner(current);
        const params = {
          seller_id: current.seller,
          status: "on_sale",
          sort_type: "updated",
          order_by: "desc",
          limit: "30",
          with_auction: "true",
          with_total_item_count: "true",
          with_action_hints: "true"
        };
        if (cursor) params.max_pager_id = cursor;
        const { payload } = await read("items/get_items", current.token, params);
        assertActive(current);
        if (!Array.isArray(payload?.data)) throw new Error("\u51FA\u54C1\u4E00\u89A7\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        for (const value of payload.data) {
          const id = String(value?.id ?? value?.item?.id ?? "");
          if (!/^m\d+$/.test(id)) throw new Error("\u4E00\u89A7\u306E\u5546\u54C1ID\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
          ids.add(id);
        }
        current.message = `\u51FA\u54C1\u4E00\u89A7\u3092\u53D6\u5F97\u4E2D\u2026 ${ids.size}\u4EF6`;
        cursor = P.nextPage(payload, payload.data);
        if (!cursor) break;
        if (cursors.has(cursor) || page === 199) throw new Error("\u4E00\u89A7\u3092\u6700\u5F8C\u307E\u3067\u53D6\u5F97\u3067\u304D\u306A\u304B\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002\u518D\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        cursors.add(cursor);
        await pause(current, 1e3 + Math.random() * 1e3);
      }
      for (const id of ids) {
        await assertOwner(current);
        const { item } = await detail(current, id);
        assertActive(current);
        addRow(current, item, P.reason(item, current.seller, current.startedAt, ledger[`${current.seller}/${id}`]));
        current.scanned++;
        current.message = `\u66F4\u65B0\u65E5\u6642\u3092\u78BA\u8A8D\u4E2D\u2026 ${current.scanned} / ${ids.size}\u4EF6`;
        await pause(current, 600 + Math.random() * 600);
      }
      await assertOwner(current);
      if (!current.candidates.length) {
        current.status = "done";
        current.message = "\u4ECA\u56DE\u306E\u5BFE\u8C61\u5546\u54C1\u306F\u3042\u308A\u307E\u305B\u3093\u3002";
        await persist();
        return;
      }
      current.status = "running";
      current.message = `${current.candidates.length}\u4EF6\u306E\u5024\u4E0B\u3052\u3092\u958B\u59CB\u3057\u307E\u3059\u2026`;
      await persist();
      await assertOwner(current);
      await run(current);
    }
    async function pause(current, ms) {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        assertActive(current);
        await sleep(Math.min(500, end - performance.now()));
      }
      assertActive(current);
    }
    async function readyPage(current, stage) {
      const expected = `${P.ORIGIN}/${stage === "ITEM" ? "item" : "sell/edit"}/${current.current.id}`;
      for (let retry = 0; retry < 40; retry++) {
        await assertOwner(current);
        const tab = await api.tabs.get(current.workerTab);
        if (tab.url !== expected) {
          const openingEditor = stage === "EDITOR" && tab.url === `${P.ORIGIN}/item/${current.current.id}`;
          if (tab.status === "complete" && !openingEditor) throw new Error("\u5BFE\u8C61\u306E\u5546\u54C1\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30ED\u30B0\u30A4\u30F3\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        } else {
          let result;
          try {
            result = await api.tabs.sendMessage(current.workerTab, { type: `${P.PREFIX}${stage}_READY`, itemId: current.current.id });
            if (stage === "EDITOR" && result?.ready) {
              const legacy = await api.tabs.sendMessage(current.workerTab, { type: "FURIMANE_PRICE_ADJUST_READY", itemId: current.current.id });
              result = { ready: legacy?.ready === true };
            }
          } catch {
            result = null;
          }
          if (result?.error) throw new Error(result.error);
          if (result?.ready) return;
        }
        await pause(current, 500);
      }
      throw new Error(stage === "ITEM" ? "\u5546\u54C1\u30DA\u30FC\u30B8\u306E\u300C\u5546\u54C1\u306E\u7DE8\u96C6\u300D\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" : "\u7DE8\u96C6\u753B\u9762\u306E\u4FA1\u683C\u6B04\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    }
    async function closeWorker(current) {
      if (!Number.isInteger(current.workerTab)) return;
      const tabId = current.workerTab;
      current.workerTab = null;
      try {
        const tab = await api.tabs.get(tabId);
        const expected = [`${P.ORIGIN}/item/${current.current.id}`, `${P.ORIGIN}/sell/edit/${current.current.id}`];
        if (expected.includes(tab.url)) await api.tabs.remove(tabId);
      } catch {
      }
      current.workerTab = null;
    }
    async function run(current) {
      const account = await profile(current.token);
      if (account.seller !== current.seller) throw new Error("\u30ED\u30B0\u30A4\u30F3\u4E2D\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      for (const candidate of current.candidates) {
        current.phase = "working";
        current.workProgress = 0;
        current.workStarted = performance.now();
        current.waitUntil = null;
        await assertOwner(current);
        const row = current.rows.find((value) => value.id === candidate.id);
        const fresh = await detail(current, candidate.id);
        assertActive(current);
        const reason = P.reason(fresh.item, current.seller, current.startedAt, ledger[`${current.seller}/${candidate.id}`]);
        if (reason || !P.unchanged(candidate, fresh.item)) {
          row.status = "\u9664\u5916";
          row.reason = reason ?? "\u78BA\u8A8D\u5F8C\u306B\u5546\u54C1\u60C5\u5831\u304C\u5909\u308F\u3063\u305F";
          current.skipped++;
          current.workStarted = null;
          await persist();
          continue;
        }
        current.current = candidate;
        current.workProgress = 0.1;
        current.authorized = false;
        current.authorizing = false;
        current.message = `\u5024\u4E0B\u3052\u4E2D\u2026 ${current.completed + 1} / ${current.candidates.length}\u4EF6`;
        const tab = await api.tabs.create({ url: `${P.ORIGIN}/item/${candidate.id}`, active: false });
        current.workerTab = tab.id;
        current.workProgress = 0.2;
        await readyPage(current, "ITEM");
        current.workProgress = 0.35;
        await assertOwner(current);
        const opened = await api.tabs.sendMessage(current.workerTab, { type: `${P.PREFIX}ITEM_OPEN_EDIT`, itemId: candidate.id });
        if (!opened?.opened) throw new Error(opened?.error ?? "\u5546\u54C1\u306E\u7DE8\u96C6\u3078\u9032\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        current.workProgress = 0.45;
        await readyPage(current, "EDITOR");
        current.workProgress = 0.6;
        await assertOwner(current);
        const prepared = await api.tabs.sendMessage(current.workerTab, {
          type: "APPLY_FURIMANE_PRICE_DROP_ON_EDIT",
          delta: -100,
          minimumPrice: 300,
          bulkJobId: current.id,
          itemId: candidate.id,
          expectedPrice: candidate.price
        });
        if (!prepared?.success || prepared.currentPrice !== candidate.price || prepared.nextPrice !== candidate.price - 100) {
          throw new Error(prepared?.reason ?? "\u2212100\u5186\u306E\u5165\u529B\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
        }
        current.workProgress = 0.7;
        await assertOwner(current);
        let reply;
        try {
          reply = await api.tabs.sendMessage(current.workerTab, {
            type: `${P.PREFIX}EDITOR_APPLY`,
            jobId: current.id,
            itemId: candidate.id,
            price: candidate.price
          });
        } catch {
          reply = null;
        }
        if (reply?.error) throw new Error(reply.error);
        if (!current.authorized) throw new Error("\u4FDD\u5B58\u524D\u306E\u6700\u7D42\u78BA\u8A8D\u304C\u5B8C\u4E86\u3057\u306A\u304B\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
        current.workProgress = 0.9;
        let verified = false;
        for (let check = 0; check < 6; check++) {
          await sleep(2e3);
          const result = await detail(current, candidate.id);
          if (result.item.seller === current.seller && result.item.price === candidate.price - 100 && result.item.updated !== null && result.item.updated > candidate.updated) {
            verified = true;
            break;
          }
          if (result.item.price !== candidate.price) break;
        }
        if (!verified) throw new Error("\u4FDD\u5B58\u7D50\u679C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u8A72\u5F53\u5546\u54C1\u306E\u4FA1\u683C\u3092\u624B\u52D5\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u81EA\u52D5\u518D\u9001\u306F\u3057\u307E\u305B\u3093\u3002");
        row.status = "\u5B8C\u4E86";
        row.reason = null;
        current.completed++;
        current.workProgress = 0;
        current.workMs = (current.workMs ?? 0) + performance.now() - current.workStarted;
        current.workSamples = (current.workSamples ?? 0) + 1;
        current.workStarted = null;
        await persist();
        await closeWorker(current);
        if (candidate !== current.candidates.at(-1)) {
          const batchBreak = current.completed % 20 === 0;
          const waitMs = batchBreak ? 2e4 + Math.random() * 1e4 : 3e3 + Math.random() * 4e3;
          current.phase = batchBreak ? "break" : "waiting";
          current.waitUntil = performance.now() + waitMs;
          current.message = batchBreak ? `${current.completed}\u4EF6\u5B8C\u4E86\u300220\u301C30\u79D2\u4F11\u61A9\u3057\u3066\u304B\u3089\u7D9A\u3051\u307E\u3059\u2026` : `\u6B21\u306E\u5546\u54C1\u307E\u3067\u5F85\u6A5F\u4E2D\u2026 \u5B8C\u4E86 ${current.completed}\u4EF6`;
          await pause(current, waitMs);
        }
      }
      assertActive(current);
      current.status = "done";
      current.message = `${current.completed}\u4EF6\u306E\u5024\u4E0B\u3052\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002`;
      await persist();
    }
    async function launch(current, operation) {
      try {
        await operation(current);
      } catch (error) {
        current.status = current.cancelled ? "stopped" : "error";
        current.message = current.cancelled ? "\u505C\u6B62\u3057\u307E\u3057\u305F\u3002\u4FDD\u5B58\u3092\u958B\u59CB\u3057\u305F\u5546\u54C1\u306E\u7D50\u679C\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : errorText(error);
        await persist().catch(() => {
        });
      } finally {
        if (!["running", "scanning"].includes(current.status)) current.token = null;
      }
    }
    async function authorize(message, sender) {
      const current = job;
      if (!current || sender.frameId !== 0 || sender.tab?.id !== current.workerTab || current.status !== "running" || current.id !== message.jobId || current.current?.id !== message.itemId || current.authorized || current.authorizing || new URL(sender.url).origin !== P.ORIGIN) throw new Error("\u3053\u306E\u7DE8\u96C6\u753B\u9762\u3067\u306F\u4E00\u62EC\u51E6\u7406\u3092\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3002");
      current.authorizing = true;
      const editor = await api.tabs.get(sender.tab.id);
      if (editor.url !== `${P.ORIGIN}/sell/edit/${message.itemId}` || editor.pendingUrl) throw new Error("\u7DE8\u96C6\u5BFE\u8C61\u306E\u30DA\u30FC\u30B8\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      await assertOwner(current);
      if (typeof message.accessToken !== "string" || message.accessToken !== current.token) throw new Error("\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      const account = await profile(message.accessToken);
      const fresh = await detail(current, message.itemId);
      await assertOwner(current);
      if (account.seller !== current.seller || P.reason(fresh.item, current.seller, current.startedAt, ledger[`${current.seller}/${message.itemId}`]) || !P.unchanged(current.current, fresh.item)) throw new Error("\u4FDD\u5B58\u524D\u306B\u5546\u54C1\u60C5\u5831\u304C\u5909\u308F\u3063\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
      ledger[`${current.seller}/${message.itemId}`] = fresh.serverAt;
      await api.storage.local.set({ [P.LEDGER_KEY]: ledger });
      await assertOwner(current);
      current.authorized = true;
      current.attempted++;
      const row = current.rows.find((value) => value.id === message.itemId);
      row.status = "\u78BA\u8A8D\u4E2D";
      await persist();
      assertActive(current);
      return { allowed: true, nextPrice: current.current.price - 100 };
    }
    async function handle(message, sender) {
      await initial;
      const action = message.type.slice(P.PREFIX.length);
      if (action === "AUTHORIZE") return authorize(message, sender);
      let senderOrigin = "";
      try {
        senderOrigin = new URL(sender.url).origin;
      } catch {
      }
      if (sender.frameId !== 0 || senderOrigin !== P.ORIGIN || sender.origin && sender.origin !== P.ORIGIN || !Number.isInteger(sender.tab?.id)) {
        throw new Error("\u51FA\u54C1\u4E2D\u30DA\u30FC\u30B8\u304B\u3089\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      }
      const currentTab = await api.tabs.get(sender.tab.id);
      if (!P.listingsPage(currentTab.url ?? "") || currentTab.pendingUrl && !P.listingsPage(currentTab.pendingUrl)) {
        throw new Error("\u51FA\u54C1\u4E2D\u30DA\u30FC\u30B8\u304B\u3089\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      }
      if (action === "STATUS") {
        if (busy() && job.ownerTab === sender.tab.id && job.instance === message.instance) {
          job.heartbeat = Date.now();
          if (message.accessToken !== job.token) job.cancelled = true;
        }
        return { state: summary(), owns: job?.ownerTab === sender.tab.id && job?.instance === message.instance };
      }
      if (action === "START") {
        if (busy()) throw new Error("\u5225\u306E\u4E00\u62EC\u51E6\u7406\u304C\u9032\u884C\u4E2D\u3067\u3059\u3002\u5148\u306B\u5B8C\u4E86\u307E\u305F\u306F\u505C\u6B62\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        if (typeof message.accessToken !== "string" || !message.accessToken.trim()) throw new Error("\u30E1\u30EB\u30AB\u30EA\u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        job = {
          id: crypto.randomUUID(),
          instance: message.instance,
          ownerTab: sender.tab.id,
          token: message.accessToken,
          heartbeat: Date.now(),
          requestAge: Math.max(0, Math.min(6e4, Number(message.requestAge) || 0)),
          status: "scanning",
          message: "\u51FA\u54C1\u4E00\u89A7\u3092\u78BA\u8A8D\u3057\u3066\u3044\u307E\u3059\u2026",
          scanned: 0,
          completed: 0,
          skipped: 0,
          attempted: 0,
          rows: [],
          candidates: [],
          cancelled: false,
          workerTab: null
        };
        try {
          await persist();
        } catch (error) {
          job.status = "error";
          job.token = null;
          throw error;
        }
        void launch(job, scan);
        return { state: summary(), owns: true };
      }
      if (!job || job.ownerTab !== sender.tab.id || message.jobId !== job.id) throw new Error("\u958B\u59CB\u3057\u305F\u51FA\u54C1\u4E2D\u30DA\u30FC\u30B8\u3067\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      if (action === "CANCEL") {
        job.cancelled = true;
        job.message = "\u505C\u6B62\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3057\u305F\u3002\u4FDD\u5B58\u3092\u958B\u59CB\u3057\u305F\u5546\u54C1\u306E\u7D50\u679C\u3092\u78BA\u8A8D\u3057\u3066\u3044\u307E\u3059\u2026";
        return { state: summary(), owns: true };
      }
      throw new Error("\u64CD\u4F5C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    }
    api.runtime.onMessage.addListener((message, sender, respond) => {
      if (!message?.type?.startsWith(P.PREFIX) || message.type.includes("EDITOR_") || message.type.includes("ITEM_")) return false;
      void handle(message, sender).then(respond).catch((error) => respond({ error: errorText(error) }));
      return true;
    });
    api.tabs.onRemoved.addListener((tabId) => {
      if (busy() && (tabId === job.ownerTab || tabId === job.workerTab)) job.cancelled = true;
    });
    api.tabs.onUpdated.addListener((tabId, change) => {
      if (busy() && tabId === job.ownerTab && (change.status === "loading" || change.url && !P.listingsPage(change.url))) job.cancelled = true;
    });
  })();
})();
