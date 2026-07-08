// このファイルを config.js にコピーして、各値を埋めてください。
// config.js は .gitignore に含まれており、Git管理されません。
const CONFIG = {
  APP_URL: "http://localhost:3001",
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key"
};

globalThis.FurimanagerConfig = CONFIG;

if (typeof window !== "undefined") {
  window.FurimanagerConfig = CONFIG;
}
