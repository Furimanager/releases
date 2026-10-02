/* global require, __dirname, Buffer */
// 自作のYahoo画面モック。外部への商品保存・画像送信は行わない。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = 4327;
const origin = `http://127.0.0.1:${port}`;
const root = path.resolve(__dirname, '..');
const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRRsAAAAASUVORK5CYII=';
const item = {itemId:'z12345',itemUrl:origin+'/item/z12345',title:'検証用　シャツ',description:'元の商品説明\n2行目',price:1000,imageUrls:[origin+'/images.auctions.yahoo.co.jp/1.png'],categoryPath:['ファッション','トップス'],rows:{カテゴリ:'ファッション > トップス',商品の状態:'未使用に近い',配送の方法:'おてがる配送（日本郵便）',発送までの日数:'2〜3日で発送',発送元の地域:'兵庫県',商品ID:'z12345',色:'ブラック系'},hashtags:[]};
function picker(name, values){
 const panel=`<div class="panel" style="display:none"><div><p>${name}</p><button type="button"><img alt="閉じるボタン" src="${image}"></button></div><div>${values.map(v=>name==='カテゴリ'?`<li><span>${v}</span></li>`:`<p>${v}</p><small>状態の説明</small>`).join('')}</div></div>`;
 // 実Yahooの商品状態は、選択表示と非表示パネルが同じ親に入る。
 const choice='<div class="choice"><p>選択してください（必須）</p>';
 return `<div><div><span>${name}</span><div>必須</div></div>${choice}${name==='カテゴリ'?'</div>'+panel:panel+'</div>'}</div>`;
}
function form(edit){return `<main><form><button type="button">画像を追加する</button><div id="images"></div><div><input placeholder="商品名を入力してください（必須）" value="${edit?'検証用シャツ':''}"></div>${picker('カテゴリ',['ファッション','トップス'])}${picker('商品の状態',['未使用','未使用に近い'])}<label>商品説明</label><div><textarea>${edit?'元の商品説明':''}</textarea></div><label><input type="radio" name="JAPAN_POST">日本郵便</label><select name="timeToShip"><option value="1">1~2日</option><option value="2">2~3日</option></select><select name="prefectures"><option value="tokyo">東京都</option><option value="hyogo">兵庫県</option></select><select name="色"><option value="">未選択</option><option value="black">ブラック系</option></select><div><label><span><span>販売価格</span><span>300円〜9,999,999円</span></span><div>必須</div></label><div><input type="tel" placeholder="0" value="${edit?'1000':''}"></div></div><div id="operation"><button type="button">${edit?'変更する':'出品する'}</button><button type="button">${edit?'出品を停止する':'下書きに保存する'}</button>${edit?'<button type="button">商品を削除する</button>':''}</div></form></main>`;}
function fixture(url){
const isEdit=url.pathname.endsWith('/edit'), isAdd=url.pathname==='/item/add';
const caseName=url.searchParams.get('case')||'';
const itemRows=Object.entries(item.rows).map(([k,v])=>`<tr><th>${k}</th><td>${k==='カテゴリ'?'<a href="/category/1">ファッション</a><a href="/category/1/2">トップス</a>':v}</td></tr>`).join('');
const body=isEdit||isAdd?form(isEdit):url.pathname==='/my/item/selling'?'<main><div id="itm"><div><a href="/item/z12345"><span>検証用シャツ 1,000円</span></a></div><div><a href="/item/z99999"><span>検証用パンツ 2,000円</span></a></div></div></main>':`<main><h1>${item.title}</h1><div class="ItemPrice__Component"><span>1,000円</span><span style="display:none">1,000円</span></div><div class="ItemText__Text">元の商品説明\n2行目</div><div class="slick-slide"><img src="${origin}/images.auctions.yahoo.co.jp/1.png"></div><div class="slick-slide slick-cloned"><img src="${origin}/images.auctions.yahoo.co.jp/1.png"></div><table class="ItemTable__Component">${itemRows}</table><div><a href="/item/z12345/edit">編集する</a></div></main>`;
return `<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif;margin:16px}main{max-width:720px;margin:auto}input,textarea,select{display:block;margin:10px 0;max-width:95%;font-size:16px}label{display:block}li{list-style:none;padding:10px}.panel{position:fixed;inset:15% 10%;background:white;border:2px solid #777;z-index:100}.panel button img{width:24px;height:24px}#itm>div{border:1px solid #bbb;padding:8px}#itm a{display:block;min-height:60px}</style>${body}<script>
window.finalClicks=0;window.priceInputEvents=0;
// 実Yahooと同じく、価格はblurで保存用の値へ確定する。
window.committedPrice=document.querySelector('input[type=tel]')?.value;
document.querySelector('input[type=tel]')?.addEventListener('blur',event=>{window.committedPrice=event.target.value;});
document.querySelectorAll('#operation button').forEach(b=>b.addEventListener('click',()=>finalClicks++));
document.querySelector('input[type=tel]')?.addEventListener('input',()=>priceInputEvents++);
document.querySelectorAll('.choice').forEach(control=>{const panel=control.nextElementSibling||control.querySelector('.panel');control.querySelector('p').onclick=()=>panel.style.display='block';panel.querySelector('button').onclick=()=>panel.style.display='none';let selected=[];panel.querySelectorAll('li,p').forEach(option=>{if(option.parentElement===panel.firstElementChild)return;option.onclick=()=>{selected.push(option.textContent);control.querySelector('p').textContent=selected.join(' > ');if(option.textContent==='トップス'||panel.parentElement.textContent.includes('商品の状態'))panel.style.display='none';};});});
document.querySelector('main form > button')?.addEventListener('click',()=>{
 const modal=document.createElement('div');modal.id='addimg';modal.setAttribute('role','dialog');
 modal.innerHTML='<label for="album">アルバムから選択する</label><input type="file" id="album" accept="image/*" multiple>';
 document.body.append(modal);
 modal.querySelector('input').addEventListener('change',e=>{for(const file of e.target.files){const img=document.createElement('img');img.src='${origin}/images.auctions.yahoo.co.jp/'+file.name;document.querySelector('#images').append(img);}modal.remove();});
});
const store={};const jobItem=${JSON.stringify(item)};
const mode='${caseName}'==='draft'?'draft':'relist';
if(${isAdd})store['furimanager_yahoo_relist_${token}']={item:jobItem,mode,savedAt:Date.now()};
if('${caseName}'==='missing'){jobItem.rows['ブランド']='確認ブランド';jobItem.hashtags=['#確認'];}
if(['tags','custom-tags'].includes('${caseName}')){
 jobItem.hashtags='${caseName}'==='tags'?['#確認']:['#確認','#喜平'];
 const section=document.createElement('div');section.id='item-description';section.innerHTML='<div><p>#確認</p><button type="button" aria-label="削除">削除</button></div><input placeholder="ハッシュタグを追加する" maxlength="20">';document.querySelector('main form').append(section);
 const field=section.querySelector('input');field.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();const chip=document.createElement('div');const p=document.createElement('p');p.textContent='#'+field.value;const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','削除');chip.append(p,button);section.prepend(chip);field.value='';});
}
if('${caseName}'==='existing')document.querySelector('input[placeholder^=商品名]').value='編集途中';
if(${isEdit}){
 const pending={itemId:'${caseName==='wrong'?'z99999':'z12345'}',action:'${caseName==='increase'?'increase':caseName==='stop'?'stop':caseName==='delete'?'delete':'decrease'}',savedAt:Date.now()-${caseName==='stale'?130000:0}};
 sessionStorage.setItem('furimanager_yahoo_navigation',JSON.stringify(pending));
 if('${caseName}'==='minimum')document.querySelector('input[type=tel]').value='300';
}
window.chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value),remove:async key=>{delete store[key]}}},runtime:{sendMessage:async message=>message.type==='FETCH_YAHOO_IMAGE_AS_DATA_URL'?{success:true,dataUrl:'${image}'}:{success:true}}};
</script><script src="/src/yahoo-fleamarket-dom.js"></script><script src="/src/yahoo-fleamarket.js"></script>`;
}
const tests=`<!doctype html><meta charset="utf-8"><title>Yahoo!フリマ入力補助 検証</title><style>body{font:16px sans-serif;color:#251434;background:#fcf7fb;margin:24px}li{padding:6px}.pass{color:#146b38}.fail{color:#ae143a}iframe{width:720px;height:750px;border:1px solid #bbb}</style><h1>Yahoo!フリマ入力補助 検証</h1><p>実DOMの目印を再現したローカル画面。商品データ・送信・画像通信はモック。</p><ol id="results"></ol><iframe></iframe><script>
const iframe=document.querySelector('iframe'),results=document.querySelector('#results');
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function load(url){iframe.src=url;await new Promise(r=>iframe.onload=r);return iframe.contentWindow;}
async function status(w){for(let i=0;i<100;i++){const s=w.document.querySelector('#furimanager-yahoo-status')?.textContent||'';if(s&&!s.includes('入力しています'))return s;await sleep(100);}throw Error('status timeout');}
async function check(name,run){const li=document.createElement('li');li.textContent=name;results.append(li);try{await run();li.className='pass';li.textContent+='：PASS';}catch(e){li.className='fail';li.textContent+='：FAIL '+e.message;}}
(async()=>{
await check('出品一覧に2商品の操作ボタン、DOM再描画でも重複なし',async()=>{const w=await load('/my/item/selling');await sleep(600);assert(w.document.querySelectorAll('.furimanager-yahoo-toolbar').length===2,'bars');w.document.body.append(w.document.createElement('div'));await sleep(500);assert(w.document.querySelectorAll('.furimanager-yahoo-toolbar').length===2,'duplicate');assert(!w.document.querySelector('a button'),'nested button');});
await check('商品情報をDOMから抽出、非表示の重複価格・画像を除外',async()=>{const w=await load('/item/z12345');const data=w.FurimanagerYahooDom.collectItem(w.document,w.location.href);assert(data.price===1000&&data.imageUrls.length===1&&data.categoryPath.length===2&&data.title==='検証用\\u3000シャツ','capture');});
for(const c of ['decrease','increase','minimum','wrong','stale','stop','delete'])await check('編集 '+c+'、最終確定を押さない',async()=>{const w=await load('/item/z12345/edit?case='+c);if(c==='wrong'||c==='stale')await sleep(700);else await status(w);const expected=c==='decrease'?'900':c==='increase'?'1100':c==='minimum'?'300':'1000';assert(w.document.querySelector('input[type=tel]').value===expected,'price');if(c==='decrease'||c==='increase')assert(w.committedPrice===expected,'price not committed');assert(w.finalClicks===0,'final clicked');if(c==='decrease'){w.document.body.append(w.document.createElement('div'));await sleep(500);assert(w.priceInputEvents===1,'double apply');}});
for(const c of ['relist','draft','missing','existing','tags','custom-tags'])await check('新規フォーム '+c+'、最終確定を押さない',async()=>{const w=await load('/item/add?case='+c+'#furimanager-yahoo=${token}');const s=await status(w);assert(w.finalClicks===0,'final clicked');if(c==='existing'){assert(s.includes('上書きせず'),'overwrite');return;}assert(w.document.querySelector('input[type=tel]').value==='1000','original price');assert(w.committedPrice==='1000','price not committed');assert(w.document.querySelector('select[name=timeToShip]').value==='2','shipping');assert(w.document.querySelector('#images img'),'image');if(c==='missing')assert(s.includes('確認ブランド')&&s.includes('#確認'),'missing not shown');else assert(s.includes('入力が完了'),'incomplete: '+s);});
document.body.dataset.complete='true';document.title='完了 '+document.querySelectorAll('.pass').length+' PASS / '+document.querySelectorAll('.fail').length+' FAIL';})();
</script>`;
http.createServer((req,res)=>{const url=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(tests);}if(url.pathname.startsWith('/src/')){const file=path.join(root,url.pathname);if(!['yahoo-fleamarket-dom.js','yahoo-fleamarket.js'].includes(path.basename(file))){res.writeHead(404);return res.end();}res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(file,'utf8').replaceAll('https://paypayfleamarket.yahoo.co.jp',origin).replaceAll('https://paypayfleamarket-sec.yahoo.co.jp',origin).replaceAll('https://auctions.c.yimg.jp',origin));}if(url.pathname.startsWith('/images.auctions.yahoo.co.jp/')){res.setHeader('Content-Type','image/png');return res.end(Buffer.from(image.split(',')[1],'base64'));}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture(url));}).listen(port,'127.0.0.1',()=>console.log(origin));
