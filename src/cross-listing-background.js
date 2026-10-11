(() => {
  (() => {
    const chromeApi = globalThis.chrome;
    const core = globalThis.FurimanagerCrossListing;
    const prefix = "furimanager_cross_tab_";
    const locks = /* @__PURE__ */ new Set();
    globalThis.installFurimanagerCrossListing = (fetchImage) => {
      chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
        if (!message?.type?.startsWith("CROSS_LISTING_")) return;
        void handle(message, sender).then(respond).catch(() => respond({ handled: true, success: false, message: "\u30B3\u30D4\u30FC\u51FA\u54C1\u3092\u7D9A\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }));
        return true;
      });
      chromeApi.tabs.onRemoved?.addListener((id) => {
        void chromeApi.storage.local.remove(prefix + id);
      });
      async function handle(message, sender) {
        const id = sender.tab?.id;
        if (!Number.isInteger(id) || sender.frameId != null && sender.frameId !== 0 || sender.id !== chromeApi.runtime.id) return { success: false };
        const tab = await chromeApi.tabs.get(id);
        if (message.type === "CROSS_LISTING_OPEN") {
          const source = core.sourceOf(tab.url);
          if (!source || new URL(sender.url).origin !== core.origins[source.platform]) return { success: false };
          const item = core.normalize(message.item, tab.url);
          const token = crypto.randomUUID();
          const destination = await chromeApi.tabs.create({ url: "about:blank", active: true });
          const key2 = prefix + destination.id;
          try {
            const all = await chromeApi.storage.local.get(null);
            const stale = Object.keys(all).filter((k) => k.startsWith(prefix) && (!all[k]?.savedAt || Date.now() - all[k].savedAt > core.maxAge));
            if (stale.length) await chromeApi.storage.local.remove(stale);
            await chromeApi.storage.local.set({ [key2]: { token, savedAt: Date.now(), state: "pending", item } });
            await chromeApi.tabs.update(destination.id, { url: `${core.endpoints[item.target]}#furimanager-cross=${token}` });
          } catch (error) {
            await chromeApi.storage.local.remove(key2);
            await chromeApi.tabs.remove(destination.id);
            throw error;
          }
          return { success: true };
        }
        const key = prefix + id;
        if (locks.has(id)) return { handled: true, success: false, message: "\u30B3\u30D4\u30FC\u51FA\u54C1\u306F\u51E6\u7406\u4E2D\u3067\u3059\u3002" };
        locks.add(id);
        try {
          const job = (await chromeApi.storage.local.get(key))[key];
          if (!job) return { handled: false, success: false };
          const destination = core.endpoints[job.item?.target];
          const url = new URL(tab.url);
          const frame = new URL(sender.url);
          if (`${url.origin}${url.pathname}` !== destination || `${frame.origin}${frame.pathname}` !== destination) return { handled: false, success: false };
          if (typeof job.savedAt !== "number" || Date.now() < job.savedAt || Date.now() - job.savedAt > core.maxAge) {
            await chromeApi.storage.local.remove(key);
            return { handled: true, success: false, message: "\u30B3\u30D4\u30FC\u51FA\u54C1\u30C7\u30FC\u30BF\u306E\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002\u5143\u306E\u5546\u54C1\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
          }
          if (message.type === "CROSS_LISTING_PEEK" || message.type === "CROSS_LISTING_CLAIM") {
            if (job.state !== "pending") return { handled: true, success: false, message: "\u3053\u306E\u30B3\u30D4\u30FC\u306F\u5165\u529B\u6E08\u307F\u3001\u307E\u305F\u306F\u4E2D\u65AD\u6E08\u307F\u3067\u3059\u3002\u3082\u3046\u4E00\u5EA6\u30B3\u30D4\u30FC\u3059\u308B\u5834\u5408\u306F\u5143\u306E\u5546\u54C1\u304B\u3089\u64CD\u4F5C\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
            if (message.type === "CROSS_LISTING_CLAIM") {
              job.state = "claimed";
              await chromeApi.storage.local.set({ [key]: job });
            }
            return { handled: true, success: true, job };
          }
          if (message.token !== job.token || job.state !== "claimed") return { success: false };
          if (message.type === "CROSS_LISTING_IMAGE" && Number.isInteger(message.index) && message.index >= 0 && message.index < job.item.imageUrls.length) return fetchImage(job.item.imageUrls[message.index], job.item.source);
          if (message.type === "CROSS_LISTING_FINISH") {
            await chromeApi.storage.local.set({ [key]: { ...job, state: "finished", item: { target: job.item.target } } });
            return { success: true };
          }
          return { success: false };
        } finally {
          locks.delete(id);
        }
      }
    };
  })();
})();
