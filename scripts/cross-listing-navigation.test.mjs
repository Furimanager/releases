import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// 配布JSのメタデータ入力と実際のreceiveガードを使い、URL先行のSPA描画を再現する。
// DOM境界のモックであり、実サイトの最終確認の代用にはしない。
const coreCode = await readFile(new URL('../src/cross-listing.js', import.meta.url), 'utf8');
const relistCode = await readFile(new URL('../content-script-relist.js', import.meta.url), 'utf8');
const start = relistCode.indexOf('    async function fillCrossMetadata(');
const end = relistCode.indexOf('    async function waitForFormAndFill(', start);
assert.ok(start >= 0 && end > start);
const metadataCode = relistCode.slice(start, end);

class Select {
  constructor(labels) {
    this.value = '0';
    this.options = labels.map((label, index) => ({ label, value: String(index) }));
    this.events = [];
  }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
  dispatchEvent(event) { this.events.push(event.type); }
}

function fixture(options = {}) {
  let time = 0;
  const timers = [], listeners = new Map(), notices = [], paths = [];
  const location = { origin: 'https://jp.mercari.com', pathname: '/sell/create', href: 'https://jp.mercari.com/sell/create#furimanager-cross=token', hash: '#furimanager-cross=token' };
  let screen = 'form', conditionSelected = !!options.conditionSelected, shippingSelected = false, shippingLabelReady = true;
  let shippingLinkReady = true, servicesReady = false, candidatesReady = false;
  let completed = false, shippingOpened = 0, groupsOpened = 0, radioClicks = 0;
  const warnings = [];
  const item = { source: 'yahoo', target: 'mercari', title: '検証商品', description: '説明', price: 300, categoryPath: [],
    condition: '傷や汚れあり', shippingMethod: 'おてがる配送（日本郵便）', shippingFrom: '兵庫県', shippingDays: '2〜3日' };
  const job = { token: 'token', item };
  const meta = {
    payer: new Select(['選択してください', '送料込み(出品者負担)']),
    days: new Select(['選択してください', '2〜3日で発送']),
    from: new Select(['北海道', '兵庫県']),
    method: new Select(['選択してください', 'ゆうゆうメルカリ便']),
  };
  const schedule = (delay, action) => { timers.push({ at: time + delay, action }); };
  const advance = ms => {
    time += ms;
    for (;;) {
      const index = timers.findIndex(timer => timer.at <= time);
      if (index < 0) break;
      timers.splice(index, 1)[0].action();
    }
  };
  const go = path => {
    location.pathname = path;
    location.href = location.origin + path;
    location.hash = '';
    paths.push(path);
  };
  const renderForm = () => {
    screen = 'loading';
    shippingLinkReady = false;
    schedule(options.formDelay ?? 0, () => {
      screen = 'form';
      schedule(options.shippingLinkDelay ?? 0, () => { shippingLinkReady = true; });
    });
    go('/sell/create');
  };
  const conditionLink = {
    textContent: '商品の状態',
    querySelectorAll: () => conditionSelected ? [{ textContent: item.condition }] : [],
    click() { screen = 'conditions'; go('/sell/conditions'); },
  };
  const conditionOption = { click() { conditionSelected = true; renderForm(); } };
  const shippingLink = {
    textContent: '配送の方法',
    querySelectorAll: () => shippingSelected && shippingLabelReady ? [{ textContent: 'ゆうゆうメルカリ便' }] : [],
    click() {
      shippingOpened++;
      screen = 'shipping-loading';
      go('/sell/shipping_methods');
      schedule(options.servicesDelay ?? 0, () => { screen = 'shipping'; servicesReady = true; });
    },
  };
  const radio = { checked: false, disabled: false, isConnected: true,
    click() {
      radioClicks++;
      this.checked = true;
      // native radio.clickのinput/changeはisTrusted=true。writeガードの動作も確認する。
      listeners.get('change')?.({ isTrusted: true, target: { closest: () => null } });
    },
  };
  const candidate = { textContent: 'ゆうゆうメルカリ便', querySelectorAll: () => [], querySelector: () => radio };
  const update = { click() {
    shippingSelected = radio.checked;
    shippingLabelReady = false;
    schedule(options.shippingLabelDelay ?? 0, () => { shippingLabelReady = true; });
    renderForm();
  } };
  const back = { textContent: '戻る', click: renderForm };
  const statusBox = { replaceChildren() {}, append() {}, remove() {} };
  const document = {
    getElementById: () => statusBox,
    createElement: () => ({ style: {}, append() {}, set textContent(value) { notices.push(value); } }),
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: type => listeners.delete(type),
    querySelectorAll: selector => selector === 'a[href="/sell/create"]' ? [back] : [],
    querySelector: selector => {
      if (selector.includes('shipping-service')) return servicesReady && screen === 'shipping' ? {} : null;
      if (screen !== 'form') return null;
      if (selector.includes('shippingPayer')) return meta.payer;
      if (selector.includes('shippingDuration')) return meta.days;
      if (selector.includes('shippingFromArea')) return meta.from;
      if (selector.includes('shippingMethod') && options.inlineShipping && shippingLinkReady) return meta.method;
      return null;
    },
  };
  const waitForCandidates = async () => {
    for (let attempt = 0; attempt < 20 && !candidatesReady; attempt++) advance(250);
  };
  const ctx = vm.createContext({ URL, Event, document, location,
    Date: { now: () => time }, setTimeout: (callback, ms) => { advance(ms); callback(); },
    chrome: { runtime: { sendMessage: async message => message.type === 'CROSS_LISTING_PEEK' ? { handled: true, success: true, job } : { success: true } } },
    findTitleField: () => screen === 'form' ? {} : null,
    findDescriptionField: () => screen === 'form' ? {} : null,
    findConditionEntryLink: () => screen === 'form' ? conditionLink : null,
    findShippingMethodEntryLink: () => screen === 'form' && shippingLinkReady && !options.inlineShipping ? shippingLink : null,
    waitForConditionOptions: async () => [conditionOption],
    getConditionOptionText: () => item.condition,
    openShippingServicesIfNeeded: async () => {
      if (!servicesReady || screen !== 'shipping') return;
      groupsOpened++;
      schedule(250, () => { candidatesReady = true; });
    },
    getShippingMethodCandidates: () => candidatesReady && screen === 'shipping' ? [candidate] : [],
    waitForShippingMethodCandidates: waitForCandidates,
    waitForShippingUpdateButton: async () => update,
    isClickableButtonLike: () => true, isVisible: () => true, sleep: async ms => advance(ms),
  });
  vm.runInContext(coreCode, ctx);
  vm.runInContext(metadataCode + '\nglobalThis.fillMetadata = fillCrossMetadata;', ctx);
  if (options.manualAt != null) schedule(options.manualAt, () => listeners.get('click')?.({ isTrusted: true, target: { closest: () => null } }));
  if (options.leaveAt != null) schedule(options.leaveAt, () => go('/sell/edit/m999'));
  const run = () => ctx.FurimanagerCrossListing.receive('mercari', async (_item, _job, check) => {
    await ctx.fillMetadata(item, check, warnings);
    completed = true;
  });
  return { run, warnings, notices, paths, meta,
    get completed() { return completed; }, get shippingOpened() { return shippingOpened; },
    get groupsOpened() { return groupsOpened; }, get radioClicks() { return radioClicks; },
  };
}

test('メルカリ: 状態選択後にURLが先行し、フォームと配送欄が遅れても配送を入力する', async () => {
  const f = fixture({ formDelay: 1200, shippingLinkDelay: 750 });
  await f.run();
  assert.equal(f.completed, true);
  assert.equal(f.shippingOpened, 1);
  assert.equal(f.radioClicks, 1);
  assert.deepEqual(f.paths, ['/sell/conditions', '/sell/create', '/sell/shipping_methods', '/sell/create']);
  assert.deepEqual(f.warnings, []);
  assert.equal(f.meta.days.selectedOptions[0].label, '2〜3日で発送');
  assert.equal(f.meta.from.selectedOptions[0].label, '兵庫県');
});

test('メルカリ: 配送ページのURLよりサービスグループが遅れても展開して選択する', async () => {
  const f = fixture({ conditionSelected: true, servicesDelay: 1800 });
  await f.run();
  assert.equal(f.completed, true);
  assert.equal(f.groupsOpened, 1);
  assert.equal(f.radioClicks, 1);
  assert.deepEqual(f.warnings, []);
});

test('メルカリ: フォーム復帰後に遅れて現れる配送selectにも入力する', async () => {
  const f = fixture({ inlineShipping: true, formDelay: 600, shippingLinkDelay: 900 });
  await f.run();
  assert.equal(f.completed, true);
  assert.equal(f.shippingOpened, 0);
  assert.equal(f.meta.method.selectedOptions[0].label, 'ゆうゆうメルカリ便');
  assert.deepEqual(f.warnings, []);
});

test('メルカリ: 配送欄の外枠より選択済みラベルが遅れても誤警告しない', async () => {
  const f = fixture({ conditionSelected: true, shippingLabelDelay: 1800 });
  await f.run();
  assert.equal(f.completed, true);
  assert.equal(f.radioClicks, 1);
  assert.deepEqual(f.warnings, []);
});

test('メルカリ: 状態から戻る描画待ち中の本人クリックで配送入力前に停止する', async () => {
  const f = fixture({ formDelay: 1200, manualAt: 300 });
  await f.run();
  assert.equal(f.completed, false);
  assert.equal(f.shippingOpened, 0);
  assert.equal(f.radioClicks, 0);
  assert.deepEqual(f.meta.from.events, []);
  assert.ok(f.notices.some(text => text.includes('手動入力')));
});

test('メルカリ: 配送グループの描画待ち中に別商品の編集URLへ移動したら操作しない', async () => {
  const f = fixture({ conditionSelected: true, servicesDelay: 1800, leaveAt: 300 });
  await f.run();
  assert.equal(f.completed, false);
  assert.equal(f.groupsOpened, 0);
  assert.equal(f.radioClicks, 0);
  assert.deepEqual(f.meta.from.events, []);
  assert.ok(f.notices.some(text => text.includes('画面の移動')));
});
