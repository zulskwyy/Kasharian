/* KasHarian: E-Statement (PDF dan Excel). Dibuat sepenuhnya di perangkat, tanpa internet dan tanpa pustaka luar.
   Isi: saldo awal, total masuk/keluar, saldo akhir, rincian transaksi dengan saldo berjalan, dan pengeluaran per kategori.
   Dokumen ini ringkasan dari catatan pemilik, bukan dokumen resmi bank. */
(function (root) {
  'use strict';
  const MON = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const L = (s) => (root.KHI18n ? root.KHI18n.t(s) : s);
  const p2 = (n) => String(n).padStart(2, '0');
  const dShort = (iso) => `${+iso.slice(8, 10)} ${MON3[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  const dLong = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  const num = (n) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rp = (n) => (n < 0 ? '-' : '') + 'Rp ' + num(n);
  const sum = (l) => l.reduce((a, b) => a + b, 0);

  // ======================= MODEL =======================
  /** o: { wallets, acts, from, to (YYYY-MM-DD), walletId|null, profile, now:Date } */
  function model(o) {
    const wallets = o.wallets || [];
    const scope = o.walletId ? wallets.filter((w) => w.id === o.walletId) : wallets.filter((w) => w.includeInTotal !== false && !w.archived);
    const ids = new Set(scope.map((w) => w.id)), byId = {};
    wallets.forEach((w) => { byId[w.id] = w; });
    const acts = (o.acts || []).filter((a) => !a.deletedAt).slice().sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
    const delta = (a) => {
      if (a.type === 'INCOME' || a.type === 'ADJUSTMENT') return ids.has(a.walletId) ? a.amount : 0;
      if (a.type === 'EXPENSE') return ids.has(a.walletId) ? -a.amount : 0;
      if (a.type === 'TRANSFER') return (ids.has(a.toWalletId) ? a.amount : 0) - (ids.has(a.walletId) ? a.amount : 0);
      return 0;
    };
    let opening = sum(scope.map((w) => w.openingBalance || 0));
    acts.forEach((a) => { if (a.occurredOn < o.from) opening += delta(a); });
    const rows = []; let run = opening, masuk = 0, keluar = 0;
    acts.filter((a) => a.occurredOn >= o.from && a.occurredOn <= o.to).forEach((a) => {
      const involved = ids.has(a.walletId) || (a.type === 'TRANSFER' && ids.has(a.toWalletId));
      if (!involved) return;
      const d = delta(a); run += d; if (d > 0) masuk += d; if (d < 0) keluar += -d;
      const wn = (id) => (byId[id] ? byId[id].name : '-');
      let desc, cat, wal;
      if (a.type === 'TRANSFER') { desc = 'Pindah dana'; cat = 'Pindah dana'; wal = `${wn(a.walletId)} -> ${wn(a.toWalletId)}`; if (d === 0) desc += ' (' + rp(a.amount) + ')'; }
      else if (a.type === 'ADJUSTMENT') { desc = a.note || 'Penyesuaian saldo'; cat = 'Penyesuaian'; wal = wn(a.walletId); }
      else { desc = a.merchant || a.note || a.category || '-'; cat = a.category || '-'; wal = wn(a.walletId); }
      rows.push({ date: a.occurredOn, desc, category: cat, wallet: wal, in: d > 0 ? d : 0, out: d < 0 ? -d : 0, balance: run, type: a.type });
    });
    const cats = {};
    rows.filter((r) => r.type === 'EXPENSE' && r.out > 0).forEach((r) => { cats[r.category] = (cats[r.category] || 0) + r.out; });
    const totalOut = sum(Object.values(cats));
    const categories = Object.keys(cats).map((c) => ({ category: c, amount: cats[c], pct: totalOut ? cats[c] / totalOut * 100 : 0, count: rows.filter((r) => r.type === 'EXPENSE' && r.category === c && r.out > 0).length })).sort((a, b) => b.amount - a.amount);
    const now = o.now || new Date(), iso = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const pr = o.profile || {};
    return {
      owner: pr.name || '-', username: pr.username ? '@' + pr.username : '',
      scope: o.walletId && scope[0] ? scope[0].name : 'Semua dompet',
      from: o.from, to: o.to, period: `${dLong(o.from)} - ${dLong(o.to)}`,
      generated: `${dLong(iso)}, ${p2(now.getHours())}:${p2(now.getMinutes())}`,
      docNo: `KH-${iso.replace(/-/g, '')}-${p2(now.getHours())}${p2(now.getMinutes())}`,
      opening, masuk, keluar, closing: opening + masuk - keluar, rows, categories, totalOut
    };
  }

  // ======================= PDF =======================
  const HV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const HB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  const WIN = { '—': 0x97, '–': 0x96, '·': 0xB7, '•': 0x95, '…': 0x85, '©': 0xA9, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94 };
  const clean = (s) => String(s == null ? '' : s).replace(/→/g, '->').replace(/[\u0000-\u001f]/g, ' ');
  const pdfStr = (s) => { let out = ''; for (const ch of clean(s)) { let c = WIN[ch] != null ? WIN[ch] : ch.charCodeAt(0); if (c > 255 || (c >= 0x7f && c < 0xa0 && !Object.values(WIN).includes(c))) c = 63; const t = String.fromCharCode(c); out += (t === '(' || t === ')' || t === '\\') ? '\\' + t : t; } return out; };
  const tw = (s, size, bold) => { let w = 0; for (const ch of clean(s)) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? (bold ? HB : HV)[c - 32] : (WIN[ch] === 0x97 ? 1000 : 556)); } return w * size / 1000; };
  const fit = (s, size, bold, maxW) => { s = clean(s); if (tw(s, size, bold) <= maxW) return s; while (s.length > 1 && tw(s + '...', size, bold) > maxW) s = s.slice(0, -1); return s.trimEnd() + '...'; };
  const rgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((v) => +v.toFixed(3)).join(' '); };
  const CAT_COLORS = ['E0214A', 'F07F00', 'D6A300', 'A33FD6', '0099B0', '3A66E0', '7C7C82'];

  function pdf(m) {
    const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
    const pages = []; let ops, y;
    const newPage = () => { ops = []; pages.push(ops); };
    const fillRect = (x, yt, w, h, hex) => ops.push(`${rgb(hex)} rg ${x.toFixed(2)} ${(H - yt - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    const rrPath = (x, yt, w, h, r) => { const b = H - yt - h, k = r * 0.5523; return `${x} ${b + r} m ${x} ${b + h - r} l ${x} ${b + h - r + k} ${x + r - k} ${b + h} ${x + r} ${b + h} c ${x + w - r} ${b + h} l ${x + w - r + k} ${b + h} ${x + w} ${b + h - r + k} ${x + w} ${b + h - r} c ${x + w} ${b + r} l ${x + w} ${b + r - k} ${x + w - r + k} ${b} ${x + w - r} ${b} c ${x + r} ${b} l ${x + r - k} ${b} ${x} ${b + r - k} ${x} ${b + r} c h`; };
    const fillRound = (x, yt, w, h, r, hex) => ops.push(`${rgb(hex)} rg ${rrPath(x, yt, w, h, r)} f`);
    const text = (x, yt, s, o) => {
      o = o || {}; const size = o.size || 9, bold = !!o.bold; s = o.maxW ? fit(s, size, bold, o.maxW) : clean(s);
      let px = x; if (o.align === 'right') px = x - tw(s, size, bold); else if (o.align === 'center') px = x - tw(s, size, bold) / 2;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color || '0B0B0C')} rg ${px.toFixed(2)} ${(H - yt).toFixed(2)} Td (${pdfStr(s)}) Tj ET`);
    };
    const line = (x1, y1, x2, y2, hex, w) => ops.push(`${rgb(hex)} RG ${w || 0.6} w ${x1} ${(H - y1).toFixed(2)} m ${x2} ${(H - y2).toFixed(2)} l S`);
    const logo = (x, yt, size) => {
      const s = size / 64, X = (v) => (x + v * s).toFixed(2), Y = (v) => (H - yt - v * s).toFixed(2);
      fillRound(x, yt, size, size, 15 * s, '265DCC');
      ops.push(`1 1 1 RG ${(7 * s).toFixed(2)} w 1 J 1 j ${X(22)} ${Y(14)} m ${X(22)} ${Y(50)} l S ${X(44)} ${Y(15)} m ${X(26)} ${Y(33)} l ${X(45)} ${Y(50)} l S`);
    };
    const COLS = [['Tanggal', 54, 'l'], ['Keterangan', 138, 'l'], ['Kategori', 78, 'l'], ['Dompet', 62, 'l'], ['Masuk', 62, 'r'], ['Keluar', 62, 'r'], ['Saldo', 67, 'r']];
    const colX = (() => { let x = M; return COLS.map((c) => { const r = x; x += c[1]; return r; }); })();
    const tableHeader = () => {
      fillRound(M, y, CW, 20, 5, '0B0B0C');
      COLS.forEach((c, i) => { const right = c[2] === 'r'; text(right ? colX[i] + c[1] - 6 : colX[i] + 6, y + 13.5, L(c[0]), { size: 7.6, bold: true, color: 'FFFFFF', align: right ? 'right' : 'left' }); });
      y += 24;
    };
    const miniHeader = () => {
      fillRect(0, 0, W, 40, '0B0B0C'); fillRect(0, 40, W, 2, 'C4FF3D'); logo(M, 9, 22);
      text(M + 30, 25, 'KasHarian', { size: 11, bold: true, color: 'FFFFFF' }); text(W - M, 25, `${L('E-Statement')} · ${m.docNo}`, { size: 8, color: 'A1A1AA', align: 'right' });
      y = 62;
    };

    // ---- halaman 1
    newPage();
    fillRect(0, 0, W, 92, '0B0B0C'); fillRect(0, 92, W, 3, 'C4FF3D'); logo(M, 24, 44);
    text(M + 56, 46, 'KasHarian', { size: 20, bold: true, color: 'FFFFFF' });
    text(M + 56, 62, L('Laporan keuangan pribadi'), { size: 9, color: 'A1A1AA' });
    text(W - M, 46, L('E-STATEMENT'), { size: 12, bold: true, color: 'C4FF3D', align: 'right' });
    text(W - M, 62, m.docNo, { size: 8, color: 'A1A1AA', align: 'right' });
    const info = (x, yt, label, value, maxW) => { text(x, yt, L(label).toUpperCase(), { size: 6.8, bold: true, color: '71717A' }); text(x, yt + 13, value, { size: 10, bold: true, maxW }); };
    info(M, 120, 'Nama pemilik', m.owner + (m.username ? '  ' + m.username : ''), 250); info(M + 290, 120, 'Dibuat pada', L(m.generated), 230);
    info(M, 154, 'Dompet', L(m.scope), 250); info(M + 290, 154, 'No. dokumen', m.docNo, 230);
    info(M, 188, 'Periode', L(m.period), 480);
    // ringkasan
    const tw4 = (CW - 3 * 8) / 4, tiles = [['Saldo awal', m.opening, '0B0B0C', 'F2F2F7'], ['Total masuk', m.masuk, '1F8A00', 'F2F2F7'], ['Total keluar', m.keluar, 'D81E4A', 'F2F2F7'], ['Saldo akhir', m.closing, 'FFFFFF', '0B0B0C']];
    tiles.forEach((t, i) => { const x = M + i * (tw4 + 8); fillRound(x, 226, tw4, 56, 10, t[3]); text(x + 11, 243, L(t[0]).toUpperCase(), { size: 6.8, bold: true, color: i === 3 ? 'C4FF3D' : '71717A' }); text(x + 11, 266, rp(t[1]), { size: 11.5, bold: true, color: t[2], maxW: tw4 - 18 }); });
    y = 306;
    text(M, y, L('Rincian transaksi'), { size: 12, bold: true }); text(W - M, y, L(`${m.rows.length} transaksi`), { size: 8, color: '71717A', align: 'right' });
    y += 12; tableHeader();
    const rowH = 18, limit = H - 62;
    if (!m.rows.length) { text(M + 6, y + 10, L('Tidak ada transaksi pada periode ini.'), { size: 9, color: '71717A' }); y += 28; }
    m.rows.forEach((r, i) => {
      if (y + rowH > limit) { newPage(); miniHeader(); tableHeader(); }
      if (i % 2 === 0) fillRect(M, y, CW, rowH, 'F7F7F9');
      const ty = y + 12;
      text(colX[0] + 6, ty, L(dShort(r.date)), { size: 7.6, maxW: COLS[0][1] - 8 });
      text(colX[1] + 6, ty, r.desc, { size: 7.8, bold: true, maxW: COLS[1][1] - 10 });
      text(colX[2] + 6, ty, L(r.category), { size: 7.4, color: '52525B', maxW: COLS[2][1] - 10 });
      text(colX[3] + 6, ty, r.wallet, { size: 7.4, color: '52525B', maxW: COLS[3][1] - 10 });
      text(colX[4] + COLS[4][1] - 6, ty, r.in ? num(r.in) : '-', { size: 7.8, color: r.in ? '1F8A00' : 'A1A1AA', align: 'right', bold: !!r.in });
      text(colX[5] + COLS[5][1] - 6, ty, r.out ? num(r.out) : '-', { size: 7.8, color: r.out ? 'D81E4A' : 'A1A1AA', align: 'right', bold: !!r.out });
      text(colX[6] + COLS[6][1] - 6, ty, (r.balance < 0 ? '-' : '') + num(r.balance), { size: 7.8, bold: true, align: 'right', color: r.balance < 0 ? 'D81E4A' : '0B0B0C' });
      y += rowH;
    });
    if (m.rows.length) {
      if (y + 26 > limit) { newPage(); miniHeader(); }
      line(M, y + 2, W - M, y + 2, '0B0B0C', 0.9);
      text(colX[1] + 6, y + 16, L('Total'), { size: 8.6, bold: true });
      text(colX[4] + COLS[4][1] - 6, y + 16, num(m.masuk), { size: 8.2, bold: true, color: '1F8A00', align: 'right' });
      text(colX[5] + COLS[5][1] - 6, y + 16, num(m.keluar), { size: 8.2, bold: true, color: 'D81E4A', align: 'right' });
      text(colX[6] + COLS[6][1] - 6, y + 16, (m.closing < 0 ? '-' : '') + num(m.closing), { size: 8.2, bold: true, align: 'right' });
      y += 30;
    }
    // per kategori
    if (m.categories.length) {
      const top = m.categories.slice(0, 10);
      if (y + 40 + top.length * 24 > limit) { newPage(); miniHeader(); }
      text(M, y + 12, L('Pengeluaran per kategori'), { size: 12, bold: true });
      text(W - M, y + 12, rp(m.totalOut), { size: 9, bold: true, color: 'D81E4A', align: 'right' });
      y += 26;
      top.forEach((c, i) => {
        const col = CAT_COLORS[Math.min(i, 5)], pct = Math.max(0.5, c.pct);
        fillRound(M, y + 2, 7, 7, 3.5, col);
        text(M + 14, y + 9, L(c.category), { size: 8.6, bold: true, maxW: 220 });
        text(W - M - 52, y + 9, num(c.amount), { size: 8.4, bold: true, align: 'right' });
        text(W - M, y + 9, (c.pct < 1 ? '<1' : Math.round(c.pct)) + '%', { size: 8.4, color: '71717A', align: 'right' });
        fillRound(M + 14, y + 13, CW - 14, 4, 2, 'E4E4E7'); fillRound(M + 14, y + 13, Math.max(3, (CW - 14) * pct / 100), 4, 2, col);
        y += 24;
      });
    }
    y += 14;
    if (y + 30 > limit) { newPage(); miniHeader(); }
    text(M, y, L('Dokumen ini dibuat otomatis dari catatan di perangkat pemilik dan bukan dokumen resmi bank.'), { size: 7, color: '71717A' });
    // footer semua halaman
    pages.forEach((p, i) => {
      ops = p;
      line(M, H - 46, W - M, H - 46, 'E4E4E7', 0.6);
      text(M, H - 32, `KasHarian · ${L('E-Statement')} · ${m.docNo}`, { size: 7, color: '71717A' });
      text(W - M, H - 32, L(`Halaman ${i + 1} dari ${pages.length}`), { size: 7, color: '71717A', align: 'right' });
      text(M, H - 21, L('Data tersimpan di perangkat pemilik dan tidak dikirim ke server mana pun.'), { size: 6.4, color: 'A1A1AA' });
    });
    // rakit berkas
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(null);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    add(`<< /Title (${pdfStr('KasHarian E-Statement ' + m.docNo)}) /Author (${pdfStr(m.owner)}) /Creator (KasHarian) /Producer (KasHarian) >>`);
    const kids = [];
    pages.forEach((p) => {
      const stream = p.join('\n'), cid = objs.length + 2;
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`));
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  // ======================= ZIP & XLSX =======================
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const utf8 = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)));
  function zip(files) {
    const parts = [], central = []; let off = 0; const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    files.forEach((f) => {
      const name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(head, name, data);
      central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += head.length + name.length + data.length;
    });
    const cdSize = sum(central.map((c) => c.length));
    const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0, 0]);
    const all = [...parts, ...central, end], out = new Uint8Array(sum(all.map((p) => p.length))); let o = 0;
    all.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  const xe = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  const serial = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569;

  function xlsx(m, logoPng) {
    // ---- gaya
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], xfs = [], seen = {};
    const idx = (arr, xml) => { let i = arr.indexOf(xml); if (i < 0) { arr.push(xml); i = arr.length - 1; } return i; };
    const NUMFMT = { rp: 164, date: 165, int: 3, pct: 166, rpz: 167 };
    const style = (o) => {
      const key = JSON.stringify(o); if (seen[key] != null) return seen[key];
      const f = idx(fonts, `<font>${o.b ? '<b/>' : ''}<sz val="${o.sz || 10}"/><color rgb="FF${o.color || '0B0B0C'}"/><name val="Calibri"/><family val="2"/></font>`);
      const fl = o.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const bd = o.bottom ? idx(borders, `<border><left/><right/><top/><bottom style="thin"><color rgb="FF${o.bottom}"/></bottom><diagonal/></border>`) : (o.top ? idx(borders, `<border><left/><right/><top style="medium"><color rgb="FF${o.top}"/></top><bottom/><diagonal/></border>`) : 0);
      xfs.push(`<xf numFmtId="${o.fmt ? NUMFMT[o.fmt] : 0}" fontId="${f}" fillId="${fl}" borderId="${bd}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${o.fmt ? ' applyNumberFormat="1"' : ''} applyAlignment="1"><alignment horizontal="${o.h || 'left'}" vertical="center"${o.wrap ? ' wrapText="1"' : ''}/></xf>`);
      return (seen[key] = xfs.length - 1);
    };
    xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    fonts.push('<font><sz val="10"/><color rgb="FF0B0B0C"/><name val="Calibri"/><family val="2"/></font>');
    const BLACK = '0B0B0C', LIME = 'C4FF3D', GRAY = 'F2F2F7', ZEBRA = 'F7F7F9', MUTED = '71717A';

    // ---- pembangun lembar
    const sheet = (opt) => {
      const rows = {}, merges = [], heights = {};
      const put = (r, c, cell) => { (rows[r] = rows[r] || {})[c] = cell; };
      return {
        s: (r, c, v, st) => put(r, c, { t: 's', v, st }), n: (r, c, v, st) => put(r, c, { t: 'n', v, st }), f: (r, c, f, v, st) => put(r, c, { t: 'f', f, v, st }), e: (r, c, st) => put(r, c, { t: 'e', st }),
        merge: (a) => merges.push(a), h: (r, ht) => { heights[r] = ht; },
        xml(extra) {
          const rs = Object.keys(rows).map(Number).sort((a, b) => a - b).map((r) => {
            const cells = Object.keys(rows[r]).map(Number).sort((a, b) => a - b).map((c) => {
              const x = rows[r][c], ref = colName(c) + r, st = x.st != null ? ` s="${x.st}"` : '';
              if (x.t === 's') return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(x.v)}</t></is></c>`;
              if (x.t === 'n') return `<c r="${ref}"${st}><v>${x.v}</v></c>`;
              if (x.t === 'f') return `<c r="${ref}"${st}><f>${xe(x.f)}</f><v>${x.v}</v></c>`;
              return `<c r="${ref}"${st}/>`;
            }).join('');
            return `<row r="${r}"${heights[r] ? ` ht="${heights[r]}" customHeight="1"` : ''}>${cells}</row>`;
          }).join('');
          return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${extra.before}<sheetData>${rs}</sheetData>${extra.after}${merges.length ? `<mergeCells count="${merges.length}">${merges.map((a) => `<mergeCell ref="${a}"/>`).join('')}</mergeCells>` : ''}${extra.tail}</worksheet>`;
        }
      };
    };
    const band = (sh, r, from, to, st) => { for (let c = from; c <= to; c++) sh.e(r, c, st); };

    // ======== Lembar 1: E-Statement
    const s1 = sheet(); const nm1 = L('E-Statement');
    const sBlack = style({ fill: BLACK }), sTitle = style({ fill: BLACK, color: 'FFFFFF', b: 1, sz: 20 }), sTag = style({ fill: BLACK, color: LIME, b: 1, sz: 12, h: 'right' }), sSub = style({ fill: BLACK, color: 'A1A1AA', sz: 9 }), sSubR = style({ fill: BLACK, color: 'A1A1AA', sz: 9, h: 'right' }), sLime = style({ fill: LIME });
    s1.h(1, 46); s1.h(2, 16); s1.h(3, 4); s1.h(4, 8);
    band(s1, 1, 0, 7, sBlack); band(s1, 2, 0, 7, sBlack); band(s1, 3, 0, 7, sLime);
    s1.s(1, 1, 'KasHarian', sTitle); s1.merge('B1:E1'); s1.s(1, 5, L('E-STATEMENT'), sTag); s1.merge('F1:H1');
    s1.s(2, 1, L('Laporan keuangan pribadi'), sSub); s1.merge('B2:E2'); s1.s(2, 5, m.docNo, sSubR); s1.merge('F2:H2');
    const sLab = style({ color: MUTED, b: 1, sz: 8 }), sVal = style({ b: 1, sz: 10 });
    const info = (r, lc, label, vc, value, mergeTo) => { s1.s(r, lc, L(label).toUpperCase(), sLab); s1.s(r, vc, value, sVal); if (mergeTo) s1.merge(`${colName(vc)}${r}:${colName(mergeTo)}${r}`); s1.h(r, 18); };
    info(5, 1, 'Nama pemilik', 2, m.owner + (m.username ? '  ' + m.username : ''), 4); info(5, 5, 'Dibuat pada', 6, L(m.generated), 7);
    info(6, 1, 'Dompet', 2, L(m.scope), 4); info(6, 5, 'No. dokumen', 6, m.docNo, 7);
    info(7, 1, 'Periode', 2, L(m.period), 7);
    s1.h(8, 10);
    const sSec = style({ b: 1, sz: 12 }); s1.s(9, 1, L('Ringkasan'), sSec); s1.h(9, 22);
    const tLab = style({ fill: GRAY, color: MUTED, b: 1, sz: 8, h: 'left' }), tLabD = style({ fill: BLACK, color: LIME, b: 1, sz: 8, h: 'left' });
    const tVal = (color) => style({ fill: GRAY, color, b: 1, sz: 13, fmt: 'rp', h: 'left' }), tValD = style({ fill: BLACK, color: 'FFFFFF', b: 1, sz: 13, fmt: 'rp', h: 'left' });
    s1.h(10, 18); s1.h(11, 28);
    const tile = (c1, c2, label, v, vs, ls) => { s1.s(10, c1, L(label).toUpperCase(), ls); s1.n(11, c1, v, vs); if (c2 > c1) { for (let c = c1 + 1; c <= c2; c++) { s1.e(10, c, ls); s1.e(11, c, vs); } s1.merge(`${colName(c1)}10:${colName(c2)}10`); s1.merge(`${colName(c1)}11:${colName(c2)}11`); } };
    tile(1, 2, 'Saldo awal', m.opening, tVal('0B0B0C'), tLab); tile(3, 3, 'Total masuk', m.masuk, tVal('1F8A00'), tLab); tile(4, 4, 'Total keluar', m.keluar, tVal('D81E4A'), tLab); tile(5, 7, 'Saldo akhir', m.closing, tValD, tLabD);
    s1.h(12, 12);
    s1.s(13, 1, L('Rincian transaksi'), sSec); s1.h(13, 22);
    const HDR = ['No', 'Tanggal', 'Keterangan', 'Kategori', 'Dompet', 'Masuk', 'Keluar', 'Saldo'], HROW = 14;
    HDR.forEach((t, i) => s1.s(HROW, i, L(t), style({ fill: BLACK, color: 'FFFFFF', b: 1, sz: 9, h: i >= 5 ? 'right' : (i === 0 ? 'center' : 'left') })));
    s1.h(HROW, 22);
    const first = HROW + 1; let r = first;
    m.rows.forEach((x, i) => {
      const z = i % 2 === 0 ? ZEBRA : null, base = { fill: z, bottom: 'E4E4E7' };
      s1.n(r, 0, i + 1, style({ ...base, h: 'center', color: MUTED, fmt: 'int' }));
      s1.n(r, 1, serial(x.date), style({ ...base, fmt: 'date', h: 'left' }));
      s1.s(r, 2, x.desc, style({ ...base, b: 1 })); s1.s(r, 3, L(x.category), style({ ...base, color: '52525B' })); s1.s(r, 4, x.wallet, style({ ...base, color: '52525B' }));
      s1.n(r, 5, x.in, style({ ...base, fmt: 'rpz', h: 'right', color: '1F8A00', b: x.in ? 1 : 0 }));
      s1.n(r, 6, x.out, style({ ...base, fmt: 'rpz', h: 'right', color: 'D81E4A', b: x.out ? 1 : 0 }));
      s1.f(r, 7, r === first ? `$B$11+F${r}-G${r}` : `H${r - 1}+F${r}-G${r}`, x.balance, style({ ...base, fmt: 'rp', h: 'right', b: 1 }));
      s1.h(r, 17); r++;
    });
    const last = Math.max(first, r - 1);
    if (m.rows.length) {
      const st = (o) => style({ top: BLACK, b: 1, ...o });
      s1.e(r, 0, st({})); s1.e(r, 1, st({})); s1.s(r, 2, L('Total'), st({})); s1.e(r, 3, st({})); s1.e(r, 4, st({}));
      s1.f(r, 5, `SUM(F${first}:F${last})`, m.masuk, st({ fmt: 'rp', h: 'right', color: '1F8A00' })); s1.f(r, 6, `SUM(G${first}:G${last})`, m.keluar, st({ fmt: 'rp', h: 'right', color: 'D81E4A' })); s1.f(r, 7, `$B$11+F${r}-G${r}`, m.closing, st({ fmt: 'rp', h: 'right' }));
      s1.h(r, 20); r++;
    } else { s1.s(r, 2, L('Tidak ada transaksi pada periode ini.'), style({ color: MUTED })); r++; }
    r++;
    s1.s(r, 1, L('Dokumen ini dibuat otomatis dari catatan di perangkat pemilik dan bukan dokumen resmi bank.'), style({ color: MUTED, sz: 8 })); s1.merge(`B${r}:H${r}`);
    const widths = [8, 14, 40, 24, 24, 18, 18, 18];
    const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
    const x1 = s1.xml({
      before: `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${HROW}" topLeftCell="A${first}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${first}" sqref="A${first}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}`,
      after: m.rows.length ? `<autoFilter ref="A${HROW}:H${last}"/>` : '',
      tail: `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LKasHarian · ${xe(m.docNo)}&amp;RHalaman &amp;P dari &amp;N</oddFooter></headerFooter>${logoPng ? '<drawing r:id="rId1"/>' : ''}`
    });

    // ======== Lembar 2: Per kategori
    const s2 = sheet(); const nm2 = L('Per kategori');
    s2.h(1, 40); band(s2, 1, 0, 3, sBlack); band(s2, 2, 0, 3, sLime); s2.h(2, 4);
    s2.s(1, 0, L('Pengeluaran per kategori'), style({ fill: BLACK, color: 'FFFFFF', b: 1, sz: 16 })); s2.merge('A1:D1');
    s2.s(3, 0, L(m.period), style({ color: MUTED, sz: 9 })); s2.merge('A3:D3'); s2.h(4, 8);
    ['Kategori', 'Total (Rp)', 'Persen', 'Jumlah transaksi'].forEach((t, i) => s2.s(5, i, L(t), style({ fill: BLACK, color: 'FFFFFF', b: 1, sz: 9, h: i ? 'right' : 'left' })));
    s2.h(5, 22);
    let rr = 6; const f2 = rr;
    m.categories.forEach((c, i) => {
      const base = { fill: i % 2 === 0 ? ZEBRA : null, bottom: 'E4E4E7' };
      s2.s(rr, 0, L(c.category), style({ ...base, b: 1 })); s2.n(rr, 1, c.amount, style({ ...base, fmt: 'rp', h: 'right' }));
      s2.f(rr, 2, `B${rr}/$B$${f2 + m.categories.length}`, c.amount / (m.totalOut || 1), style({ ...base, fmt: 'pct', h: 'right', color: MUTED })); s2.n(rr, 3, c.count, style({ ...base, fmt: 'int', h: 'right' })); s2.h(rr, 17); rr++;
    });
    if (m.categories.length) {
      const st = (o) => style({ top: BLACK, b: 1, ...o });
      s2.s(rr, 0, L('Total'), st({})); s2.f(rr, 1, `SUM(B${f2}:B${rr - 1})`, m.totalOut, st({ fmt: 'rp', h: 'right', color: 'D81E4A' })); s2.f(rr, 2, `SUM(C${f2}:C${rr - 1})`, 1, st({ fmt: 'pct', h: 'right' })); s2.f(rr, 3, `SUM(D${f2}:D${rr - 1})`, sum(m.categories.map((c) => c.count)), st({ fmt: 'int', h: 'right' })); s2.h(rr, 20);
    } else s2.s(rr, 0, L('Belum ada pengeluaran di periode ini.'), style({ color: MUTED }));
    const x2 = s2.xml({ before: `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="20" customWidth="1"/></cols>`, after: '', tail: '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/>' });

    // ======== bagian pendukung
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const qs = (n) => `'${n.replace(/'/g, "''")}'`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}"><numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;Rp &quot;#,##0;[Red]-&quot;Rp &quot;#,##0"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="&quot;Rp &quot;#,##0;[Red]-&quot;Rp &quot;#,##0;&quot;-&quot;"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="${xe(nm1)}" sheetId="1" r:id="rId1"/><sheet name="${xe(nm2)}" sheetId="2" r:id="rId2"/></sheets><definedNames>${m.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xe(qs(nm1))}!$A$${HROW}:$H$${last}</definedName>` : ''}<definedName name="_xlnm.Print_Titles" localSheetId="0">${xe(qs(nm1))}!$${HROW}:$${HROW}</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logoPng ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${logoPng ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles }, { name: 'xl/worksheets/sheet1.xml', data: x1 }, { name: 'xl/worksheets/sheet2.xml', data: x2 }
    ];
    if (logoPng) {
      files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>` });
      files.push({ name: 'xl/drawings/drawing1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>60000</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>95000</xdr:rowOff></xdr:from><xdr:ext cx="381000" cy="381000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo KasHarian" descr="Logo KasHarian"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${REL}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>` });
      files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/></Relationships>` });
      files.push({ name: 'xl/media/image1.png', data: logoPng });
    }
    return zip(files);
  }

  // ======================= LAYAR =======================
  if (root.KHApp) {
    const A = KHApp, { h, R, db, SCREENS, card, frame, toast, field } = A;
    const lastDay = (ym) => ym + '-' + p2(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate());
    const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256"><rect width="64" height="64" rx="15" fill="#265DCC"/><path d="M22 14V50M44 15L26 33L45 50" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    const logoPng = () => new Promise((res) => {
      const done = (v) => res(v); setTimeout(() => done(null), 2500);
      try {
        const img = new Image();
        img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, 0, 0, 256, 256); c.toBlob((b) => (b ? b.arrayBuffer().then((ab) => done(new Uint8Array(ab)), () => done(null)) : done(null)), 'image/png'); } catch (e) { done(null); } };
        img.onerror = () => done(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LOGO_SVG);
      } catch (e) { done(null); }
    });
    function save(name, bytes, mime) {
      if (window.KHNativeFiles) { window.KHNativeFiles.saveBytes(name, mime, bytes); return; }
      const url = URL.createObjectURL(new Blob([bytes], { type: mime })), a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    SCREENS.estatement = () => {
      const ym = R.monthOf(R.todayISO());
      const RANGES = { now: ['Bulan ini', () => [ym + '-01', lastDay(ym)]], prev: ['Bulan lalu', () => { const p = R.addMonths(ym, -1); return [p + '-01', lastDay(p)]; }], last3: ['3 bulan terakhir', () => [R.addMonths(ym, -2) + '-01', lastDay(ym)]], custom: ['Pilih tanggal', null] };
      let key = 'now', from = ym + '-01', to = lastDay(ym), walletId = '';
      const chips = h('div', { class: 'chips' }), customBox = h('div', { class: 'est-dates' }), preview = h('div'), err = A.errBox();
      const wallet = h('select', { class: 'input', onchange: (e) => { walletId = e.target.value; draw(); } },
        h('option', { value: '' }, 'Semua dompet'), ...db().wallets.filter((w) => !w.archived).map((w) => h('option', { value: w.id }, w.name)));
      const dFrom = h('input', { class: 'input', type: 'date', value: from, onchange: (e) => { from = e.target.value; draw(); } });
      const dTo = h('input', { class: 'input', type: 'date', value: to, onchange: (e) => { to = e.target.value; draw(); } });
      customBox.append(field('Dari', dFrom), field('Sampai', dTo));
      const build = () => model({ wallets: db().wallets, acts: A.liveActs(), from, to, walletId: walletId || null, profile: db().profile, now: new Date() });
      let busy = false;
      const exportBtn = (label, kind) => h('button', { class: 'btn ' + (kind === 'pdf' ? 'primary ' : '') + 'block', type: 'button', onclick: async (e) => {
        if (busy) return;
        if (!from || !to || from > to) return A.showErr(err, 'Tanggal akhir harus sama atau setelah tanggal awal.');
        busy = true; const b = e.currentTarget, old = b.textContent; b.disabled = true; b.textContent = 'Menyiapkan...'; b.classList.add('busy');
        try {
          const m = build(), base = `KasHarian-E-Statement-${from}_${to}`;
          if (kind === 'pdf') save(base + '.pdf', pdf(m), 'application/pdf');
          else save(base + '.xlsx', xlsx(m, await logoPng()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          toast(kind === 'pdf' ? 'E-Statement PDF siap' : 'E-Statement Excel siap');
        } catch (x) { A.showErr(err, 'Dokumen gagal dibuat. Coba lagi.'); }
        busy = false; b.disabled = false; b.textContent = old; b.classList.remove('busy');
      } }, label);
      const draw = () => {
        chips.replaceChildren(...Object.entries(RANGES).map(([k, v]) => h('button', { class: 'chip' + (key === k ? ' on' : ''), type: 'button', onclick: () => { key = k; if (RANGES[k][1]) { [from, to] = RANGES[k][1](); dFrom.value = from; dTo.value = to; } draw(); } }, v[0])));
        customBox.style.display = key === 'custom' ? '' : 'none';
        if (!from || !to || from > to) { preview.replaceChildren(h('p', { class: 'note' }, 'Tanggal akhir harus sama atau setelah tanggal awal.')); return; }
        const m = build(), none = !m.rows.length;
        preview.replaceChildren(
          h('div', { class: 'est-stats' },
            [['Saldo awal', m.opening, ''], ['Total masuk', m.masuk, 'in'], ['Total keluar', m.keluar, 'out'], ['Saldo akhir', m.closing, 'dark']].map(([l, v, c], i) => h('div', { class: 'est-stat ' + c, style: { '--i': i } }, h('small', null, l), h('strong', null, R.rupiah(v))))),
          h('p', { class: 'est-count' }, none ? 'Belum ada transaksi di periode ini.' : L(`${m.rows.length} transaksi · ${m.period}`)));
        pdfBtn.disabled = excelBtn.disabled = none;
      };
      const pdfBtn = exportBtn('Unduh PDF', 'pdf'), excelBtn = exportBtn('Unduh Excel', 'xlsx');
      draw();
      return frame({ title: 'E-Statement', back: true, children: [
        card(h('h3', null, 'Periode'), chips, customBox, field('Dompet', wallet)),
        card(h('h3', null, 'Ringkasan'), preview),
        card(h('div', { class: 'stack' }, pdfBtn, excelBtn), err,
          h('p', { class: 'about-note' }, 'Dokumen dibuat di perangkat ini dengan logo KasHarian. Tidak ada data yang dikirim ke mana pun. Ini ringkasan catatanmu, bukan dokumen resmi bank.'))] });
    };
  }

  root.KHStatement = { model, pdf, xlsx, zip, crc32, num, rp, dLong, dShort };
})(typeof self !== 'undefined' ? self : this);
