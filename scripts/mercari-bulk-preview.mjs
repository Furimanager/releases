// ローカル画面専用。Chrome APIと商品を置き換え、実商品の価格は変更しない。
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const root = new URL("../", import.meta.url);
const [policy, ui, css] = await Promise.all(["src/mercari-bulk-policy.js", "src/mercari-bulk-price.js", "src/mercari-bulk-price.css"].map(file => readFile(new URL(file, root), "utf8")));
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>一括値下げ・1クリック実行プレビュー</title>
<style>${css}</style>
<style>
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;color:#303038;margin:0;background:#fff}*{box-sizing:border-box}
header{border-bottom:1px solid #eee;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}header strong{font-size:16px}header p{margin:0;color:#777;font-size:12px}.demo-modes{display:flex;gap:6px}.demo-modes a{color:#6b5865;border:1px solid #ead9e2;border-radius:6px;padding:4px 10px;text-decoration:none;font-size:12px}
.layout{max-width:1220px;margin:38px auto;display:grid;grid-template-columns:210px minmax(0,1fr);gap:40px;padding:0 24px}aside{color:#666}aside strong{font-size:16px;color:#333}aside p{border-bottom:1px solid #eee;margin:0;padding:17px 0}.selected{background:#fafafa}main{min-width:0}h1{font-size:24px;margin:0 0 18px}nav{border-bottom:1px solid #ddd}nav ul{margin:0;padding:0;display:flex;list-style:none}nav li{flex:1;text-align:center}nav a{display:block;padding:14px 4px;color:#666;text-decoration:none;font-weight:600}nav a[aria-current]{color:#ff334b;border-bottom:3px solid #ff334b}
.sort{display:flex;justify-content:space-between;color:#777;padding:10px 0;font-size:13px}[data-testid=listed-item-list]{list-style:none;padding:0;margin:0}.card{display:flex;padding:18px 0;border-top:1px solid #e8e8e8;gap:16px}.photo{flex:0 0 64px;height:72px;background:linear-gradient(135deg,#e2e5ed,#f4f5f8);border-radius:6px}.shirt{background:linear-gradient(135deg,#e9e3de,#faf7f1)}.case{background:linear-gradient(135deg,#e5e7e0,#f7f8f5)}.card a{color:#333;text-decoration:none;font-size:15px}.card p{margin:4px 0}.muted{color:#888;font-size:12px}.row-actions{margin-left:auto;display:flex;gap:6px;align-items:center}.row-actions span{color:white;background:#ff4fa3;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;white-space:nowrap}
@media(max-width:760px){.layout{grid-template-columns:minmax(0,1fr);margin:22px auto;padding:0 16px}aside{display:none}.row-actions{display:none}h1{font-size:21px}header{padding:12px 16px}nav{font-size:12px}}
</style>
<header><div><strong>一括値下げの表示プレビュー</strong><p>拡張の読み込み不要。架空の商品で表示を確認できます。</p></div><div class="demo-modes"><a href="?demo=idle">対象あり</a><a href="?demo=empty">対象なし</a><a href="?demo=done">完了</a></div></header>
<div class="layout"><aside><strong>商品管理</strong><p>いいね！一覧</p><p>閲覧履歴</p><p>フォローリスト</p><p class="selected">出品した商品</p><p>購入した商品</p><p>下書き一覧</p></aside>
<main id="my-page-main-content"><div data-testid="listing-container"><h1>出品した商品</h1><nav aria-label="出品した商品"><ul><li><a data-testid="tab-to-listing" aria-current="page" href="#listings">出品中</a></li><li><a data-testid="tab-to-in-progress" href="#in_progress">取引中</a></li><li><a data-testid="tab-to-completed" href="#completed">売却済み</a></li><li><a href="#sold">販売履歴</a></li></ul></nav>
<div class="sort" data-testid="sorting-menu"><span>3件</span><span>まとめて編集 / 更新順</span></div>
<ul data-testid="listed-item-list">
<li class="card"><div class="photo"></div><div><a data-testid="listed-item" href="#item-1">シンプルなニット・ネイビー</a><p><b>¥1,200</b></p><p class="muted">2日前に更新</p></div><div class="row-actions"><span>−100</span><span>＋100</span><span>再出品</span></div></li>
<li class="card"><div class="photo shirt"></div><div><a data-testid="listed-item" href="#item-2">コットンシャツ・ホワイト</a><p><b>¥900</b></p><p class="muted">3日前に更新</p></div><div class="row-actions"><span>−100</span><span>＋100</span><span>再出品</span></div></li>
<li class="card"><div class="photo case"></div><div><a data-testid="listed-item" href="#item-3">スマートフォンケース</a><p><b>¥500</b></p><p class="muted">8時間前に更新</p></div><div class="row-actions"><span>−100</span><span>＋100</span><span>再出品</span></div></li></ul></div></main></div>
<script>${policy}</script><script>
document.documentElement.dataset.view='listings';
FurimaneBulkPolicy.listingsPage=()=>document.documentElement.dataset.view==='listings';
document.querySelectorAll('nav a').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();document.documentElement.dataset.view=link.hash.slice(1);document.querySelectorAll('nav a').forEach(a=>a.removeAttribute('aria-current'));link.setAttribute('aria-current','page');}));
let mock={status:'idle'},timer,alreadyCompleted=false;
const rows=[{id:'m123',title:'シンプルなニット・ネイビー',price:1200,status:'対象'},{id:'m456',title:'コットンシャツ・ホワイト',price:900,status:'対象'},{id:'m789',title:'スマートフォンケース',price:500,status:'対象外',reason:'更新から24時間未満'}];
const prepare=()=>({id:'demo',status:'running',scanned:3,completed:0,skipped:1,rows:structuredClone(rows),candidates:rows.slice(0,2),message:'値下げ中… 1 / 2件'});
const complete=()=>{mock=prepare();mock.status='done';mock.completed=2;mock.message='2件の値下げが完了しました。';mock.rows.forEach(r=>{if(r.status==='対象')r.status='完了'});alreadyCompleted=true;document.querySelectorAll('.card b').forEach((price,index)=>{if(index<2)price.textContent='¥'+(rows[index].price-100).toLocaleString('ja-JP')})};
const demo=new URL(location.href).searchParams.get('demo');if(demo==='done')complete();
window.chrome={runtime:{id:'fixture',onMessage:{addListener(){}},async sendMessage(message){
const action=message.type.replace('FURIMANE_BULK_PRICE_','');
if(action==='START'){
if(['scanning','running'].includes(mock.status))return{error:'別の一括処理が進行中です。'};
mock={id:'demo',status:'scanning',scanned:0,completed:0,skipped:0,rows:[],candidates:[],message:'出品一覧を確認しています…'};
timer=setTimeout(()=>{
if(demo==='empty'||alreadyCompleted){mock={...mock,status:'done',scanned:3,skipped:3,message:'今回の対象商品はありません。'};return;}
mock=prepare();timer=setTimeout(complete,6000);
},1200);
}
if(action==='CANCEL'){clearTimeout(timer);mock.status='stopped';mock.message='停止しました。'}
return{state:structuredClone(mock),owns:true};}}};
</script><script>${ui}</script></html>`;
if (process.argv[2] === "--write" && process.argv[3]) {
  const output = resolve(process.argv[3]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html.replaceAll("\u3000", " "), "utf8");
  console.log(`Standalone preview: ${output}`);
} else {
  const port = Number(process.env.FURIMANE_PREVIEW_PORT ?? 4177);
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html);
  }).listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}/mypage/listings`));
}
