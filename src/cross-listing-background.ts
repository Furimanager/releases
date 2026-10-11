// コピー先タブに紐付けた一回限りのジョブ。URLには商品本文や画像を載せない。
(() => {
  const chromeApi = (globalThis as any).chrome;
  const core = (globalThis as any).FurimanagerCrossListing;
  const prefix = "furimanager_cross_tab_";
  const locks = new Set<number>();
  (globalThis as any).installFurimanagerCrossListing = (fetchImage: (url: string, platform: "mercari" | "yahoo") => Promise<any>) => {
    chromeApi.runtime.onMessage.addListener((message: any, sender: any, respond: (value: any) => void) => {
      if (!message?.type?.startsWith("CROSS_LISTING_")) return;
      void handle(message, sender).then(respond).catch(() => respond({ handled: true, success: false, message: "コピー出品を続けられませんでした。元の商品からやり直してください。" }));
      return true;
    });
    chromeApi.tabs.onRemoved?.addListener((id: number) => { void chromeApi.storage.local.remove(prefix + id); });
    async function handle(message: any, sender: any) {
      const id = sender.tab?.id;
      if (!Number.isInteger(id) || (sender.frameId != null && sender.frameId !== 0) || sender.id !== chromeApi.runtime.id) return { success: false };
      const tab = await chromeApi.tabs.get(id);
      if (message.type === "CROSS_LISTING_OPEN") {
        const source = core.sourceOf(tab.url);
        // sourceのoriginはフレームにも要求する。SPAのpathnameは現在タブを優先する。
        if (!source || new URL(sender.url).origin !== core.origins[source.platform]) return { success: false };
        // 信頼できるフィールドだけで再構築し、mode/taskIdなどは持ち込ませない。
        const item = core.normalize(message.item, tab.url);
        const token = crypto.randomUUID();
        const destination = await chromeApi.tabs.create({ url: "about:blank", active: true });
        const key = prefix + destination.id;
        try {
          // 古いジョブは新規開始時に掃除する。既存の再出品データは対象外。
          const all = await chromeApi.storage.local.get(null);
          const stale = Object.keys(all).filter(k => k.startsWith(prefix) && (!all[k]?.savedAt || Date.now() - all[k].savedAt > core.maxAge));
          if (stale.length) await chromeApi.storage.local.remove(stale);
          await chromeApi.storage.local.set({ [key]: { token, savedAt: Date.now(), state: "pending", item } });
          await chromeApi.tabs.update(destination.id, { url: `${core.endpoints[item.target]}#furimanager-cross=${token}` });
        } catch (error) { await chromeApi.storage.local.remove(key); await chromeApi.tabs.remove(destination.id); throw error; }
        return { success: true };
      }
      const key = prefix + id;
      if (locks.has(id)) return { handled: true, success: false, message: "コピー出品は処理中です。" };
      locks.add(id);
      try {
        const job = (await chromeApi.storage.local.get(key))[key];
        if (!job) return { handled: false, success: false };
        const destination = core.endpoints[job.item?.target];
        const url = new URL(tab.url); const frame = new URL(sender.url);
        if (`${url.origin}${url.pathname}` !== destination || `${frame.origin}${frame.pathname}` !== destination) return { handled: false, success: false };
        if (typeof job.savedAt !== "number" || Date.now() < job.savedAt || Date.now() - job.savedAt > core.maxAge) {
          await chromeApi.storage.local.remove(key); return { handled: true, success: false, message: "コピー出品データの期限が切れています。元の商品からやり直してください。" };
        }
        if (message.type === "CROSS_LISTING_PEEK" || message.type === "CROSS_LISTING_CLAIM") {
          if (job.state !== "pending") return { handled: true, success: false, message: "このコピーは入力済み、または中断済みです。もう一度コピーする場合は元の商品から操作してください。" };
          if (message.type === "CROSS_LISTING_CLAIM") { job.state = "claimed"; await chromeApi.storage.local.set({ [key]: job }); }
          return { handled: true, success: true, job };
        }
        if (message.token !== job.token || job.state !== "claimed") return { success: false };
        if (message.type === "CROSS_LISTING_IMAGE" && Number.isInteger(message.index) && message.index >= 0 && message.index < job.item.imageUrls.length) return fetchImage(job.item.imageUrls[message.index], job.item.source);
        if (message.type === "CROSS_LISTING_FINISH") {
          // tombstoneを残し、再読込で別の同一サイト再出品pendingを誤実行させない。
          await chromeApi.storage.local.set({ [key]: { ...job, state: "finished", item: { target: job.item.target } } }); return { success: true };
        }
        return { success: false };
      } finally { locks.delete(id); }
    }
  };
})();
