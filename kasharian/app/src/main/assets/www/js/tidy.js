/* KasHarian tidy: "Rapikan data". Memeriksa seluruh catatan, menemukan data ganda, pindah dana yang terhitung dua kali,
   kategori belum pasti, dan nominal janggal. Tidak mengubah apa pun sebelum disetujui; ada status pemulihan sementara dan tombol batalkan.
   Inti analisis tidak memakai DOM sehingga bisa dites di Node. */
(function (root) {
  'use strict';
  const live = (d) => d.activities.filter((a) => !a.deletedAt);
  const txt = (a) => ((a.merchant || '') + ' ' + (a.note || '')).toLowerCase();
  const amountOf = (a) => root.KHRules && root.KHRules.ledgerAmountValue ? root.KHRules.ledgerAmountValue(a && a.amount) : (Number(a && a.amount) || 0);
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  const MOVE_RE = /(pindah dana|top\s*-?up|isi saldo|tarik tunai|setor tunai|ke rekening sendiri|transfer dari (rekening|bank))/i;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const kindOf = (a) => { if (root.KHRules && root.KHRules.activityType) return root.KHRules.activityType(a); const t = String(a.type || a.kind || '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return ({ IN: 'INCOME', MASUK: 'INCOME', PEMASUKAN: 'INCOME', INCOMING: 'INCOME', CREDIT: 'INCOME', DEPOSIT: 'INCOME', OUT: 'EXPENSE', KELUAR: 'EXPENSE', PENGELUARAN: 'EXPENSE', OUTGOING: 'EXPENSE', SPEND: 'EXPENSE', SPENDING: 'EXPENSE', DEBIT: 'EXPENSE', PAYMENT: 'EXPENSE', MOVE: 'TRANSFER', PINDAH: 'TRANSFER', PINDAH_DANA: 'TRANSFER', INTERNAL_TRANSFER: 'TRANSFER' })[t] || t; };
  const isOut = (a) => kindOf(a) === 'EXPENSE' || (kindOf(a) === 'ADJUSTMENT' && amountOf(a) < 0);
  const isIn = (a) => kindOf(a) === 'INCOME' || (kindOf(a) === 'ADJUSTMENT' && amountOf(a) > 0);

  function balances(d) {
    const res = {}; d.wallets.forEach((w) => { res[w.id] = root.KHRules && root.KHRules.ledgerAmountValue ? root.KHRules.ledgerAmountValue(w.openingBalance) : (Number(w.openingBalance) || 0); });
    live(d).forEach((a) => {
      const amount = Math.abs(amountOf(a));
      if (kindOf(a) === 'INCOME') res[a.walletId] = (res[a.walletId] || 0) + amount;
      else if (kindOf(a) === 'ADJUSTMENT') res[a.walletId] = (res[a.walletId] || 0) + amountOf(a);
      else if (kindOf(a) === 'EXPENSE') res[a.walletId] = (res[a.walletId] || 0) - amount;
      else if (kindOf(a) === 'TRANSFER' && a.toWalletId && a.toWalletId !== a.walletId) {
        res[a.walletId] = (res[a.walletId] || 0) - amount;
        res[a.toWalletId] = (res[a.toWalletId] || 0) + amount;
      }
    });
    return res;
  }
  function totals(d) {
    let income = 0, expense = 0, moved = 0;
    live(d).forEach((a) => { if (kindOf(a) === 'INCOME') income += Math.abs(amountOf(a)); else if (kindOf(a) === 'EXPENSE') expense += Math.abs(amountOf(a)); else if (kindOf(a) === 'TRANSFER') moved += Math.abs(amountOf(a)); });
    const b = balances(d), total = d.wallets.filter((w) => w.includeInTotal !== false && !w.archived).reduce((s, w) => s + (b[w.id] || 0), 0);
    return { income, expense, moved, total, balances: b };
  }

  /** Tebak dompet pasangan: dompet yang namanya disebut di catatan (BNI, BRI, ...), kas untuk tarik tunai, selain itu dompet lain pertama. */
  function guessPartner(d, wid, a) {
    const ws = d.wallets.filter((w) => !w.archived && w.id !== wid), t = txt(a);
    const bank = /(bni|bri|bca|mandiri|bsi|cimb|permata|jago|seabank|btn|ovo|dana|shopeepay|gopay)/.exec(t);
    let w = bank && ws.find((x) => x.name.toLowerCase().includes(bank[1]));
    if (!w && /(tarik\s*tunai|setor\s*tunai)/.test(t)) w = ws.find((x) => /(tunai|kas|cash|dompet)/i.test(x.name) || x.type === 'CASH');
    return (w || ws[0] || {}).id || '';
  }

  /** Hasil: { items, totals }. Tiap item punya apply (dicentang), safe (aman otomatis atau perlu ditanyakan). */
  const sigOf = (it) => it.kind + '|' + (it.ids || it.wallets || []).join(',');
  function analyze(d, o) {
    o = o || {}; const fmt = o.rupiah || ((n) => 'Rp' + n), wn = (id) => (d.wallets.find((w) => w.id === id) || { name: '-' }).name;
    const items = []; let seq = 0; const used = new Set(); const mk = (it) => { it.id = 'i' + ++seq; items.push(it); return it; };
    const acts = live(d);

    // 1. dompet kembar (nama sama)
    const byName = {}; d.wallets.filter((w) => !w.archived).forEach((w) => { (byName[norm(w.name)] = byName[norm(w.name)] || []).push(w); });
    Object.values(byName).filter((g) => g.length > 1).forEach((g) => mk({ kind: 'walletdup', safe: true, apply: true, title: `Dompet "${g[0].name}" ada ${g.length} buah`, detail: 'Digabung jadi satu dompet. Riwayat dan saldo awal ikut dipindahkan.', wallets: g.map((w) => w.id) }));

    // 2. data ganda dari impor yang sama (sourceId sama)
    const bySrc = {}; acts.forEach((a) => { if (a.sourceId) (bySrc[a.sourceId + '|' + kindOf(a) + '|' + a.walletId] = bySrc[a.sourceId + '|' + kindOf(a) + '|' + a.walletId] || []).push(a); });
    Object.values(bySrc).filter((g) => g.length > 1).forEach((g) => { g.slice(1).forEach((x) => used.add(x.id)); mk({ kind: 'dupe', safe: true, apply: true, title: `Catatan ganda: ${g[0].merchant || g[0].note || 'transaksi'} ${fmt(Math.abs(amountOf(g[0])))}`, detail: `Tercatat ${g.length} kali dari impor yang sama (${g[0].occurredOn}). Sisanya disembunyikan.`, ids: g.map((x) => x.id) }); });
    // ganda mirip (tanpa penanda impor): tanya
    const bySim = {}; acts.filter((a) => !used.has(a.id) && a.source && a.source !== 'manual' && kindOf(a) !== 'TRANSFER').forEach((a) => { const k = [kindOf(a), a.walletId, amountOf(a), a.occurredOn, norm(a.merchant || a.note)].join('|'); (bySim[k] = bySim[k] || []).push(a); });
    Object.values(bySim).filter((g) => g.length > 1).forEach((g) => { g.slice(1).forEach((x) => used.add(x.id)); mk({ kind: 'dupe', safe: false, apply: g.every((x) => x.source === 'struk'), title: `Mungkin ganda: ${g[0].merchant || g[0].note || 'transaksi'} ${fmt(Math.abs(amountOf(g[0])))}`, detail: `${g.length} catatan dengan tanggal, dompet, dan nominal sama (${g[0].occurredOn}). Hapus yang kembar?`, ids: g.map((x) => x.id) }); });

    // 3. pasangan keluar-masuk antar dompet = satu perpindahan
    const outs = acts.filter((a) => !used.has(a.id) && isOut(a)), ins = acts.filter((a) => !used.has(a.id) && isIn(a));
    outs.forEach((a) => {
      const cand = ins.filter((b) => !used.has(b.id) && b.walletId !== a.walletId && Math.abs(amountOf(b)) === Math.abs(amountOf(a)) && Math.abs(dayDiff(a.occurredOn, b.occurredOn)) <= 1).sort((p, q) => Math.abs(dayDiff(a.occurredOn, p.occurredOn)) - Math.abs(dayDiff(a.occurredOn, q.occurredOn)))[0];
      if (!cand || used.has(a.id)) return; used.add(a.id); used.add(cand.id);
      const hint = MOVE_RE.test(txt(a)) || MOVE_RE.test(txt(cand));
      mk({ kind: 'pair', safe: hint, apply: hint, title: `${fmt(Math.abs(amountOf(a)))} keluar dari ${wn(a.walletId)} dan masuk ke ${wn(cand.walletId)}`, detail: `Keduanya ${a.occurredOn === cand.occurredOn ? 'sehari' : 'berdekatan'} dan nominalnya sama, kemungkinan satu perpindahan dana, bukan pemasukan dan pengeluaran. Satukan jadi pindah dana?`, ids: [a.id, cand.id] });
    });

    // 4. pindah dana yang tersimpan sepihak (penyesuaian, atau pemasukan "top up")
    acts.filter((a) => !used.has(a.id) && kindOf(a) !== 'TRANSFER' && MOVE_RE.test(txt(a)) && (['ADJUSTMENT', 'INCOME', 'EXPENSE'].includes(kindOf(a)))).forEach((a) => {
      used.add(a.id); const partner = guessPartner(d, a.walletId, a), out = isOut(a), ws = d.wallets.filter((w) => !w.archived && w.id !== a.walletId);
      if (!ws.length) return;
      mk({ kind: 'move', safe: false, apply: !!partner, partner, partners: ws.map((w) => ({ id: w.id, name: w.name })),
        title: `${a.merchant || a.note || 'Pindah dana'} ${fmt(Math.abs(amountOf(a)))} tercatat sebagai ${kindOf(a) === 'INCOME' ? 'pemasukan' : kindOf(a) === 'EXPENSE' ? 'pengeluaran' : 'penyesuaian'} di ${wn(a.walletId)}`,
        detail: out ? 'Ini terlihat seperti dana yang pindah ke dompet lain. Pilih dompet tujuannya:' : 'Ini terlihat seperti dana yang masuk dari dompet lain (bukan gaji baru). Pilih dompet asalnya:', ids: [a.id] });
    });

    // 5. kategori belum pasti
    const unc = {}; acts.filter((a) => kindOf(a) === 'EXPENSE' && a.category === 'Belum pasti').forEach((a) => { const k = norm(a.merchant || a.note) || '_'; (unc[k] = unc[k] || []).push(a); });
    Object.entries(unc).forEach(([k, g]) => { const guess = o.categorize ? o.categorize(g[0].merchant || g[0].note || '') : null; mk({ kind: 'cat', safe: !!guess, apply: !!guess, category: guess || '', cats: o.cats || [], title: `${g[0].merchant || g[0].note || 'Tanpa nama'} (${g.length} catatan) belum punya kategori`, detail: guess ? `Cocok dengan kategori ${guess}.` : 'Pilih kategori agar masuk hitungan Rencana uang.', ids: g.map((x) => x.id) }); });

    // 6. nominal janggal dari struk
    const exp = acts.filter((a) => kindOf(a) === 'EXPENSE').map((a) => Math.abs(amountOf(a))).sort((p, q) => p - q), med = exp.length ? exp[exp.length >> 1] : 0;
    acts.filter((a) => kindOf(a) === 'EXPENSE' && a.source === 'struk' && Math.abs(amountOf(a)) >= 1000000 && Math.abs(amountOf(a)) > med * 20).forEach((a) => mk({ kind: 'big', safe: false, apply: false, newAmount: 0, title: `Nominal struk janggal: ${a.merchant || a.note || 'struk'} ${fmt(amountOf(a))}`, detail: 'Jauh di atas pengeluaran Anda yang biasa, mungkin salah baca. Isi nominal yang benar bila perlu:', ids: [a.id] }));

    const ign = new Set(o.ignore || []);
    return { items: items.filter((it) => !ign.has(sigOf(it))), totals: totals(d) };
  }

  /** Terapkan item yang dicentang pada d. fix = { walletId: saldoNyata }. Mengembalikan jumlah perbaikan. */
  function apply(d, items, o) {
    o = o || {}; const now = o.now || Date.now(), uid = o.uid || (() => 'x' + Math.random().toString(36).slice(2)), find = (id) => d.activities.find((a) => a.id === id && !a.deletedAt);
    let n = 0;
    items.filter((it) => it.apply).forEach((it) => {
      if (it.kind === 'walletdup') { const [first, ...rest] = it.wallets.map((id) => d.wallets.find((w) => w.id === id)).filter(Boolean); rest.forEach((w) => { d.activities.forEach((a) => { if (a.walletId === w.id) a.walletId = first.id; if (a.toWalletId === w.id) a.toWalletId = first.id; }); first.openingBalance = amountOf({ amount: first.openingBalance }) + amountOf({ amount: w.openingBalance }); w.openingBalance = 0; w.archived = true; }); n++; }
      else if (it.kind === 'dupe') { it.ids.slice(1).forEach((id) => { const a = find(id); if (a) { a.deletedAt = now; a.updatedAt = now; } }); n++; }
      else if (it.kind === 'pair') { const a = find(it.ids[0]), b = find(it.ids[1]); if (a && b) { Object.assign(a, { type: 'TRANSFER', amount: Math.abs(amountOf(a)), toWalletId: b.walletId, category: 'Pindah dompet', note: 'Pindah dana (digabung otomatis)', updatedAt: now }); b.deletedAt = now; b.updatedAt = now; n++; } }
      else if (it.kind === 'move') { const a = find(it.ids[0]); if (a && it.partner && it.partner !== a.walletId) { const out = isOut(a), amt = Math.abs(amountOf(a)), me = a.walletId; Object.assign(a, { type: 'TRANSFER', amount: amt, walletId: out ? me : it.partner, toWalletId: out ? it.partner : me, category: 'Pindah dompet', updatedAt: now }); n++; } }
      else if (it.kind === 'cat') { if (it.category) { it.ids.forEach((id) => { const a = find(id); if (a) { a.category = it.category; a.updatedAt = now; } }); n++; } }
      else if (it.kind === 'big') { const a = find(it.ids[0]); if (a && it.newAmount > 0 && it.newAmount !== amountOf(a)) { a.amount = it.newAmount; a.updatedAt = now; n++; } }
    });
    const fix = o.fix || {}, b = balances(d);
    Object.entries(fix).forEach(([wid, actual]) => { if (actual == null || actual === '' || isNaN(actual)) return; const diff = Math.round(actual) - Math.round(b[wid] || 0); if (diff) { d.activities.push(diff < 0 ? { id: uid(), type: 'EXPENSE', amount: -diff, walletId: wid, toWalletId: null, category: 'Lainnya', occurredOn: o.today, merchant: 'Selisih saldo', note: 'Pengeluaran belum tercatat (selisih dengan saldo nyata)', source: 'selisih', sourceId: null, createdAt: now, updatedAt: now, deletedAt: null } : { id: uid(), type: 'ADJUSTMENT', amount: diff, walletId: wid, toWalletId: null, category: 'Penyesuaian', occurredOn: o.today, merchant: null, note: 'Penyesuaian saldo saat rapikan data', source: 'rapikan', sourceId: null, createdAt: now, updatedAt: now, deletedAt: null }); n++; } });
    return n;
  }
  function preview(d, items, o) { const c = clone({ wallets: d.wallets, activities: d.activities }); apply(c, items, o); return totals(c); }

  const core = { sigOf, analyze, apply, preview, totals, balances, guessPartner, clone };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  root.KHTidy = core;
  if (!root.KHApp) return;

  // ---------- layar ----------
  const A = KHApp, { h, R, S, db, go, frame, card, SCREENS, toast } = A;
  const { moneyInput, confirmBox } = KHUI;
  let T = null;
  const opts = (extra) => Object.assign({ ignore: db().tidyIgnore || [], rupiah: R.rupiah, today: R.todayISO(), uid: S.uid, cats: R.CAT.expense, categorize: (t) => { if (!t) return null; let c = R.FreeTextParser.parse(t, R.todayISO(), db().memory).category; if (c === 'Belum pasti' && root.KHScan) { const b = KHScan.detectBrand([t]); if (b) c = b.cat; } return c === 'Belum pasti' ? null : c; } }, extra || {});
  const data = () => ({ wallets: db().wallets, activities: db().activities });
  function run() { T = Object.assign(analyze(data(), opts()), { fix: {} }); }
  const fixOf = () => { const f = {}; Object.entries(T.fix).forEach(([k, v]) => { if (v > 0) f[k] = v; }); return f; };

  /** Catatan kecil di kartu saldo Beranda: jumlah temuan dan saldo yang akan tampil bila dirapikan, plus tombol menuju layar Rapikan data. */
  core.heroNote = () => {
    let note = null;
    try {
      const d = data(), key = d.activities.length + ':' + d.activities.reduce((m, a) => Math.max(m, a.updatedAt || 0), 0) + ':' + d.wallets.length + ':' + (db().tidyIgnore || []).length;
      if (d.activities.length <= 4000) {
        if (!core._hc || core._hc.key !== key) { const r0 = analyze(d, opts()); core._hc = { key, r: r0, after: preview(d, r0.items, opts()).total }; }
        const r = core._hc.r, todo = r.items.filter((i) => i.apply), after = core._hc.after;
        if (r.items.length) { note = { __n: r.items.length }; }
      }
    } catch (e) { /* kartu saldo tetap tampil tanpa catatan */ }
    const n = note ? note.__n : 0;
    return n ? h('div', { class: 'hero-tidy' }, h('button', { class: 'pill warn', type: 'button', onclick: () => go('rapikan') }, h('small', null, 'Rapikan'), h('strong', null, n + ' temuan'))) : null;
  };

  SCREENS.rapikan = () => {
    const sum = h('div'), body = h('div');
    const undo = db().tidyUndo;
    const drawSum = () => {
      const now = T.totals, after = preview(data(), T.items, opts({ fix: fixOf() })), row = (l, a, b) => h('div', { class: 'stat' }, h('small', null, l), h('strong', null, R.rupiah(b)), h('small', null, a === b ? 'tetap' : 'dari ' + R.rupiah(a)));
      sum.replaceChildren(card(h('h3', null, 'Dampak ke total'), h('div', { class: 'stats' }, row('Pemasukan', now.income, after.income), row('Pengeluaran', now.expense, after.expense), row('Total saldo', now.total, after.total)),
        null));
    };
    const itemEl = (it) => {
      const el = h('section', { class: 'card entry' });
      const chk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.apply, onchange: (e) => { it.apply = e.target.checked; drawSum(); } }), h('span', null, h('strong', null, it.title)));
      el.append(chk, ['move', 'pair'].includes(it.kind) ? h('p', { class: 'hint' }, it.detail) : null, h('button', { class: 'btn ghost sm', onclick: () => { (db().tidyIgnore = db().tidyIgnore || []).push(sigOf(it)); S.save(); T.items = T.items.filter((x) => x !== it); drawBody(); drawSum(); toast('Temuan diabaikan.'); } }, 'Abaikan temuan ini'));
      if (it.kind === 'move') el.append(h('select', { class: 'input', 'aria-label': 'Dompet pasangan', onchange: (e) => { it.partner = e.target.value; it.apply = !!it.partner; drawBody(); drawSum(); } }, [h('option', { value: '', selected: !it.partner }, 'Biarkan seperti sekarang'), ...it.partners.map((p) => h('option', { value: p.id, selected: it.partner === p.id }, p.name))]));
      if (it.kind === 'cat') el.append(h('select', { class: 'input', 'aria-label': 'Kategori', onchange: (e) => { it.category = e.target.value; it.apply = !!it.category; drawBody(); drawSum(); } }, [h('option', { value: '', selected: !it.category }, 'Pilih kategori'), ...it.cats.map((c) => h('option', { value: c, selected: it.category === c }, c))]));
      if (it.kind === 'big') el.append(moneyInput(it.newAmount || 0, (n) => { it.newAmount = n; it.apply = n > 0; drawSum(); }));
      return el;
    };
    const drawBody = () => {
      const safe = T.items.filter((i) => i.safe), ask = T.items.filter((i) => !i.safe), ws = A.activeWallets(), bal = preview(data(), T.items, opts()).balances;
      body.replaceChildren(...[
        !T.items.length ? card(h('h3', null, 'Data sudah rapi'), null) : null,
        safe.length ? h('div', null, h('h3', { class: 'section' }, `Perbaikan aman (${safe.length})`), null, ...safe.map(itemEl)) : null,
        ask.length ? h('div', null, h('h3', { class: 'section' }, `Perlu konfirmasi Anda (${ask.length})`), null, ...ask.map(itemEl)) : null,
        card(h('h3', null, 'Cek saldo nyata (boleh dilewati)'), null,
          ...ws.map((w) => h('div', { class: 'wallet' }, h('div', null, h('strong', null, w.name), h('small', { style: { display: 'block' } }, 'Menurut aplikasi sesudah dirapikan: ' + R.rupiah(bal[w.id] || 0))), moneyInput(T.fix[w.id] || 0, (n) => { T.fix[w.id] = n; drawSum(); })))),
        h('button', { class: 'btn primary block', onclick: doApply }, 'Terapkan perbaikan yang dicentang')].filter(Boolean));
    };
    async function doApply() {
      const n = T.items.filter((i) => i.apply).length + Object.keys(fixOf()).length;
      if (!n) return toast('Belum ada yang dicentang.');
      if (!(await confirmBox('Terapkan perbaikan', `${n} perbaikan akan diterapkan. Status sebelum perubahan disimpan sementara agar bisa dibatalkan.`, 'Terapkan'))) return;
      db().tidyUndo = { at: Date.now(), snap: clone(data()) };
      const c = apply(data(), T.items, opts({ now: Date.now(), fix: fixOf() }));
      (db().tidyLog = db().tidyLog || []).unshift({ at: Date.now(), n: c, before: T.totals.total, after: totals(data()).total }); db().tidyLog.length = Math.min(db().tidyLog.length, 20);
      S.save(); T = null; toast(`${c} perbaikan diterapkan. Saldo akhir tampil di Beranda. Bisa dibatalkan dari Rapikan data.`); A.root('home');
    }
    async function doUndo() {
      if (!(await confirmBox('Batalkan perapian', 'Data dikembalikan ke kondisi sebelum perapian terakhir.', 'Kembalikan'))) return;
      const u = db().tidyUndo; db().wallets.splice(0, db().wallets.length, ...u.snap.wallets); db().activities.splice(0, db().activities.length, ...u.snap.activities); db().tidyUndo = null; S.save(); T = null; toast('Dikembalikan.'); A.render();
    }
    const children = [];
    if (undo) children.push(card(h('h3', null, 'Perapian terakhir'), null, h('button', { class: 'btn', onclick: doUndo }, 'Batalkan perapian terakhir')));
    if (!T) children.push(card(h('h3', null, 'Rapikan data'), null,
      null, h('button', { class: 'btn primary block', onclick: () => { run(); A.render(); } }, 'Periksa data saya')));
    else { drawSum(); drawBody(); children.push(sum, body); }
    return frame({ title: 'Rapikan data', back: true, children });
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
