/* KasHarian bucket: pemilah otomatis Kebutuhan / Keinginan / Tabungan.
   Tidak ada pengaturan manual wajib. Tiap pengeluaran dinilai saat dihitung (bukan disimpan), jadi mengubah kategori, nama toko,
   atau catatan langsung mengubah rencana. Urutan penilaian, dari yang paling kuat:
     1. pilihan Anda pada catatan itu (bucket)            4. kata kunci tabungan / keinginan / kebutuhan
     2. hasil belajar per toko (bucketMemory)             5. kategori bawaan
     3. pilihan Anda per kategori (mapUser)               6. tidak dikenal -> Kebutuhan, ditandai "perlu dicek"
   Tanpa DOM, bisa dites di Node. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.KHBucket = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = (words) => new RegExp('(^|[^a-z0-9])(' + words.join('|') + ')([^a-z0-9]|$)', 'i');
  const SAVE = W(['tabung\\w*', 'nabung', 'menabung', 'deposito', 'reksa\\s?dana', 'reksadana', 'saham', 'emas', 'logam mulia', 'antam', 'dana darurat', 'investasi', 'obligasi', 'sbn', 'bibit', 'bareksa', 'pluang', 'ajaib', 'stockbit', 'kripto', 'crypto', 'bitcoin', 'tapera', 'dplk', 'jago pocket', 'celengan']);
  const WANT = W(['kafe', 'cafe', 'coffee', 'kopi', 'starbucks', 'janji jiwa', 'kenangan', 'chatime', 'boba', 'haus', 'mcdonald\\w*', 'mcd', 'kfc', 'burger king', 'pizza\\s?hut', 'hokben', 'solaria', 'resto', 'restoran', 'dessert', 'es krim', 'netflix', 'spotify', 'youtube', 'disney', 'vidio', 'viu', 'prime video', 'langganan', 'game', 'gaming', 'steam', 'diamond', 'mobile legends', 'free fire', 'genshin', 'bioskop', 'xxi', 'cgv', 'karaoke', 'konser', 'tiket', 'hotel', 'inn', 'resort', 'villa', 'homestay', 'traveloka', 'agoda', 'airbnb', 'liburan', 'wisata', 'salon', 'spa', 'massage', 'pijat', 'rokok', 'tobaku', 'tembakau', 'vape', 'camel', 'sampoerna', 'gudang garam', 'marlboro', 'shopee', 'tokopedia', 'lazada', 'tiktok\\s?shop', 'blibli', 'zalora', 'uniqlo', 'h&m', 'fashion', 'sepatu', 'baju', 'skincare', 'kosmetik', 'parfum', 'mainan', 'hobi', 'gadget', 'aksesoris', 'thrift', 'nongkrong', 'jajan', 'dine', 'bar']);
  const NEED = W(['indomaret', 'alfamart', 'alfamidi', 'superindo', 'pasar', 'sembako', 'beras', 'minyak', 'telur', 'gas', 'lpg', 'galon', 'listrik', 'pln', 'token', 'pdam', 'air', 'internet', 'wifi', 'indihome', 'pulsa', 'paket data', 'bpjs', 'asuransi', 'spp', 'sekolah', 'kuliah', 'apotek', 'apotik', 'obat', 'dokter', 'klinik', 'rumah sakit', 'bensin', 'pertamax', 'pertalite', 'spbu', 'parkir', 'tol', 'krl', 'transjakarta', 'busway', 'sewa', 'kos', 'kontrakan', 'cicilan', 'kpr', 'zakat', 'warteg', 'warung', 'nasi']);
  const BASIC_CAT = { 'Tagihan dan utilitas': 'need', 'Cicilan dan utang': 'need', 'Kesehatan': 'need', 'Pendidikan': 'need', 'Keluarga': 'need', 'Transportasi': 'need', 'Potongan gaji': 'need', 'Hiburan': 'want', 'Donasi dan sedekah': 'want', 'Tabungan dan investasi': 'save', 'Makan dan minum': 'need', 'Belanja': 'need' };

  const text = (a) => ((a.merchant || '') + ' ' + (a.note || '')).toLowerCase();
  /** Kunci toko untuk belajar: huruf dan angka saja, 18 karakter pertama. */
  const keyOf = (a) => { const t = (a.merchant || a.note || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); return t.slice(0, 18).trim(); };

  /** -> { nature: 'need'|'want'|'save', source, confident } */
  function classify(a, ctx) {
    ctx = ctx || {};
    if (a.bucket === 'need' || a.bucket === 'want' || a.bucket === 'save') return { nature: a.bucket, source: 'manual', confident: true };
    const key = keyOf(a), mem = ctx.memory || {};
    if (key && mem[key]) return { nature: mem[key], source: 'memory', confident: true };
    const um = (ctx.userMap || {})[a.category];
    if (um === 'need' || um === 'want' || um === 'save') return { nature: um, source: 'category', confident: true };
    const t = text(a) + ' ' + (a.category || '').toLowerCase();
    if (a.category === 'Tabungan dan investasi' || SAVE.test(t)) return { nature: 'save', source: 'keyword', confident: true };
    if (/zakat/.test(t)) return { nature: 'need', source: 'keyword', confident: true };
    if (WANT.test(text(a))) return { nature: 'want', source: 'keyword', confident: true };
    if (NEED.test(text(a))) return { nature: 'need', source: 'keyword', confident: true };
    const base = BASIC_CAT[a.category];
    if (base) return { nature: base, source: 'category', confident: a.category !== 'Belanja' };   // Belanja tanpa nama toko yang dikenal: bisa kebutuhan atau keinginan
    return { nature: 'need', source: 'default', confident: false };      // Lainnya / Belum pasti / tak dikenal
  }

  const kindOf = (b) => b.kind || (b.save ? 'save' : /(ingin|hibur|gaya|jajan|want|senang)/i.test(b.name || '') ? 'want' : 'need');
  /** Pilih id kelompok pada rencana untuk satu sifat. Rencana kustom tanpa kelompok "keinginan" jatuh ke kelompok pengeluaran kedua. */
  function bucketIdFor(buckets, nature, a) {
    const spend = buckets.filter((b) => !b.save), save = buckets.filter((b) => b.save);
    if (nature === 'save') {
      if (!save.length) return (spend[0] || buckets[0]).id;
      const emg = /darurat/i.test(text(a || {}));
      return (emg && save.find((b) => /darurat|emg/i.test(b.id + b.name)) || save[0]).id;
    }
    if (nature === 'want') return (spend.find((b) => kindOf(b) === 'want') || spend[1] || spend[0] || buckets[0]).id;
    return (spend.find((b) => kindOf(b) === 'need') || spend[0] || buckets[0]).id;
  }

  /** Belajar dari koreksi: semua catatan toko yang sama (sekarang dan nanti) ikut. */
  function learn(store, a, nature) {
    const k = keyOf(a); if (!k) return false;
    store.bucketMemory = store.bucketMemory || {}; store.bucketMemory[k] = nature; return true;
  }

  return { classify, bucketIdFor, learn, keyOf, kindOf };
});
