(() => {
  (() => {
    const STORAGE_KEY = "furimaneExtensionTheme";
    const ATTRIBUTE = "data-furimane-theme";
    const DEFAULT_THEME = "purple";
    const toraSwatch = (color, base) => `url("icons/tora-rosettes.svg#${color}") center / 100% 100%, ${base}`;
    const THEMES = [
      { key: "purple", label: "\u7D2B", group: "basic", swatch: "linear-gradient(135deg, #7c3aed, #ec4899)" },
      { key: "pink", label: "\u30D4\u30F3\u30AF", group: "basic", swatch: "linear-gradient(135deg, #d34080, #ec6ea4)" },
      { key: "indigo", label: "\u30A4\u30F3\u30C7\u30A3\u30B4", group: "basic", swatch: "linear-gradient(135deg, #4f46e5, #7c83f7)" },
      { key: "tora-pink", label: "\u30D4\u30F3\u30AF", group: "tora", swatch: toraSwatch("pink", "#f9d0dc") },
      { key: "tora-brown", label: "\u8336\u8272", group: "tora", swatch: toraSwatch("brown", "#e8ccaa") },
      { key: "tora-purple", label: "\u7D2B", group: "tora", swatch: toraSwatch("purple", "#e5d4ee") },
      { key: "tora-blue", label: "\u6C34\u8272", group: "tora", swatch: toraSwatch("blue", "#d7edfa") }
    ];
    const GROUPS = [
      { key: "basic", label: "\u3044\u3064\u3082\u306E\u8272" },
      { key: "tora", label: "\u30C8\u30E9\u67C4" }
    ];
    function normalize(value) {
      return THEMES.some((theme) => theme.key === value) ? value : DEFAULT_THEME;
    }
    globalThis.FurimaneExtensionTheme = { STORAGE_KEY, ATTRIBUTE, DEFAULT_THEME, THEMES, GROUPS, normalize };
    const chromeApi = globalThis.chrome;
    if (typeof document === "undefined" || !chromeApi?.storage?.local) return;
    function apply(value) {
      document.documentElement.setAttribute(ATTRIBUTE, normalize(value));
    }
    chromeApi.storage.local.get(STORAGE_KEY, (result) => {
      if (!chromeApi.runtime?.lastError) apply(result?.[STORAGE_KEY]);
    });
    chromeApi.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) apply(changes[STORAGE_KEY].newValue);
    });
  })();
})();
