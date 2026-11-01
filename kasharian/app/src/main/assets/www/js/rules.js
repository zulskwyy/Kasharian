/* KasHarian rules: pure logic, no DOM. Port of FinanceRules.kt (Android) with fixes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KHRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_AMOUNT = 10000000000;

  // ---------- date helpers (ISO strings YYYY-MM-DD, no timezone surprises) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const parts = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  function validDate(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && y >= 1900 && y <= 2200)) return false;
    return d <= daysInMonth(y, m);
  }
  function addDays(s, n) {
    const { y, m, d } = parts(s);
    const dt = new Date(y, m - 1, d + n);
    return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  function daysBetween(a, b) {
    const pa = parts(a), pb = parts(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }
  function todayISO() { const t = new Date(); return iso(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
  const monthOf = (s) => s.slice(0, 7);
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }
  const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  function formatDate(s) { const { y, m, d } = parts(s); return `${d} ${MONTHS_ID[m - 1]} ${y}`; }
  function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}`; }

  // ---------- money formatting ----------
  function group(n) { return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function rupiah(v) { return (v < 0 ? '-Rp ' : 'Rp ') + group(v); }
  function short(v) {
    const a = Math.abs(v);
    const t = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    const sign = v < 0 ? '-' : '';
    if (a >= 1e9) return `${sign}${t(a / 1e9)} M`;
    if (a >= 1e6) return `${sign}${t(a / 1e6)} jt`;
    if (a >= 1e3) return `${sign}${t(a / 1e3)} rb`;
    return String(v);
  }

  // ---------- categories ----------
  const CAT = {
    expense: ['Makan dan minum', 'Transportasi', 'Belanja', 'Tagihan dan utilitas', 'Cicilan dan utang', 'Kesehatan', 'Pendidikan', 'Keluarga', 'Donasi dan sedekah', 'Hiburan', 'Potongan gaji', 'Tabungan dan investasi', 'Lainnya'],
    income: ['Gaji', 'Pendapatan harian', 'Freelance dan proyek', 'Uang saku', 'Hadiah', 'Lainnya'],
    hints: {
      'Makan dan minum': 'Makanan, minuman, kopi, dan jajan',
      'Transportasi': 'Bensin, parkir, ojek, tol, dan ongkos',
      'Belanja': 'Barang kebutuhan atau belanja pribadi',
      'Tagihan dan utilitas': 'Listrik, pulsa, internet, dan air',
      'Cicilan dan utang': 'Cicilan barang atau pembayaran utang',
      'Kesehatan': 'Obat, dokter, dan perawatan kesehatan',
      'Pendidikan': 'Biaya sekolah, kursus, dan buku',
      'Keluarga': 'Kebutuhan keluarga atau kiriman uang',
      'Donasi dan sedekah': 'Zakat, infaq, sedekah, dan sumbangan',
      'Hiburan': 'Langganan, tontonan, dan rekreasi',
      'Potongan gaji': 'Potongan yang berasal dari slip gaji',
      'Tabungan dan investasi': 'Menabung, reksadana, emas, dan dana darurat',
      'Gaji': 'Gaji pokok, tunjangan, dan pendapatan bulanan',
      'Pendapatan harian': 'Uang dari kerja harian, misalnya ngojek atau dagang',
      'Freelance dan proyek': 'Bayaran proyek, desain, buzzer, atau jasa',
      'Uang saku': 'Uang saku atau uang pegangan',
      'Hadiah': 'Hadiah, bonus pemberian, atau uang kejutan',
      'Lainnya': 'Pilih ini bila kategori belum tersedia'
    }
  };

  // ---------- money amount parser ----------
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CAND = /(?:rp\.?\s*)?\d+(?:[.,]\d{3})*(?:[.,]\d+)?(?:\s*(?:ribu|rb|juta|jt|k)\b)?/gi;

  function normalizeNumber(source) {
    let s = source.trim().replace(/\s+/g, '');
    if (!s) return null;
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return s.replace(/[.,]/g, '');
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
      const dec = lastDot > lastComma ? '.' : ',';
      const other = dec === '.' ? ',' : '.';
      const tail = s.slice(s.lastIndexOf(dec) + 1);
      if (tail.length === 3) s = s.replace(/[.,]/g, '');          // 1.234,567 -> thousands only
      else s = s.split(other).join('').replace(dec, '.');          // 5.250.000,00 / 5,250,000.00
    } else if (hasComma) {
      const p = s.split(',');
      if (p.length > 2) s = s.replace(/,/g, '');
      else s = (p[1].length === 3 && p[0].length >= 1 && p[0].length <= 3) ? p.join('') : p.join('.');
    } else if (hasDot) {
      const p = s.split('.');
      if (p.length > 2) s = s.replace(/\./g, '');
      else if (p[1].length === 3 && p[0].length >= 1 && p[0].length <= 3) s = p.join('');
    }
    return /^\d+(?:\.\d+)?$/.test(s) ? s : null;
  }

  function convertAmount(numberPart, suffixText) {
    const suffix = (suffixText || '').toLowerCase().trim();
    let mult = 1;
    if (suffix.includes('juta') || suffix.includes('jt')) mult = 1e6;
    else if (suffix.includes('ribu') || suffix.includes('rb') || suffix === 'k') mult = 1e3;
    const clean = normalizeNumber(numberPart);
    if (clean == null) return null;
    const v = Math.round(parseFloat(clean) * mult);
    return Number.isFinite(v) ? v : null;
  }

  const MoneyAmountParser = {
    parse(input) {
      const cands = [];
      CAND.lastIndex = 0;
      let m;
      while ((m = CAND.exec(input)) !== null) {
        if (m[0].length === 0) { CAND.lastIndex++; continue; }
        const raw = m[0].trim();
        const numeric = raw.replace(/^rp\.?\s*/i, '').trim();
        const suffixMatch = /\s*(rb|ribu|k|jt|juta)$/i.exec(numeric);
        const numberPart = suffixMatch ? numeric.slice(0, suffixMatch.index).trim() : numeric;
        const hasMarker = /^rp/i.test(raw) || !!suffixMatch;
        const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(numberPart);
        const digitsOnly = numberPart.replace(/\D/g, '');
        // a decimal tail like ",00" after a grouped number still counts as grouped money
        const groupedDec = /^\d{1,3}(?:[.,]\d{3})+[.,]\d{1,2}$/.test(numberPart);
        if (!(hasMarker || grouped || groupedDec || digitsOnly.length >= 4)) continue;
        const value = convertAmount(numberPart, suffixMatch ? suffixMatch[1] : '');
        if (value == null || value <= 0 || value > MAX_AMOUNT) continue;
        const strength = hasMarker ? 3 : (grouped || groupedDec) ? 2 : 1;
        cands.push({ value, start: m.index, end: m.index + m[0].length, strength });
      }
      if (!cands.length) return { value: null, start: -1, end: -1, confidence: 'UNKNOWN', ambiguous: false };
      const max = Math.max(...cands.map((c) => c.strength));
      const top = cands.filter((c) => c.strength === max);
      if (top.length > 1) return { value: null, start: -1, end: -1, confidence: 'UNKNOWN', ambiguous: true };
      return { value: top[0].value, start: top[0].start, end: top[0].end, confidence: 'RECOGNIZED', ambiguous: false };
    },
    /** All money-like amounts on a line, left to right (used by salary slips). */
    findAll(input) {
      const out = [];
      CAND.lastIndex = 0;
      let m;
      while ((m = CAND.exec(input)) !== null) {
        if (m[0].length === 0) { CAND.lastIndex++; continue; }
        const raw = m[0].trim();
        const numeric = raw.replace(/^rp\.?\s*/i, '').trim();
        const suffixMatch = /\s*(rb|ribu|k|jt|juta)$/i.exec(numeric);
        const numberPart = suffixMatch ? numeric.slice(0, suffixMatch.index).trim() : numeric;
        const hasMarker = /^rp/i.test(raw) || !!suffixMatch;
        const grouped = /^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(numberPart);
        const digitsOnly = numberPart.replace(/\D/g, '');
        if (!(hasMarker || grouped || digitsOnly.length >= 4)) continue;
        const value = convertAmount(numberPart, suffixMatch ? suffixMatch[1] : '');
        if (value == null || value <= 0 || value > MAX_AMOUNT) continue;
        out.push({ value, start: m.index, end: m.index + m[0].length, raw, hasMarker, grouped });
      }
      return out;
    }
  };

  // ---------- free text (daily entry) ----------
  const WORK_DAILY = ['narik angkot', 'narik', 'ngojek', 'dagang', 'jualan', 'ngamen', 'nyupir', 'kuli'];
  const WORK_FREELANCE = ['freelance', 'ngejob', 'buzzer', 'endorse', 'ngonten', 'proyek', 'desain', 'fee', 'honor', 'komisi'];
  const INCOME_WORDS = ['gaji', 'terima', 'dapat', 'masuk', 'bonus', 'uang saku', 'jual', 'tip', 'order'];
  const ALIASES = { mkn: 'makan', byr: 'bayar', tf: 'transfer', trf: 'transfer', bnsn: 'bensin', lstrk: 'listrik', ngopi: 'kopi' };
  const MERCHANTS = [
    ['Mie Gacoan', 'Makan dan minum'], ['Indomaret', 'Belanja'], ['Alfamart', 'Belanja'], ['Starbucks', 'Makan dan minum'],
    ['Netflix', 'Hiburan'], ['Spotify', 'Hiburan'], ['Gojek', 'Transportasi'], ['Grab', 'Transportasi'],
    ['Tokopedia', 'Belanja'], ['Shopee', 'Belanja'], ['KFC', 'Makan dan minum'], ["McDonald's", 'Makan dan minum'],
    ['PLN', 'Tagihan dan utilitas'], ['Telkomsel', 'Tagihan dan utilitas'], ['IndiHome', 'Tagihan dan utilitas'],
    ['Alfamidi', 'Belanja'], ['Lazada', 'Belanja'], ['Smartfren', 'Tagihan dan utilitas'], ['GoTagihan', 'Tagihan dan utilitas'], ['SPBU', 'Transportasi'], ['Pertamina', 'Transportasi'], ['Planet Ban', 'Transportasi'],
    ['Dana', 'Belanja'], ['OVO', 'Belanja'], ['BCA', 'Lainnya']
  ];
  const wholeWord = (text, word) => new RegExp('(?<![\\p{L}])' + esc(word) + '(?![\\p{L}])', 'u').test(text);
  const containsAny = (text, words) => words.some((w) => wholeWord(text, w) || text.includes(w));
  const byLenDesc = (a, b) => b.length - a.length;

  function normalizeText(input) {
    let s = input.toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
    for (const [alias, canon] of Object.entries(ALIASES)) {
      s = s.replace(new RegExp('(?<![\\p{L}])' + esc(alias) + '(?![\\p{L}])', 'gu'), canon);
    }
    return s;
  }

  function parseDate(text, today) {
    if (text.includes('kemarin')) return addDays(today, -1);
    let m = /(\d+)\s+hari lalu/.exec(text);
    if (m) return addDays(today, -parseInt(m[1], 10));
    m = /(?:tgl|tanggal)\s*(\d{1,2})/i.exec(text);
    if (m) {
      const t = parts(today);
      const d = Math.min(Math.max(parseInt(m[1], 10), 1), daysInMonth(t.y, t.m));
      return iso(t.y, t.m, d);
    }
    m = /(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?!\d)/.exec(text);
    if (m) {
      const t = parts(today);
      const d = +m[1], mo = +m[2], y = m[3] ? +m[3] : t.y;
      return validDate(y, mo, d) ? iso(y, mo, d) : today;
    }
    return today;
  }

  function unknownMerchant(original, amount) {
    const before = amount.start >= 0 ? original.slice(0, Math.min(amount.start, original.length)).trim() : original;
    const cleaned = before.replace(/\b(gaji|masuk|dapat|terima|beli|bayar|makan|minum|ngojek|narik|uang|saku|kemarin|hari ini|tgl|tanggal)\b/gi, ' ').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const caps = words.filter((w) => /^\p{Lu}/u.test(w));
    return caps.length ? caps.slice(0, 3).join(' ').slice(0, 60) : null;
  }

  function makeNote(text, amount, work, freelance, merchant) {
    let note = text;
    if (amount.start >= 0 && amount.end <= note.length) note = note.slice(0, amount.start) + note.slice(amount.end);
    const pats = ['hari\\s+ini', 'kemarin', '\\d+\\s+hari\\s+lalu', 'tgl\\s+\\d{1,2}', 'tanggal\\s+\\d{1,2}', '\\d{1,2}/\\d{1,2}(?:/\\d{4})?', 'gaji', 'masuk', 'terima', 'dapat', 'bonus', 'uang\\s+saku'];
    if (work) pats.push(esc(work));
    if (freelance) pats.push(esc(freelance));
    for (const p of pats) note = note.replace(new RegExp('(?<![\\p{L}])(?:' + p + ')(?![\\p{L}])', 'giu'), ' ');
    if (merchant && merchant.trim()) note = note.replace(new RegExp(esc(merchant), 'gi'), ' ');
    note = note.replace(/\b(rp|rb|ribu|jt|juta|k)\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
    return note;
  }

  const FreeTextParser = {
    normalize: normalizeText,
    parse(input, today, memory) {
      today = today || todayISO();
      memory = memory || [];
      const original = (input || '').trim();
      const normalized = normalizeText(original);
      const amount = MoneyAmountParser.parse(normalized);
      const learned = [...memory].sort((a, b) => b.term.length - a.term.length).find((t) => normalized.includes(normalizeText(t.term)));
      const work = [...WORK_DAILY].sort(byLenDesc).find((w) => wholeWord(normalized, w));
      const freelance = [...WORK_FREELANCE].sort(byLenDesc).find((w) => wholeWord(normalized, w));
      const incomeWord = INCOME_WORDS.some((w) => wholeWord(normalized, w));
      const moveIntent = /\b(pindah\s*dana|pindah\s*dompet|antar\s*dompet|transfer\s*antar|top\s*-?up|isi\s*saldo|tarik\s*tunai)\b/.test(normalized);
      const ambiguousTransfer = /\b(transfer|trf|trsf)\b/.test(normalized) && !moveIntent && !/\b(transfer\s*(masuk|dari|keluar|ke)|ditransfer\s*(masuk|dari|keluar|ke)|penerimaan\s*transfer)\b/.test(normalized);
      let kind, kindConfidence;
      if (learned) { kind = learned.kind; kindConfidence = 'RECOGNIZED'; }
      else if (moveIntent) { kind = 'TRANSFER'; kindConfidence = 'GUESSED'; }
      else if (ambiguousTransfer) { kind = 'UNKNOWN'; kindConfidence = 'UNKNOWN'; }
      else if (work || freelance || incomeWord) { kind = 'INCOME'; kindConfidence = 'RECOGNIZED'; }
      else { kind = 'EXPENSE'; kindConfidence = 'GUESSED'; }
      const date = parseDate(normalized, today);
      const mp = [...MERCHANTS].sort((a, b) => b[0].length - a[0].length).find((p) => wholeWord(normalized, p[0].toLowerCase()));
      let category;
      if (learned) category = learned.category;
      else if (kind === 'TRANSFER') category = 'Pindah dompet';
      else if (kind === 'UNKNOWN') category = 'Belum pasti';
      else if (kind === 'INCOME' && wholeWord(normalized, 'gaji')) category = 'Gaji';
      else if (work) category = 'Pendapatan harian';
      else if (freelance) category = 'Freelance dan proyek';
      else if (mp) category = mp[1];
      else if (containsAny(normalized, ['nabung', 'menabung', 'tabungan', 'investasi', 'reksadana', 'reksa dana', 'saham', 'deposito', 'dana darurat'])) category = 'Tabungan dan investasi';
      else if (containsAny(normalized, ['makan', 'kopi', 'bakso', 'nasi', 'mie', 'soto', 'ayam', 'roti', 'minum', 'jajan', 'kebab', 'warung', 'resto', 'restoran', 'cafe', 'kantin', 'geprek', 'burger', 'martabak', 'bubur', 'seblak'])) category = 'Makan dan minum';
      else if (containsAny(normalized, ['bensin', 'parkir', 'ojek', 'tol', 'angkot', 'grab', 'gojek', 'spbu', 'pertamax', 'stasiun', 'kereta', 'bengkel', 'busway', 'transjakarta'])) category = 'Transportasi';
      else if (containsAny(normalized, ['listrik', 'pulsa', 'wifi', 'token', 'pln', 'air', 'paket data', 'internet', 'bpjs'])) category = 'Tagihan dan utilitas';
      else if (containsAny(normalized, ['zakat', 'infaq', 'sedekah', 'laznas', 'yatim', 'donasi', 'masjid', 'panti'])) category = 'Donasi dan sedekah';
      else if (containsAny(normalized, ['cicilan', 'utang', 'angsuran', 'pinjaman'])) category = 'Cicilan dan utang';
      else if (containsAny(normalized, ['netflix', 'spotify', 'bioskop', 'game', 'streaming'])) category = 'Hiburan';
      else if (containsAny(normalized, ['obat', 'dokter', 'klinik', 'rumah sakit'])) category = 'Kesehatan';
      else if (containsAny(normalized, ['belanja', 'indomaret', 'alfamart', 'shopee', 'tokopedia'])) category = 'Belanja';
      else category = 'Belum pasti';
      const categoryConfidence = category === 'Belum pasti' ? 'UNKNOWN' : (learned || mp || kind === 'TRANSFER') ? 'RECOGNIZED' : 'GUESSED';
      const merchant = (learned && learned.merchant) || (mp && mp[0]) || unknownMerchant(original, amount);
      const note = makeNote(normalized, amount, work, freelance, merchant);
      let message = null;
      if (!original) message = 'Tulis contoh: makan siang 25rb';
      else if (amount.ambiguous) message = 'Nominal belum jelas. Isi nominal yang benar sebelum menyimpan.';
      else if (amount.value == null) message = 'Nominal belum terbaca, mohon isi';
      else if (category === 'Belum pasti') message = 'Kategori belum pasti. Pilih kategori sebelum menyimpan.';
      return { raw: original, amount: amount.value, kind, category, merchant, note, date, amountConfidence: amount.confidence, kindConfidence, categoryConfidence, message };
    }
  };

  // ---------- wallet story ("uang tunai 300rb, di BCA 2jt") ----------
  const WALLET_NAMES = [
    [/\b(tunai|uang tunai|cash|dompet|celengan)\b/i, 'Tunai', 'CASH'], [/\bbca\b/i, 'BCA', 'BANK'], [/\bbni\b/i, 'BNI', 'BANK'],
    [/\bbri\b/i, 'BRI', 'BANK'], [/\bmandiri\b/i, 'Mandiri', 'BANK'], [/\bjago\b/i, 'Jago', 'BANK'], [/\bseabank\b/i, 'SeaBank', 'BANK'],
    [/\bdana\b/i, 'DANA', 'EWALLET'], [/\bovo\b/i, 'OVO', 'EWALLET'], [/\bgopay\b/i, 'GoPay', 'EWALLET'],
    [/\bshopeepay\b/i, 'ShopeePay', 'EWALLET'], [/\blinkaja\b/i, 'LinkAja', 'EWALLET'], [/\b(tabungan|rekening|bank)\b/i, 'Rekening', 'BANK']
  ];
  function splitStory(story) {
    const safe = story.replace(/(?<=\d),(?=\d{1,2}\s*(?:jt|juta))/gi, '\u00a7');
    return safe.split(/[;\n,&]|\bdan\b/i).map((s) => s.replace(/\u00a7/g, ',').trim()).filter(Boolean);
  }
  const WalletStoryParser = {
    parse(story) {
      if (!story || !story.trim()) return [];
      const out = [];
      for (const seg of splitStory(story)) {
        const amount = MoneyAmountParser.parse(seg).value;
        if (amount == null) continue;
        const hit = WALLET_NAMES.find((w) => w[0].test(seg));
        out.push({ name: hit ? hit[1] : 'Uang Saya', type: hit ? hit[2] : 'OTHER', amount });
      }
      return out;
    }
  };

  // ---------- bill story ----------
  const MONTH_NUM = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agustus: 8, sep: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, des: 12, desember: 12 };
  const BillStoryParser = {
    parse(story, today) {
      today = today || todayISO();
      if (!story || !story.trim()) return [];
      return splitStory(story).map((seg) => BillStoryParser.parseOne(seg, today));
    },
    parseOne(segment, today) {
      const t = parts(today);
      const amountInfo = MoneyAmountParser.parse(segment);
      const lower = segment.toLowerCase();
      const dayM = /(?:tgl|tanggal|tiap tanggal)\s*(\d{1,2})/i.exec(segment);
      const day = dayM ? parseInt(dayM[1], 10) : null;
      const clampDay = (y, m, d) => Math.min(Math.max(d, 1), daysInMonth(y, m));
      let due;
      let m;
      if (lower.includes('besok')) due = addDays(today, 1);
      else if (lower.includes('lusa')) due = addDays(today, 2);
      else if (lower.includes('minggu depan')) due = addDays(today, 7);
      else if (lower.includes('akhir bulan')) due = iso(t.y, t.m, daysInMonth(t.y, t.m));
      else if ((m = /jatuh tempo\s*(\d{1,2})\s+([a-z]+)/i.exec(segment))) {
        const mo = MONTH_NUM[m[2].toLowerCase()] || t.m;
        due = iso(t.y, mo, Math.min(parseInt(m[1], 10), daysInMonth(t.y, mo)));
      } else if ((m = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/.exec(segment))) {
        due = validDate(t.y, +m[2], +m[1]) ? iso(t.y, +m[2], +m[1]) : today;
      } else if (day != null) due = iso(t.y, t.m, clampDay(t.y, t.m, day));
      else due = today;
      const recurring = /tiap bulan|setiap bulan|bulanan|monthly|tiap tanggal/.test(lower);
      if (day != null && due < today) {
        const nx = addMonths(monthOf(today), 1).split('-').map(Number);
        due = iso(nx[0], nx[1], clampDay(nx[0], nx[1], day));
      }
      const rm = /ingatkan\s+(\d+)\s+hari sebelumnya/i.exec(segment);
      const reminderDays = rm ? [parseInt(rm[1], 10), 0] : [7, 3, 1, 0];
      let name = segment
        .replace(/jatuh tempo\s*\d{1,2}\s+[a-z]+|(?:tiap|setiap)\s+bulan|bulanan|monthly|tiap\s+tanggal\s+\d{1,2}|(?:tgl|tanggal)\s*\d{1,2}|ingatkan\s+\d+\s+hari sebelumnya|minggu depan|besok|lusa|akhir bulan|\d{1,2}\/\d{1,2}/gi, ' ')
        .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:ribu|rb|juta|jt|k)?\b/gi, ' ')
        .replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
      let category;
      if (/listrik|wifi|pulsa|internet|pajak|\bair\b/.test(lower)) category = 'Tagihan dan utilitas';
      else if (/cicilan|motor|utang/.test(lower)) category = 'Cicilan dan utang';
      else category = 'Belum pasti';
      return {
        name: name || 'Tagihan baru', amount: amountInfo.value, dueOn: due,
        recurrence: recurring ? 'MONTHLY' : 'NONE', reminderDays, category,
        confidence: day != null && !recurring ? 'GUESSED' : amountInfo.value != null ? 'RECOGNIZED' : 'UNKNOWN', raw: segment
      };
    },
    sentence(bill, today) {
      today = today || todayISO();
      const left = daysBetween(today, bill.dueOn);
      const when = left < 0 ? `terlambat ${-left} hari` : left === 0 ? 'hari ini' : `${left} hari lagi`;
      const rec = bill.recurrence === 'MONTHLY' ? 'berulang tiap bulan' : 'sekali bayar';
      return `${bill.name} ${rupiah(bill.amount)}, jatuh tempo ${formatDate(bill.dueOn)} (${when}), ${rec}.`;
    }
  };

  // ---------- salary slip math ----------
  const sum = (rows) => rows.reduce((a, r) => a + r.amount, 0);
  const SlipMath = {
    totals(rows) {
      const gross = sum(rows.filter((r) => r.type === 'EARNING'));
      const deductions = sum(rows.filter((r) => r.type === 'DEDUCTION'));
      return { gross, deductions, net: gross - deductions };
    },
    /** Gross income + one expense per deduction, or net only. Never both (no double counting). */
    posting(rows, mode) {
      const t = SlipMath.totals(rows);
      if (mode === 'NET_ONLY') return { income: t.net, deductionExpenses: [] };
      return { income: t.gross, deductionExpenses: rows.filter((r) => r.type === 'DEDUCTION') };
    }
  };

  // ---------- balances and summaries ----------
  const ACTIVITY_TYPE_ALIASES = {
    IN: 'INCOME', MASUK: 'INCOME', PEMASUKAN: 'INCOME', INCOMING: 'INCOME', CREDIT: 'INCOME', DEPOSIT: 'INCOME',
    OUT: 'EXPENSE', KELUAR: 'EXPENSE', PENGELUARAN: 'EXPENSE', OUTGOING: 'EXPENSE', SPEND: 'EXPENSE', SPENDING: 'EXPENSE', DEBIT: 'EXPENSE', PAYMENT: 'EXPENSE',
    MOVE: 'TRANSFER', PINDAH: 'TRANSFER', PINDAH_DANA: 'TRANSFER', INTERNAL_TRANSFER: 'TRANSFER'
  };
  const activityType = (a) => {
    const t = String((a && (a.type || a.kind)) || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return ACTIVITY_TYPE_ALIASES[t] || t;
  };
  /** Read both numeric values and legacy rupiah strings without treating `25.000` as 25. */
  function ledgerAmountValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value == null) return 0;
    let s = String(value).trim().replace(/^(?:rp\.?|idr)\s*/i, '').replace(/\s/g, '');
    if (!s) return 0;
    const negative = /^-/.test(s) || /\(.*\)/.test(s);
    s = s.replace(/[()\-+]/g, '').replace(/[^0-9.,]/g, '');
    if (!s || !/\d/.test(s)) return 0;
    const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) {
      const decimal = dot > comma ? '.' : ',';
      const thousands = decimal === '.' ? ',' : '.';
      const tail = s.slice(s.lastIndexOf(decimal) + 1);
      s = tail.length === 3 ? s.replace(/[.,]/g, '') : s.split(thousands).join('').replace(decimal, '.');
    } else if (dot >= 0 || comma >= 0) {
      const sep = dot >= 0 ? '.' : ',', parts = s.split(sep);
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = parts.join('');
      else if (parts.length === 2) s = parts[0] + '.' + parts[1];
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    const integer = Math.round(Math.abs(n));
    return negative ? -integer : integer;
  }
  const ledgerMagnitude = (a) => Math.abs(ledgerAmountValue(a && a.amount));
  /** Canonical ledger record: direction is encoded only by type, never by the amount sign. */
  function normalizeActivity(a) {
    if (!a || typeof a !== 'object') return a;
    const type = activityType(a), raw = ledgerAmountValue(a.amount);
    const amount = type === 'ADJUSTMENT' ? raw : Math.abs(raw);
    return Object.assign({}, a, { type, amount });
  }
  const BalanceEngine = {
    normalizeActivity,
    balances(wallets, acts) {
      const res = {};
      wallets.forEach((w) => { res[w.id] = ledgerAmountValue(w.openingBalance); });
      for (const source of acts || []) {
        if (!source || source.deletedAt) continue;
        const a = normalizeActivity(source), type = a.type, amount = ledgerMagnitude(a), wid = a.walletId;
        if (!wid) continue;
        if (type === 'INCOME') res[wid] = (res[wid] || 0) + amount;
        else if (type === 'EXPENSE') res[wid] = (res[wid] || 0) - amount;
        else if (type === 'ADJUSTMENT') res[wid] = (res[wid] || 0) + ledgerAmountValue(a.amount);
        else if (type === 'TRANSFER') {
          // A transfer must have two distinct wallets. An incomplete transfer must never alter any balance.
          if (!a.toWalletId || a.toWalletId === wid) continue;
          res[wid] = (res[wid] || 0) - amount;
          res[a.toWalletId] = (res[a.toWalletId] || 0) + amount;
        }
      }
      return res;
    },
    total(wallets, acts) {
      const b = BalanceEngine.balances(wallets, acts);
      return wallets.filter((w) => w.includeInTotal !== false && !w.archived).reduce((s, w) => s + (b[w.id] || 0), 0);
    }
  };

  const SummaryEngine = {
    month(acts, ym) {
      const rec = acts.filter((a) => !a.deletedAt && monthOf(a.occurredOn) === ym).map(normalizeActivity).filter((a) => a.type === 'INCOME' || a.type === 'EXPENSE');
      const income = rec.filter((a) => a.type === 'INCOME').reduce((n, a) => n + ledgerMagnitude(a), 0);
      const exp = rec.filter((a) => a.type === 'EXPENSE');
      const expense = exp.reduce((n, a) => n + ledgerMagnitude(a), 0);
      const byCat = {};
      exp.forEach((a) => { byCat[a.category] = (byCat[a.category] || 0) + ledgerMagnitude(a); });
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
      return { income, expense, difference: income - expense, biggestCategory: top ? top[0] : null, biggestExpense: exp.reduce((m, a) => Math.max(m, ledgerMagnitude(a)), 0) };
    },
    /** Category shares exclude payroll deductions (they are not spending choices); month totals include them. */
    categoryBreakdown(acts, ym) {
      const prevYm = addMonths(ym, -1);
      const pick = (m) => {
        const r = {};
        acts.filter((a) => !a.deletedAt && activityType(a) === 'EXPENSE' && a.category !== 'Potongan gaji' && monthOf(a.occurredOn) === m)
          .forEach((a) => { r[a.category] = (r[a.category] || 0) + ledgerMagnitude(a); });
        return r;
      };
      const cur = pick(ym), prev = pick(prevYm);
      const total = Object.values(cur).reduce((a, b) => a + b, 0);
      return Object.entries(cur).sort((a, b) => b[1] - a[1]).map(([category, amount]) => {
        const old = prev[category] || 0;
        const share = total > 0 ? Math.floor((amount * 100) / total) : 0;
        const growth = old > 0 && amount - old >= 100000 && amount >= old * 1.25 ? Math.floor(((amount - old) * 100) / old) : null;
        return { category, amount, sharePercent: share, previousAmount: old, growthPercent: growth, isBig: share >= 30 || growth != null };
      });
    }
  };


  // ---------- selaraskan saldo: selisih dengan saldo nyata ----------
  const Reconcile = {
    /** diff = saldo nyata - saldo aplikasi. Kurang: uang sudah keluar tetapi belum tercatat, jadi dicatat sebagai pengeluaran.
     *  Lebih: penyesuaian saja (bukan pemasukan, supaya pemasukan tidak menggelembung). */
    record(diff, walletId, today, now) {
      const d = Math.round(Number(diff) || 0);
      if (!d) return null;
      const base = { walletId, toWalletId: null, occurredOn: today, sourceId: null, createdAt: now, updatedAt: now, deletedAt: null };
      if (d < 0) return Object.assign(base, { type: 'EXPENSE', amount: -d, category: 'Lainnya', merchant: 'Selisih saldo', note: 'Pengeluaran belum tercatat (selisih dengan saldo nyata)', source: 'selisih' });
      return Object.assign(base, { type: 'ADJUSTMENT', amount: d, category: 'Penyesuaian', merchant: null, note: 'Penyesuaian saldo', source: 'penyesuaian' });
    }
  };

  // ---------- profile and friendly reminders ----------
  const GREETINGS = ['', 'Kak', 'Bang', 'Mas', 'Mbak', 'Pak', 'Bu', 'Bro', 'Sis'];
  const TONES = { akrab: 'Akrab', santai: 'Santai', sopan: 'Sopan' };
  const Profile = {
    normalizeUsername(u) { return String(u || '').trim().replace(/^@+/, '').toLowerCase(); },
    validate(p) {
      const errors = {};
      const name = String((p && p.name) || '').replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 24 || !/\p{L}/u.test(name)) errors.name = 'Nama panggilan 2 sampai 24 huruf.';
      const u = Profile.normalizeUsername(p && p.username);
      if (!/^[a-z0-9._]{3,20}$/.test(u) || /^[.]|[.]$/.test(u)) errors.username = 'Username 3 sampai 20 karakter: huruf kecil, angka, titik, atau garis bawah.';
      return errors;
    }
  };
  const Reminder = {
    GREETINGS, TONES,
    salutation(p) { const n = String((p && p.name) || '').trim() || 'Teman'; const g = String((p && p.greeting) || '').trim(); return g ? g + ' ' + n : n; },
    daypart(hour) { return hour >= 4 && hour < 11 ? 'pagi' : hour >= 11 && hour < 15 ? 'siang' : hour >= 15 && hour < 18 ? 'sore' : 'malam'; },
    greetingLine(p, hour) { return 'Selamat ' + Reminder.daypart(hour) + ', ' + Reminder.salutation(p); },
    /** Title and text of a bill reminder. daysLeft < 0 means overdue. Runs on the device, so it works offline. */
    billMessage(p, bill, daysLeft, hour) {
      const sal = Reminder.salutation(p), rp = rupiah(bill.amount), nm = bill.name, tone = (p && p.tone) || 'akrab';
      const dp = Reminder.daypart(hour == null ? 9 : hour), late = -daysLeft;
      if (tone === 'sopan') {
        const title = 'Selamat ' + dp + ', ' + sal;
        if (daysLeft < 0) return { title, body: `Tagihan ${nm} sebesar ${rp} telah melewati jatuh tempo ${late} hari. Mohon segera diselesaikan.` };
        if (daysLeft === 0) return { title, body: `Tagihan ${nm} sebesar ${rp} jatuh tempo hari ini.` };
        if (daysLeft === 1) return { title, body: `Tagihan ${nm} sebesar ${rp} jatuh tempo besok.` };
        return { title, body: `Tagihan ${nm} sebesar ${rp} akan jatuh tempo ${daysLeft} hari lagi.` };
      }
      if (tone === 'santai') {
        if (daysLeft < 0) return { title: nm, body: `${sal}, ${nm} ${rp} telat ${late} hari.` };
        if (daysLeft === 0) return { title: nm, body: `${sal}, ${nm} ${rp} jatuh tempo hari ini.` };
        if (daysLeft === 1) return { title: nm, body: `${sal}, ${nm} ${rp} jatuh tempo besok.` };
        return { title: nm, body: `${sal}, ${nm} ${rp} jatuh tempo ${daysLeft} hari lagi.` };
      }
      if (daysLeft < 0) return { title: `Hai ${sal}, ada yang kelewat`, body: `${nm} ${rp} sudah lewat ${late} hari. Yuk dibereskan sekarang, biar tenang.` };
      if (daysLeft === 0) return { title: `Hai ${sal}!`, body: `Hari ini ${nm} ${rp} jatuh tempo. Jangan lupa dibayar ya.` };
      if (daysLeft === 1) return { title: `Halo ${sal}`, body: `Besok ${nm} ${rp} jatuh tempo. Siapkan uangnya ya.` };
      return { title: `Halo ${sal}`, body: `${daysLeft} hari lagi ${nm} ${rp} jatuh tempo. Masih aman, cuma mengingatkan.` };
    }
  };

  function validateAmount(n) {
    if (!Number.isFinite(n) || n <= 0) return 'Nominal harus lebih dari Rp 0.';
    if (n > MAX_AMOUNT) return 'Nominal maksimal Rp 10.000.000.000.';
    return null;
  }

  return {
    MAX_AMOUNT, CAT, Profile, Reminder, MoneyAmountParser, FreeTextParser, WalletStoryParser, BillStoryParser, SlipMath, BalanceEngine, SummaryEngine, Reconcile, normalizeActivity, activityType, ledgerAmountValue,
    rupiah, short, formatDate, monthLabel, todayISO, addDays, addMonths, daysBetween, monthOf, validDate, daysInMonth, iso, parts, validateAmount
  };
});
