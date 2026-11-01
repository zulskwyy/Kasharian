/* Reads Word (.docx), Excel (.xlsx), CSV and plain text into positioned words, so the salary-slip reader can treat
   them exactly like a photo: table cells keep their column, which separates "Pendapatan" from "Potongan". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KHDocs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROW_H = 30, COL_W = 420, CH_W = 12;

  // ---------- minimal ZIP reader (central directory + deflate-raw) ----------
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Peramban ini belum bisa membuka berkas Word/Excel. Simpan sebagai PDF lalu coba lagi.');
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buffer, want) {
    const u8 = new Uint8Array(buffer), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Berkas bukan dokumen Office yang valid.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {}, dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!want(name)) continue;
      const lnLen = dv.getUint16(lho + 26, true), leLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnLen + leLen, raw = u8.subarray(start, start + csize);
      out[name] = method === 0 ? raw : await inflateRaw(raw);
    }
    return out;
  }
  const text = (u8) => new TextDecoder('utf-8').decode(u8);
  const unxml = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  // ---------- grid -> words ----------
  const groupDots = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  /** rows: array of arrays of cell strings (null/'' = empty). */
  function gridToWords(rows, yBase) {
    const words = [];
    rows.forEach((cells, r) => {
      const y0 = (yBase || 0) + r * ROW_H;
      cells.forEach((cell, c) => {
        if (cell == null || String(cell).trim() === '') return;
        let x = c * COL_W;
        String(cell).trim().split(/\s+/).forEach((tok) => {
          const w = tok.length * CH_W;
          words.push({ text: tok, x0: x, x1: x + w, y0, y1: y0 + 18 });
          x += w + 10;
        });
      });
    });
    return words;
  }
  function numText(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || String(v).trim() === '') return String(v);
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? (Math.abs(r) >= 1000 ? groupDots(r) : String(r)) : String(r).replace('.', ',');
  }

  // ---------- DOCX ----------
  function paraText(xml) {
    let out = '';
    const re = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out += m[1] !== undefined ? unxml(m[1]) : ' ';
    return out.trim();
  }
  async function readDocx(buffer) {
    const files = await unzip(buffer, (n) => n === 'word/document.xml');
    if (!files['word/document.xml']) throw new Error('Isi dokumen Word tidak ditemukan.');
    const xml = text(files['word/document.xml']);
    const rows = [];
    const re = /<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m[0].startsWith('<w:tr')) {
        const cells = (m[0].match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).map((tc) => (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(paraText).filter(Boolean).join(' '));
        if (cells.some(Boolean)) rows.push(cells);
      } else {
        const t = paraText(m[0]);
        if (t) rows.push([t]);
      }
    }
    return { words: gridToWords(rows), engine: 'Dokumen Word' };
  }

  // ---------- XLSX ----------
  const colIndex = (ref) => { const l = /^[A-Z]+/.exec(ref)[0]; let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function readXlsx(buffer) {
    const files = await unzip(buffer, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const sheets = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10)).slice(0, 3);
    if (!sheets.length) throw new Error('Lembar Excel tidak ditemukan.');
    const shared = files['xl/sharedStrings.xml']
      ? (text(files['xl/sharedStrings.xml']).match(/<si>[\s\S]*?<\/si>|<si [^>]*>[\s\S]*?<\/si>/g) || []).map((si) => unxml((si.match(/<t(?: [^>]*)?>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
      : [];
    let words = [], yBase = 0;
    for (const name of sheets) {
      const xml = text(files[name]), rows = [];
      (xml.match(/<row[ >][\s\S]*?<\/row>/g) || []).forEach((row) => {
        const cells = [];
        (row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
          const ref = /r="([A-Z]+\d+)"/.exec(c), type = /t="(\w+)"/.exec(c), v = /<v>([^<]*)<\/v>/.exec(c);
          if (!ref) return;
          let val = null;
          if (type && type[1] === 's' && v) val = shared[parseInt(v[1], 10)];
          else if (type && type[1] === 'inlineStr') val = unxml((c.match(/<t(?: [^>]*)?>([^<]*)<\/t>/) || [, ''])[1]);
          else if (type && (type[1] === 'str' || type[1] === 'e') && v) val = unxml(v[1]);
          else if (v) val = numText(v[1]);
          if (val != null && String(val).trim() !== '') cells[colIndex(ref[1])] = val;
        });
        rows.push(Array.from(cells, (x) => x));
      });
      words = words.concat(gridToWords(rows, yBase));
      yBase += (rows.length + 5) * ROW_H;
    }
    return { words, engine: 'Dokumen Excel' };
  }

  // ---------- CSV / TXT ----------
  function parseCsv(textIn) {
    const first = textIn.split(/\r?\n/).find((l) => l.trim()) || '';
    const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < textIn.length; i++) {
      const ch = textIn[i];
      if (q) { if (ch === '"') { if (textIn[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && textIn[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c.trim()) ? numText(c.trim()) : c))).filter((r) => r.some((c) => c.trim() !== ''));
  }
  function readCsv(textIn) { return { words: gridToWords(parseCsv(textIn)), engine: 'Berkas CSV' }; }
  function readTxt(textIn) {
    const rows = textIn.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => [l]);
    return { words: gridToWords(rows), engine: 'Berkas teks' };
  }

  return { readDocx, readXlsx, readCsv, readTxt, unzip, gridToWords };
});
