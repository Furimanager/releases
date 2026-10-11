import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// 配布JSの実関数を実行。DOM境界はスタブであり、実サイト確認の代用とはしない。
const coreCode = await readFile(new URL('../src/cross-listing.js', import.meta.url), 'utf8');
const mercCode = await readFile(new URL('../content-script-relist.js', import.meta.url), 'utf8');
const yahooCode = await readFile(new URL('../src/yahoo-fleamarket.js', import.meta.url), 'utf8');
function functionBlock(code, end) {
  const start = code.indexOf('    async function fillCrossListing(');
  assert.ok(start > 0); const stop = code.indexOf(end, start); assert.ok(stop > start);
  return code.slice(start, stop);
}
const mercFill = functionBlock(mercCode, '    async function waitForFormAndFill(');
const yahooFill = functionBlock(yahooCode, '    new MutationObserver(');
class Field {
  constructor(value = '', maxLength = -1) { this.current = value; this.maxLength = maxLength; this.events = []; this.isConnected = true; this.files = []; }
  get value() { return this.current; } set value(value) { this.current = value; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
}
class Transfer {
  constructor() { this.files = []; this.items = { add: value => this.files.push(value) }; }
}
class Select extends Field {
  constructor(labels, initial = 0) { super(String(initial)); this.options = labels.map((label, index) => ({label, textContent: label, value: String(index)})); }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
}
function fixture(platform, options = {}) {
  let time = 0, edited = false, uploads = 0, claimed = false, uploaded = false, wizard = !!options.wizard;
  const title = new Field(options.existing ? '本人が入力中' : '', options.titleLimit ?? (platform === 'mercari' ? 40 : 65)), description = new Field(), price = new Field(), image = new Field();
  const files = [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '3.jpg' }];
  const notices = [];
  const count = () => uploaded ? (options.partial ? 1 : time >= (options.delay ?? 0) ? 3 : 1) : options.existingImage ? 1 : 0;
  const root = { querySelectorAll: () => Array.from({ length: count() }, () => ({ src: 'https://static.mercdn.net/a.jpg', complete: true, naturalWidth: 300, getBoundingClientRect: () => ({ width: 80, height: 80 }) })) };
  image.closest = () => root;
  image.dispatchEvent = event => { image.events.push(event.type); if (event.type === 'change') { uploaded = true; uploads++; } };
  const meta = {
    condition: new Select(['選択してください', platform === 'mercari' ? '新品、未使用' : '未使用', '傷や汚れあり']),
    shippingMethod: new Select(['選択してください', 'ゆうゆうメルカリ便', 'らくらくメルカリ便']),
    shippingPayer: new Select(['選択してください', '送料込み(出品者負担)']),
    shippingDays: new Select(platform === 'mercari' ? ['選択してください', '1~2日で発送', '4~7日で発送'] : ['1~2日', '2~3日', '3~7日']),
    shippingFrom: new Select(['北海道', '兵庫県']),
  };
  const shipping = { checked: false, click() { this.checked = !options.revertMetadata; } };
  const queryMeta = selector => /Condition|name="condition"/.test(selector) ? meta.condition : /shippingMethod/.test(selector) ? meta.shippingMethod
    : /shippingPayer/.test(selector) ? meta.shippingPayer : /shippingDuration|shippingDays|timeToShip/.test(selector) ? meta.shippingDays
    : /shippingFrom|prefectures/.test(selector) ? meta.shippingFrom : null;
  const form = { isConnected: true, querySelector: selector => selector.startsWith('img') ? options.existingImage ? {} : null : queryMeta(selector) };
  let currentForm = form;
  const document = { querySelector: selector => selector === 'main form' ? currentForm : queryMeta(selector), addEventListener() {}, createElement() {}, getElementById() {} };
  const ctx = vm.createContext({ URL, document, HTMLInputElement: Field, HTMLTextAreaElement: class extends Field {}, Event,
    DataTransfer: Transfer, Date: { now: () => time }, setTimeout: callback => callback(),
    sleep: async ms => { time += ms; if (options.manualDuringUpload && uploaded) edited = true; },
    findTitleField: () => title, findDescriptionField: () => description, findPriceField: () => price, findImageField: () => image,
    hasUploadedListingImages: () => count() > 0, isVisible: () => true,
    findImageUploadNextButton: () => wizard && time > 2000 ? {} : null, clickButtonLike: () => { wizard = false; },
    clickAiSupportSkipButtonIfVisible: async () => false, isImageUploadDialogOpen: () => wizard, isAiSupportDialogOpen: () => false,
    fillPriceField: value => { price.value = String(value); }, isPriceReady: value => price.value === String(value), METADATA_SELECT_WAIT_MS: 250,
    findConditionEntryLink: () => null, findShippingMethodEntryLink: () => null,
    fillPicker: async (_form, _name, values, check) => { check(); if (!options.revertMetadata) meta.condition.value = String(meta.condition.options.findIndex(o=>o.label === values[0])); return !options.revertMetadata; },
    pickerMatches: (_form, _name, values) => meta.condition.selectedOptions[0]?.label === values[0],
    dom: { unique: (_root, selector) => selector === 'textarea' ? description : selector.includes('radio') ? shipping : title, priceField: () => price,
      setPriceValue: (field, value) => { field.value = value; }, selectText: () => true, price: value => Number(value) },
    fillImages: async (_form, _urls, check, prepared) => {
      assert.equal(prepared.length, 3); uploads++;
      if (options.replaceForm) currentForm = { ...form };
      if (options.detachForm) form.isConnected = false;
      if (options.manualDuringUpload) edited = true;
      check(); return !options.partial;
    }
  });
  vm.runInContext(coreCode, ctx); const cross = ctx.FurimanagerCrossListing;
  cross.wait = async (find, check) => { check(); const result = find(); if (!result) throw Error('form missing'); return result; };
  cross.claim = async (_job, check) => { check(); claimed = true; };
  cross.files = async (_job, check) => {
    assert.equal(claimed, true);
    if (options.downloadFails) throw Error('image download failed');
    if (options.editWhileFetching) title.value = '本人が入力中';
    check(); return files;
  };
  cross.complete = (item, warnings) => notices.push({ item, warnings });
  vm.runInContext((platform === 'mercari' ? mercFill : yahooFill) + '\nglobalThis.fill = fillCrossListing;', ctx);
  const item = { source: platform === 'yahoo' ? 'mercari' : 'yahoo', target: platform,
    title: options.title ?? (options.longTitle ? 'あ'.repeat(platform === 'mercari' ? 65 : 70) : '元の商品　名称'), description: '説明\n#タグ1 #タグ2', price: 300,
    condition: '傷や汚れあり', shippingPayer: '送料込み(出品者負担)', shippingMethod: platform === 'yahoo' ? 'ゆうゆうメルカリ便' : 'おてがる配送（日本郵便）',
    imageUrls: ['1','2','3'], shippingDays: '1〜2日で発送', shippingFrom: options.unknownPrefecture ? '未定' : '兵庫県', categoryPath: ['元カテゴリ'] };
  const run = () => ctx.fill(item, { token: 'token', item }, () => { if (edited) throw Error('manual edit'); });
  return { run, item, title, description, price, image, notices, meta, shipping, get uploads() { return uploads; }, get time() { return time; }, get claimed() { return claimed; } };
}
for (const platform of ['mercari', 'yahoo']) {
  test(`${platform}: 画像3枚・改行・タグ・全角空白・300円を入力、出品確定は呼ばない`, async () => {
    const f = fixture(platform); await f.run(); assert.equal(f.uploads, 1); assert.equal(f.title.value, f.item.title);
    assert.equal(f.description.value, f.item.description); assert.equal(f.price.value, '300'); assert.equal(f.notices.length, 1);
    assert.ok(f.notices[0].warnings.includes('カテゴリ')); assert.equal(f.notices[0].warnings.includes('配送方法'), false);
    assert.equal(f.meta.condition.selectedOptions[0].label, '傷や汚れあり'); assert.equal(f.meta.shippingFrom.selectedOptions[0].label, '兵庫県');
    assert.equal(f.notices[0].warnings.includes('商品の状態'), false); assert.equal(f.notices[0].warnings.includes('発送までの日数'), false);
  });
  test(`${platform}: 入力済みのタイトルや画像があればclaim前に停止`, async () => {
    for (const option of [{ existing: true }, { existingImage: true }]) {
      const f = fixture(platform, option); await assert.rejects(f.run(), /上書き/); assert.equal(f.claimed, false); assert.equal(f.uploads, 0);
    }
  });
  test(`${platform}: 画像取得が1枚でも失敗すれば何もアップロードしない`, async () => {
    const f = fixture(platform, { downloadFails: true }); await assert.rejects(f.run(), /download/); assert.equal(f.uploads, 0); assert.equal(f.title.value, '');
  });
  test(`${platform}: 画像取得中の別入力を上書きしない`, async () => {
    const f = fixture(platform, { editWhileFetching: true }); await assert.rejects(f.run(), /上書き/); assert.equal(f.title.value, '本人が入力中'); assert.equal(f.uploads, 0);
  });
  test(`${platform}: 画像追加中の本人操作で中断し完了通知を出さない`, async () => {
    const f = fixture(platform, { manualDuringUpload: true, delay: 10000 }); await assert.rejects(f.run(), /manual/); assert.equal(f.notices.length, 0); assert.equal(f.title.value, '');
  });
  test(`${platform}: 長い商品名は上限まで入力し、調整案内と元の全文を残す`, async () => {
    const limit = platform === 'mercari' ? 40 : 65;
    const f = fixture(platform, { longTitle: true }); await f.run(); assert.equal(f.title.value, 'あ'.repeat(limit));
    assert.equal(f.notices[0].item.title.length, platform === 'mercari' ? 65 : 70);
    assert.ok(f.notices[0].warnings.some(value => value.includes(`${limit}文字まで`) && value.includes('内容を確認・調整')));
    assert.equal(f.notices[0].warnings.includes('商品名の一致'), false);
  });
  test(`${platform}: 一部画像のみ反映の場合は画像の警告を残す`, async () => {
    const f = fixture(platform, { partial: true }); await f.run(); assert.ok(f.notices[0].warnings.some(value => value.includes('画像')));
  });
}
test('メルカリ: maxLength属性がなくても40文字を守り、絵文字を途中で壊さない', async () => {
  const f = fixture('mercari', {title: 'あ'.repeat(39) + '😀続き', titleLimit:-1}); await f.run();
  assert.equal(f.title.value, 'あ'.repeat(39)); assert.equal(f.item.title, 'あ'.repeat(39) + '😀続き');
  assert.ok(f.notices[0].warnings.some(w=>w.includes('40文字まで')));
});
test('メルカリ: 商品名40文字ちょうどなら省略案内を出さない', async () => {
  const f = fixture('mercari', {title:'あ'.repeat(40)}); await f.run();
  assert.equal(f.title.value, f.item.title); assert.equal(f.notices[0].warnings.some(w=>w.includes('商品名')), false);
});
for (const platform of ['mercari', 'yahoo']) test(`${platform}: 未定の地域は現在値を変えず、確認を必ず案内`, async () => {
  const f = fixture(platform, {unknownPrefecture: true}); await f.run();
  assert.equal(f.meta.shippingFrom.value, '0'); assert.deepEqual(f.meta.shippingFrom.events, []);
  assert.ok(f.notices[0].warnings.some(w=>w.includes('発送元の地域')));
});
test('Yahoo: 入力が反映されなかった状態・配送は成功扱いにしない', async () => {
  const f = fixture('yahoo', {revertMetadata: true}); await f.run();
  assert.ok(f.notices[0].warnings.includes('商品の状態')); assert.ok(f.notices[0].warnings.includes('配送方法'));
});
test('メルカリ: 画像20秒遅延・モーダル遅延でも全3枚を待つ', async () => {
  const f = fixture('mercari', { delay: 20000, wizard: true }); await f.run(); assert.ok(f.time >= 20000);
  assert.equal(f.notices[0].warnings.some(value => value.includes('画像')), false);
});
for (const key of ['replaceForm', 'detachForm']) test(`Yahoo: ${key}したフォームへ入力しない`, async () => {
  const f = fixture('yahoo', { [key]: true }); await assert.rejects(f.run(), /フォームが切り替わった/);
  assert.equal(f.title.value, ''); assert.equal(f.notices.length, 0);
});
