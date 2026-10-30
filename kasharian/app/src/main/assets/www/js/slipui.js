/* Salary slip screens: pick a file, read it, review rows and the net salary, then post to the ledger. */
(function () {
  'use strict';
  const A = KHApp, { h, R, S, db, go, root, back, frame, card, field, errBox, showErr, SCREENS, toast, modal } = A;
  const { moneyInput } = KHUI;
  const SL = KHSlip;
  const TYPE_LABEL = { EARNING: 'Pendapatan', DEDUCTION: 'Potongan', INFO: 'Info (tidak dihitung)', UNCLASSIFIED: 'Belum diatur' };
  let draft = null;

  function makeDraft(a, res) {
    return {
      rows: a.rows.map((r) => ({ id: S.uid(), label: r.label, amount: r.amount, type: r.type, source: r.source || '' })),
      printed: { gross: a.printed.gross, deductions: a.printed.deductions, net: a.printed.net },
      period: a.period, employer: a.employer, notes: a.notes || [], imageUrl: res.imageUrl || null, advice: res.advice || [], warning: res.warning || null,
      engine: res.engine, confidence: res.confidence, ocrText: (res.words || []).map((w) => w.text).filter(Boolean).join(' '), mode: 'NET_ONLY', walletId: A.defaultWallet().id, date: R.todayISO()
    };
  }

  SCREENS.slip = () => {
    const status = h('p', { class: 'note', 'aria-live': 'polite' });
    const err = errBox();
    const bar = h('div', { class: 'busy', hidden: true }, h('div', { class: 'spinner' }), status);
    async function run(files) {
      if (!files.length) return;
      showErr(err, '');
      try {
        const res = await KHApp.scanWith(files, (cb) => KHOCR.readFiles(files, cb)); if (!res) return;
        draft = makeDraft(SL.readWords(res.words), res);
        go('slipreview', null, { replace: true });
      } catch (e) { showErr(err, e.message || 'Gagal membaca berkas.'); KHUI.notice('Scan belum berhasil', KHUI.h('p', null, (e && e.message) || 'Berkas tidak bisa dibaca.'), 'error'); }
    }
    const mk = (accept, extra) => h('input', Object.assign({ type: 'file', accept, hidden: true, onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; run(f); } }, extra || {}));
    const cam = mk('image/*', { capture: 'environment' });
    const gal = mk('image/*', { multiple: true });
    const docs = mk('application/pdf,.pdf,.docx,.xlsx,.csv,.txt,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { multiple: true });

    const engine = h('div', { hidden: true });
    if (window.KHOCR && KHOCR.selfTest) {
      KHOCR.selfTest().then((r) => {
        if (r.photoOcr) return;
        const why = !r.wasm ? 'WebAssembly tidak ada' : !r.simd ? 'perlu peramban yang lebih baru' : !r.worker ? 'halaman ini memblokir Web Worker' : 'tidak tersedia';
        KHUI.notice('Foto belum bisa dibaca', h('p', null, `Penyebab: ${why}. Pakai PDF, Word, Excel, atau tempel teks.`), 'warn');
      });
    }

    const paste = h('textarea', { class: 'input', rows: 6, placeholder: 'Contoh:\nGaji Pokok 4.500.000\nTunjangan 500.000\nBPJS 100.000\nGaji Bersih 4.900.000' });
    const perr = errBox();
    const readPaste = () => {
      showErr(perr, '');
      let a = SL.readText(paste.value);
      if (!a.rows.length) a = SL.readText(KHExtra.storyToSlipText(paste.value));
      if (!a.rows.length && a.printed.net == null) return showErr(perr, 'Belum ada baris dengan nominal yang terbaca. Pastikan tiap baris memuat nama dan angka.');
      draft = makeDraft(a, { engine: 'Teks yang ditempel', advice: [] });
      go('slipreview', null, { replace: true });
    };
    return frame({ title: 'Baca slip gaji', back: true, children: [
      card(null,
        h('button', { class: 'btn primary block', onclick: () => cam.click() }, 'Ambil foto sekarang'),
        h('button', { class: 'btn block', onclick: () => gal.click() }, 'Pilih foto dari galeri'),
        h('button', { class: 'btn block', onclick: () => docs.click() }, 'Pilih dokumen'),
        cam, gal, docs, bar, err,
        null),
      engine,
      card(h('h3', null, 'Atau tempel teks slip'), null, paste, perr,
        h('button', { class: 'btn block', onclick: readPaste }, 'Baca teks')),
      h('button', { class: 'btn ghost block', onclick: () => { draft = makeDraft({ rows: [], printed: { gross: null, deductions: null, net: null }, notes: [], period: null, employer: null, defaultMode: 'GROSS_AND_DEDUCTIONS' }, { engine: 'Manual', advice: [] }); go('slipreview', null, { replace: true }); } }, 'Isi manual')] });
  };

  SCREENS.slipreview = () => {
    if (!draft) return frame({ title: 'Slip gaji', back: true, children: [h('p', { class: 'empty card' }, 'Tidak ada slip yang sedang dibuka.')] });
    const d = draft;
    const netBox = h('div'), rowsBox = h('div'), postBox = h('div');

    function info() {
      const t = R.SlipMath.totals(d.rows.filter((r) => r.amount > 0));
      let net, source;
      if (d.printed.net != null) { net = d.printed.net; source = 'Terbaca dari slip'; }
      else if (d.printed.gross != null && d.printed.deductions != null) { net = d.printed.gross - d.printed.deductions; source = 'Dari total pendapatan dan potongan di slip'; }
      else if (t.gross > 0) { net = t.net; source = 'Dihitung dari baris'; }
      else { net = null; source = 'Belum terbaca'; }
      const diff = net == null ? null : net - t.net;
      return { t, net, source, diff, match: net != null && t.gross > 0 ? diff === 0 : null };
    }
    function addRow(label, amount, type) { d.rows.push({ id: S.uid(), label, amount, type, source: '' }); drawRows(); drawNet(); }
    function addAdjustment() {
      const i = info();
      if (i.match !== false) return;
      addRow(i.diff > 0 ? 'Selisih belum terdaftar (pendapatan)' : 'Selisih belum terdaftar (potongan)', Math.abs(i.diff), i.diff > 0 ? 'EARNING' : 'DEDUCTION');
    }
    function editNet() {
      let v = d.printed.net || 0;
      modal({ title: 'Gaji bersih di slip', body: [h('p', null, 'Isi sesuai angka gaji bersih yang tercetak di slip.'), moneyInput(v, (n) => { v = n; })], buttons: [{ label: 'Hapus angka', value: 'clear' }, { label: 'Batal', value: false }, { label: 'Simpan', kind: 'primary', value: true }] })
        .then((r) => { if (r === 'clear') d.printed.net = null; else if (r) d.printed.net = v || null; drawNet(); });
    }

    function drawNet() {
      const i = info();
      let check;
      if (i.match === true) check = h('p', { class: 'ok-text' }, 'Cocok dengan hitungan baris (pendapatan dikurangi potongan).');
      else if (i.match === false) check = h('div', null, h('p', { class: 'warn-text' }, `Hitungan baris ${R.rupiah(i.t.net)}. Selisih ${R.rupiah(Math.abs(i.diff))} ${i.diff > 0 ? '(ada pendapatan yang belum terbaca)' : '(ada potongan yang belum terbaca)'}.`),
        h('button', { class: 'btn sm', onclick: addAdjustment }, 'Tambah baris selisih'));
      else check = null;
      netBox.replaceChildren(h('section', { class: 'card hero' }, h('small', null, 'Gaji bersih'), h('div', { class: 'big' }, i.net == null ? '-' : R.rupiah(i.net)),
        h('small', null, i.source), h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', onclick: editNet }, 'Ubah angka di slip')), check,
        h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('small', null, 'Pendapatan'), h('strong', { class: 'in' }, R.rupiah(i.t.gross))), h('div', { class: 'stat' }, h('small', null, 'Potongan'), h('strong', { class: 'out' }, R.rupiah(i.t.deductions)))),
        d.notes.length ? h('ul', { class: 'notes' }, d.notes.map((n) => h('li', null, n))) : null));
      drawPost();
    }

    function drawRows() {
      const dup = (r) => d.rows.filter((x) => x.label.toLowerCase() === r.label.toLowerCase() && x.amount === r.amount).length > 1;
      rowsBox.replaceChildren(h('section', { class: 'card' }, h('h3', null, 'Baris slip'), null,
        d.rows.length ? h('div', { class: 'list' }, d.rows.map((r, idx) => {
          const row = h('div', { class: 'slip-row' + (r.type === 'UNCLASSIFIED' ? ' warn' : '') });
          const sel = h('select', { class: 'input', 'aria-label': 'Jenis baris', onchange: (e) => { r.type = e.target.value; row.classList.toggle('warn', r.type === 'UNCLASSIFIED'); drawNet(); } },
            Object.entries(TYPE_LABEL).map(([k, v]) => h('option', { value: k, selected: r.type === k }, v)));
          row.append(h('input', { class: 'input', value: r.label, 'aria-label': 'Nama baris', oninput: (e) => { r.label = e.target.value; } }),
            moneyInput(r.amount, (n) => { r.amount = n; drawNet(); }, { 'aria-label': 'Nominal' }), sel,
            h('button', { class: 'btn ghost sm', onclick: () => { d.rows.splice(idx, 1); drawRows(); drawNet(); } }, 'Hapus'),
            dup(r) ? h('small', { class: 'warn-text' }, 'Mungkin ganda.') : (r.source === 'cocok dengan gaji bersih' ? null : null));
          return row;
        })) : h('p', { class: 'empty' }, 'Belum ada baris. Tambahkan baris di bawah.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', onclick: () => addRow('', 0, 'EARNING') }, 'Tambah pendapatan'), h('button', { class: 'btn sm', onclick: () => addRow('', 0, 'DEDUCTION') }, 'Tambah potongan'))));
    }

    function drawPost() {
      const i = info();
      d.mode = 'NET_ONLY';
      postBox.replaceChildren(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Dicatat sebagai pemasukan'), h('strong', { class: 'card-total in' }, i.net == null ? '-' : R.rupiah(i.net))),
        h('div', { class: 'two' }, field('Dompet', h('select', { class: 'input', onchange: (e) => { d.walletId = e.target.value; } }, A.orderWallets(A.activeWallets()).map((w) => h('option', { value: w.id, selected: w.id === d.walletId }, w.name)))),
          field('Tanggal masuk', h('input', { class: 'input', type: 'date', value: d.date, onchange: (e) => { d.date = e.target.value || d.date; } })))));
    }

    async function save() {
      const rows = d.rows.filter((r) => r.amount > 0);
      if (rows.some((r) => r.type === 'UNCLASSIFIED')) return toast('Atur jenis baris yang "Belum diatur" dulu.');
      const i = info();
      if (!(i.net > 0)) return toast('Gaji bersih belum ada. Isi angkanya dulu.');
      const finalRows = d.rows.filter((r) => r.amount > 0);
      const slip = { id: S.uid(), period: d.period, employer: d.employer, rows: finalRows.map(({ label, amount, type }) => ({ label, amount, type })), printed: { ...d.printed }, mode: 'NET_ONLY', walletId: d.walletId, createdAt: Date.now(), activityIds: [] };
      const title = `Gaji ${d.period ? R.monthLabel(d.period) : R.formatDate(d.date)}`;
      try {
        slip.activityIds.push(A.addActivity({ type: 'INCOME', amount: i.net, walletId: d.walletId, category: 'Gaji', occurredOn: d.date, merchant: d.employer, note: title + ' (bersih)', source: 'slip', sourceId: slip.id }).id);
      } catch (e) { return toast(e.message); }
      db().slips.push(slip); S.save(); draft = null;
      toast('Gaji dicatat'); root('home');
    }

    drawRows(); drawNet();
    const q = [...d.advice, ...(d.warning ? [d.warning] : [])];
    return frame({ title: 'Periksa slip gaji', back: true, children: [
      q.length ? h('section', { class: 'card warn' }, h('strong', null, 'Perhatian'), h('ul', { class: 'notes' }, q.map((x) => h('li', null, x)))) : null,
      netBox,
      d.imageUrl ? h('details', { class: 'card' }, h('summary', null, 'Lihat gambar slip'), h('img', { class: 'slip-img', src: d.imageUrl, alt: 'Slip gaji yang dibaca' })) : null,
      d.ocrText ? h('details', { class: 'card ocr-text-details' }, h('summary', null, 'Lihat semua teks hasil pembacaan'), null, h('textarea', { class: 'input', rows: 6, readOnly: true, value: d.ocrText })) : null,
      rowsBox, postBox,
      null,
      h('button', { class: 'btn primary block', onclick: save }, 'Simpan ke aktivitas'),
      h('button', { class: 'btn ghost block', onclick: () => { draft = null; back(); } }, 'Batal')] });
  };

  async function load(files, onStage) { const res = await KHOCR.readFiles(files, onStage); draft = makeDraft(SL.readWords(res.words), res); return draft; }
  function fromResult(res) { draft = makeDraft(SL.readWords(res.words), res); return draft; }
  function loadText(text) {
    let a = SL.readText(text);
    if (!a.rows.length) a = SL.readText(KHExtra.storyToSlipText(text));
    if (!a.rows.length && a.printed.net == null) throw new Error('Belum ada komponen gaji yang terbaca. Contoh: gaji pokok 4,5jt, tunjangan 500rb, BPJS 100rb.');
    draft = makeDraft(a, { engine: 'Cerita Anda', advice: [] }); return draft;
  }
  window.KHSlipUI = { getDraft: () => draft, setDraft: (x) => { draft = x; }, load, fromResult, loadText };
})();
