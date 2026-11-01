/* KasHarian: kartu "Uang habis ke mana" (donat per kategori dengan nominal dan persen).
   Dipakai di Beranda, Aktivitas, dan Ringkasan. Hanya membaca data; tidak mengubah apa pun. */
(function (root) {
  'use strict';
  const A = KHApp, { h, R, go, card } = A;
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (name, attrs) => { const e = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); return e; };
  /** 1.500.000 -> "1,5 jt". Dipakai untuk angka sumbu dan label puncak di grafik. */
  function compact(v) {
    v = Math.round(Number(v) || 0);
    const f = (n, u) => (Math.round(n * 10) / 10).toString().replace('.', ',') + ' ' + u;
    if (v >= 1e9) return f(v / 1e9, 'M');
    if (v >= 1e6) return f(v / 1e6, 'jt');
    if (v >= 1e3) return f(v / 1e3, 'rb');
    return String(v);
  }
  const pctText = (amount, total) => { const p = total > 0 ? amount * 100 / total : 0; return (p > 0 && p < 1 ? '<1' : String(Math.round(p))) + '%'; };

  function spendCard(acts, ym, opt) {
    opt = opt || {};
    const rows = R.SummaryEngine.categoryBreakdown(acts, ym);
    const head = h('div', { class: 'card-head' }, h('h3', null, 'Uang habis ke mana'), opt.link ? h('button', { class: 'link', type: 'button', onclick: () => go('summary') }, 'Detail') : null);
    if (!rows.length) return opt.empty ? card(head, h('p', { class: 'empty' }, 'Belum ada pengeluaran di bulan ini.')) : null;
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const items = rows.length > 6
      ? [...rows.slice(0, 5), { category: 'Lainnya', amount: rows.slice(5).reduce((a, r) => a + r.amount, 0), other: true }]
      : rows.slice();
    const colorOf = (it, i) => `var(--cat${it.other ? 6 : i})`;
    const R0 = 64, C = 2 * Math.PI * R0, GAP = items.length > 1 ? 3 : 0;
    let sel = null;

    // donat
    const svg = sv('svg', { viewBox: '0 0 176 176', role: 'img', class: 'spend-svg', 'aria-label': 'Pengeluaran per kategori' });
    svg.append(sv('circle', { cx: 88, cy: 88, r: R0, fill: 'none', 'stroke-width': 20, class: 'spend-track' }));
    const segs = []; let cum = 0;
    items.forEach((it, i) => {
      const len = it.amount / total * C, draw = Math.max(.6, len - GAP);
      const c = sv('circle', { cx: 88, cy: 88, r: R0, fill: 'none', 'stroke-width': 20, class: 'spend-seg', transform: 'rotate(-90 88 88)', 'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': -cum, tabindex: -1 });
      c.style.stroke = colorOf(it, i); c.style.setProperty('--i', i);
      c.addEventListener('click', () => select(i));
      c._to = `${draw} ${C - draw}`; cum += len; segs.push(c); svg.append(c);
    });
    const cLabel = h('small', null, 'Total keluar'), cValue = h('strong', null, R.rupiah(total)), cSub = h('em', null, R.monthLabel(ym));
    const centerBox = h('div', { class: 'spend-center', 'aria-live': 'polite' }, cLabel, cValue, cSub);
    const detail = h('div', { class: 'spend-detail' });

    // daftar
    const top = items[0];
    const list = h('div', { class: 'spend-list' }, items.map((it, i) => {
      const g = opt.growth && !it.other ? rows[i].growthPercent : null;
      const bar = h('i'); bar._to = Math.max(3, it.amount / total * 100) + '%';
      return h('button', { class: 'spend-row', type: 'button', style: { '--c': colorOf(it, i), '--i': i }, onclick: () => select(i) },
        h('span', { class: 'spend-dot' }), h('span', { class: 'spend-name' }, it.category),
        h('strong', { class: 'spend-amt' }, R.rupiah(it.amount)), h('small', { class: 'spend-pct' }, pctText(it.amount, total)),
        h('span', { class: 'spend-bar' }, bar),
        g != null ? h('small', { class: 'warn-text spend-grow' }, `Naik ${g}% dari bulan lalu`) : null);
    }));
    const rowEls = Array.from(list.children);

    function select(i) {
      sel = sel === i ? null : i;
      segs.forEach((s, k) => { s.classList.toggle('on', sel === k); s.classList.toggle('dim', sel !== null && sel !== k); });
      rowEls.forEach((r, k) => { r.classList.toggle('on', sel === k); r.classList.toggle('dim', sel !== null && sel !== k); });
      if (sel === null) { cLabel.textContent = 'Total keluar'; cValue.textContent = R.rupiah(total); cSub.textContent = R.monthLabel(ym); detail.replaceChildren(); return; }
      const it = items[sel];
      cLabel.textContent = it.category; cValue.textContent = R.rupiah(it.amount); cSub.textContent = pctText(it.amount, total);
      detail.replaceChildren(it.other ? null : h('button', { class: 'link', type: 'button', onclick: () => go('activities', { month: ym, kind: 'EXPENSE', category: it.category }) }, 'Lihat transaksi'));
    }

    const out = card(head,
      h('div', { class: 'spend-top' }, h('div', { class: 'spend-top-l' }, h('small', null, 'Paling banyak ke'), h('strong', null, top.category)), h('div', { class: 'spend-top-r' }, h('strong', null, R.rupiah(top.amount)), h('small', null, pctText(top.amount, total)))),
      h('div', { class: 'spend-donut' }, svg, centerBox), detail, list);
    // animasi masuk: donat tergambar, batang memanjang
    requestAnimationFrame(() => requestAnimationFrame(() => {
      segs.forEach((s) => s.setAttribute('stroke-dasharray', s._to));
      list.querySelectorAll('.spend-bar i').forEach((b) => { b.style.width = b._to || ''; });
    }));
    list.querySelectorAll('.spend-bar i').forEach((b) => { b.style.width = '0%'; });
    return out;
  }

  root.KHCharts = { spendCard, compact };
})(typeof self !== 'undefined' ? self : this);
