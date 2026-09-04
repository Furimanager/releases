// このファイルを config.js にコピーして、各値を埋めてください。
// config.js は .gitignore に含まれており、Git管理されません。
const CONFIG = {
  // Web アプリの URL。「Googleでログイン」で開く連携ページ（/extension/connect）の
  // ベースにもなるので、ローカル検証では http://localhost:3000 などに変える。
  // その場合は manifest.dev.json（externally_connectable に localhost を含む）を使うこと。
  APP_URL: "https://furimanager.app.furimakaikei.com",
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key"
};

globalThis.FurimanagerConfig = CONFIG;

if (typeof window !== "undefined") {
  window.FurimanagerConfig = CONFIG;
}
