/* KasHarian salary-slip reader. Pure logic: takes OCR / PDF words (with positions) or plain text and returns
   rows, printed totals, and a net-salary determination that is cross-checked against the rows. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.KHSlip = factory(root.KHRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';
  const { MoneyAmountParser, SlipMath } = R;

  // ---------- dictionaries ----------
  const RE = {
    // totals
    dedTotal: /(total|jumlah|sub\s*total)\s*(potongan|pot\b|deduction|pengurangan)|potongan\s*total|total\s*pot\b/,
    netStrong: /take\s*-?\s*home|\bthp\b|gaji\s*bersih|penerimaan\s*bersih|pendapatan\s*bersih|penghasilan\s*bersih|net\s*(pay|salary|income|take)|\bnett?o?\b|gaji\s*diterima|jumlah\s*diterima|total\s*diterima|yang\s*diterima|dibayarkan|total\s*pembayaran|jumlah\s*dibayar|\bbersih\b/,
    netWeak: /\bditerima\b|penerimaan\s*karyawan|grand\s*total/,
    grossTotal: /(total|jumlah|sub\s*total)\s*(pendapatan|penghasilan|penerimaan|gaji|earning|income|tunjangan)|gaji\s*kotor|\bgross\b|penghasilan\s*bruto|\bbruto\b/,
    bareTotal: /^(total|jumlah|sub\s*total|subtotal)$/,
    // headings
    earnHead: /^(pendapatan|penghasilan|earnings?|income|komponen\s*(gaji|pendapatan)|gaji\s*dan\s*tunjangan|rincian\s*pendapatan)\b/,
    dedHead: /^(potongan|deductions?|pengurangan|komponen\s*potongan|rincian\s*potongan)\b/,
    infoHead: /^(informasi|keterangan|kontribusi\s*perusahaan|iuran\s*perusahaan|employer|benefit|lain\s*-?\s*lain)\b/,
    // not money rows
    skipLabel: /\b(nik|npwp|nip|no\.?\s*(karyawan|rek|rekening|slip)|nomor|rekening|rek\.?|periode|tahun|npp|kode|id\s*karyawan|tanggal|tgl|jam\s*kerja|hari\s*kerja|masa\s*kerja|cuti|sisa|ytd|kumulatif|s\/d)\b/,
    info: /perusahaan|ditanggung|employer|company|beban\s*perusahaan|dibayar\s*(oleh\s*)?perusahaan/,
    infoExact: /^(bpjs\s*)?(jkk|jkm)\b/,
    dedStrong: /potongan|\bpot\b|\bpph\b|pph\s*-?\s*21|pph21|pajak|kasbon|pinjaman|cicilan|angsuran|koperasi|denda|terlambat|\balpa\b|\balpha\b|absen|iuran|\bjht\b|jaminan\s*(hari\s*tua|pensiun)|\bjp\b|bpjs|\btk\b|asuransi|zakat|arisan|simpanan|dana\s*pensiun|dplk|\bpotong/,
    earnStrong: /gaji|basic|tunjangan|uang\s*(makan|transport|lembur|shift|kehadiran|hadir|bensin|pulsa)|transport|lembur|overtime|bonus|\bthr\b|insentif|incentive|komisi|rapel|honor|upah|allowance|shift|premi\s*hadir|kehadiran|reimburs|penggantian|pendapatan\s*lain|bantuan|subsidi|fasilitas/
  };

  // ---------- lines ----------
  function fixNumericToken(tok) {
    // OCR confusions inside numeric-looking tokens: 5.250.OOO -> 5.250.000
    if (/^[\dOoIl.,]{4,}$/.test(tok) && (tok.match(/\d/g) || []).length >= 2 && /[.,]/.test(tok)) {
      return tok.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
    }
    return tok;
  }
  const LEADER = /^[._\-=:|~…·•*]+$/;

  /** Estimate page skew (slope dy/dx) with a projection profile: the right slope makes text rows pile up in sharp bands. */
  function estimateSlope(ws, medH) {
    const bw = Math.max(2, medH * 0.5);
    const score = (s) => {
      const bins = new Map();
      for (const w of ws) { const k = Math.round((w.yc - s * ((w.x0 + w.x1) / 2)) / bw); bins.set(k, (bins.get(k) || 0) + (w.x1 - w.x0)); }
      let sc = 0; for (const v of bins.values()) sc += v * v;
      return sc;
    };
    let best = 0, bestSc = score(0);
    for (let s = -0.12; s <= 0.1201; s += 0.004) { const sc = score(s); if (sc > bestSc * 1.0001) { bestSc = sc; best = s; } }
    for (let s = best - 0.004; s <= best + 0.0041; s += 0.0005) { const sc = score(s); if (sc > bestSc) { bestSc = sc; best = s; } }
    return best;
  }

  /** words: [{text,x0,x1,y0,y1}] -> visual rows (top to bottom, words left to right). Handles slightly rotated photos. */
  function linesFromWords(words) {
    const ws = words.filter((w) => w.text && w.text.trim()).map((w) => ({ ...w, text: w.text.trim(), yc: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));
    if (!ws.length) return [];
    const hs = ws.map((w) => w.h).sort((a, b) => a - b);
    const medH = hs[Math.floor(hs.length / 2)];
    const slope = ws.length >= 8 ? estimateSlope(ws, medH) : 0;
    ws.forEach((w) => { w.yc = w.yc - slope * ((w.x0 + w.x1) / 2); });
    ws.sort((a, b) => a.yc - b.yc);
    const lines = [];
    for (const w of ws) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(w.yc - last.yc) <= medH * 0.6) { last.ws.push(w); last.yc = (last.yc * (last.ws.length - 1) + w.yc) / last.ws.length; }
      else lines.push({ ws: [w], yc: w.yc });
    }
    return lines.map((l) => buildLine(l.ws.sort((a, b) => a.x0 - b.x0).map((w) => ({ t: w.text, x0: w.x0, x1: w.x1 })), l.yc));
  }
  function buildLine(words, y) {
    const kept = words.filter((w) => !LEADER.test(w.t)).map((w) => ({ ...w, t: fixNumericToken(w.t) }));
    const offs = []; let text = '';
    kept.forEach((w, i) => { if (i) text += ' '; offs.push(text.length); text += w.t; });
    return { text, words: kept, offs, y: y || 0 };
  }
  /** Plain text fallback. Merges a label-only line with a following amount-only line. */
  function linesFromText(text) {
    const raw = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      const next = raw[i + 1];
      const curHasAmt = MoneyAmountParser.findAll(cur).length > 0;
      const nextOnlyAmt = next && /^(rp\.?\s*)?[\d.,\s]+$/i.test(next) && MoneyAmountParser.findAll(next).length > 0;
      if (!curHasAmt && nextOnlyAmt && /[A-Za-z]{3}/.test(cur)) { out.push(buildLine([{ t: `${cur} ${next}`, x0: 0, x1: 0 }])); i++; }
      else out.push(buildLine(cur.split(' ').map((t) => ({ t, x0: 0, x1: 0 }))));
    }
    // plain text has no coordinates
    out.forEach((l) => { l.words = []; l.offs = []; });
    return out;
  }

  // ---------- classification ----------
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%\s./-]/g, ' ').replace(/\s+/g, ' ').trim();

  function classifyLabel(label) {
    const l = norm(label);
    if (RE.info.test(l) || RE.infoExact.test(l)) return { type: 'INFO', strong: true };
    if (/^tunjangan/.test(l)) return { type: 'EARNING', strong: true };
    if (RE.dedStrong.test(l)) return { type: 'DEDUCTION', strong: true };
    if (RE.earnStrong.test(l)) return { type: 'EARNING', strong: true };
    return { type: 'UNCLASSIFIED', strong: false };
  }

  function totalKind(label) {
    const l = norm(label);
    if (!l) return null;
    if (RE.dedTotal.test(l)) return { kind: 'deductions', priority: 3 };
    if (RE.netStrong.test(l)) return { kind: 'net', priority: /take\s*-?\s*home|\bthp\b|gaji\s*bersih|net\s*(pay|salary)/.test(l) ? 3 : 2 };
    if (RE.grossTotal.test(l)) return { kind: 'gross', priority: 3 };
    if (RE.netWeak.test(l)) return { kind: 'net', priority: 1 };
    if (RE.bareTotal.test(l)) return { kind: 'bare', priority: 1 };
    return null;
  }

  function cleanLabel(s) {
    return s.replace(/\b\d+([.,]\d+)?\s*%/g, ' ').replace(/^[\s.,:;|=\-_/\\()[\]*]+|[\s.,:;|=\-_/\\()[\]*]+$/g, '').replace(/\s+/g, ' ').replace(/\brp\.?$/i, '').trim();
  }

  function moneyTokens(text) {
    return MoneyAmountParser.findAll(text).filter((a) => {
      const digits = a.raw.replace(/\D/g, '');
      if (!a.hasMarker && !a.grouped && /^\d+$/.test(a.raw.replace(/^rp\.?\s*/i, '')) && (digits.length < 5 || digits.length > 9)) return false; // years, NIK, accounts
      return true;
    });
  }

  function xOfOffset(line, off) {
    if (!line.words.length) return null;
    let idx = 0;
    for (let i = 0; i < line.offs.length; i++) if (line.offs[i] <= off) idx = i;
    return line.words[idx].x0;
  }

  // ---------- main reader ----------
  function read(lines) {
    const rows = [];
    const totals = { gross: [], deductions: [], net: [] };
    let section = null, sectionSource = null, columns = null;
    let period = null, employer = null;

    lines.forEach((line, li) => {
      const text = line.text;
      const ntext = norm(text);
      if (!period) {
        const m = /(?:periode|bulan|period)\s*[:\-]?\s*([a-z]+)\s*(20\d{2})/i.exec(text);
        if (m) {
          const mn = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 }[m[1].slice(0, 3).toLowerCase()];
          if (mn) period = `${m[2]}-${String(mn).padStart(2, '0')}`;
        }
      }
      if (!employer) { const m = /\b((?:PT|CV)\.?\s+[A-Z][A-Za-z0-9 .&-]{2,40})/.exec(text); if (m) employer = m[1].trim(); }

      const amts = moneyTokens(text);

      // headings (no amounts)
      if (!amts.length) {
        const hasE = RE.earnHead.test(ntext) || /(^|\s)(pendapatan|penghasilan|earnings?)(\s|$)/.test(ntext);
        const hasD = RE.dedHead.test(ntext) || /(^|\s)(potongan|deductions?|pengurangan)(\s|$)/.test(ntext);
        if (hasE && hasD && line.words.length) {
          const ex = line.words.find((w) => /^(pendapatan|penghasilan|earnings?)/i.test(w.t));
          const dx = line.words.find((w) => /^(potongan|deductions?|pengurangan)/i.test(w.t));
          if (ex && dx && dx.x0 > ex.x0) { columns = { split: (ex.x0 + dx.x0) / 2 }; section = null; sectionSource = 'cols'; }
        } else if (ntext.split(' ').length <= 6) {
          if (RE.dedHead.test(ntext)) { section = 'DEDUCTION'; sectionSource = 'seq'; columns = null; }
          else if (RE.earnHead.test(ntext)) { section = 'EARNING'; sectionSource = 'seq'; columns = null; }
          else if (RE.infoHead.test(ntext)) { section = 'INFO'; sectionSource = 'seq'; columns = null; }
        }
        return;
      }

      // segments: label before each amount
      let prevEnd = 0;
      const segs = amts.map((a, i) => {
        let label = cleanLabel(text.slice(prevEnd, a.start));
        prevEnd = a.end;
        return { label, amount: a.value, start: a.start, labelStart: Math.max(0, a.start - label.length), idx: i, raw: a };
      });
      // amount-first layout: "5.000.000 Gaji Pokok"
      if (segs.length === 1 && !segs[0].label) {
        const trailing = cleanLabel(text.slice(amts[0].end));
        if (/[A-Za-z]{3}/.test(trailing)) segs[0].label = trailing;
      }

      segs.forEach((seg) => {
        const label = seg.label;
        const tk = totalKind(label);
        const segX = xOfOffset(line, seg.labelStart) ?? xOfOffset(line, seg.start);
        const posSection = columns && segX != null ? (segX >= columns.split ? 'DEDUCTION' : 'EARNING') : null;
        if (tk) {
          let kind = tk.kind;
          if (kind === 'bare') kind = (posSection || section) === 'DEDUCTION' ? 'deductions' : (posSection || section) === 'EARNING' ? 'gross' : (segs.length > 1 ? (seg.idx === 0 ? 'gross' : 'deductions') : null);
          if (kind) totals[kind].push({ value: seg.amount, priority: tk.priority, line: li, label });
          if (kind === 'net') { section = null; columns = null; }
          if (kind === 'gross' && !columns) section = null;
          return;
        }
        if (!/[A-Za-z]{2}/.test(label)) return;               // no label: year-to-date column, numbering, noise
        if (RE.skipLabel.test(norm(label))) return;
        const c = classifyLabel(label);
        let type = c.type, weak = !c.strong, source = c.strong ? 'kamus' : 'tebakan';
        const sec = posSection || section;
        if (sec && type !== 'INFO') {
          const trustSection = posSection ? true : !c.strong;
          if (trustSection) { type = sec; weak = false; source = posSection ? 'kolom' : 'bagian'; }
        }
        if (sec === 'INFO' && type === 'UNCLASSIFIED') { type = 'INFO'; weak = false; source = 'bagian'; }
        rows.push({ label, amount: seg.amount, type, weak: type === 'UNCLASSIFIED' ? true : weak, source, line: li });
      });
    });

    const pick = (arr) => arr.length ? arr.slice().sort((a, b) => b.priority - a.priority || b.line - a.line)[0].value : null;
    const printed = { gross: pick(totals.gross), deductions: pick(totals.deductions), net: pick(totals.net), candidates: totals };
    return { rows, printed, period, employer };
  }

  // ---------- reconciliation: determine the net salary and make the rows agree with it ----------
  function solveWeakRows(rows, printed) {
    const target = printed.net;
    if (target == null) return null;
    const idxWeak = rows.map((r, i) => (r.weak ? i : -1)).filter((i) => i >= 0);
    const n = idxWeak.length;
    if (!n || n > 14) return null;
    const fixed = rows.filter((r) => !r.weak);
    const baseG = fixed.filter((r) => r.type === 'EARNING').reduce((s, r) => s + r.amount, 0);
    const baseD = fixed.filter((r) => r.type === 'DEDUCTION').reduce((s, r) => s + r.amount, 0);
    const opts = n <= 9 ? ['EARNING', 'DEDUCTION', 'INFO'] : ['EARNING', 'DEDUCTION'];
    const sols = [];
    const cur = new Array(n);
    (function rec(i, g, d) {
      if (sols.length > 50) return;
      if (i === n) {
        if (g - d === target && (printed.gross == null || g === printed.gross) && (printed.deductions == null || d === printed.deductions)) sols.push(cur.slice());
        return;
      }
      const amt = rows[idxWeak[i]].amount;
      for (const o of opts) { cur[i] = o; rec(i + 1, g + (o === 'EARNING' ? amt : 0), d + (o === 'DEDUCTION' ? amt : 0)); }
    })(0, baseG, baseD);
    if (!sols.length) return null;
    // Prefer the dictionary/column guess, avoid INFO, and use Indonesian payroll
    // vocabulary as a semantic tie-breaker. Even when two solutions reconcile to
    // the same net salary, return one deterministic best-fit assignment so the
    // review form is prefilled instead of forcing a manual choice.
    const earningWords = /gaji|upah|tunjangan|bonus|lembur|insentif|komisi|premi|transport|makan|jabatan|thr|honor|pendapatan|penghasilan/i;
    const deductionWords = /potongan|bpjs|pph|ppn|pajak|iuran|pinjaman|angsuran|kasbon|koperasi|denda|terlambat|absen|asuransi|jht|jkn/i;
    const score = (s) => s.reduce((acc, t, i) => {
      const row = rows[idxWeak[i]], label = String(row.label || '');
      const semantic = deductionWords.test(label) ? 'DEDUCTION' : earningWords.test(label) ? 'EARNING' : null;
      return acc + (t === 'INFO' ? 1 : 0)
        + (row.type !== 'UNCLASSIFIED' && row.type !== t ? 2 : 0)
        + (semantic && semantic !== t ? 5 : 0);
    }, 0);
    sols.sort((a, b) => score(a) - score(b));
    const best = sols[0];
    const tied = sols.filter((s) => score(s) === score(best)).length;
    return { idxWeak, types: best, unique: tied === 1, ambiguous: tied > 1, count: sols.length };
  }

  function analyze(res) {
    const rows = res.rows.map((r) => ({ ...r }));
    const printed = { ...res.printed };
    const notes = [];

    // 1) a trailing amount equal to (earnings - deductions of the other rows) is the net salary, even without a known label
    let t = SlipMath.totals(rows);
    if (printed.net == null) {
      for (let i = rows.length - 1; i >= Math.max(0, rows.length - 3); i--) {
        const r = rows[i];
        if (r.source === 'kamus' || r.type === 'INFO') continue;
        const others = rows.filter((_, j) => j !== i);
        const ot = SlipMath.totals(others);
        if (ot.gross > 0 && ot.net === r.amount && r.amount > 0) {
          printed.net = r.amount;
          notes.push(`Baris "${r.label}" sama dengan gaji kotor dikurangi potongan, jadi dibaca sebagai gaji bersih.`);
          rows.splice(i, 1);
          break;
        }
      }
      t = SlipMath.totals(rows);
    }
    // 2) printed gross + deductions imply net
    let netImplied = null;
    if (printed.net == null && printed.gross != null && printed.deductions != null) netImplied = printed.gross - printed.deductions;

    // 3) let the printed net decide rows we could not place
    let solved = false;
    const target = printed.net != null ? printed : (netImplied != null ? { ...printed, net: netImplied } : null);
    if (target) {
      const sol = solveWeakRows(rows, target);
      const before = SlipMath.totals(rows).net;
      if (sol && (before !== target.net)) {
        sol.idxWeak.forEach((ri, k) => { rows[ri].type = sol.types[k]; rows[ri].weak = false; rows[ri].source = 'cocok dengan gaji bersih'; });
        solved = true;
        notes.push(sol.ambiguous
          ? 'Jenis baris yang belum jelas dipilih otomatis dari kecocokan gaji bersih dan nama baris. Periksa kembali bila diperlukan.'
          : 'Jenis beberapa baris diatur otomatis agar hitungan sama dengan gaji bersih di slip.');
      }
    }

    t = SlipMath.totals(rows);
    const unclassified = rows.filter((r) => r.type === 'UNCLASSIFIED').length;
    let net = null, source = null;
    if (printed.net != null) { net = printed.net; source = 'slip'; }
    else if (netImplied != null) { net = netImplied; source = 'total-slip'; }
    else if (t.gross > 0) { net = t.net; source = 'hitung'; }

    const diff = net != null ? net - t.net : null;
    const match = net != null && t.gross > 0 ? diff === 0 : null;
    let adjustment = null;
    if (net != null && t.gross > 0 && diff !== 0 && unclassified === 0) {
      adjustment = diff > 0
        ? { label: 'Selisih belum terdaftar (pendapatan)', amount: diff, type: 'EARNING' }
        : { label: 'Selisih belum terdaftar (potongan)', amount: -diff, type: 'DEDUCTION' };
    }
    const mode = t.gross > 0 ? 'GROSS_AND_DEDUCTIONS' : 'NET_ONLY';
    if (printed.gross != null && t.gross > 0 && printed.gross !== t.gross) notes.push(`Total pendapatan di slip ${R.rupiah(printed.gross)}, hitungan baris ${R.rupiah(t.gross)}.`);
    if (printed.deductions != null && t.deductions > 0 && printed.deductions !== t.deductions) notes.push(`Total potongan di slip ${R.rupiah(printed.deductions)}, hitungan baris ${R.rupiah(t.deductions)}.`);
    return { rows, printed, totals: t, net, netSource: source, diff, match, adjustment, unclassified, solved, defaultMode: mode, notes, period: res.period, employer: res.employer };
  }

  function readWords(words) { return analyze(read(linesFromWords(words))); }
  function readText(text) { return analyze(read(linesFromText(text))); }

  return { linesFromWords, linesFromText, estimateSlope, read, analyze, readWords, readText, classifyLabel, totalKind };
});
