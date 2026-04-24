(() => {
  type RelistMode = "relist" | "draft" | "copy";

  type RelistPendingItem = {
    itemId: string | null;
    title: string | null;
    price: number | null;
    itemUrl: string | null;
    thumbnailUrl: string | null;
    imageUrls: string[];
    description: string | null;
    categoryPath: string[];
    condition: string | null;
    brand: string | null;
    size: string | null;
    shippingPayer: string | null;
    shippingMethod: string | null;
    shippingFrom: string | null;
    shippingDays: string | null;
    savedAt?: string;
    mode: RelistMode;
  };

  type ExtensionMessage = {
    type?: string;
    payload?: Partial<RelistPendingItem>;
    url?: string;
  };

  type BackgroundResponse = {
    success: boolean;
    message?: string;
    dataUrl?: string;
    type?: string;
  };

  type ChromeLike = {
    runtime: {
      lastError?: {
        message?: string;
      };
      onMessage: {
        addListener: (
          listener: (
            message: ExtensionMessage,
            sender: unknown,
            sendResponse: (response: BackgroundResponse) => void
          ) => boolean | void
        ) => void;
      };
    };
    storage: {
      local: {
        set: (items: Record<string, unknown>, callback?: () => void) => void;
      };
    };
    tabs: {
      create: (createProperties: { url: string; active?: boolean }, callback?: () => void) => void;
    };
  };

  const chromeApi = (globalThis as unknown as { chrome?: ChromeLike }).chrome;
  const RELIST_PENDING_KEY = "relist_pending";
  const MERCARI_SELL_URL = "https://jp.mercari.com/sell";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  if (!chromeApi?.runtime?.onMessage) {
    return;
  }

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const respond = (response: BackgroundResponse) => {
      try {
        sendResponse(response);
      } catch (error) {
        console.error("[furimanager-extension] sendResponse failed", error);
      }
    };

    if (message?.type === "FETCH_IMAGE_AS_DATA_URL") {
      void handleFetchImage(message.url, respond);
      return true;
    }

    if (message?.type !== "SET_RELIST_PENDING") {
      return false;
    }

    void handleSetRelistPending(message.payload, respond);
    return true;
  });

  async function handleFetchImage(
    url: string | undefined,
    respond: (response: BackgroundResponse) => void
  ): Promise<void> {
    try {
      respond(await fetchImageAsDataUrl(url));
    } catch (error) {
      console.error("[furimanager-extension] fetch image request failed", error);
      respond({ success: false, message: "画像の取得に失敗しました" });
    }
  }

  async function handleSetRelistPending(
    payload: Partial<RelistPendingItem> | undefined,
    respond: (response: BackgroundResponse) => void
  ): Promise<void> {
    respond(await setRelistPending(payload));
  }

  async function setRelistPending(payload: Partial<RelistPendingItem> | undefined): Promise<BackgroundResponse> {
    if (!payload || typeof payload !== "object") {
      return { success: false, message: "保存する出品データが見つかりませんでした" };
    }

    const pendingItem: RelistPendingItem = {
      itemId: payload.itemId ?? null,
      title: payload.title ?? null,
      price: typeof payload.price === "number" ? payload.price : null,
      itemUrl: payload.itemUrl ?? null,
      thumbnailUrl: payload.thumbnailUrl ?? null,
      imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls.filter((url): url is string => typeof url === "string") : [],
      description: payload.description ?? null,
      categoryPath: Array.isArray(payload.categoryPath)
        ? payload.categoryPath.filter((category): category is string => typeof category === "string")
        : [],
      condition: payload.condition ?? null,
      brand: payload.brand ?? null,
      size: payload.size ?? null,
      shippingPayer: payload.shippingPayer ?? null,
      shippingMethod: payload.shippingMethod ?? null,
      shippingFrom: payload.shippingFrom ?? null,
      shippingDays: payload.shippingDays ?? null,
      mode: payload.mode ?? "relist",
      savedAt: new Date().toISOString(),
    };

    try {
      await setLocalStorage({ [RELIST_PENDING_KEY]: pendingItem });
      await createTab({ url: MERCARI_SELL_URL, active: true });
      return { success: true };
    } catch (error) {
      console.error("[furimanager-extension] set relist pending failed", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "出品データの保存に失敗しました",
      };
    }
  }

  function setLocalStorage(items: Record<string, unknown>) {
    return new Promise<void>((resolve, reject) => {
      try {
        chromeApi.storage.local.set(items, () => {
          if (chromeApi.runtime.lastError) {
            reject(new Error("出品データの保存に失敗しました"));
            return;
          }

          resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("出品データの保存に失敗しました"));
      }
    });
  }

  function createTab(createProperties: { url: string; active?: boolean }) {
    return new Promise<void>((resolve, reject) => {
      try {
        chromeApi.tabs.create(createProperties, () => {
          if (chromeApi.runtime.lastError) {
            reject(new Error("新規出品ページを開けませんでした"));
            return;
          }

          resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("新規出品ページを開けませんでした"));
      }
    });
  }

  async function fetchImageAsDataUrl(url: string | undefined): Promise<BackgroundResponse> {
    if (!url) {
      return { success: false, message: "画像URLが見つかりませんでした" };
    }

    try {
      const response = await fetch(url, {
        credentials: "include",
      });

      if (!response.ok) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;

      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      const type = response.headers.get("content-type") || "image/jpeg";
      const buffer = await response.arrayBuffer();

      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        return { success: false, message: "画像の取得に失敗しました" };
      }

      return {
        success: true,
        dataUrl: `data:${type};base64,${arrayBufferToBase64(buffer)}`,
        type,
      };
    } catch {
      return { success: false, message: "画像の取得に失敗しました" };
    }
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.slice(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }
})();
