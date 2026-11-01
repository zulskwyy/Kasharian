'use strict';
// Regresi v1.0.9: screenshot panjang riwayat GoPay (hasil OCR asli dari tangkapan layar pengguna).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..'), WWW = path.join(ROOT, 'app/src/main/assets/www/js');
global.self = global;
const R = require(path.join(WWW, 'rules.js')); global.KHRules = R;
const S = require(path.join(WWW, 'scan.js'));
const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8')).words;

// 1) OCR asli: transaksi "Gagal" tidak boleh menjadi pengeluaran, nominal "-Rp1150.000" harus 1.150.000, ikon tidak masuk nama.
const st = S.parseAppList(load('gopay-riwayat-ocr-asli.json'), '2026-11-01');
assert.ok(st, 'riwayat terbaca');
const key = (r) => `${r.date} ${r.neg ? '-' : '+'}${r.amt} ${r.desc}`;
assert.deepEqual(st.rows.map(key), [
  '2026-11-01 -1150000 Ditransfer ke Zulfiarudin Trian Masada',
  '2026-11-01 -54030 PDAM Kota Pasuruan - A208284',
  '2026-10-31 -24500 Alfamidi',
  '2026-10-31 -2000000 Ditransfer ke Zulfiarudin Trian Masada',
  '2026-10-31 +4000000 GoPay Top Up',
  '2026-10-29 -7900 PT Tokopedia',
  '2026-10-27 -256000 Planet Ban Cabang SBY'
], 'tujuh transaksi sukses terbaca benar');
assert.equal(st.rows.some((r) => r.amt === 214849), false, 'PLN Pascabayar berstatus Gagal tidak dicatat');
assert.equal(st.skipped.length, 4, 'empat transaksi gagal dilewati dan dilaporkan');
assert.ok(st.skipped.every((x) => x.reason === 'gagal' && x.amt === 214849));
assert.equal(st.header.months['2026-11'].out, 54030, 'ringkasan Pengeluaran bulan November terbaca');
assert.equal(st.header.months['2026-11'].in, 0, 'RpO (Rp0) terbaca sebagai 0');
assert.deepEqual([...new Set(st.rows.map((r) => r.txId))].length, st.rows.length, 'setiap baris punya id unik untuk cegah ganda');

// 2) OCR bising (mode baca ulang): kata "Gagal" rusak ("agal") tetap dikenali sebagai gagal.
const noisy = S.parseAppList(load('gopay-riwayat-ocr-bising.json'), '2026-11-01');
assert.equal(noisy.rows.some((r) => r.amt === 214849), false, 'status Gagal yang rusak terbaca ("agal") tetap dilewati');
assert.equal(noisy.rows.find((r) => r.amt === 1150000).neg, true);

// 3) Nominal: titik ribuan hilang/bergeser tidak boleh mengubah nilai.
const mk = (amtText) => {
  const w = (text, x0, y0) => ({ text, x0, x1: x0 + 60, y0, y1: y0 + 14 });
  const words = [w('Hari', 40, 100), w('ini', 100, 100), w('1', 140, 100), w('Nov', 160, 100), w('2026', 200, 100),
    w('Belanja', 140, 200), w(amtText, 480, 200), w('Toko', 140, 300), w('-Rp5.000', 480, 300), w('Warung', 140, 400), w('-Rp6.000', 480, 400), w('Kios', 140, 500), w('-Rp7.000', 480, 500)];
  return S.parseAppList(words, '2026-11-01').rows.find((r) => r.desc === 'Belanja').amt;
};
assert.equal(mk('-Rp1150.000'), 1150000);
assert.equal(mk('-Rp1.150000'), 1150000);
assert.equal(mk('-Rp2.000.000'), 2000000);
assert.equal(mk('-Rp214.849'), 214849);
assert.equal(mk('-Rp54030'), 54030);
console.log('Riwayat GoPay OCR (gagal, nominal, ikon, ringkasan bulan) regression v1.0.9 passed.');
