import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const coreCode = await readFile(new URL('../src/cross-listing.js', import.meta.url), 'utf8');
const brokerCode = await readFile(new URL('../src/cross-listing-background.js', import.meta.url), 'utf8');
const coreContext = vm.createContext({ URL }); vm.runInContext(coreCode, coreContext);
const core = coreContext.FurimanagerCrossListing;
const mercari = 'https://jp.mercari.com/item/m123456789';
const yahoo = 'https://paypayfleamarket.yahoo.co.jp/item/z123456789';
const mercImage = 'https://static.mercdn.net/item/detail/orig/photos/m123456789_1.jpg';
const yahooImage = 'https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/1.jpg';
const raw = (source = 'mercari') => ({ itemId: source === 'mercari' ? 'm123456789' : 'z123456789', itemUrl: source === 'mercari' ? mercari : yahoo,
  title: '検証用　商品', description: '説明\n2行目', price: 300, imageUrls: [source === 'mercari' ? mercImage : yahooImage], categoryPath: ['元のカテゴリ'],
  condition: '傷や汚れあり', shippingFrom: '兵庫県', shippingDays: '1〜2日で発送' });

function broker() {
  const storage = {}; const tabs = new Map([[1, { id: 1, url: mercari }], [2, { id: 2, url: yahoo }]]);
  let listener, removed; let next = 10; const images = [];
  let rejectSet = false, rejectUpdate = false;
  const ctx = vm.createContext({ URL, crypto: webcrypto, console, chrome: {
    runtime: { id: 'our-extension', onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: {
      async get(key) { return key === null ? { ...storage } : { [key]: storage[key] }; },
      async set(value) { if (rejectSet) throw Error('quota'); Object.assign(storage, structuredClone(value)); },
      async remove(keys) { for (const key of [].concat(keys)) delete storage[key]; }
    } },
    tabs: { async get(id) { return tabs.get(id); }, async create(options) { const tab = { id: next++, ...options }; tabs.set(tab.id, tab); return tab; },
      async update(id, options) { if (rejectUpdate) throw Error('closed'); Object.assign(tabs.get(id), options); },
      async remove(id) { tabs.delete(id); }, onRemoved: { addListener(fn) { removed = fn; } } }
  } });
  vm.runInContext(coreCode, ctx); vm.runInContext(brokerCode, ctx);
  ctx.installFurimanagerCrossListing(async (url, platform) => { images.push({ url, platform }); return { success: true, dataUrl: 'data:image/jpeg;base64,YQ==' }; });
  const send = (type, id = 1, extra = {}, sender = {}) => new Promise(resolve => listener({ type, ...extra }, { id: 'our-extension', frameId: 0, tab: { id }, url: tabs.get(id)?.url, ...sender }, resolve));
  return { storage, tabs, images, send, removed: id => removed(id), failSet: () => { rejectSet = true; }, failUpdate: () => { rejectUpdate = true; } };
}

for (const source of ['mercari', 'yahoo']) test(`${source}の商品・改行・全角空白・価格を維持する`, () => {
  const data = raw(source); const item = core.normalize(data, data.itemUrl);
  assert.equal(item.title, data.title); assert.equal(item.description, data.description); assert.equal(item.price, 300);
  assert.equal(item.source, source); assert.equal(item.target, source === 'mercari' ? 'yahoo' : 'mercari');
});
test('Yahooの別欄ハッシュタグは説明末尾へ残し、既存タグは重ねない', () => {
  const item = core.normalize({ ...raw('yahoo'), description: '説明\n#タグ1', hashtags: ['#タグ1', '#タグ2'] }, yahoo);
  assert.equal(item.description, '説明\n#タグ1\n\n#タグ2');
  assert.equal(core.normalize(item, yahoo).description, item.description);
});
test('元商品・画像の偽装、不正価格、空画像では出品を始めない', () => {
  for (const diff of [{ itemId: 'm9' }, { itemUrl: yahoo }, { price: 299 }, { price: 1.5 }, { price: NaN }, { title: '' }, { imageUrls: [] },
    { imageUrls: ['https://evil.example/a.jpg'] }, { imageUrls: ['https://a:b@static.mercdn.net/a.jpg'] }, { imageUrls: Array(21).fill(mercImage) }]) {
    assert.throws(() => core.normalize({ ...raw(), ...diff }, mercari));
  }
  assert.equal(core.sourceOf('https://evil.example/item/m123456789'), null);
  assert.equal(core.sourceOf(mercari + '/edit'), null);
});
for (const source of ['mercari', 'yahoo']) test(`${source}→別サービスへ専用タブを作り、画像だけを取得、終了後は再実行しない`, async () => {
  const b = broker(), id = source === 'mercari' ? 1 : 2;
  const opened = await b.send('CROSS_LISTING_OPEN', id, { item: raw(source) }); assert.equal(opened.success, true);
  const url = b.tabs.get(10).url; const job = b.storage.furimanager_cross_tab_10;
  assert.equal(url, core.endpoints[job.item.target] + '#furimanager-cross=' + job.token);
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, true);
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, false);
  assert.equal((await b.send('CROSS_LISTING_IMAGE', 10, { token: job.token, index: 0 })).success, true);
  assert.deepEqual(b.images, [{ url: raw(source).imageUrls[0], platform: source }]);
  assert.equal((await b.send('CROSS_LISTING_FINISH', 10, { token: job.token })).success, true);
  assert.deepEqual(b.storage.furimanager_cross_tab_10.item, { target: job.item.target });
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).handled, true);
  assert.equal((await b.send('CROSS_LISTING_IMAGE', 10, { token: job.token, index: 0 })).success, false);
});
test('二商品の同時コピーは別タブに保持される', async () => {
  const b = broker(); await Promise.all([b.send('CROSS_LISTING_OPEN', 1, { item: raw() }), b.send('CROSS_LISTING_OPEN', 2, { item: raw('yahoo') })]);
  const jobs = await Promise.all([b.send('CROSS_LISTING_CLAIM', 10), b.send('CROSS_LISTING_CLAIM', 11)]);
  assert.equal(jobs.filter(j => j.success).length, 2);
  assert.notEqual(jobs[0].job.item.itemId, jobs[1].job.item.itemId);
});
test('二重claimの競合を止める', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() });
  const result = await Promise.all([b.send('CROSS_LISTING_CLAIM', 10), b.send('CROSS_LISTING_CLAIM', 10)]);
  assert.equal(result.filter(r => r.success).length, 1);
});
test('ログイン後にURLのhashが消えても作成した同じタブだけで引き継ぐ', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() });
  b.tabs.get(10).url = core.endpoints.yahoo;
  b.tabs.set(11, { id: 11, url: core.endpoints.yahoo });
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 11)).handled, false);
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, true);
});
test('フォーム準備前のPEEK・認証画面往復ではジョブを消費しない', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() });
  assert.equal((await b.send('CROSS_LISTING_PEEK', 10)).success, true);
  assert.equal(b.storage.furimanager_cross_tab_10.state, 'pending');
  b.tabs.get(10).url = 'https://login.yahoo.co.jp/';
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, false);
  b.tabs.get(10).url = core.endpoints.yahoo;
  assert.equal((await b.send('CROSS_LISTING_PEEK', 10)).success, true);
  assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, true);
});
test('別origin・iframe・他拡張・SPAで別商品へ移動済みなら拒否', async () => {
  for (const override of [{ url: 'https://evil.example/' }, { frameId: 1 }, { id: 'other-extension' }]) {
    const b = broker(); assert.equal((await b.send('CROSS_LISTING_OPEN', 1, { item: raw() }, override)).success, false); assert.equal(b.tabs.size, 2);
  }
  const b = broker(); b.tabs.get(1).url = mercari.replace('123456789', '999999999');
  assert.equal((await b.send('CROSS_LISTING_OPEN', 1, { item: raw() })).success, false);
});
test('未claim・誤トークン・範囲外index・任意URLの画像取得を拒否', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() }); const token = b.storage.furimanager_cross_tab_10.token;
  assert.equal((await b.send('CROSS_LISTING_IMAGE', 10, { token, index: 0 })).success, false);
  await b.send('CROSS_LISTING_CLAIM', 10);
  for (const input of [{ token: 'wrong', index: 0 }, { token, index: -1 }, { token, index: 1 }, { token, index: 0.1 }, { token, url: mercImage }]) assert.equal((await b.send('CROSS_LISTING_IMAGE', 10, input)).success, false);
  assert.equal(b.images.length, 0);
});
test('コピー先から別画面へ移動すると画像取得を拒否', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() }); const token = b.storage.furimanager_cross_tab_10.token;
  await b.send('CROSS_LISTING_CLAIM', 10); b.tabs.get(10).url = yahoo;
  assert.equal((await b.send('CROSS_LISTING_IMAGE', 10, { token, index: 0 })).success, false);
});
test('期限切れ・未来時刻は拒否し削除', async () => {
  for (const age of [core.maxAge + 1, -10000]) {
    const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() }); b.storage.furimanager_cross_tab_10.savedAt = Date.now() - age;
    assert.equal((await b.send('CROSS_LISTING_CLAIM', 10)).success, false);
    assert.equal(b.storage.furimanager_cross_tab_10, undefined);
  }
});
for (const method of ['failSet', 'failUpdate']) test(`途中の${method}失敗時は新しいタブとジョブだけを片付ける`, async () => {
  const b = broker(); b[method](); assert.equal((await b.send('CROSS_LISTING_OPEN', 1, { item: raw() })).success, false);
  assert.equal(b.tabs.size, 2); assert.equal(Object.keys(b.storage).length, 0);
});
test('タブを閉じた場合はそのタブのデータだけ削除', async () => {
  const b = broker(); await b.send('CROSS_LISTING_OPEN', 1, { item: raw() }); await b.send('CROSS_LISTING_OPEN', 2, { item: raw('yahoo') });
  b.removed(10); await Promise.resolve(); assert.equal(b.storage.furimanager_cross_tab_10, undefined); assert.ok(b.storage.furimanager_cross_tab_11);
});
test('同一サービスの再出品pendingに触れず、古いコピーだけ掃除', async () => {
  const b = broker(); b.storage.relist_pending = { mode: 'relist' }; b.storage.furimanager_cross_tab_99 = { savedAt: 1 };
  await b.send('CROSS_LISTING_OPEN', 1, { item: raw() });
  assert.deepEqual(b.storage.relist_pending, { mode: 'relist' }); assert.equal(b.storage.furimanager_cross_tab_99, undefined);
});

test('相互コピーの対応値: 状態・匿名配送・日数・都道府県をそれぞれ照合', () => {
  for (const target of ['yahoo', 'mercari']) {
    const toYahoo = target === 'yahoo';
    const base = {target, source: toYahoo ? 'mercari' : 'yahoo', condition: toYahoo ? '新品、未使用' : '未使用',
      shippingPayer: '送料込み(出品者負担)', shippingMethod: toYahoo ? 'ゆうゆうメルカリ便' : 'おてがる配送（日本郵便）',
      shippingDays: toYahoo ? '４～７日で発送' : '3〜7日で発送', shippingFrom: '兵庫県'};
    const plan = core.metadata(base);
    assert.equal(plan.condition, toYahoo ? '未使用' : '新品、未使用'); assert.equal(plan.carrier, 'post');
    assert.equal(plan.shippingMethod, toYahoo ? 'おてがる配送（日本郵便）' : 'ゆうゆうメルカリ便');
    assert.equal(plan.shippingDays, toYahoo ? '3~7日' : '4~7日で発送'); assert.equal(plan.shippingFrom, '兵庫県');
    assert.equal(core.metadata({...base, shippingMethod: toYahoo ? 'らくらくメルカリ便' : 'おてがる配送(ヤマト運輸)'}).carrier, 'yamato');
    for (const condition of ['未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり']) assert.equal(core.metadata({...base, condition}).condition, condition);
  }
});
test('意味の一致しない状態・配送・着払い・日数・未定地域を推測しない', () => {
  const base = {source:'mercari', target:'yahoo', condition:'全体的に状態が悪い', shippingMethod:'普通郵便', shippingPayer:'送料込み(出品者負担)', shippingDays:'8~14日', shippingFrom:'未定'};
  const plan = core.metadata(base);
  for (const key of ['condition', 'shippingMethod', 'shippingDays', 'shippingFrom']) assert.equal(plan[key], null);
  assert.equal(core.metadata({...base, shippingMethod:'ゆうゆうメルカリ便', shippingPayer:'着払い(購入者負担)'}).carrier, null);
  assert.equal(core.metadata({...base, shippingMethod:'らくらくメルカリ便', shippingPayer:''}).carrier, null);
  assert.equal(core.metadata({...base, shippingDays:'1~2日で発送予定'}).shippingDays, null);
});
test('送料負担は二度normalizeしても消えず、元データを変更しない', () => {
  const data = {...raw(), shippingPayer:'着払い(購入者負担)'};
  const once = core.normalize(data, mercari), twice = core.normalize(once, mercari);
  assert.equal(twice.shippingPayer, data.shippingPayer); assert.equal(data.shippingPayer, '着払い(購入者負担)');
  assert.equal(core.normalize(raw('yahoo'), yahoo).shippingPayer, '送料込み(出品者負担)');
});

test('メルカリの配送欄に連結された既知のバッジだけを除いて配送名を照合する', () => {
  const base = {...core.normalize(raw(), mercari), shippingPayer:'送料込み(出品者負担)'};
  assert.equal(core.metadata({...base, shippingMethod:'ゆうゆうメルカリ便郵便局/コンビニ受取匿名配送'}).carrier, 'post');
  assert.equal(core.metadata({...base, shippingMethod:'らくらくメルカリ便匿名配送'}).carrier, 'yamato');
  assert.equal(core.metadata({...base, shippingMethod:'ゆうゆうメルカリ便別の配送方法'}).carrier, null);
  assert.equal(core.metadata({...base, shippingMethod:'ゆうゆうメルカリ便匿名配送', shippingPayer:'着払い(購入者負担)'}).carrier, null);
});
test('selectは完全一致が一つある時だけ更新し、不明な値や曖昧な候補で先頭に戻さない', () => {
  const ctx = vm.createContext({URL, Event}); vm.runInContext(coreCode, ctx);
  const calls = [], field = {value:'hyogo', options:[{value:'hokkaido',label:'北海道'},{value:'hyogo',label:'兵庫県'}],
    get selectedOptions() { return this.options.filter(o=>o.value === this.value); }, dispatchEvent(e) { calls.push(e.type); }};
  assert.equal(ctx.FurimanagerCrossListing.selectExact(field, '未定'), false); assert.equal(field.value, 'hyogo'); assert.equal(calls.length, 0);
  assert.equal(ctx.FurimanagerCrossListing.selectExact(field, '北海道'), true); assert.equal(field.value, 'hokkaido');
  field.options.push({value:'other',label:'兵庫県'});
  assert.equal(ctx.FurimanagerCrossListing.selectExact(field, '兵庫県'), false); assert.equal(field.value, 'hokkaido');
});

function receiver() {
  let current = new URL(core.endpoints.mercari + '#furimanager-cross=token');
  const listeners = new Map(), messages = [], texts = [];
  const node = () => ({style: {}, append() {}, replaceChildren() {}, setAttribute() {}, set textContent(value) { texts.push(value); }});
  const ctx = vm.createContext({URL, Event, Date, setTimeout, document: {getElementById:node, createElement:node,
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key=>listeners.delete(key)},
    location: {get href() {return current.href;}, get origin() {return current.origin;}, get pathname() {return current.pathname;}, get hash() {return current.hash;}},
    chrome:{runtime:{async sendMessage(message) {messages.push(message); return {handled:true, success:true, job:{token:'token', item:core.normalize(raw('yahoo'), yahoo)}};}}}});
  vm.runInContext(coreCode, ctx);
  return {api:ctx.FurimanagerCrossListing, texts, messages, listeners, navigate: path=>{current=new URL(path, core.origins.mercari);},
    edit: type=>listeners.get(type)?.({isTrusted:true,target:{closest:()=>null}})};
}
test('明示した状態/配送画面の往復だけを許可し、監視を終了時に片付ける', async () => {
  const r = receiver(); let done = false;
  await r.api.receive('mercari', async (_item, _job, check) => {
    for (const path of ['/sell/conditions','/sell/create','/sell/shipping_methods','/sell/create']) {
      await check.navigate(path, () => r.navigate(path)); check();
    }
    done = true;
  });
  assert.equal(done, true); assert.equal(r.listeners.size, 0); assert.equal(r.messages.at(-1).type, 'CROSS_LISTING_FINISH');
});
test('予定外のURL・別origin・選択中の本人操作は途中で中断', async () => {
  for (const action of [r=>r.navigate('/item/m999'), r=>r.navigate('https://evil.example/sell/conditions'), r=>r.edit('click'), r=>r.edit('drop')]) {
    const r = receiver(); let continued = false;
    await r.api.receive('mercari', async (_item, _job, check) => {
      // 本人の操作は、自動クリックの同期処理が戻った後に届く。
      await check.navigate('/sell/conditions', () => {queueMicrotask(() => action(r));}); continued = true;
    });
    assert.equal(continued, false); assert.ok(r.texts.some(t=>t.includes('自動入力を止めました')));
  }
});
test('自動radio由来のtrustedイベントだけ除外し、その後の本人変更を検知', async () => {
  const r = receiver(); let wrote = false, continued = false;
  await r.api.receive('mercari', async (_item, _job, check) => {
    check.write(() => r.edit('change')); check(); wrote = true;
    r.edit('change'); check(); continued = true;
  });
  assert.equal(wrote, true); assert.equal(continued, false);
});
