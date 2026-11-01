'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const R = require(path.join(ROOT, 'app/src/main/assets/www/js/rules.js'));
global.self = global; global.KHRules = R;
const T = require(path.join(ROOT, 'app/src/main/assets/www/js/tidy.js'));
const SL = require(path.join(ROOT, 'app/src/main/assets/www/js/slip.js'));

const wallets = [
  { id: 'cash', name: 'Tunai', type: 'CASH', openingBalance: 1000000, includeInTotal: true },
  { id: 'bank', name: 'BCA', type: 'BANK', openingBalance: 500000, includeInTotal: true },
  { id: 'hidden', name: 'Dompet Arsip', type: 'OTHER', openingBalance: 100000, includeInTotal: false }
];
const acts = [
  { id: 'e1', type: 'EXPENSE', amount: -250000, walletId: 'cash', occurredOn: '2026-11-01', category: 'Makan dan minum' },
  { id: 'i1', type: 'INCOME', amount: -400000, walletId: 'bank', occurredOn: '2026-11-01', category: 'Gaji' },
  { id: 't1', type: 'TRANSFER', amount: -100000, walletId: 'bank', toWalletId: 'cash', occurredOn: '2026-11-01' },
  { id: 'bad-transfer', type: 'TRANSFER', amount: 900000, walletId: 'cash', toWalletId: null, occurredOn: '2026-11-01' },
  { id: 'alias-out', type: 'KELUAR', amount: -50000, walletId: 'cash', occurredOn: '2026-11-01', category: 'Transportasi' },
  { id: 'adj', type: 'ADJUSTMENT', amount: -25000, walletId: 'cash', occurredOn: '2026-11-01', category: 'Penyesuaian' }
];
const b = R.BalanceEngine.balances(wallets, acts);
assert.equal(b.cash, 775000, 'Expense reduces balance even if legacy amount is negative; incomplete transfer has no effect; adjustment remains signed');
assert.equal(b.bank, 800000, 'Negative legacy income adds and negative transfer amount transfers by absolute value');
assert.equal(R.BalanceEngine.total(wallets, acts), 1575000, 'Transfers conserve combined wallet total and excluded wallets stay excluded');

const openingText = R.BalanceEngine.balances([{ id: 'legacy-open', openingBalance: 'Rp 1.250.000' }], []);
assert.equal(openingText['legacy-open'], 1250000, 'Legacy rupiah opening balances are parsed as grouped rupiah');

const summary = R.SummaryEngine.month(acts, '2026-11');
assert.equal(summary.income, 400000, 'Income summary uses absolute magnitude');
assert.equal(summary.expense, 300000, 'Expense summary uses absolute magnitude');
assert.equal(summary.difference, 100000, 'Net cash-flow summary is income minus expense');
assert.equal(summary.biggestCategory, 'Makan dan minum', 'Expense category breakdown includes absolute values');

const tidyData = { wallets, activities: acts };
const tidyTotals = T.totals(tidyData);
assert.equal(tidyTotals.balances.cash, b.cash, 'Rapikan data and main balance engine must agree');
assert.equal(tidyTotals.balances.bank, b.bank, 'Rapikan data and main balance engine must agree for bank');
assert.equal(tidyTotals.income, 400000);
assert.equal(tidyTotals.expense, 300000);
const tidyTextData = {
  wallets: [{ id: 'text-wallet', name: 'Tunai', type: 'CASH', openingBalance: 'Rp 1.000.000', includeInTotal: true }],
  activities: [
    { id: 'text-expense', type: 'KELUAR', amount: 'Rp 25.000', walletId: 'text-wallet', occurredOn: '2026-11-01' },
    { id: 'text-income', type: 'MASUK', amount: 'Rp 100.000', walletId: 'text-wallet', occurredOn: '2026-11-01' }
  ]
};
assert.equal(T.totals(tidyTextData).balances['text-wallet'], 1075000, 'Rapikan Data parses old currency text and opening balances identically to the main ledger');

assert.equal(R.normalizeActivity({ type: 'pengeluaran', amount: -123 }).type, 'EXPENSE');
assert.equal(R.normalizeActivity({ type: 'outgoing', amount: -123 }).amount, 123);
assert.equal(R.normalizeActivity({ kind: 'pindah dana', amount: -20 }).type, 'TRANSFER');
assert.equal(R.normalizeActivity({ type: 'ADJUSTMENT', amount: -10 }).amount, -10, 'Adjustment retains signed semantics');

// The everyday Catat parser must map plain expense language to EXPENSE and payroll/work receipts to INCOME.
assert.equal(R.FreeTextParser.parse('mkn siang 25rb', '2026-11-01').kind, 'EXPENSE');
assert.equal(R.FreeTextParser.parse('mkn siang 25rb', '2026-11-01').amount, 25000);
assert.equal(R.FreeTextParser.parse('gaji masuk 5jt', '2026-11-01').kind, 'INCOME');
assert.equal(R.FreeTextParser.parse('gaji masuk 5jt', '2026-11-01').amount, 5000000);

// Ambiguous payroll rows are now prefilled automatically using a deterministic best fit.
const slipAuto = SL.analyze({
  rows: [
    { label: 'Gaji tetap', amount: 100000, type: 'EARNING', weak: false },
    { label: 'Baris A', amount: 100000, type: 'UNCLASSIFIED', weak: true },
    { label: 'Baris B', amount: 100000, type: 'UNCLASSIFIED', weak: true }
  ],
  printed: { gross: null, deductions: null, net: 200000 }, period: null, employer: null
});
assert.equal(slipAuto.solved, true, 'Slip reconciliation auto-fills ambiguous row classifications');
assert.ok(slipAuto.rows.every((r) => r.type !== 'UNCLASSIFIED'), 'No manual two-choice classification is required when net salary can reconcile the rows');
assert.ok(slipAuto.notes.some((n) => /dipilih otomatis/.test(n)), 'Ambiguous slip result explains it was auto-selected');

assert.equal(R.ledgerAmountValue('Rp 25.000'), 25000, 'Legacy rupiah string parses Indonesian thousands separators');
assert.equal(R.ledgerAmountValue('1.250.000'), 1250000, 'Legacy grouped rupiah text parses without losing digit groups');
assert.equal(R.ledgerAmountValue('Rp 1.234,00'), 1234, 'Legacy rupiah text with decimal cents rounds to integer rupiah');
assert.equal(R.ledgerAmountValue('-Rp 7.500'), -7500, 'Legacy negative rupiah text retains sign for adjustments');
const textLedger = R.BalanceEngine.balances(wallets, [
  { id: 'text-expense', type: 'PENGELUARAN', amount: 'Rp 25.000', walletId: 'cash' },
  { id: 'text-income', type: 'MASUK', amount: 'Rp 100.000', walletId: 'bank' }
]);
assert.equal(textLedger.cash, 975000, 'Formatted legacy expense string debits the cash wallet');
assert.equal(textLedger.bank, 600000, 'Formatted legacy income string credits the bank wallet');

// Exercise the Planning engine using signed legacy entries: income allocates positively,
// expenses reduce the monthly envelope, and savings progress follows the planned split.
global.self = global;
global.KHRules = R;
global.KHBucket = require(path.join(ROOT, 'app/src/main/assets/www/js/bucket.js'));
const planDb = {
  wallets: [{ id: 'plan-wallet', name: 'BCA', type: 'BANK', openingBalance: 0, includeInTotal: true }],
  activities: [
    { id: 'plan-income', type: 'INCOME', amount: -1000000, walletId: 'plan-wallet', occurredOn: '2026-11-01', category: 'Gaji' },
    { id: 'plan-expense', type: 'EXPENSE', amount: -250000, walletId: 'plan-wallet', occurredOn: '2026-11-01', category: 'Makan dan minum', merchant: 'Warung makan' }
  ],
  plan: { preset: 'custom', chosen: true, estimate: 0, map: {}, mapUser: {}, rules: [], buckets: [
    { id: 'need', name: 'Kebutuhan', kind: 'need', pct: 50, save: false },
    { id: 'want', name: 'Keinginan', kind: 'want', pct: 30, save: false },
    { id: 'save', name: 'Tabungan', kind: 'save', pct: 20, save: true }
  ] },
  bucketMemory: {}, memory: []
};
global.KHApp = { R, S: { save() {} }, db: () => planDb, liveActs: () => planDb.activities.filter((a) => !a.deletedAt).map((a) => Object.assign(a, R.normalizeActivity(a))),
  h() {}, go() {}, frame() {}, card() {}, field() {}, toast() {}, SCREENS: {} };
global.KHUI = { moneyInput() {} };
delete require.cache[require.resolve(path.join(ROOT, 'app/src/main/assets/www/js/extra.js'))];
require(path.join(ROOT, 'app/src/main/assets/www/js/extra.js'));
const planned = global.KHExtra.state('2026-11');
assert.equal(planned.base, 1000000, 'Planning reads a legacy negative income as positive');
assert.equal(planned.spendingBudget, 800000, 'Planning splits needs and wants from income');
assert.equal(planned.totalSpend, 250000, 'Planning recognizes a negative legacy expense as spending');
assert.equal(planned.spendable, 550000, 'Planning reduces the remaining needs+wants limit');
assert.equal(planned.savingsProgress, 200000, 'Savings progress receives the planned percentage automatically');

// Exercise the Android-backed synchronous key/value store migration with a mock bridge.
const storePath = path.join(ROOT, 'app/src/main/assets/www/js/store.js');
const saved = new Map();
saved.set('kh_web_db_v1', JSON.stringify({
  v: 3, wallets, activities: [
    { id: 'legacy-exp', type: 'pengeluaran', amount: -7000, walletId: 'cash' },
    { id: 'legacy-inc', type: 'incoming', amount: -12000, walletId: 'bank' },
    { id: 'legacy-move', type: 'internal-transfer', amount: -3000, walletId: 'bank', toWalletId: 'cash' },
    { id: 'legacy-adjust', type: 'ADJUSTMENT', amount: -500, walletId: 'cash' }
  ]
}));
global.self = {
  KHRules: R,
  KHNativeStorage: {
    getItem: (k) => saved.has(k) ? saved.get(k) : null,
    setItem: (k, v) => { saved.set(k, v); return true; },
    removeItem: (k) => saved.delete(k)
  },
  crypto: undefined
};
delete require.cache[require.resolve(storePath)];
require(storePath);
const migrated = global.self.KHStore.db.activities;
assert.deepEqual(migrated.map((a) => a.type), ['EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT']);
assert.deepEqual(migrated.map((a) => a.amount), [7000, 12000, 3000, -500]);
assert.equal(JSON.parse(saved.get('kh_web_db_v1')).activities[0].amount, 7000, 'Migration persists to native storage, not only in-memory state');



// Exercise the exact production addActivity() function used by Catat and OCR receipt review.
let appUid = 0;
const appDb = {
  wallets: [{ id: 'app-cash', name: 'Tunai', type: 'CASH', openingBalance: 1000000, includeInTotal: true, archived: false }],
  activities: [], memory: [], bills: [], slips: [], settings: { autolockMin: 1 }, plan: null
};
global.window = global;
global.self = global;
global.KHRules = R;
global.KHStore = { db: appDb, uid: () => 'app-' + (++appUid), save: () => true };
global.KHUI = { h() { return {}; }, toast() {}, modal() {}, confirmBox() {}, pinPad() {}, moneyInput() {} };
global.KHExtra = undefined;
global.document = { getElementById() { return { replaceChildren() {} }; }, addEventListener() {}, body: { classList: { toggle() {} } } };
global.addEventListener = () => {};
global.history = { pushState() {} };
delete require.cache[require.resolve(path.join(ROOT, 'app/src/main/assets/www/js/app.js'))];
require(path.join(ROOT, 'app/src/main/assets/www/js/app.js'));
const App = global.KHApp;
App.addActivity({ type: 'EXPENSE', amount: 25000, walletId: 'app-cash', category: 'Makan dan minum', occurredOn: '2026-11-01' });
assert.equal(App.totalBalance(), 975000, 'The production addActivity path debits wallet for a Catat expense');
App.addActivity({ type: 'KELUAR', amount: 'Rp 50.000', walletId: 'app-cash', category: 'Transportasi', occurredOn: '2026-11-01' });
assert.equal(App.totalBalance(), 925000, 'Production write path canonicalizes localized amount and still debits');
App.addActivity({ type: 'INCOME', amount: 100000, walletId: 'app-cash', category: 'Gaji', occurredOn: '2026-11-01' });
assert.equal(App.totalBalance(), 1025000, 'Production write path credits income');
assert.equal(App.liveActs().filter((a) => a.type === 'EXPENSE').length, 2, 'Catat and OCR expense types remain expense entries after canonicalization');
App.addActivity({ type: R.FreeTextParser.parse('mkn siang 25rb', '2026-11-01').kind, amount: R.FreeTextParser.parse('mkn siang 25rb', '2026-11-01').amount, walletId: 'app-cash', category: 'Makan dan minum', occurredOn: '2026-11-01' });
assert.equal(App.totalBalance(), 1000000, 'The final Rp25,000 expense debits the wallet after earlier income and expenses.');

console.log('Ledger + Planning + Catat regression tests passed.');
