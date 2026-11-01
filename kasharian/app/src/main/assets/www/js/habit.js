/* KasHarian: saran rencana dari kebiasaan 3 bulan.
   Pengeluaran per kategori dari 3 bulan sebelum bulan ini dihitung. Kategori yang muncul di minimal 2 dari 3 bulan dianggap
   "sering" dan menjadi Kebutuhan; sisa pemasukan rata-rata menjadi Keinginan (atau diatur sendiri lewat Custom).
   Ini hanya saran: rencana baru berubah setelah pengguna menyetujuinya. */
(function (root) {
  'use strict';
  const A = KHApp, { h, R, db, go, card, toast, S } = A, X = KHExtra;
  const MIN_MONTHS = 2;                                   // "sering" = muncul di minimal 2 dari 3 bulan
  const sum = (l) => l.reduce((a, b) => a + b, 0);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function analyze(ym) {
    ym = ym || R.monthOf(R.todayISO());
    const months = [R.addMonths(ym, -3), R.addMonths(ym, -2), R.addMonths(ym, -1)], acts = A.liveActs();
    const inMonth = (m, t) => acts.filter((a) => R.activityType(a) === t && R.monthOf(a.occurredOn) === m);
    const withData = months.filter((m) => inMonth(m, 'INCOME').length || inMonth(m, 'EXPENSE').length).length;
    const incomeAvg = Math.round(sum(months.map((m) => sum(inMonth(m, 'INCOME').map((a) => Math.abs(R.ledgerAmountValue(a.amount)))))) / 3);
    const cat = {};
    months.forEach((m, i) => inMonth(m, 'EXPENSE').filter((a) => a.category !== 'Potongan gaji' && a.category !== 'Tabungan dan investasi').forEach((a) => {
      const c = cat[a.category] || (cat[a.category] = { category: a.category, total: 0, seen: new Set() });
      c.total += Math.abs(R.ledgerAmountValue(a.amount)); c.seen.add(i);
    }));
    const items = Object.values(cat).map((c) => ({ category: c.category, avg: Math.round(c.total / 3), months: c.seen.size, frequent: c.seen.size >= MIN_MONTHS })).sort((a, b) => b.avg - a.avg);
    return { ym, months, withData, ready: withData >= 3 && incomeAvg > 0, incomeAvg, items };
  }
  /** Dari kategori yang dipilih menjadi Kebutuhan: persen Kebutuhan dan sisanya. */
  function split(res, chosen) {
    const needs = sum(res.items.filter((i) => chosen.has(i.category)).map((i) => i.avg));
    const over = res.incomeAvg > 0 && needs > res.incomeAvg;
    const needPct = res.incomeAvg > 0 ? clamp(Math.round(needs / res.incomeAvg * 100), 0, 100) : 0;
    return { needs, over, needPct, wantPct: 100 - needPct, rest: Math.max(0, res.incomeAvg - needs) };
  }

  function apply(res, chosen, mode, prm) {
    const sp = split(res, chosen), was = X.plan().chosen;
    if (mode === 'custom') {
      X.customStart();
      const P = X.plan(), save = Math.min(10, sp.wantPct), need = P.buckets.find((b) => b.id === 'need'), want = P.buckets.find((b) => b.id === 'want'), sv = P.buckets.find((b) => b.save);
      need.pct = sp.needPct; want.pct = sp.wantPct - save; sv.pct = save; P.preset = 'custom';
    } else {
      X.applyPreset('need-want');
      const P = X.plan(); P.buckets.find((b) => b.id === 'need').pct = sp.needPct; P.buckets.find((b) => b.id === 'want').pct = sp.wantPct;
    }
    db().habitApplied = res.ym; S.save();
    toast(mode === 'custom' ? 'Saran dipakai. Atur persen sesuai maumu.' : 'Rencana dari kebiasaanmu dipakai');
    if (mode !== 'custom' && prm && prm.from === 'home') A.root('home'); else A.render();
  }

  /** Kartu di layar Rencana uang. */
  function planCard(prm) {
    const res = analyze();
    if (!res.ready) {
      return card(h('h3', null, 'Dari kebiasaan 3 bulan'),
        h('p', { class: 'note' }, 'Catat pemasukan dan pengeluaran selama 3 bulan. Di bulan ke-4, aplikasi menghitung pengeluaran yang sering jadi Kebutuhan dan menyarankan rencananya.'),
        h('div', { class: 'habit-progress', role: 'img', 'aria-label': `Data terkumpul ${res.withData} dari 3 bulan` },
          [0, 1, 2].map((i) => h('i', { class: i < res.withData ? 'on' : '' }))),
        h('small', { class: 'habit-prog-text' }, `Data baru ${Math.min(res.withData, 3)} dari 3 bulan`));
    }
    const chosen = new Set(res.items.filter((i) => i.frequent).map((i) => i.category));
    const body = h('div');
    const draw = () => {
      const sp = split(res, chosen), rare = res.items.filter((i) => !chosen.has(i.category));
      body.replaceChildren(
        h('p', { class: 'note' }, 'Pengeluaran yang muncul di minimal 2 dari 3 bulan dianggap sering, jadi Kebutuhan. Hilangkan centang bila ada yang sebenarnya bukan kebutuhan.'),
        h('div', { class: 'habit-stats' },
          h('span', null, h('small', null, 'Pemasukan rata-rata'), h('strong', null, R.rupiah(res.incomeAvg))),
          h('span', null, h('small', null, 'Kebutuhan rutin'), h('strong', null, R.rupiah(sp.needs)))),
        h('div', { class: 'habit-list' }, res.items.map((it, i) => h('label', { class: 'habit-row' + (chosen.has(it.category) ? ' on' : ''), style: { '--i': i } },
          h('input', { type: 'checkbox', checked: chosen.has(it.category), onchange: (e) => { e.target.checked ? chosen.add(it.category) : chosen.delete(it.category); draw(); } }),
          h('span', { class: 'habit-name' }, h('strong', null, it.category), h('small', null, `Muncul di ${it.months} dari 3 bulan`)),
          h('span', { class: 'habit-amt' }, R.rupiah(it.avg))))),
        rare.length ? h('p', { class: 'habit-rare' }, `${rare.length} kategori lain dihitung sebagai Keinginan: ${R.rupiah(sum(rare.map((i) => i.avg)))} per bulan.`) : null,
        h('div', { class: 'habit-result' + (sp.over ? ' over' : '') },
          h('div', null, h('small', null, 'Kebutuhan'), h('strong', null, sp.needPct + '%')),
          h('div', null, h('small', null, 'Keinginan'), h('strong', null, sp.wantPct + '%'))),
        sp.over ? h('p', { class: 'rec-warn' }, 'Pengeluaran rutinmu sudah lebih besar dari pemasukan rata-rata. Coba kurangi dulu sebelum membagi uang.') : null,
        h('button', { class: 'btn primary block', type: 'button', onclick: () => apply(res, chosen, 'needwant', prm) }, `Pakai: Kebutuhan ${sp.needPct}% + Keinginan ${sp.wantPct}%`),
        h('button', { class: 'btn block', type: 'button', onclick: () => apply(res, chosen, 'custom', prm) }, 'Atur sendiri (Custom)'));
    };
    draw();
    return card(h('div', { class: 'card-head' }, h('h3', null, 'Dari kebiasaan 3 bulan'), h('small', { class: 'tag' }, 'Saran')), body);
  }

  /** Kartu kecil di Beranda: muncul sekali per bulan saat saran sudah siap. */
  function banner() {
    const ym = R.monthOf(R.todayISO());
    if (db().habitSeen === ym || db().habitApplied === ym) return null;
    const res = analyze(ym);
    if (!res.ready) return null;
    const sp = split(res, new Set(res.items.filter((i) => i.frequent).map((i) => i.category)));
    return h('section', { class: 'card habit-banner' },
      h('small', { class: 'plan-kicker' }, 'SARAN BULAN INI'),
      h('strong', null, 'Rencana dari kebiasaan 3 bulanmu sudah siap'),
      h('p', null, `Kebutuhan ${sp.needPct}% · Keinginan ${sp.wantPct}%`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => go('plan', { from: 'home' }) }, 'Lihat saran'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { db().habitSeen = ym; S.save(); A.render(); } }, 'Nanti')));
  }

  root.KHHabit = { analyze, split, planCard, banner };
})(typeof self !== 'undefined' ? self : this);
