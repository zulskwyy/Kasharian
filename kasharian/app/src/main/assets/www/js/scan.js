/* KasHarian scan: logika pembaca struk dan riwayat transaksi dari hasil OCR (tanpa DOM, bisa dites di Node).
   - Nominal struk dicocokkan secara hitungan: tunai - kembalian = total (bukan angka terbesar).
   - Tanggal dibaca toleran terhadap salah baca OCR (O/0, l/1, spasi).
   - Nama toko dicocokkan samar ke daftar jaringan toko (ALFAMIDT, NLFAMIDL tetap dikenali).
   - Screenshot riwayat aplikasi (GoPay, OVO, Dana, dll): satu baris per transaksi, dengan tanggal dari judul hari. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.KHScan = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const todayISO = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const addDaysISO = (s, n) => { const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // ---------- nama toko ----------
  const B = (name, cat, keys, fuzzy) => ({ name, cat, keys, fuzzy: fuzzy !== false });
  const BRANDS = [
    B('Alfamidi', 'Belanja', ['alfamidi', 'midi utama']), B('Alfamart', 'Belanja', ['alfamart', 'sumber alfaria']), B('Indomaret', 'Belanja', ['indomaret', 'indomarco']),
    B('Lawson', 'Belanja', ['lawson']), B('Circle K', 'Belanja', ['circle k'], false), B('Superindo', 'Belanja', ['superindo', 'supermarket indonesia']), B('Hypermart', 'Belanja', ['hypermart']),
    B('Transmart', 'Belanja', ['transmart']), B('Carrefour', 'Belanja', ['carrefour']), B('Giant', 'Belanja', ['giant'], false), B('Ranch Market', 'Belanja', ['ranch market']), B('Ace Hardware', 'Belanja', ['ace hardware']),
    B('Lazada', 'Belanja', ['lazada']), B('Tokopedia', 'Belanja', ['tokopedia']), B('Shopee', 'Belanja', ['shopee'], false),
    B('KFC', 'Makan dan minum', ['kfc'], false), B('McDonald\'s', 'Makan dan minum', ['mcdonald']), B('Burger King', 'Makan dan minum', ['burger king']), B('Pizza Hut', 'Makan dan minum', ['pizza hut']),
    B('Starbucks', 'Makan dan minum', ['starbucks']), B('Kopi Kenangan', 'Makan dan minum', ['kopi kenangan']), B('Janji Jiwa', 'Makan dan minum', ['janji jiwa']), B('Chatime', 'Makan dan minum', ['chatime']),
    B('HokBen', 'Makan dan minum', ['hokben', 'hoka hoka']), B('Solaria', 'Makan dan minum', ['solaria']), B('Warung / restoran', 'Makan dan minum', ['warung', 'restoran', 'resto ', 'bakso', 'kebab'], false),
    B('SPBU', 'Transportasi', ['spbu', 'pertamina', 'pertalite', 'pertamax']), B('Shell', 'Transportasi', ['shell'], false), B('Parkir', 'Transportasi', ['parkir', 'e-toll', 'tol '], false), B('Gojek', 'Transportasi', ['gojek'], false), B('Grab', 'Transportasi', ['grab'], false),
    B('Apotek', 'Kesehatan', ['apotek', 'apotik', 'kimia farma', 'guardian', 'watsons', 'klinik']), B('Rumah sakit', 'Kesehatan', ['rumah sakit'], false),
    B('PLN', 'Tagihan dan utilitas', ['pln'], false), B('PDAM', 'Tagihan dan utilitas', ['pdam'], false), B('Indihome', 'Tagihan dan utilitas', ['indihome']), B('Telkomsel', 'Tagihan dan utilitas', ['telkomsel']),
    B('Smartfren', 'Tagihan dan utilitas', ['smartfren']), B('BPJS', 'Tagihan dan utilitas', ['bpjs'], false),
    B('Donasi', 'Donasi dan sedekah', ['laznas', 'baznas zakat', 'infaq', 'zakat'], false)
  ];
  /** lines: array of strings. Mengembalikan {name, cat, line} atau null. Kecocokan pasti didahulukan, lalu samar (maks ~25% huruf salah). */
  function detectBrand(texts) {
    let best = null;
    texts.forEach((t, li) => {
      const low = ' ' + t.toLowerCase().replace(/[^a-z0-9\s'.-]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const toks = low.split(/[\s.\-']+/).filter((x) => x.length >= 4);
      for (const b of BRANDS) {
        for (const k of b.keys) {
          let score = 0;
          if (k.length <= 3 ? new RegExp('(^|[^a-z])' + k.trim() + '([^a-z]|$)').test(low) : low.includes(k.trim())) score = 3;
          else if (b.fuzzy && !k.includes(' ') && k.length >= 7) {
            for (const tk of toks) { if (Math.abs(tk.length - k.length) > 2) continue; const r = lev(tk, k) / k.length; if (r <= 0.26) score = Math.max(score, 2 - r); }
          }
          if (score && (!best || score > best.score || (score === best.score && li < best.li))) best = { score, li, name: b.name, cat: b.cat, line: t };
        }
      }
    });
    return best ? { name: best.name, cat: best.cat, line: best.line } : null;
  }

  // ---------- tanggal ----------
  const fixDigits = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5');
  function findDate(t, today, future) {
    today = today || todayISO();
    const ok = (y, m, d) => validDate(y, m, d) && (future || iso(y, m, d) <= addDaysISO(today, 1)) && y >= 2000;
    let m = /(?<![\d\w])([\dOoIl|]{1,2})\s*[\/\-.]\s*([\dOoIl|]{1,2})\s*[\/\-.]\s*((?:20|2O)[\dOoIl|]{2}|[\dOoIl|]{2})(?![\d])/.exec(t);
    if (m) { const d = +fixDigits(m[1]), mo = +fixDigits(m[2]); let ys = fixDigits(m[3]); const y = ys.length === 2 ? 2000 + +ys : +ys; if (ok(y, mo, d)) return iso(y, mo, d); }
    m = /(?<!\d)(20\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/.exec(t); if (m && ok(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
    m = /(?<!\d)(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(20\d{2})/.exec(t); if (m && MON[m[2].toLowerCase()] && ok(+m[3], MON[m[2].toLowerCase()], +m[1])) return iso(+m[3], MON[m[2].toLowerCase()], +m[1]);
    return null;
  }

  // ---------- nominal ----------
  const JUNK = /(telp|tel\.|npwp|wa\s*\/\s*sms|kritik|saran|www\.|\.com|\.co\.id|kav\.|jl\.|\bno\.|kasir|\bbon\b|member|poin|expired|point|nik\b|ref\b|trx|id\s*transaksi|versi|v\.\d|\b(tgl|tanggal|jam|waktu)\b|\d{1,2}:\d{2}|\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{2,4})/i;
  // Final-payable labels used by Indonesian retail, bills, QRIS, and online checkout receipts.
  // Deliberately accepts a bare `tagihan`/`jumlah` label because OCR often separates the amount onto the next line.
  const RE_TOTAL = /(?:harga\s*jual|grand\s*total|total(?:\s*(?:(?:yang\s*)?(?:(?:harus|wajib)\s*)?(?:bayar|dibayar(?:kan)?|pembayaran|belanja|tagihan|akhir|bersih|harga|transaksi|keseluruhan|amount|due|payment)))?|totalbayar|jumlah(?:\s*(?:(?:yang\s*)?(?:(?:harus|wajib)\s*)?(?:dibayar(?:kan)?|bayar|pembayaran|tagihan|akhir|bersih|keseluruhan|transaksi)))?|(?:harus|wajib)\s*dibayar(?:kan)?|amount\s*due|balance\s*due|total\s*due|nominal\s*(?:(?:yang\s*)?(?:(?:harus|wajib)\s*)?)?(?:tagihan|pembayaran|dibayar(?:kan)?|bayar)|nilai\s*(?:akhir|transaksi|tagihan|pembayaran)|tagihan(?:\s*(?:anda|total|akhir|pembayaran))?|invoice\s*total|net\s*payable|payable\s*amount|^total\s*:?$)/i;
  const RE_NOTTOTAL = /(?:total\s*(?:item|barang|qty)|item|qty|barang|diskon|hemat|ppn|dpp|pajak|sub\s*total|subtotal|poin|point)/i;
  const AMT_RE = /(?<![\d.,A-Za-z])(\d{1,3}(?:[.,]\s?\d{3}){1,2}|\d{4,9}|\d{3})(?:[.,]\d{2})?(?![\dA-Za-z])/g;
  const TOTAL_WORDS = ['total','jumlah','bayar','dibayar','dibayarkan','bersih','pembayaran','belanja','tagihan','akhir','harga','transaksi','keseluruhan','harus','wajib','grand','amount','due','payment','jual','anda','invoice','payable','nominal','nilai','net'];
  function normalizeLabel(text) {
    return String(text || '').toLowerCase().replace(/[|!]/g, 'i').split(/([^a-z0-9]+)/).map((part) => {
      if (!/[a-z]/i.test(part)) return part;
      let word = part.replace(/0/g, 'o').replace(/1/g, 'i').replace(/4/g, 'a').replace(/5/g, 's');
      let best = word, distance = Infinity;
      for (const target of TOTAL_WORDS) {
        const d = lev(word, target);
        const limit = target.length >= 8 ? 2 : 1;
        if (d <= limit && d < distance) { best = target; distance = d; }
      }
      return best;
    }).join('').replace(/totalbayar/g, 'total bayar').replace(/totalpembayaran/g, 'total pembayaran').replace(/jumlahtagihan/g, 'jumlah tagihan');
  }
  function amountsOf(text, allowBare) {
    const t = fixNum(text), out = []; let m; AMT_RE.lastIndex = 0;
    while ((m = AMT_RE.exec(t))) {
      if (/^%/.test(t.slice(m.index + m[0].length).trim())) continue;
      const raw = m[1].replace(/\s/g, ''); if (!/[.,]/.test(raw) && !allowBare) continue; let n = parseInt(raw.replace(/[.,]/g, ''), 10);
      if (n >= 100 && n <= 50000000) out.push({ n, at: m.index });
    }
    return out;
  }
  const fixNum = (t) => String(t).replace(/(^|[^A-Za-z])([\dOoIl|]+(?:[.,]\s?[\dOoIl|]+)*)(?=$|[^A-Za-z])/g, (m, prefix, token) => prefix + token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\s+/g, ''));
  const fuzzyHas = (text, key) => (text.toLowerCase().match(/[a-z]{4,}/g) || []).some((w) => lev(w, key) / key.length <= 0.4);
  const labelOf = (text) => {
    const label = String(text || '').replace(/\b(?:rp|idr)\b/ig, ' ').replace(/[\d.,\s]+$/g, '').trim(), l = normalizeLabel(label);
    if (RE_TOTAL.test(l) && !RE_NOTTOTAL.test(l)) return 'total';
    if (/(sub\s*total|subtotal)/.test(l)) return 'sub';
    if (/(kembali|chang)/.test(l) || fuzzyHas(l, 'kembalian') || fuzzyHas(l, 'kembali')) return 'change';
    if (/(tunai|cash|dibayar|qris|debit|kartu|gopay|ovo|\bdana\b|shopeepay|uang)/.test(l) || fuzzyHas(l, 'tunai')) return 'cash';
    if (/(ppn|dpp|pajak|tax|diskon|hemat|potongan|service|servis)/.test(l)) return 'tax';
    return '';
  };
  /** lines: [{text}] -> {amount, sure, choices:[n], how} */
  /** Lapisan penyaring di atas pickTotal0: memperbaiki kesalahan yang umum pada foto struk yang kurang jelas.
   *  1) subtotal terpilih padahal ada angka total (subtotal + pajak) di bawahnya,
   *  2) tebakan hitungan dari kumpulan angka acak (kebetulan cocok) dianggap benar,
   *  3) angka total yang benar tidak masuk daftar pilihan karena daftar terpotong. */
  function pickTotal(lines) {
    const r = pickTotal0(lines);
    try { return refineTotal(r, lines); } catch (e) { return r; }
  }
  const CONFUSE = { 0: [6, 8, 9], 1: [7], 2: [7], 3: [8, 5], 5: [6, 3], 6: [0, 8, 5], 7: [1], 8: [0, 6, 3, 9], 9: [0, 8, 4], 4: [9] };
  /** Semua angka yang bisa muncul bila paling banyak `max` digit tertukar karena salah baca; nilai -> jumlah digit berubah. */
  function digitVariants(n, max) {
    const out = new Map([[n, 0]]); let layer = [[String(n), 0]];
    for (let step = 1; step <= max; step++) {
      const nxt = [];
      for (const [str, ed] of layer) for (let i = 0; i < str.length; i++) for (const d of CONFUSE[+str[i]] || []) {
        if (i === 0 && d === 0) continue;
        const v = str.slice(0, i) + d + str.slice(i + 1), num = +v;
        if (!out.has(num)) { out.set(num, ed + 1); nxt.push([v, ed + 1]); }
      }
      layer = nxt;
    }
    return out;
  }
  /** Cari total yang memenuhi: tunai - kembalian = total dan subtotal + pajak = total, dengan koreksi digit seminimal mungkin. */
  function repairTotal(meta, subs, taxNums) {
    const T0 = (meta.labTotal || []).slice(-1)[0], C0 = (meta.labCash || []).slice(-1)[0], K0 = (meta.labChange || [])[0];
    if (!T0 || !C0 || !K0 || T0 < 1000) return null;
    if (C0 - K0 === T0) return null;                          // sudah cocok, tidak perlu koreksi
    const VT = digitVariants(T0, 2), VC = digitVariants(C0, 2), VK = digitVariants(K0, 2), A = new Map();
    for (const [c, ec] of VC) for (const [k, ek] of VK) { const t = c - k; if (t > 0 && VT.has(t)) { const e = ec + ek + VT.get(t); if (!A.has(t) || e < A.get(t)) A.set(t, e); } }
    if (!A.size) return null;
    const taxes = [...taxNums].filter((n) => n >= 100), B = new Map();
    for (const sub of subs) for (const tax of taxes) { const VS = digitVariants(sub, 2), VX = digitVariants(tax, 2); for (const [a, ea] of VS) for (const [b, eb] of VX) { const t = a + b; if (A.has(t) && b / a >= 0.02 && b / a <= 0.3) { const e = ea + eb; if (!B.has(t) || e < B.get(t)) B.set(t, e); } } }
    const sols = [];
    for (const [t, eA] of A) { const eB = B.has(t) ? B.get(t) : null; const strong = eB !== null, cost = eA + (strong ? eB : 3); if (!strong && eA > 3) continue; if (strong || cost <= 6) sols.push({ T: t, strong, cost }); }
    // Total di struk Indonesia hampir selalu berakhir 00 atau 50; utamakan solusi seperti itu, lalu yang koreksinya paling sedikit.
    sols.sort((x, y) => (y.strong - x.strong) || ((y.T % 50 === 0) - (x.T % 50 === 0)) || x.cost - y.cost);
    return sols.length ? { T: sols[0].T, strong: sols[0].strong, alts: sols.slice(1, 4).map((x) => x.T) } : null;
  }
  function refineTotal(r0, lines) {
    let r = r0;
    const meta = r.meta || {}, pool = (meta.pool || []).slice();
    if (!pool.length) return r;
    const isQty = (t) => /\d\s*[x\u00d7]\s*\d/i.test(t), isSub = (t) => /(sub\s*-?\s*tot|s[ua]\w?\s*-?\s*tota?l)/i.test(t), isTax = (t) => /(ppn|pajak|\btax\b|pb1|service|servis)/i.test(t);
    const where = new Map(), itemNums = new Set(), subNums = new Set(), taxNums = new Set();
    lines.forEach((l, i) => {
      const t = String(l.text || ''), am = amountsOf(t, true).map((x) => x.n); if (!am.length) return;
      const itemLike = isQty(t) || ((t.match(/\p{L}/gu) || []).length >= 6 && am.length >= 2 && !isSub(t) && !isTax(t) && !/total|tunai|cash|kembali|change|bayar/i.test(t));
      am.forEach((n) => { if (!where.has(n)) where.set(n, i); if (itemLike) itemNums.add(n); if (isSub(t)) subNums.add(n); if (isTax(t)) taxNums.add(n); });
    });
    const cashLike = new Set([...(meta.labCash || []), ...(meta.labChange || [])]);
    const round = (n) => n >= 10000 && n % 10000 === 0;
    const nonItem = pool.filter((n) => !itemNums.has(n) && !cashLike.has(n) && !taxNums.has(n));
    const rank = (a, b) => (round(a) - round(b)) || b - a;
    const items = meta.items > 0 ? meta.items : 0, subs = [...new Set([...subNums, ...(items >= 1000 && pool.includes(items) ? [items] : [])])];
    const out = { ...r, meta: { ...meta } };
    const dropSub = () => { out.meta.labTotal = (meta.labTotal || []).filter((n) => !subNums.has(n) && n !== items); };
    const finish = () => {
      const ordered = [out.amount, ...(r.choices || []), ...nonItem.slice().sort(rank), ...pool.filter((n) => itemNums.has(n)).sort((a, b) => b - a)];
      const seen = []; ordered.forEach((n) => { if (n && !seen.includes(n)) seen.push(n); });
      out.choices = seen.slice(0, 8); return out;
    };
    // 0) angka tercetak tidak saling cocok karena 1-2 digit salah baca (0/6/8, 1/7, dst.): pulihkan lewat hubungan antar angka
    const rep = repairTotal(meta, [...subNums, ...(items >= 1000 ? [items] : [])], taxNums);
    if (rep) {
      // Koreksi digit hanya tebakan terbaik: selalu minta pengguna mencocokkan dengan foto, tapi alternatifnya disediakan di pilihan.
      out.amount = rep.T; out.sure = false; out.how = 'dikoreksi dari angka yang saling cocok';
      const printed = [(meta.labTotal || []).slice(-1)[0]].filter(Boolean);
      r = { ...r, choices: [rep.T, ...rep.alts, ...printed, ...(r.choices || [])] }; return finish();
    }
    // 1) subtotal + pajak = total, semuanya terbaca di struk
    let tier1 = 0;
    for (const a of subs) for (const b of pool) { const T = a + b; if (b / a >= 0.02 && b / a <= 0.3 && pool.includes(T) && T > tier1) tier1 = T; }
    const maxCash = Math.max(0, ...(meta.labCash || []));
    if (tier1 && tier1 !== r.amount && (!maxCash || tier1 <= maxCash)) { out.amount = tier1; out.sure = !maxCash || (meta.labChange || []).some((k) => Math.abs(maxCash - k - tier1) <= 0); out.how = 'subtotal ditambah pajak'; dropSub(); out.meta.labTotal = [...out.meta.labTotal, tier1]; return finish(); }
    // 2) hasil sekarang ternyata subtotal/harga barang: cari angka non-barang yang sedikit lebih besar di bawahnya
    if (r.amount && (subNums.has(r.amount) || (itemNums.has(r.amount) && !(meta.labTotal || []).includes(r.amount)) || r.amount === items) && !(meta.labTotal || []).some((t) => t > r.amount * 1.02 && t <= r.amount * 1.3)) {
      const after = nonItem.filter((n) => !round(n) && n > r.amount * 1.02 && n <= r.amount * 1.3 && (where.get(n) || 0) >= (where.get(r.amount) || 0));
      if (after.length) { out.amount = Math.max(...after); out.sure = false; out.how = 'angka setelah subtotal'; dropSub(); return finish(); }
    }
    // 3) tebakan hitungan berskor rendah dari kumpulan angka banyak: terlalu mudah kebetulan, pakai angka non-barang terbesar yang bukan tunai bulat
    if (r.how === 'hitungan' && pool.length > 5) {
      const cand = nonItem.slice().sort(rank);
      if (cand.length) { out.amount = cand[0]; out.sure = false; out.how = 'angka terbesar'; }
    }
    return finish();
  }
  function pickTotal0(lines) {
    const rows = lines.map((l, i) => ({ i, text: String(l.text || ''), am: JUNK.test(l.text) && !/total/i.test(l.text) ? [] : amountsOf(l.text, !!labelOf(l.text) && labelOf(l.text) !== 'tax'), lab: labelOf(l.text), neg: /\(\s*[\d.,\s]{3,}\s*\)?\s*$/.test(l.text) || /voucher|vc\s|diskon|potongan/i.test(l.text) && /\(/.test(l.text) }));
    const withAm = rows.filter((r) => r.am.length);
    const valueNearLabel = (r, key) => {
      if (r.am.length) return r.am[r.am.length - 1].n;
      let combined = r.text;
      for (let j = r.i + 1; j < Math.min(rows.length, r.i + 4); j++) {
        const next = rows[j];
        if (next.lab && next.lab !== key) break;
        if (next.lab === key && next.am.length) return next.am[next.am.length - 1].n;
        const vals = amountsOf(next.text, true);
        const bare = String(next.text).replace(/\b(?:rp|idr)\b/ig, '').trim();
        if (vals.length && /^[\dOoIl|.,\s]+$/.test(bare)) return vals[vals.length - 1].n;
        if (!vals.length && /[\p{L}]{2,}/u.test(next.text)) {
          combined += ' ' + next.text;
          if (labelOf(combined) === key) continue; // label split over multiple OCR lines (e.g. TOTAL / BAYAR)
          if (RE_NOTTOTAL.test(normalizeLabel(combined))) break;
          continue;
        }
        if (vals.length && labelOf(next.text) === key) return vals[vals.length - 1].n;
        break;
      }
      return 0;
    };
    const byLab = (k) => rows.filter((r) => r.lab === k).map((r) => valueNearLabel(r, k)).filter((n) => n > 0);
    const labTotal = byLab('total'), labCash = byLab('cash'), labChange = byLab('change');
    // Include amounts found on a separate line after an explicit label in the candidate pool.
    const pool = [...new Set([...withAm.flatMap((r) => r.am.map((x) => x.n)), ...labTotal, ...labCash, ...labChange])];
    const choices = []; const add = (n) => { if (n && !choices.includes(n)) choices.push(n); }; const meta = { labTotal, labCash, labChange, pool };
    // 1. hitungan: tunai - kembalian = total
    let best = null;
    for (const c of pool) for (const k of pool) {
      if (k >= c) continue; const T = c - k; if (T < 500) continue;
      // Bayar non-tunai (QRIS, debit, e-wallet) tidak punya kembalian: jangan cari "kembalian" dari angka barang. Bila labelnya ada, pakai hanya angka berlabel.
      if (labCash.length && !labChange.length) continue;
      if (labChange.length && !labChange.includes(k)) continue;
      if (labCash.length && !labCash.includes(c)) continue;
      const inPool = pool.includes(T); if (!inPool && !(labCash.includes(c) && labChange.includes(k))) continue;
      const ix = (n) => pool.indexOf(n), ord = inPool && ix(T) < ix(c) && ix(c) < ix(k) ? 1.5 : 0;
      const sc = (inPool ? 3 : 1.5) + ord + (labTotal.includes(T) ? 2 : 0) + (labCash.includes(c) ? 1 : 0) + (labChange.includes(k) ? 1 : 0);
      if (!best || sc > best.sc || (sc === best.sc && c > best.c)) best = { sc, T, c, k };
    }
    if (best && best.sc >= 4) { add(best.T); labTotal.forEach(add); add(best.c); add(best.k); pool.forEach(add); return { amount: best.T, sure: true, how: 'hitungan tunai dan kembalian', choices: choices.slice(0, 6), meta }; }
    // 1b. total berlabel tidak cocok dengan tunai - kembalian: salah satu salah baca. Pilih yang sesuai jumlah barang.
    const items = rows.filter((r) => !r.lab && r.am.length >= 1 && !/(sub\s*-?\s*tot|s[ua]\w?\s*-?\s*tota?l|ppn|pajak|\btax\b|pb1|service|servis)/i.test(r.text) && (r.neg || (fixNum(r.text).match(/\p{L}/gu) || []).length >= 3)).reduce((a, r) => a + (r.neg ? -1 : 1) * r.am[r.am.length - 1].n, 0);
    meta.items = items;
    if (labTotal.length && labCash.length && labChange.length) {
      const Tck = Math.max(...labCash) - labChange[0], Tl = labTotal[labTotal.length - 1];
      if (Tck >= 500 && Tck !== Tl) {
        const okC = (n) => !items || n >= items * 0.98, pickT = okC(Tl) && (!okC(Tck) || Math.abs(Tl - items) <= Math.abs(Tck - items)) ? Tl : Tck;
        add(pickT); add(Tck); add(Tl); labCash.forEach(add); labChange.forEach(add);
        return { amount: pickT, sure: false, how: 'total tidak cocok dengan tunai dan kembalian', choices: choices.slice(0, 6), meta };
      }
    }
    // 1c. total = tunai (bayar pas), atau total = jumlah barang dikurangi voucher
    const exact = labTotal.find((t) => labCash.includes(t));
    if (exact) { add(exact); pool.forEach(add); return { amount: exact, sure: true, how: 'total sama dengan tunai', choices: choices.slice(0, 6), meta }; }
    if (items >= 1000 && pool.includes(items)) { add(items); pool.forEach(add); return { amount: items, sure: true, how: 'jumlah barang', choices: choices.slice(0, 6), meta }; }
    // 2. baris berlabel total
    const maxCash = labCash.length ? Math.max(...labCash) : 0;
    const okTotals = labTotal.filter((n) => !maxCash || n <= maxCash);
    if (okTotals.length) { const T = okTotals[okTotals.length - 1]; add(T); if (best) add(best.T); pool.forEach(add); return { amount: T, sure: items > 0 && Math.abs(items - T) <= 100 ? true : !labCash.length || labCash.some((c) => c >= T), how: 'baris total', choices: choices.slice(0, 6), meta }; }
    if (best) { add(best.T); pool.forEach(add); return { amount: best.T, sure: false, how: 'hitungan', choices: choices.slice(0, 6), meta }; }
    // 3. cadangan: angka terbesar yang bukan tunai/kembalian/pajak
    const skip = new Set([...labCash, ...labChange, ...rows.filter((r) => r.lab === 'tax').flatMap((r) => r.am.map((x) => x.n))]);
    const cand = pool.filter((n) => !skip.has(n)); const round = (n) => n >= 10000 && n % 10000 === 0; cand.sort((a, b) => (round(a) - round(b)) || b - a); cand.forEach(add); pool.forEach(add);
    return { amount: cand[0] || 0, sure: false, how: 'angka terbesar', choices: choices.slice(0, 6), meta };
  }

  const STOP = /(struk|nota|invoice|receipt|kasir|tagihan|terima kasih|selamat datang|jl\.|jalan|telp|npwp)/i;
  function headMerchant(texts) {
    const clean = (x) => !(x.split(/\s+/).some((w) => w.length >= 4 && /[a-z]/.test(w) && /[A-Z]/.test(w) && !/^[A-Z][a-z]+$/.test(w)));
    const t = texts.slice(0, 6).find((x) => (x.match(/\p{L}/gu) || []).length >= 4 && (x.match(/\d/g) || []).length <= 3 && !STOP.test(x) && clean(x));
    return t ? t.replace(/[^\p{L}\p{N}\s.&'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  }
  /** Struk/tagihan -> {amount, sure, choices, merchant, brand, category, date, due, isBill} */
  function analyzeReceipt(lines, today) {
    const texts = lines.map((l) => l.text), all = texts.join('\n');
    const tot = pickTotal(lines);
    const dueLine = texts.find((t) => /(jatuh\s*tempo|batas\s*(waktu\s*)?bayar|due\s*date|bayar\s*sebelum)/i.test(t)), due = dueLine ? findDate(dueLine, today, true) : null;
    let date = null; for (const t of texts) { const d = findDate(t, today); if (d && d !== due) { date = d; break; } }
    const brand = detectBrand(texts);
    const merchant = brand ? brand.name : headMerchant(texts) || null;
    return { ...tot, merchant, brand: brand ? brand.name : null, brandCat: brand ? brand.cat : null, date, due, isBill: /(tagihan|jatuh\s*tempo|invoice|rekening\s*(listrik|air)|pelanggan)/i.test(all) };
  }

  // ---------- screenshot riwayat aplikasi ----------
  function groupLines(words) {
    const ws = words.filter((w) => w.text && w.text.trim()).map((w) => ({ ...w, text: w.text.trim(), yc: (w.y0 + w.y1) / 2 }));
    if (!ws.length) return { lines: [], medH: 10, maxX: 0 };
    const hs = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b), medH = Math.max(4, hs[Math.floor(hs.length / 2)]);
    ws.sort((a, b) => a.yc - b.yc); const lines = [];
    for (const w of ws) { const l = lines[lines.length - 1]; if (l && Math.abs(w.yc - l.yc) <= medH * 0.55) { l.ws.push(w); l.yc = (l.yc * (l.ws.length - 1) + w.yc) / l.ws.length; } else lines.push({ ws: [w], yc: w.yc }); }
    lines.forEach((l) => { l.ws.sort((a, b) => a.x0 - b.x0); l.text = l.ws.map((w) => w.text).join(' '); });
    return { lines, medH, maxX: Math.max(...ws.map((w) => w.x1)) };
  }
  const DAYS = '(?:senin|selasa|rabu|kamis|jumat|jum\'at|sabtu|minggu)';
  const HDR_FULL = new RegExp('(?:' + DAYS + '|hari ini|kemarin)?\\s*(\\d{1,2})\\s+(jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des)[a-z]*\\.?\\s*,?\\s*(20\\d{2})', 'i');
  const HDR_SHORT = new RegExp('^(?:' + DAYS + '|hari ini|kemarin)[\\s,]*(\\d{1,2})\\s+(jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des)[a-z]*\\.?$', 'i');
  const NAV = /^(beranda|keuangan|qris|riwayat|profil|tanggal|layanan|metode|download|kembali|home|transaksi|semua|filter)(\s|$)/i;
  // Nominal: ambil semua angka setelah "Rp" lalu buang pemisah. OCR sering menghilangkan atau menggeser titik ribuan ("Rp1150.000" harus 1.150.000, bukan 1.150).
  const RP_RE = /([-\u2212\u2013\u2014+])?\s*Rp\.?\s*(\d[\d.,]*\d|\d)/i;
  const rpValue = (txt) => { const d = String(txt || '').replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : 0; };
  // Status transaksi yang belum/tidak berhasil. Uangnya tidak pernah keluar, jadi baris ini tidak boleh dicatat.
  const BAD_STATUS = /^(gagal|failed|batal|dibatalkan|dibatalin|canceled|cancelled|ditolak|rejected|kedaluwarsa|kadaluarsa|kedaluarsa|expired|menunggu|pending|diproses|diprosess|processing)$/i;
  const badStatusWord = (t) => { const w = String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!w) return false; if (BAD_STATUS.test(w)) return true; return w.length >= 4 && w.length <= 6 && /^[ga]/.test(w) && lev(w, 'gagal') <= 1; };
  const SUBLINE = /^(bni|bri|bca|mandiri|bsi|bank|gopay|cimb|permata|dana|ovo|\*+)\b.*(\d{4,}|\*{2,})/i;
  const WD = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0 };
  const dow = (iso0) => { const [y, m, d] = iso0.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  /** Judul hari ("Selasa 13 Okt 2026", "Kemarin") -> tanggal ISO. Hari dan urutan (terbaru di atas) dipakai untuk membetulkan salah baca angka. */
  function headerOf(l, txt, prev, today) {
    if (l.ws.length > 7 || RP_RE.test(txt)) return null;
    const first = (l.ws[0].text || '').toLowerCase().replace(/[^a-z]/g, '');
    if (/^(kemarin|kemar[il]n)$/.test(first) || (first === 'kemarin')) return addDaysISO(today, -1);
    if (/^hari$/.test(first) && /ini/i.test(txt)) return today;
    let wd = null; for (const [k, v] of Object.entries(WD)) if (first === k || (k.length >= 5 && first.length >= 4 && lev(first, k) <= 1)) wd = v;
    const mon = /(jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|oxt|nov|des)[a-z]*/i.exec(txt), yr = /(20\d{2})/.exec(txt);
    if (wd == null && !(mon && /^\d{1,2}\s/.test(txt))) return null;
    if (wd == null) { const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(20\d{2})/.exec(txt); if (m && MON[m[2].toLowerCase()] && validDate(+m[3], MON[m[2].toLowerCase()], +m[1])) return iso(+m[3], MON[m[2].toLowerCase()], +m[1]); return null; }
    const dn = (/(?:^|\s)(\d{1,2})(?=\s|$)/.exec(txt.replace(/^\S+\s*/, '')) || [])[1];
    const mo = mon ? (MON[mon[1].toLowerCase().replace('oxt', 'okt')] || null) : null, upper = prev ? addDaysISO(prev, -1) : today;
    const Y = yr ? +yr[1] : +upper.slice(0, 4), M = mo || +upper.slice(5, 7);
    if (dn && validDate(Y, M, +dn) && dow(iso(Y, M, +dn)) === wd && iso(Y, M, +dn) <= upper) return iso(Y, M, +dn);
    // cari tanggal terdekat sebelum 'upper' dengan hari yang sama (bulan sama bila terbaca)
    let best = null; for (let i = 0; i < 70; i++) { const d = addDaysISO(upper, -i); if (dow(d) !== wd) continue; if (mo && +d.slice(5, 7) !== mo) continue; const sc = (dn ? lev(String(+d.slice(8)), String(+dn)) : 0) * 100 + i; if (!best || sc < best.sc) best = { sc, d }; if (!dn) break; }
    return best ? best.d : null;
  }
  /** "Rp2.55jt" / "Rp4jt" / "Rp62.500" -> {n, tol}. Angka berakhiran jt/rb dibulatkan aplikasi, jadi diberi toleransi setengah digit terakhir. */
  function shortRp(s) {
    const m = /Rp\.?\s*(\d+(?:[.,]\d+)*)\s*(jt|juta|rb|ribu)?/i.exec(String(s || '').replace(/Rp\.?\s*[Oo](?![A-Za-z])/g, 'Rp0')); if (!m) return null;
    if (m[2]) { const mult = /^j/i.test(m[2]) ? 1e6 : 1e3, num = m[1].replace(',', '.'), dec = (num.split('.')[1] || '').length; return { n: Math.round(parseFloat(num) * mult), tol: Math.round(0.5 * Math.pow(10, -dec) * mult) }; }
    return { n: parseInt(m[1].replace(/[.,]/g, ''), 10), tol: 0 };
  }
  /** Baris ringkasan bulan di atas riwayat ("Pengeluaran: -Rp2.55jt  Pemasukan: Rp4jt"). */
  function headerSums(txt) {
    const o = /pengeluaran\s*:?\s*(.*?)(?=pemasukan|$)/i.exec(txt), i = /pemasukan\s*:?\s*(.*?)(?=pengeluaran|$)/i.exec(txt);
    return { out: o ? shortRp(o[1]) : null, in: i ? shortRp(i[1]) : null };
  }
  function parseAppList(words, today) {
    today = today || todayISO();
    words = words.flatMap((w) => { const t = (w.text || '').trim(), m = /^(.{2,}?)([-\u2212\u2013+]?R[pP]\.?\d[\d.,]*)$/.exec(t); if (!m) return [w]; const f = m[1].length / t.length, cx = w.x0 + (w.x1 - w.x0) * f; return [{ ...w, text: m[1], x1: cx }, { ...w, text: m[2], x0: cx }]; });
    const { lines, medH, maxX } = groupLines(words);
    if (lines.length < 4) return null;
    const rpx = words.filter((w) => /^[-\u2212\u2013\u2014+]?Rp\.?\d/i.test(w.text.trim())).map((w) => w.x0).sort((a, b) => a - b);
    const cut = rpx.length >= 2 ? Math.min(rpx[Math.floor(rpx.length * 0.1)], maxX * 0.75) - medH * 0.5 : maxX * 0.5; let date = null; const groups = new Set();
    const heads = [], anchors = [], frags = [], sums = { out: null, in: null }, monthSums = {}; let pend = null;
    for (const l of lines) {
      const txt = l.text.replace(/\s+/g, ' ');
      if (/(pengeluaran|pemasukan)\s*:/i.test(txt)) { const hs = headerSums(txt); if (hs.out) sums.out = hs.out; if (hs.in) sums.in = hs.in; pend = { out: hs.out || (pend && pend.out) || null, in: hs.in || (pend && pend.in) || null }; continue; }
      const hd = headerOf(l, txt, heads.length ? heads[heads.length - 1].date : null, today);
      if (hd) { heads.push({ yc: l.yc, date: hd }); groups.add(hd); if (pend) { monthSums[hd.slice(0, 7)] = pend; pend = null; } continue; }
      const right = l.ws.filter((w) => w.x0 >= cut), left = l.ws.filter((w) => w.x0 < cut);
      const rt = right.map((w) => w.text).join(' ').replace(/\s*([.,])\s*/g, '$1'), rm = RP_RE.exec(rt);
      if (rm) {
        const hasHead = heads.length; if (!hasHead) continue;
        anchors.push({ yc: l.yc, neg: !!(rm[1] && rm[1] !== '+'), plus: rm[1] === '+', n: rpValue(rm[2]), date: heads[heads.length - 1].date, h: heads.length });
      }
      const lt = left.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
      if (lt && heads.length) frags.push({ yc: l.yc, text: lt, ws: left, h: heads.length, method: '' });
      // Kata status di kolom kanan (tanpa nominal) juga dipantau.
      const rightBad = right.filter((w) => !RP_RE.test(w.text) && badStatusWord(w.text));
      if (rightBad.length && heads.length) frags.push({ yc: l.yc, text: '', ws: [], bad: true, h: heads.length, method: '' });
    }
    if (anchors.length < 2 || !heads.length) return null;
    const docMinus = anchors.filter((a) => a.neg).length >= 2;
    const used = new Map(); anchors.forEach((a) => used.set(a, []));
    // Kolom keterangan: ikon di kiri (huruf/angka sisa gambar seperti "a", "3,", "Li", "[+]") bukan bagian nama transaksi.
    const lead = frags.filter((f) => f.ws && f.ws.length && !f.bad).map((f) => f.ws[0].x0), bin = Math.max(6, medH * 0.7), hist = {};
    lead.forEach((x) => { const k = Math.round(x / bin); hist[k] = (hist[k] || 0) + 1; });
    const topK = Object.keys(hist).sort((p, q) => hist[q] - hist[p])[0], descX = lead.length >= 3 && topK != null ? Number(topK) * bin : null;
    const cleanWords = (ws) => ws.filter((w) => !(descX != null && w.x1 <= descX - medH * 0.35)).filter((w, i, a) => /[A-Za-z0-9\u00C0-\u024F]/.test(w.text) || (/^[-\u2013\u2014]$/.test(w.text) && i > 0 && i < a.length - 1));
    for (const f of frags) {
      if (!f.bad) {
        const kept = cleanWords(f.ws || []); f.badWord = kept.some((w, i) => badStatusWord(w.text) && (kept.length === 1 || i === kept.length - 1));
        f.text = kept.filter((w) => !(f.badWord && badStatusWord(w.text))).map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
      } else f.badWord = true;
      if (!f.badWord && (!f.text || NAV.test(f.text) || /^(cashback|coins?\s+dari)/i.test(f.text) || /^(gopay\s+)?(saldo|coins?|poin)\b/i.test(f.text) || /^\d{1,3}$/.test(f.text))) continue;
      let best = null; for (const a of anchors) { if (a.h !== f.h) continue; const d = Math.abs(a.yc - f.yc); if (d <= medH * 3.2 && (!best || d < best.d)) best = { a, d }; }
      if (best) used.get(best.a).push(f);
    }
    const seen = {}, rows = [], skipped = [];
    anchors.forEach((a) => {
      const fr = used.get(a).sort((p, q) => p.yc - q.yc), failed = fr.some((f) => f.badWord), real = fr.filter((f) => f.text), main = real.filter((f) => !SUBLINE.test(f.text)), sub = real.filter((f) => SUBLINE.test(f.text));
      const desc = main.map((f) => f.text).join(' ').replace(/\s+/g, ' ').trim();
      if (failed) { skipped.push({ date: a.date, desc: desc || 'Transaksi', amt: a.n, reason: 'gagal' }); return; }
      const pos = /(top\s*-?up|isi\s*saldo|diterima|terima\s+dari|menerima|refund|pengembalian|dikembalikan|gaji|masuk|bonus|hadiah|bunga)/i.test(desc);
      const neg = a.neg || (!a.plus && (docMinus ? !pos : !pos && /(bayar|ditransfer|transfer ke|tarik|beli|pembayaran|tagihan)/i.test(desc)));
      const key = a.date + '|' + desc.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) + '|' + a.n; seen[key] = (seen[key] || 0) + 1;
      rows.push({ date: a.date, time: '', desc: desc || 'Transaksi', sub: sub.map((f) => f.text).join(' '), txId: 'layar:' + key + '#' + seen[key], method: '', neg, rp: true, amt: a.n, noDesc: !desc, hint: desc ? '' : 'Keterangan tidak terbaca; baris mungkin terpotong di tepi tangkapan layar. Periksa jenis dan nominalnya.' });
    });
    const all = words.map((w) => w.text).join(' ');
    const provider = /gopay/i.test(all) ? 'GoPay' : /\bovo\b/i.test(all) ? 'OVO' : /shopeepay/i.test(all) ? 'ShopeePay' : /\bdana\b/i.test(all) ? 'Dana' : null;
    // nama tujuan yang berulang: kemungkinan rekening sendiri
    const names = {}; rows.forEach((r) => { const m = /(?:ditransfer|transfer|kirim)\s+ke\s+(.+)/i.exec(r.desc); if (m) { const k = m[1].toLowerCase(); names[k] = (names[k] || 0) + 1; } });
    rows.forEach((r) => { const m = /(?:ditransfer|transfer|kirim)\s+ke\s+(.+)/i.exec(r.desc); if (m && names[m[1].toLowerCase()] >= 3) r.hint = `Nama ini muncul ${names[m[1].toLowerCase()]} kali. Jika ini rekening Anda sendiri, pilih "Pindah dana".`; });
    return { rows, header: { months: Object.fromEntries(Object.entries(monthSums).map(([k, v]) => [k, { in: v.in ? v.in.n : null, out: v.out ? v.out.n : null, tolIn: v.in ? v.in.tol : 0, tolOut: v.out ? v.out.tol : 0 }])), in: sums.in ? sums.in.n : null, out: sums.out ? sums.out.n : null, tolIn: sums.in ? sums.in.tol : 0, tolOut: sums.out ? sums.out.tol : 0, coinsUsed: null }, owner: '', provider, source: 'layar', skipped };
  }

  return { shortRp, headerSums, lev, detectBrand, findDate, amountsOf, pickTotal, analyzeReceipt, parseAppList, groupLines, BRANDS };
});
