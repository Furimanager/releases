// メルカリ・Yahoo!フリマに出すフリマネ部品の色。色の値は extension-theme.css、ここは選択肢と保存だけ。
// ポップアップでも読み込み、選択肢の一覧を共用する。
(() => {
  const STORAGE_KEY = "furimaneExtensionTheme";
  const ATTRIBUTE = "data-furimane-theme";
  const DEFAULT_THEME = "purple";
  // 丸い見本は Web の色選択（theme-toggle.tsx の丸い tora-swatch）と同じ地色・柄の当て方。
  const toraSwatch = (color: string, base: string) => `url("icons/tora-rosettes.svg#${color}") center / 100% 100%, ${base}`;
  const THEMES = [
    { key: "purple", label: "紫", group: "basic", swatch: "linear-gradient(135deg, #7c3aed, #ec4899)" },
    { key: "pink", label: "ピンク", group: "basic", swatch: "linear-gradient(135deg, #d34080, #ec6ea4)" },
    { key: "indigo", label: "インディゴ", group: "basic", swatch: "linear-gradient(135deg, #4f46e5, #7c83f7)" },
    { key: "tora-pink", label: "ピンク", group: "tora", swatch: toraSwatch("pink", "#f9d0dc") },
    { key: "tora-brown", label: "茶色", group: "tora", swatch: toraSwatch("brown", "#e8ccaa") },
    { key: "tora-purple", label: "紫", group: "tora", swatch: toraSwatch("purple", "#e5d4ee") },
    { key: "tora-blue", label: "水色", group: "tora", swatch: toraSwatch("blue", "#d7edfa") }
  ];
  const GROUPS = [
    { key: "basic", label: "いつもの色" },
    { key: "tora", label: "トラ柄" }
  ];

  function normalize(value: unknown): string {
    return THEMES.some(theme => theme.key === value) ? value as string : DEFAULT_THEME;
  }

  (globalThis as any).FurimaneExtensionTheme = { STORAGE_KEY, ATTRIBUTE, DEFAULT_THEME, THEMES, GROUPS, normalize };

  // ポップアップにも付ける。ポップアップは背景を暗いまま、ボタンと紫の文字だけ popup.css で色を変える。
  const chromeApi = (globalThis as any).chrome;
  if (typeof document === "undefined" || !chromeApi?.storage?.local) return;

  function apply(value: unknown) {
    document.documentElement.setAttribute(ATTRIBUTE, normalize(value));
  }

  chromeApi.storage.local.get(STORAGE_KEY, (result: Record<string, unknown>) => {
    if (!chromeApi.runtime?.lastError) apply(result?.[STORAGE_KEY]);
  });
  chromeApi.storage.onChanged?.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName === "local" && changes[STORAGE_KEY]) apply(changes[STORAGE_KEY].newValue);
  });
})();
