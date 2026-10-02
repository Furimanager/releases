// ローカル画面専用。Chrome APIと商品を置き換え、実商品の価格は変更しない。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = new Map([
  ["/policy.js", ["src/mercari-bulk-policy.js", "text/javascript"]],
  ["/ui.js", ["src/mercari-bulk-price.js", "text/javascript"]],
  ["/ui.css", ["src/mercari-bulk-price.css", "text/css"]],
]);
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>一括値下げ・ローカル確認</title><link rel="stylesheet" href="/ui.css">
<style>body{font:16px/1.6 sans-serif;color:#303038;margin:0}header{border-bottom:1px solid #ddd;padding:22px}main{max-width:880px;margin:36px auto;padding:0 16px}nav{display:flex;border-bottom:1px solid #ddd}nav a{flex:1;text-align:center;padding:14px 6px;color:#555}nav a[aria-selected=true]{color:#db3260;border-bottom:3px solid #db3260}.card{display:flex;padding:22px 8px;border-bottom:1px solid #ddd;gap:18px}.photo{width:90px;height:90px;background:#eee;border-radius:8px}.card a{color:#333}</style>
<header>フリマネ 一括値下げの動作確認（架空の商品）</header>
<main id="my-page-main-content"><h1>出品した商品</h1><nav role="tablist"><a role="tab" aria-selected="true" href="/mypage/listings">出品中</a><a role="tab" href="/mypage/listings/in_progress">取引中</a><a role="tab" href="/mypage/listings/sold">販売履歴</a></nav>
<div class="card"><div class="photo"></div><div><a data-testid="listed-item" href="/item/m123">シンプルなニット・ネイビー</a><p>¥1,200 2日前に更新</p></div></div>
<div class="card"><div class="photo"></div><div><a data-testid="listed-item" href="/item/m456">コットンシャツ・ホワイト</a><p>¥900 3日前に更新</p></div></div>
<div class="card"><div class="photo"></div><div><a data-testid="listed-item" href="/item/m789">スマートフォンケース</a><p>¥500 8時間前に更新</p></div></div></main>
<script src="/policy.js"></script><script>
FurimaneBulkPolicy.listingsPage=url=>/^\\/mypage\\/listings\\/?$/.test(new URL(url).pathname);
let mock={status:'idle'},timer;
const rows=[{id:'m123',title:'シンプルなニット・ネイビー',price:1200,status:'対象'},{id:'m456',title:'コットンシャツ・ホワイト',price:900,status:'対象'},{id:'m789',title:'スマートフォンケース',price:500,status:'対象外',reason:'更新から24時間＋5分未満'}];
window.chrome={runtime:{id:'fixture',onMessage:{addListener(){}},async sendMessage(message){
const action=message.type.replace('FURIMANE_BULK_PRICE_','');
if(action==='START'){mock={id:'demo',status:'scanning',scanned:0,completed:0,skipped:0,rows:[],candidates:[],message:'更新日時を確認中…'};timer=setTimeout(()=>{mock={...mock,status:'ready',scanned:3,skipped:1,rows:structuredClone(rows),candidates:rows.slice(0,2),message:'2件を各100円値下げできます。'}},600)}
if(action==='EXECUTE'){mock.status='running';mock.message='値下げ中… 1 / 2件';timer=setTimeout(()=>{mock.status='done';mock.completed=2;mock.message='2件の値下げが完了しました。';mock.rows.forEach(r=>{if(r.status==='対象')r.status='完了'})},3000)}
if(action==='CANCEL'){clearTimeout(timer);mock.status='stopped';mock.message='停止しました。'}
return{state:structuredClone(mock),owns:true};}}};
</script><script src="/ui.js"></script></html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (files.has(path)) {
    const [file, mime] = files.get(path);
    response.writeHead(200, { "content-type": `${mime}; charset=utf-8` });
    response.end(await readFile(new URL(file, root))); return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html);
});
server.listen(4177, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:4177/mypage/listings"));
