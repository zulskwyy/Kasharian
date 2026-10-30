/* KasHarian extra: rencana pembagian uang (50/30/20 atau custom) dengan "nyawa" ala game,
   pembaca struk/tagihan (foto, PDF, dokumen), dan cerita gaji -> teks slip. */
(function (root) {
  'use strict';
  const A = KHApp, { h, R, S, db, go, frame, card, field, SCREENS, toast } = A;
  const { moneyInput } = KHUI;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);

  // ---------- rencana ----------
  const PRESETS = {
    '50-30-20': { label: '50/30/20', b: [['need', 'Kebutuhan', 50, 0], ['want', 'Keinginan', 30, 0], ['save', 'Tabungan', 20, 1]] },
    '50-30-10-10': { label: '50/30/10/10', b: [['need', 'Kebutuhan', 50, 0], ['want', 'Keinginan', 30, 0], ['save', 'Tabungan', 10, 1], ['emg', 'Dana darurat', 10, 1]] },
    '60-20-20': { label: '60/20/20', b: [['need', 'Kebutuhan', 60, 0], ['want', 'Keinginan', 20, 0], ['save', 'Tabungan', 20, 1]] },
    '70-20-10': { label: '70/20/10', b: [['need', 'Kebutuhan', 70, 0], ['want', 'Keinginan', 20, 0], ['save', 'Tabungan', 10, 1]] },
    'need-want': { label: 'Kebutuhan & Keinginan', b: [['need', 'Kebutuhan', 60, 0], ['want', 'Keinginan', 40, 0]] }
  };
  function mkPlan(key) {
    const buckets = PRESETS[key].b.map(([id, name, pct, save]) => ({ id, name, pct, save: !!save }));
    const first = buckets.find((b) => !b.save).id, map = {};
    R.CAT.expense.forEach((c) => { map[c] = ['Belanja', 'Hiburan'].includes(c) ? 'want' : first; });
    return { preset: key, buckets, map, rules: [], estimate: 0, chosen: false };
  }
  function plan() {
    if (!db().plan) { db().plan = mkPlan('need-want'); S.save(); }
    else if (!db().plan.chosen && db().plan.buckets.some((b) => b.save)) { const e = db().plan.estimate; db().plan = mkPlan('need-want'); db().plan.estimate = e; S.save(); }   // belum memilih: tidak ada potongan tabungan otomatis
    const P = db().plan, first = (P.buckets.find((b) => !b.save) || P.buckets[0]).id;
    P.buckets.forEach((b) => { b.goalTarget = Math.max(0, Math.round(Number(b.goalTarget) || 0)); });
    R.CAT.expense.forEach((c) => { if (!P.map[c]) P.map[c] = first; });
    return P;
  }
  /** Pemasukan yang tercatat sebelum rencana dipilih tidak punya potongan tabungan; setelah memilih, ikut dibagi sesuai rencana. */
  function markChosen(wasChosen) { if (!wasChosen) A.liveActs().forEach((a) => { if (a.type === 'INCOME') delete a.planAllocation; }); }
  function applyPreset(key) { const P = plan(), e = P.estimate, was = P.chosen; Object.assign(P, mkPlan(key)); P.estimate = e; P.chosen = true; markChosen(was); S.save(); }

  /** Split each recorded income once using the active plan. Stored snapshots keep
   * historical savings goals stable when a user later changes their plan. */
  function allocationForIncome(amount, category) {
    const P = plan(), n = Math.max(0, Math.round(Number(amount) || 0));
    const rule = P.rules && P.rules.find((r) => r.source === category);
    let remaining = n; const out = {};
    P.buckets.forEach((b, i) => {
      const pct = Number(rule ? (rule.pct[b.id] || 0) : b.pct) || 0;
      const share = i === P.buckets.length - 1 ? remaining : Math.min(remaining, Math.round(n * pct / 100));
      out[b.id] = Math.max(0, share); remaining = Math.max(0, remaining - share);
    });
    return out;
  }
  function allocationSnapshot(amount, category) {
    const P = plan();
    return { version: 1, amounts: allocationForIncome(amount, category), buckets: P.buckets.map((b) => ({ id: b.id, name: b.name, pct: Number(b.pct) || 0, save: !!b.save })) };
  }
  /** Preflight budget for new income using the same allocation arithmetic as the plan. */
  function spendingLimitForIncome(amount, category) {
    const P = plan(), allocated = allocationForIncome(amount, category);
    return Math.max(0, sum(P.buckets.filter((b) => !b.save).map((b) => allocated[b.id] || 0)));
  }

  const isSalaryDeduction = (a) => a && a.type === 'EXPENSE' && a.source === 'slip' && /potongan/i.test([a.category, a.note].join(' '));
  const isSavingsWalletExpense = (a) => {
    if (!a || a.type !== 'EXPENSE') return false;
    const w = db().wallets.find((x) => x.id === a.walletId);
    return !!w && (w.type === 'SAVINGS' || w.type === 'EMERGENCY');
  };
  /** Transfers to savings wallets and investments are reserved savings, not everyday spending. */
  function isBudgetExpense(a) {
    if (!a || a.type !== 'EXPENSE' || isSalaryDeduction(a) || isSavingsWalletExpense(a)) return false;
    const c = KHBucket.classify(a, { memory: db().bucketMemory || {}, userMap: (db().plan && db().plan.mapUser) || {} });
    return c.nature !== 'save';
  }

  /** Monthly allocation. Batas belanja bulan ini = kebutuhan + keinginan (digabung), tetapi nyawa tiap kelompok
   * dihitung dari pemilahan otomatis tiap pengeluaran. Tabungan dipisah. */
  function state(ym) {
    const P = plan(), acts = A.liveActs();
    const inMonth = (m) => acts.filter((a) => a.type === 'INCOME' && R.monthOf(a.occurredOn) === m);
    let incomes = inMonth(ym).map((a) => [a.category, a.amount]), est = false;
    if (!incomes.length) {
      let e = P.estimate || sum(inMonth(R.addMonths(ym, -1)).map((a) => a.amount));
      if (!e) { const ms = [...new Set(acts.filter((a) => a.type === 'INCOME').map((a) => R.monthOf(a.occurredOn)))].sort(); if (ms.length) e = sum(inMonth(ms[ms.length - 1]).map((a) => a.amount)); }
      if (e > 0) { incomes = [['*', e]]; est = true; }
    }
    const alloc = {};
    P.buckets.forEach((b) => { alloc[b.id] = 0; });
    incomes.forEach(([cat, amt]) => {
      const shares = allocationForIncome(amt, cat);
      P.buckets.forEach((b) => { alloc[b.id] += shares[b.id] || 0; });
    });

    const ctx = { memory: db().bucketMemory || {}, userMap: P.mapUser || {} }, review = new Map();
    let spentThisMonth = 0;
    acts.filter((a) => a.type === 'EXPENSE' && R.monthOf(a.occurredOn) === ym).forEach((a) => {
      const c = KHBucket.classify(a, ctx);
      if (isBudgetExpense(a)) spentThisMonth += a.amount;
      if (!c.confident) {
        const k = KHBucket.keyOf(a) || '_' + a.category;
        const r = review.get(k) || { key: k, name: a.merchant || a.note || a.category, count: 0, amount: 0, ids: [], guess: c.nature };
        r.count++; r.amount += a.amount; r.ids.push(a.id); review.set(k, r);
      }
    });

    // Build cumulative goal progress from each income's saved allocation snapshot.
    // This is a planned reserve (virtual envelope), not a claim that money has moved
    // to a different physical bank account. Physical wallet balances remain separate.
    const saveBuckets = P.buckets.filter((b) => b.save), firstSave = saveBuckets[0];
    const savedGross = Object.fromEntries(saveBuckets.map((b) => [b.id, 0]));
    const currentBucketFor = (oldId, oldName) => saveBuckets.find((b) => b.id === oldId)
      || saveBuckets.find((b) => oldName && b.name.toLowerCase() === String(oldName).toLowerCase()) || firstSave;
    acts.filter((a) => a.type === 'INCOME').forEach((a) => {
      const snap = a.planAllocation;
      if (snap && snap.amounts && snap.buckets) {
        const meta = new Map(snap.buckets.map((b) => [b.id, b]));
        Object.entries(snap.amounts).forEach(([id, value]) => {
          const bMeta = meta.get(id);
          if (!bMeta || !bMeta.save || !firstSave) return;
          const target = currentBucketFor(id, bMeta.name);
          if (target) savedGross[target.id] += Math.max(0, Number(value) || 0);
        });
      } else {
        const shares = allocationForIncome(a.amount, a.category);
        P.buckets.filter((b) => b.save).forEach((b) => { savedGross[b.id] += Math.max(0, Number(shares[b.id]) || 0); });
      }
    });
    // Existing saving/investment entries count as an additional goal contribution
    // only when they are recorded as an expense outside a dedicated savings wallet.
    acts.filter((a) => a.type === 'EXPENSE' && !isSalaryDeduction(a) && !isSavingsWalletExpense(a)
      && KHBucket.classify(a, ctx).nature === 'save').forEach((a) => {
        if (firstSave) savedGross[firstSave.id] += Math.max(0, Number(a.amount) || 0);
      });
    // Savings authorized for an over-limit expense reduce the goal balance. Legacy
    // records without a per-goal map consume savings goals in their displayed order.
    const savedByBucket = { ...savedGross };
    acts.filter((a) => (a.type === 'EXPENSE' || a.type === 'TRANSFER') && Number(a.budgetSavingsUsed) > 0).forEach((a) => {
      const byBucket = a.budgetSavingsByBucket;
      if (byBucket && typeof byBucket === 'object') {
        Object.entries(byBucket).forEach(([id, value]) => { if (id in savedByBucket) savedByBucket[id] = Math.max(0, savedByBucket[id] - Math.max(0, Number(value) || 0)); });
      } else {
        let take = Math.max(0, Number(a.budgetSavingsUsed) || 0);
        saveBuckets.forEach((b) => { const got = Math.min(take, savedByBucket[b.id] || 0); savedByBucket[b.id] = Math.max(0, (savedByBucket[b.id] || 0) - got); take -= got; });
      }
    });
    // Purchases paid directly from a savings/emergency wallet must also reduce
    // goal progress, even when they did not cross the monthly spending envelope.
    acts.filter((a) => a.type === 'EXPENSE' && isSavingsWalletExpense(a) && !(Number(a.budgetSavingsUsed) > 0))
      .forEach((a) => {
        let take = Math.max(0, Number(a.amount) || 0);
        saveBuckets.forEach((b) => { const got = Math.min(take, savedByBucket[b.id] || 0); savedByBucket[b.id] = Math.max(0, (savedByBucket[b.id] || 0) - got); take -= got; });
      });
    const savingsProgress = sum(saveBuckets.map((b) => savedByBucket[b.id] || 0));
    const saveIds = db().wallets.filter((w) => w.type === 'SAVINGS' || w.type === 'EMERGENCY').map((w) => w.id);
    const balances = R.BalanceEngine.balances(db().wallets, acts);
    const liquidSavings = sum(saveIds.map((id) => Math.max(0, balances[id] || 0)));
    // Conservative spendable savings avoids counting a physical balance twice if
    // it is already represented by the plan's virtual reserve.
    const savingsAvailable = Math.max(savingsProgress, liquidSavings);
    const ordered = [...P.buckets.filter((b) => !b.save), ...saveBuckets];
    const usedBy = {};
    P.buckets.forEach((b) => { usedBy[b.id] = 0; });
    acts.filter((a) => a.type === 'EXPENSE' && R.monthOf(a.occurredOn) === ym && isBudgetExpense(a)).forEach((a) => {
      const bk = P.buckets.find((x) => x.id === KHBucket.bucketIdFor(P.buckets, KHBucket.classify(a, ctx).nature, a));
      if (bk && !bk.save) usedBy[bk.id] += a.amount;
    });
    // Nyawa mengalir: pengeluaran lebih dulu mengurangi kelompoknya sendiri. Bila kelompok itu habis, kelebihannya
    // langsung mengurangi kelompok belanja berikutnya (Kebutuhan -> Keinginan). Bila semuanya habis, barulah
    // pengeluaran berikutnya meminta sumber dana (dana darurat atau tabungan).
    const spendGroups = P.buckets.filter((b) => !b.save);
    let overflow = 0;
    spendGroups.forEach((b) => { const cap = Math.max(0, alloc[b.id] || 0), own = usedBy[b.id]; usedBy[b.id] = Math.min(own, cap); overflow += Math.max(0, own - cap); });
    spendGroups.forEach((b) => { const room = Math.max(0, (alloc[b.id] || 0) - usedBy[b.id]), take = Math.min(room, overflow); usedBy[b.id] += take; overflow -= take; });
    const rows = ordered.map((b) => {
      if (b.save) {
        const monthlyBudget = Math.max(0, alloc[b.id] || 0);
        const recommendation = monthlyBudget > 0 ? monthlyBudget * 6 : 0;
        const target = Math.max(0, Number(b.goalTarget) || recommendation);
        const got = Math.max(0, savedByBucket[b.id] || 0);
        return { b, budget: target, monthlyBudget, used: got, ratio: target > 0 ? clamp(got / target, 0, 1) : 0 };
      }
      const used = usedBy[b.id] || 0;                       // nyawa per kelompok mengikuti pemilahan otomatis tiap pengeluaran
      const ratio = alloc[b.id] > 0 ? clamp(1 - used / alloc[b.id], 0, 1) : 0;
      return { b, budget: alloc[b.id], monthlyBudget: alloc[b.id], used, ratio };
    });
    const spendingBudget = sum(P.buckets.filter((b) => !b.save).map((b) => alloc[b.id] || 0));
    return {
      rows, base: sum(incomes.map((x) => x[1])), est, spendingBudget,
      totalSpend: spentThisMonth, spendable: Math.max(0, spendingBudget - spentThisMonth),
      savingsProgress, savingsByBucket: savedByBucket, savingsAvailable, physicalSavings: liquidSavings,
      limitReached: spendingBudget > 0 && spentThisMonth >= spendingBudget,
      review: [...review.values()].sort((x, y) => y.amount - x.amount)
    };
  }

  function assertExpenseAllowed(a) {
    if (!a || a.type !== 'EXPENSE') return true;
    if (isSalaryDeduction(a)) return true;
    const ym = R.monthOf(a.occurredOn || R.todayISO()), s = state(ym), amt = Math.max(0, Number(a.amount) || 0);
    if (isSavingsWalletExpense(a)) {
      if (s.spendable > 0) throw new Error(`Limit kebutuhan dan keinginan masih tersisa ${R.rupiah(s.spendable)}. Gunakan itu terlebih dahulu agar tabungan tetap terlindungi.`);
      if (amt > s.savingsAvailable) throw new Error(`Saldo tabungan yang tersedia hanya ${R.rupiah(s.savingsAvailable)}. Catat pemasukan tambahan atau periksa saldo dompet tabungan.`);
      return true;
    }
    if (!isBudgetExpense(a)) return true;
    const authorized = Math.max(0, Number(a.budgetSavingsUsed) || 0) + Math.max(0, Number(a.budgetFreeUsed) || 0);
    if (amt > s.spendable + authorized) throw new Error(`Limit bulan ini habis. Tambahkan pemasukan pada bulan ${R.monthLabel(ym)} atau pilih sumber dana terlebih dahulu.`);
    return true;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  /** Cincin SVG berujung bulat. rings: [{ratio, color}] dari luar ke dalam. */
  function ringSvg(rings, size, stroke, gap, cls) {
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }); if (cls) svg.setAttribute('class', cls);
    rings.forEach((g, i) => {
      const r = size / 2 - stroke / 2 - i * (stroke + gap), C = 2 * Math.PI * r, v = clamp(g.ratio, 0, 1);
      svg.append(svgEl('circle', { class: 'trk', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }));
      const arc = svgEl('circle', { class: 'val', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': C, 'stroke-dashoffset': C }); arc.style.stroke = g.color;
      if (v <= 0.004) arc.setAttribute('stroke-dasharray', `0 ${C}`);
      svg.append(arc);
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16); raf(() => raf(() => arc.setAttribute('stroke-dashoffset', C * (1 - v))));
    });
    return svg;
  }
  function lifeRing(ratio, color, label, hasBudget = true) {
    const pct = hasBudget ? Math.round(clamp(ratio, 0, 1) * 100) : 0;
    const el = h('div', { class: 'life-ring' + (!hasBudget ? ' no-budget' : ''), role: 'progressbar', 'aria-label': label || (hasBudget ? 'Persentase nyawa tersisa' : 'Belum ada jatah'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': hasBudget ? pct : null, 'aria-valuetext': hasBudget ? pct + '% tersisa' : 'Belum ada jatah' },
      h('span', { class: 'life-ring-center' }, h('strong', null, hasBudget ? pct + '%' : '—'), h('small', null, hasBudget ? 'tersisa' : 'belum ada')));
    el.prepend(ringSvg([{ ratio: hasBudget ? ratio : 0, color }], 64, 7, 0));
    return el;
  }
  const statusColor = (r) => (r.b.save ? 'var(--save)' : r.ratio > 0.5 ? 'var(--in)' : r.ratio > 0.25 ? 'var(--warn)' : 'var(--out)');
  /** Ringkasan cincin berlapis ala Fitness: satu cincin per kelompok, isi = nyawa tersisa. */
  function ringsSummary(rows) {
    const live = rows.filter((r) => r.budget > 0).slice(0, 5); if (!live.length) return null;
    return h('div', { class: 'rings' }, ringSvg(live.map((r) => ({ ratio: r.ratio, color: statusColor(r) })), 136, 14, 4, 'rings-svg'),
      h('div', { class: 'rings-legend' }, live.map((r) => h('div', null, h('b', { style: { color: statusColor(r) } }, r.b.name), h('span', null, Math.round(clamp(r.ratio, 0, 1) * 100) + '%')))));
  }
  function meter(r) {
    const save = r.b.save, left = Math.max(0, r.budget - r.used);
    const pct = r.budget > 0 ? Math.round(clamp(r.ratio, 0, 1) * 100) : 0;
    const color = statusColor(r);
    const text = r.budget <= 0 ? (save ? 'Belum ada alokasi untuk menghitung target. Catat pemasukan atau atur target sendiri.' : 'Belum ada jatah karena belum ada pemasukan.')
      : save ? `${R.rupiah(Math.min(r.used, r.budget))} / ${R.rupiah(r.budget)}`
        : left > 0 ? `Sisa ${R.rupiah(left)} / ${R.rupiah(r.budget)}` : 'Habis';
    return h('div', { class: 'life' + (!save && r.ratio === 0 && r.budget > 0 ? ' dead' : '') },
      h('div', { class: 'life-head' },
        h('div', { class: 'life-title' }, h('strong', null, r.b.name), h('span', { class: 'life-allocation' }, `${r.b.pct}% dari pemasukan`)),
        lifeRing(r.ratio, color, r.budget > 0 ? `${r.b.name}: ${pct}% ${save ? 'target tercapai' : 'tersisa'}` : `${r.b.name}: belum ada jatah`, r.budget > 0)),
      h('div', { class: 'life-progress', role: 'progressbar', 'aria-label': `Progres ${r.b.name}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', { style: { width: pct + '%', backgroundColor: color } })),
      h('small', { class: 'note' }, text));
  }

  const snap = (ym) => { const o = {}; state(ym || R.monthOf(R.todayISO())).rows.forEach((r) => { if (!r.b.save && r.budget > 0) o[r.b.id] = { r: r.ratio, name: r.b.name }; }); return o; };
  /** before: {ym: snap(ym)}. Menampilkan nyawa yang berkurang per bulan. */
  function notify(before) {
    Object.keys(before).forEach((ym) => {
      const now = snap(ym), tag = ym === R.monthOf(R.todayISO()) ? '' : ` (${R.monthLabel(ym)})`;
      Object.keys(before[ym]).forEach((id) => {
        const o = before[ym][id]; if (!now[id] || now[id].r >= o.r) return;
        const lost = Math.ceil(o.r * 10) - Math.ceil(now[id].r * 10);
        toast(now[id].r === 0 ? `Nyawa ${now[id].name}${tag} habis!` : `${now[id].name}${tag}: nyawa ${lost > 0 ? '-' + lost : 'berkurang'}, tinggal ${Math.ceil(now[id].r * 10)} dari 10`, { ms: 5500 });
      });
    });
  }
  const snapMonths = (dates) => { const o = {}; [...new Set(dates.map((d) => R.monthOf(d)))].forEach((m) => { o[m] = snap(m); }); return o; };
  function presetChips(onPick) {
    const rec = recommend(), P = plan();
    const activeLabel = P.preset === 'custom' ? 'Custom' : (PRESETS[P.preset] || PRESETS['need-want']).label;
    const descriptions = {
      '50-30-20': 'Keseimbangan kebutuhan, keinginan, dan masa depan.',
      '50-30-10-10': 'Pisahkan tabungan dan dana darurat.',
      '60-20-20': 'Ruang lebih besar untuk kebutuhan pokok.',
      '70-20-10': 'Prioritaskan kebutuhan saat anggaran ketat.',
      'need-want': 'Tanpa tabungan. Ketik sendiri persen Kebutuhan dan Keinginan.',
      custom: 'Atur nama kelompok dan persentase sendiri.'
    };
    let revealTimer = null;
    const picker = h('div', { class: 'plan-picker' });
    const trigger = h('button', { class: 'plan-current', type: 'button', 'aria-expanded': 'false' },
      h('span', { class: 'plan-current-copy' },
        h('small', { class: 'plan-kicker' }, P.chosen ? 'RENCANA AKTIF' : 'MULAI DARI SINI'),
        h('strong', null, P.chosen ? activeLabel : 'Pilih pembagian uang'),
        P.chosen ? null : h('small', { class: 'plan-hint' }, 'Belum dipilih, jadi pemasukan belum dipotong untuk tabungan.')),
      h('span', { class: 'plan-current-action' }, h('span', null, P.chosen ? 'Ubah' : 'Pilih'), h('span', { class: 'plan-current-chevron', 'aria-hidden': 'true' })));
    const loading = h('div', { class: 'plan-loading', hidden: true, 'aria-live': 'polite' },
      h('span', { class: 'plan-dots', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: 'plan-dot dot-' + i }))),
      h('span', null, 'Menyiapkan pilihan rencana'));
    const choices = Object.entries(PRESETS).map(([k, v], i) => h('button', {
      class: 'plan-choice' + (P.chosen && P.preset === k ? ' selected' : ''), type: 'button', onclick: () => onPick(k)
    }, h('span', { class: 'plan-choice-index' + (k === rec.key ? ' rec' : '') }, String(i + 1).padStart(2, '0')),
       h('span', { class: 'plan-choice-copy' }, h('strong', null, v.label)),
       h('span', { class: 'plan-choice-meta' }, k === rec.key ? 'Disarankan' : (P.chosen && P.preset === k ? 'Aktif' : 'Pilih'))));
    choices.push(h('button', { class: 'plan-choice custom-choice' + (P.chosen && P.preset === 'custom' ? ' selected' : ''), type: 'button', onclick: () => onPick('custom') },
      h('span', { class: 'plan-choice-index' }, 'C'), h('span', { class: 'plan-choice-copy' }, h('strong', null, 'Custom')),
      h('span', { class: 'plan-choice-meta' }, 'Racik sendiri')));
    const options = h('div', { class: 'plan-options', hidden: true }, choices);
    const toggle = () => {
      if (!options.hidden || !loading.hidden) {
        if (revealTimer) clearTimeout(revealTimer);
        options.hidden = true; loading.hidden = true; picker.classList.remove('is-loading', 'is-open');
        trigger.setAttribute('aria-expanded', 'false'); return;
      }
      loading.hidden = false; options.hidden = true; picker.classList.remove('is-open'); picker.classList.add('is-loading');
      trigger.setAttribute('aria-expanded', 'true');
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        if (!picker.isConnected) return;
        loading.hidden = true; options.hidden = false; picker.classList.remove('is-loading'); picker.classList.add('is-open');
      }, 520);
    };
    trigger.addEventListener('click', toggle);
    picker.append(trigger, loading, options);
    return picker;
  }
  function customStart() {
    const P = plan(), was = P.chosen;
    if (!P.buckets.some((b) => b.save)) { const e = P.estimate; Object.assign(P, mkPlan('50-30-20')); P.estimate = e; }
    P.preset = 'custom'; P.chosen = true; markChosen(was); S.save();
  }
  /** Sekali saja: setelah ada pemasukan tetapi rencana belum dipilih, tawarkan memilih. Tidak ada yang dipotong sebelum itu. */
  // Planning is opened only by an explicit user action. Never interrupt a saved income flow with an automatic redirect.
  function homeCard() {
    const P = plan(), s = state(R.monthOf(R.todayISO()));
    const pick = (k) => {
      if (k === 'custom') { customStart(); return go('plan', { from: 'home' }); }
      applyPreset(k); toast('Rencana ' + PRESETS[k].label + ' dipakai');
      if (k === 'need-want') return go('plan', { from: 'home' });
      A.render();
    };
    return card(h('div', { class: 'card-head' }, h('h3', null, 'Nyawa bulan ini'), h('button', { class: 'link', onclick: () => go('plan') }, 'Rencana')),
      s.base > 0 ? ringsSummary(s.rows) : null,
      s.base > 0 ? h('div', { class: 'stack' }, s.rows.map(meter)) : null,
      presetChips(pick));
  }

  function recommend() {
    const prev = R.addMonths(R.monthOf(R.todayISO()), -1), acts = A.liveActs();
    const inc = sum(acts.filter((a) => a.type === 'INCOME' && R.monthOf(a.occurredOn) === prev).map((a) => a.amount));
    if (!inc) return { key: '50-30-20', why: 'Belum ada riwayat bulan lalu. Mulai dari aturan umum 50/30/20.' };
    const need = sum(acts.filter((a) => a.type === 'EXPENSE' && R.monthOf(a.occurredOn) === prev && !['Belanja', 'Hiburan'].includes(a.category)).map((a) => a.amount));
    const pct = Math.round(need * 100 / inc), key = pct > 65 ? '70-20-10' : pct > 55 ? '60-20-20' : '50-30-20';
    return { key, why: `Bulan lalu kebutuhan memakai ${pct}% pemasukan, jadi ${PRESETS[key].label} paling masuk akal.` };
  }


  /** Pengeluaran yang belum bisa dipastikan kelompoknya. Satu ketukan, dan semua catatan toko itu (sekarang dan nanti) ikut. */
  function reviewCard(s, redraw) {
    if (!s.review || !s.review.length) return null;
    const LBL = { need: 'Kebutuhan', want: 'Keinginan', save: 'Tabungan' };
    const items = s.review.slice(0, 6);
    return card(h('h3', null, `Perlu dicek (${s.review.length})`), null,
      h('div', { class: 'list' }, items.map((r) => h('div', { class: 'review-row' }, h('span', null, h('strong', null, r.name), h('small', null, `${r.count} catatan · ${R.rupiah(r.amount)}`)),
        h('div', { class: 'chips', style: { margin: 0 } }, ['need', 'want', 'save'].map((n) => h('button', { class: 'chip', type: 'button', onclick: () => { const a = A.liveActs().find((x) => x.id === r.ids[0]); if (a) KHBucket.learn(db(), a, n); r.ids.forEach((id) => { const x = A.liveActs().find((y) => y.id === id); if (x && !KHBucket.keyOf(x)) x.bucket = n; }); S.save(); toast(`Dicatat sebagai ${LBL[n]}`); redraw(); } }, LBL[n])))))));
  }

  SCREENS.plan = (prm) => {
    const P = plan(); let ym = (prm && prm.month) || R.monthOf(R.todayISO());
    const live = h('div'), edit = h('div'), nav = h('div', { class: 'month-nav' });
    const setLive = (...els) => live.replaceChildren(...els.filter(Boolean));
    const drawLive = () => { const s = state(ym); nav.replaceChildren(h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, -1); drawLive(); } }, 'Sebelumnya'), h('strong', null, R.monthLabel(ym)), h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, 1); drawLive(); } }, 'Berikutnya')); setLive(card(h('h3', null, 'Nyawa ' + R.monthLabel(ym)),
      null,
      h('div', { class: 'stack' }, s.rows.map(meter))), reviewCard(s, drawLive)); };
    const drawEdit = () => {
      const rec = recommend();
      const setPreset = (key) => { applyPreset(key); drawLive(); drawEdit(); };
      const totalLine = h('p', { class: 'total-line' });
      const totalEl = () => {
        const t = sum(P.buckets.map((b) => Number(b.pct) || 0));
        totalLine.textContent = `Total alokasi ${t}%` + (t === 100 ? ' · seimbang' : ' · harus 100%');
        totalLine.className = 'total-line ' + (t === 100 ? 'ok-text' : 'warn-text');
      };
      const bucketRows = P.buckets.map((b, i) => {
        const name = h('input', { class: 'input', value: b.name, maxlength: 24, 'aria-label': 'Nama kategori', oninput: (e) => { b.name = e.target.value.slice(0, 24) || 'Kategori'; P.preset = 'custom'; } });
        const pct = h('input', { class: 'input pct', type: 'number', inputmode: 'numeric', min: 0, max: 100, value: b.pct, 'aria-label': `Persentase ${b.name}`, oninput: (e) => { b.pct = clamp(parseInt(e.target.value || '0', 10) || 0, 0, 100); if (P.preset !== 'need-want') P.preset = 'custom'; totalEl(); } });
        const coreBucket = ['need', 'want', 'save'].includes(b.id);
        const saving = coreBucket
          ? h('span', { class: 'plan-type-label' }, b.save ? 'Tabungan' : 'Belanja')
          : h('label', { class: 'check plan-saving-toggle' }, h('input', { type: 'checkbox', checked: !!b.save, onchange: (e) => {
            if (e.target.checked) {
              b.save = true;
              P.buckets = P.buckets.filter((x) => x !== b).concat(b);
            } else {
              if (P.buckets.filter((x) => x.save).length <= 1) { e.target.checked = true; toast('Sisakan minimal satu kategori tabungan.'); return; }
              b.save = false;
              P.buckets = P.buckets.filter((x) => x !== b);
              const firstSave = P.buckets.findIndex((x) => x.save);
              P.buckets.splice(firstSave < 0 ? P.buckets.length : firstSave, 0, b);
            }
            P.preset = 'custom'; drawEdit();
          } }), h('span', null, 'Jadikan tabungan'));
        const canDelete = !['need', 'want', 'save'].includes(b.id) && P.buckets.length > 3;
        return h('div', { class: 'plan-bucket-row' },
          h('div', { class: 'plan-bucket-name' }, h('span', { class: 'label' }, `Kategori ${i + 1}`), name),
          h('div', { class: 'plan-bucket-pct' }, h('span', { class: 'label' }, 'Persen'), pct),
          saving,
          b.save ? h('div', { class: 'plan-goal-field' }, h('label', { class: 'label' }, 'Target tabungan (Rp)'), h('input', { class: 'input', type: 'number', min: 0, step: 10000, inputmode: 'numeric', value: b.goalTarget || '', placeholder: 'Otomatis: 6× alokasi bulanan', 'aria-label': `Target tabungan ${b.name}`, oninput: (e) => { b.goalTarget = Math.max(0, Math.round(Number(e.target.value) || 0)); P.preset = 'custom'; } })) : null,
          canDelete ? h('button', { class: 'btn ghost sm plan-delete', type: 'button', onclick: () => { P.buckets.splice(P.buckets.indexOf(b), 1); P.preset = 'custom'; drawEdit(); } }, 'Hapus') : null);
      });
      totalEl();
      edit.replaceChildren(
        card(h('h3', null, 'Pilih rencana'), null,
          presetChips((k) => { if (k === 'custom') { customStart(); drawLive(); drawEdit(); } else setPreset(k); })),
        card(h('h3', null, 'Pembagian dana'),
          P.preset === 'need-want' ? h('p', { class: 'plan-note' }, 'Tanpa tabungan. Ketik sendiri persen Kebutuhan dan Keinginan, totalnya harus 100%.') : null,
          h('div', { class: 'plan-buckets' }, bucketRows), totalLine,
          h('button', { class: 'btn sm', type: 'button', onclick: () => {
            const b = { id: 'b' + Date.now().toString(36), name: 'Kategori tambahan', pct: 0, save: false };
            const ix = P.buckets.findIndex((x) => x.save);
            P.buckets.splice(ix < 0 ? P.buckets.length : ix, 0, b); P.preset = 'custom'; drawEdit();
          } }, 'Tambah kategori'),
          h('button', { class: 'btn primary block', type: 'button', onclick: () => {
            const t = sum(P.buckets.map((b) => Number(b.pct) || 0));
            if (!P.buckets.some((b) => b.id === 'need') || !P.buckets.some((b) => b.id === 'want') || (P.preset !== 'need-want' && !P.buckets.some((b) => b.save))) return toast('Rencana harus memiliki Kebutuhan, Keinginan, dan minimal satu kategori Tabungan.');
            if (t !== 100) return toast('Total persentase harus tepat 100%.');
            // Simplified plan uses one consistent split for all income sources.
            const was = P.chosen; P.rules = []; P.chosen = true; P.preset = P.preset || 'custom'; markChosen(was);
            const firstSpend = P.buckets.find((b) => !b.save);
            R.CAT.expense.forEach((c) => { if (!P.map[c]) P.map[c] = firstSpend.id; });
            S.save(); toast('Rencana tersimpan. Pembagian pemasukan berikutnya otomatis.'); if (prm && prm.from === 'home') A.root('home'); else A.back();
          } }, 'Simpan rencana')));
    };

    drawLive(); drawEdit();
    return frame({ title: 'Rencana uang', back: true, children: [nav, window.KHHabit ? KHHabit.planCard(prm) : null, live, edit] });
  };

  // ---------- baca struk / tagihan / dokumen ----------
  const AMT = /(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d])|(?<![\d.,])\d{4,9}(?![\d])/g;
  const toNum = (s) => parseInt(s.replace(/[.,]/g, ''), 10);
  const amounts = (t) => (t.match(AMT) || []).map(toNum).filter((n) => n >= 500 && n <= R.MAX_AMOUNT);
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };
  function findDate(t) {
    let m = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/.exec(t);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (R.validDate(y, +m[2], +m[1])) return R.iso(y, +m[2], +m[1]); }
    m = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(t); if (m && R.validDate(+m[1], +m[2], +m[3])) return R.iso(+m[1], +m[2], +m[3]);
    m = /(?<!\d)(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(t); if (m && MON[m[2].toLowerCase()] && R.validDate(+m[3], MON[m[2].toLowerCase()], +m[1])) return R.iso(+m[3], MON[m[2].toLowerCase()], +m[1]);
    return null;
  }
  const SLIP_HINT = /(slip\s*gaji|gaji\s*pokok|take\s*home|gaji\s*bersih|potongan|pendapatan\s*bruto|penghasilan)/i;
  function analyzeLines(lines) {
    const texts = lines.map((l) => l.text), all = texts.join('\n');
    if ((all.match(new RegExp(SLIP_HINT.source, 'gi')) || []).length >= 2 && /gaji|salary/i.test(all)) return { kind: 'slip' };
    const sc = KHScan.analyzeReceipt(lines, R.todayISO());
    let category = sc.brandCat || 'Belum pasti';
    if (category === 'Belum pasti') for (const t of [sc.merchant || '', ...texts.slice(0, 25)]) { if (!t) continue; const c = R.FreeTextParser.parse(t, R.todayISO(), db().memory).category; if (c !== 'Belum pasti') { category = c; break; } }
    const mem = db().memory.slice().sort((x, y) => y.term.length - x.term.length).find((m) => m.term && all.toLowerCase().includes(m.term));
    if (mem && mem.category) category = mem.category;
    return { kind: 'receipt', meta: sc.meta, amount: sc.amount, sure: sc.sure, how: sc.how, choices: sc.choices, merchant: sc.merchant, date: sc.date, due: sc.due, category, isBill: sc.isBill, lines: texts.length };
  }
  function receiptQuality(a) {
    if (!a || a.kind !== 'receipt') return -100;
    const m = a.meta || {}, total = [...new Set(m.labTotal || [])];
    let score = a.amount > 0 ? 1 : -8;
    if (total.length) score += 4;
    if (a.amount && total.includes(a.amount)) score += 7;
    if (a.sure) score += 3;
    if (/baris total|total sama|tunai dan kembalian/.test(a.how || '')) score += 2;
    if (m.labCash && m.labCash.length && m.labChange && m.labChange.length) {
      const derived = Math.max(...m.labCash) - m.labChange[0];
      if (derived >= 500 && derived === a.amount) score += 7;
      else if (derived >= 500 && a.amount) score -= 2;
    }
    if (m.items && a.amount && Math.abs(m.items - a.amount) <= Math.max(100, a.amount * .015)) score += 2;
    if (a.choices && a.choices.length > 1 && !a.sure) score -= .5;
    return score;
  }
  async function readDoc(files, onStage) {
    const t0 = Date.now(), overBudget = (ms) => Date.now() - t0 > ms;
    const res = await KHOCR.readFiles(files, onStage);
    let words = res.words || [];
    // Sparse or genuinely low-confidence OCR gets a second segmentation pass before classification.
    if (res.retry && !overBudget(60000) && (words.length < 5 || (Number(res.confidence) > 0 && Number(res.confidence) < 48))) {
      try {
        onStage && onStage('Hasil awal kurang terbaca; mencoba mode pembacaan lain');
        const again = await res.retry(onStage);
        if (again && again.length > words.length) { words = again; res.words = again; }
      } catch (e) { /* first pass remains usable */ }
    }
    onStage && onStage('Mencocokkan teks, tanggal, dan angka hasil baca');
    const st = parseStatement(words) || KHScan.parseAppList(words, R.todayISO());
    if (st) return { res, kind: 'statement', st };
    let a = analyzeLines(KHSlip.linesFromWords(words));
    if (a.kind !== 'receipt') return Object.assign({ res }, a);

    const attempts = [{ ...a, words }];
    const needsReview = () => {
      const best = attempts.slice().sort((x, y) => receiptQuality(y) - receiptQuality(x))[0];
      return !best || !best.amount || !best.sure || !((best.meta || {}).labTotal || []).length || (Number(res.confidence) > 0 && Number(res.confidence) < 72);
    };
    if (needsReview() && res.retry && !overBudget(60000)) {
      try {
        onStage && onStage('Memeriksa ulang label total dan nominal');
        const w2 = await res.retry(onStage);
        if (w2 && w2.length) attempts.push({ ...analyzeLines(KHSlip.linesFromWords(w2)), words: w2 });
      } catch (e) { /* keep all earlier useful reads */ }
    }
    if (needsReview() && res.alts && !overBudget(50000)) {
      try {
        const alts = await res.alts(onStage);
        (alts || []).forEach((w) => { if (w && w.length) attempts.push({ ...analyzeLines(KHSlip.linesFromWords(w)), words: w }); });
      } catch (e) { /* one alternative may fail without discarding the first read */ }
    }
    a = voteReceipts(attempts);
    if (a.words && a.words.length) res.words = a.words;
    delete a.words;
    return Object.assign({ res }, a);
  }
  /** Rank total candidates by explicit final-payment labels and arithmetic, not by the largest number on the receipt. */
  function voteReceipts(list) {
    const score = new Map(), add = (n, weight) => { if (Number.isSafeInteger(Number(n)) && Number(n) > 0) score.set(Number(n), (score.get(Number(n)) || 0) + weight); };
    list.forEach((x) => {
      const m = x.meta || {}, totals = [...new Set(m.labTotal || [])];
      totals.forEach((n) => add(n, 6));
      if (x.amount) add(x.amount, x.sure ? 3.5 : 1.25);
      if (x.amount && totals.includes(x.amount)) add(x.amount, 2.5);
      if (m.labCash && m.labCash.length && m.labChange && m.labChange.length) {
        const derived = Math.max(...m.labCash) - m.labChange[0];
        if (derived >= 500) add(derived, 5);
      }
      if (m.items >= 500) add(m.items, 1.25);
    });
    const order = [...score.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    if (!order.length) return list.slice().sort((x, y) => receiptQuality(y) - receiptQuality(x))[0] || {};
    const top = order[0][0], runner = order[1] ? order[1][1] : 0;
    const base = list.slice().sort((x, y) => receiptQuality(y) - receiptQuality(x))[0] || {};
    const evidence = list.some((x) => x.amount === top && x.sure) || list.some((x) => (x.meta && (x.meta.labTotal || []).includes(top)));
    const margin = order[0][1] - runner;
    const pick = (k) => { const c = new Map(); list.forEach((x) => { if (x[k]) c.set(x[k], (c.get(x[k]) || 0) + 1); }); return [...c.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] || base[k] || null; };
    const bestWords = (list.find((x) => x.amount === top && x.words) || base).words;
    return Object.assign({}, base, {
      amount: top,
      sure: evidence && margin >= 2.5,
      choices: order.slice(0, 6).map((e) => e[0]),
      how: evidence ? 'gabungan label total dan beberapa pembacaan' : 'beberapa pembacaan; nominal perlu diperiksa',
      merchant: pick('merchant'), date: pick('date'), category: list.map((x) => x.category).find((c) => c && c !== 'Belum pasti') || base.category,
      words: bestWords
    });
  }
  /** Tempat umum: tombol kamera / galeri / dokumen. onFiles(files) dipanggil setelah dipilih. */
  function attachButtons(onFiles, labels) {
    labels = labels || {};
    const mk = (accept, extra) => h('input', Object.assign({ type: 'file', accept, hidden: true, onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); } }, extra || {}));
    const cam = mk('image/*', { capture: 'environment' }), gal = mk('image/*', { multiple: true });
    const doc = mk('application/pdf,.pdf,.docx,.xlsx,.csv,.txt,text/plain,text/csv', { multiple: true });
    return h('div', { class: 'attach' }, h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', onclick: () => cam.click() }, labels.cam || 'Foto'), h('button', { class: 'btn sm', onclick: () => gal.click() }, labels.gal || 'Galeri'), h('button', { class: 'btn sm', onclick: () => doc.click() }, labels.doc || 'Dokumen')), cam, gal, doc);
  }

  // ---------- mutasi / e-statement (GoPay, OVO, bank, dll): banyak transaksi dalam satu dokumen ----------
  const DATE_RE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
  const parseAmt = (t) => { const neg = /^[-\u2212\u2013]/.test(t), rp = /rp/i.test(t), n = parseInt(t.replace(/[^\d]/g, '') || '0', 10); return { neg, rp, n }; };
  /** words [{text,x0,x1,y0,y1}] -> {rows, header, owner, provider} atau null bila bukan mutasi. */
  function parseStatement(words) {
    const ws = words.filter((w) => w.text && w.text.trim()).map((w) => ({ ...w, text: w.text.trim() }));
    const hs = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b), medH = hs[Math.floor(hs.length / 2)] || 10;
    const cand = ws.filter((w) => DATE_RE.test(w.text));
    if (cand.length < 3) return null;
    const xs = cand.map((w) => w.x0).sort((a, b) => a - b), leftX = xs[Math.floor(xs.length / 2)];
    const anchors = cand.filter((w) => Math.abs(w.x0 - leftX) < 4 * medH).sort((a, b) => a.y0 - b.y0);
    if (anchors.length < 3) return null;
    const find = (re, after) => ws.find((w) => re.test(w.text) && (after == null || w.x0 > after));
    const hT = find(/^tanggal$/i), hJ = find(/^jumlah$/i), hTr = hT && find(/^transaksi$/i, hT.x0 + 1), hID = find(/^id(\s|$)/i), hM = find(/^metode/i);
    const cols = hT && hJ && hTr && hID && hM ? { tr: hTr.x0 - 6, id: hID.x0 - 6, me: hM.x0 - 12, am: hJ.x0 - 15 } : null;
    const rows = [];
    anchors.forEach((a, i) => {
      const end = Math.min(i + 1 < anchors.length ? anchors[i + 1].y0 - 0.4 * medH : Infinity, a.y0 + 4.5 * medH), top = a.y0 - 0.4 * medH;
      const rec = ws.filter((w) => w !== a && w.y0 >= top && w.y0 < end).sort((p, q) => (Math.abs(p.y0 - q.y0) < 0.4 * medH ? p.x0 - q.x0 : p.y0 - q.y0));
      let desc, idw, amt, meth;
      if (cols) {
        desc = rec.filter((w) => w.x0 >= cols.tr && w.x0 < cols.id); idw = rec.filter((w) => w.x0 >= cols.id && w.x0 < cols.me);
        meth = rec.filter((w) => w.x0 >= cols.me && w.x0 < cols.am); amt = rec.filter((w) => w.x0 >= cols.am);
      } else {
        const isAmt = (w) => /^[-\u2212\u2013]?(rp\.?\s?)?\d[\d.,]*$/i.test(w.text) && !/^\d{1,2}:\d{2}$/.test(w.text);
        const am = rec.filter(isAmt).sort((p, q) => q.x1 - p.x1)[0]; amt = am ? [am] : [];
        const left = am ? am.x0 : Infinity;
        meth = rec.filter((w) => /^(gopay|saldo|coins|ovo|dana|shopeepay)$/i.test(w.text));
        idw = rec.filter((w) => /^[A-Za-z0-9]{14,}$/.test(w.text) && /\d{6}/.test(w.text));
        const idx = idw.length ? idw[0].x0 : left;
        desc = rec.filter((w) => !meth.includes(w) && !idw.includes(w) && !amt.includes(w) && !/^\d{1,2}:\d{2}$/.test(w.text) && w.x0 >= a.x1 && w.x0 < idx);
      }
      const at = amt.map((w) => w.text).join('').replace(/\s/g, ''), { neg, rp, n } = parseAmt(at);
      const time = (rec.find((w) => /^\d{1,2}:\d{2}$/.test(w.text)) || {}).text || '';
      const m = DATE_RE.exec(a.text), d = +m[1], mo = +m[2], y = +m[3];
      if (!R.validDate(y, mo, d) || !n) return;
      rows.push({ date: R.iso(y, mo, d), time, desc: desc.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(), txId: idw.map((w) => w.text).join('').slice(0, 40), method: meth.map((w) => w.text).join(' '), neg, rp, amt: n });
    });
    if (rows.length < 3) return null;
    const below = (re, any) => { const l = ws.find((w) => re.test(w.text)); if (!l) return null; const v = ws.filter((w) => (any ? /^\d[\d.]*$/ : /^rp/i).test(w.text) && w.y0 > l.y0 && w.y0 - l.y0 < 6 * medH && Math.abs((w.x0 + w.x1) / 2 - (l.x0 + l.x1) / 2) < 6 * medH).sort((p, q) => p.y0 - q.y0)[0]; return v ? parseAmt(v.text).n : null; };
    const all = ws.map((w) => w.text).join(' '), prov = /gopay/i.test(all) ? 'GoPay' : /\bovo\b/i.test(all) ? 'OVO' : /shopeepay/i.test(all) ? 'ShopeePay' : /\bdana\b/i.test(all) ? 'Dana' : /\b(bca|bri|bni|mandiri)\b/i.exec(all) ? /\b(bca|bri|bni|mandiri)\b/i.exec(all)[1].toUpperCase() : null;
    const topY = anchors[0].y0, ownerW = ws.filter((w) => w.y0 < topY && /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(w.text) && w.x0 <= leftX + 2 * medH && !/statement|halaman|periode|transaksi|tanggal|total/i.test(w.text)).sort((p, q) => p.y0 - q.y0)[0];
    return { rows, header: { in: below(/^total\s*pemasukan/i), out: below(/^total\s*pengeluaran/i), coinsUsed: below(/^total\s*coins?\s*dipakai/i, true) }, owner: ownerW ? ownerW.text : '', provider: prov };
  }
  /** Memilah satu baris: Keluar / Masuk / Pindah dana (bukan pemasukan atau pengeluaran) / Abaikan. */
  const IDS = () => { const d = db(); d.identities = d.identities || { mine: [], notMine: [] }; d.identities.mine = d.identities.mine || []; d.identities.notMine = d.identities.notMine || []; return d.identities; };
  const acctOf = (t) => ((/\d[\d\s]{5,}\d/.exec(t || '') || [''])[0]).replace(/\s/g, '');
  const EW = '(gopay|dana|ovo|shopeepay|linkaja)';
  const EW_TOPUP = new RegExp('(?:pembayaran\\s+' + EW + '\\s+customer|top\\s*-?up\\s+' + EW + '|isi\\s+saldo\\s+' + EW + ')\\s*(\\d[\\d\\s]{6,}\\d)?', 'i');
  const nameOf = (desc) => {
    const m = /(?:ditransfer|transfer|kirim)\s+ke\s+(.+)/i.exec(desc || ''); if (m) return m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    const e = EW_TOPUP.exec(desc || ''); return e ? ((e[1] || e[2] || e[3]) + ' ' + (e[4] || '').replace(/\s/g, '')).toLowerCase().trim() : '';
  };
  const isMine = (r) => { const t = ((r.desc || '') + ' ' + (r.sub || '')).toLowerCase(), a = acctOf(t); return IDS().mine.some((m) => (m.name && nameOf(r.desc).includes(m.name)) || (m.acct && a && a === m.acct)); };
  function classify(r, ownerTokens) {
    const d = r.desc.toLowerCase(), mem = db().memory.slice().sort((a, b) => b.term.length - a.term.length).find((m) => d.includes(m.term));
    if (isMine(r)) return { kind: 'MOVE', cat: 'Penyesuaian' };
    if (mem) return { kind: mem.kind, cat: mem.category };
    if (/^cashback|^coins? dari/.test(d)) return { kind: 'SKIP', cat: 'Lainnya' };
    // Biaya admin bank: pengeluaran kecil yang pasti, bukan kategori yang perlu ditanyakan.
    if (/^biaya\s+(transaksi|admin)|biaya\s+admin|admin\s+bank/.test(d)) return { kind: 'EXPENSE', cat: 'Lainnya' };
    // Top up e-wallet dari mutasi bank: pindah dana bila akun itu milik sendiri. Nomor bisa milik orang lain, jadi minta konfirmasi sekali.
    if (EW_TOPUP.test(d) && r.neg) return { kind: 'MOVE', cat: 'Penyesuaian', needsDirectionReview: true };
    // A bare transfer label does not reveal whether this is income, spending, or a wallet move.
    // Keep a provisional direction but require an explicit user choice before saving it.
    if (/\b(?:transfer|trf|trsf)\b/.test(d) && !/(?:transfer\s+(?:masuk|dari|ke)|ditransfer\s+ke|kirim\s+ke|pindah\s+dana)/.test(d))
      return { kind: r.neg ? 'EXPENSE' : 'INCOME', cat: 'Lainnya', uncertain: true, needsDirectionReview: true };
    if (/top\s*-?up|isi\s*saldo/.test(d)) return { kind: 'MOVE', cat: 'Penyesuaian' };
    if (/tarik\s*tunai/.test(d)) return { kind: 'MOVE', cat: 'Penyesuaian' };
    if (!r.neg && /transfer masuk|transfer dari|penerimaan transfer|dana masuk dari rekening/.test(d)) return { kind: 'MOVE', cat: 'Penyesuaian' };
    const tf = /(?:ditransfer|transfer|kirim)\s+ke\s+(.+)/.exec(d);
    if (tf) {
      if (ownerTokens.length && ownerTokens.every((t) => tf[1].includes(t))) return { kind: 'MOVE', cat: 'Penyesuaian' };
      return { kind: 'EXPENSE', cat: /laznas|zakat|infaq|sedekah|yatim|donasi|masjid|panti/.test(tf[1]) ? 'Donasi dan sedekah' : 'Keluarga' };
    }
    if (!r.neg) return { kind: 'INCOME', cat: 'Lainnya' };
    let c = R.FreeTextParser.parse(r.desc, R.todayISO(), []).category;
    if (c === 'Belum pasti') { const b = KHScan.detectBrand([r.desc]); if (b) c = b.cat; }
    return { kind: 'EXPENSE', cat: c === 'Belum pasti' ? 'Lainnya' : c, uncertain: c === 'Belum pasti' };
  }
  /** Choose a transfer counterpart only when explicit or type-unambiguous. */
  function guessPartner(r, mainId) {
    const ws = A.activeWallets().filter((w) => w.id !== mainId), t = ((r.desc || '') + ' ' + (r.sub || '') + ' ' + (r.method || '')).toLowerCase();
    const tokens = ['bni', 'bri', 'bca', 'mandiri', 'bsi', 'cimb', 'permata', 'jago', 'seabank', 'neo', 'btn', 'ovo', 'dana', 'shopeepay', 'gopay'];
    const token = tokens.find((n) => new RegExp('\\b' + n + '\\b', 'i').test(t));
    if (token) { const found = ws.find((w) => w.name.toLowerCase().includes(token)); if (found) return found.id; }
    if (/tarik\s*tunai|atm.*tunai|penarikan.*tunai/.test(t)) {
      const cash = ws.filter((w) => w.type === 'CASH' || /^(tunai|kas|cash)(\s|$)/i.test(w.name || ''));
      return cash.length === 1 ? cash[0].id : '';
    }
    if (/top\s*-?up|isi\s*saldo/.test(t) && !r.neg) {
      const bank = ws.filter((w) => w.type === 'BANK');
      return bank.length === 1 ? bank[0].id : '';
    }
    const byName = ws.find((w) => (w.name || '').toLowerCase().trim() && t.includes(w.name.toLowerCase().trim()));
    if (byName) return byName.id;
    // Never silently pair a transfer with the first arbitrary wallet.
    return '';
  }
  function salarySlipMatch(r) {
    if (r.neg) return null;
    const amt = Math.max(0, Number(r.amt) || 0), desc = String(r.desc || '').toLowerCase();
    const pool = A.liveActs().filter((a) => a.type === 'INCOME' && a.source === 'slip' && Math.abs(Number(a.amount) - amt) <= 1000 && Math.abs(R.daysBetween(a.occurredOn, r.date)) <= 3);
    if (!pool.length) return null;
    // Exact amount/date is strong evidence; otherwise require transfer/payroll wording.
    const ranked = pool.filter((a) => Number(a.amount) === amt || /transfer|top.?up|isi saldo|gaji|payroll|salary|penerimaan/.test(desc))
      .sort((a, b) => Math.abs(R.daysBetween(a.occurredOn, r.date)) - Math.abs(R.daysBetween(b.occurredOn, r.date)) || Math.abs(a.amount - amt) - Math.abs(b.amount - amt));
    return ranked[0] || null;
  }
  /** Transfers always have two wallet IDs and never count as new income/expense. */
  function saveMove(r, wid, now) {
    const from = r.neg ? wid : r.partner, to = r.neg ? r.partner : wid;
    if (!from || !to || from === to) throw new Error(`Baris pindah dana “${r.desc}” belum memiliki dompet sumber dan tujuan yang jelas. Pilih pasangan dompet; baris ini belum disimpan.`);
    const near = (d) => Math.abs(R.daysBetween(d, r.date)) <= 1;
    const twin = A.liveActs().find((a) => a.type === 'TRANSFER' && a.amount === r.amt && near(a.occurredOn) && ((a.walletId === from && a.toWalletId === to) || (a.walletId === to && a.toWalletId === from)));
    if (twin) return 'twin';
    const rootIncome = r.originActivityId && A.liveActs().find((a) => a.id === r.originActivityId && a.type === 'INCOME');
    const parent = rootIncome || A.liveActs().filter((a) => !a.deletedAt && a.occurredOn <= r.date && (a.walletId === from || a.toWalletId === from) && (a.type === 'INCOME' || a.type === 'TRANSFER'))
      .sort((a, b) => String(b.occurredOn).localeCompare(String(a.occurredOn)) || Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
    const originActivityId = rootIncome ? rootIncome.id : parent ? (parent.originActivityId || (parent.type === 'INCOME' ? parent.id : null)) : null;
    const rec = { type: 'TRANSFER', amount: r.amt, walletId: from, toWalletId: to, category: 'Pindah dompet', occurredOn: r.date,
      merchant: (r.desc || '').slice(0, 60), note: 'Pindah dana: ' + (r.desc || ''), source: 'mutasi', sourceId: r.txId || null,
      originActivityId, parentActivityId: parent ? parent.id : null,
      provenanceNote: originActivityId ? `Jejak dana terhubung ke ${rootIncome ? 'slip gaji' : 'catatan sumber'}` : 'Asal dana belum dapat dipastikan otomatis; periksa riwayat dompet.',
      createdAt: now, updatedAt: now, deletedAt: null };
    if (r.convertId) {
      const old = A.liveActs().find((x) => x.id === r.convertId);
      if (old) { Object.assign(old, rec, { id: old.id }); return 'ok'; }
    }
    A.addActivity(rec); return 'ok';
  }
  let STM = null;
  function openStatement(r) {
    const st = r.st, owner = (st.owner || '').toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const seenAct = new Map(A.liveActs().filter((a) => a.sourceId).map((a) => [a.sourceId, a]));
    const rp = st.rows.filter((x) => x.rp), coinOut = st.rows.filter((x) => !x.rp && x.neg).reduce((a, x) => a + x.amt, 0);
    const sumPos = rp.filter((x) => !x.neg).reduce((s, x) => s + x.amt, 0), sumNeg = rp.filter((x) => x.neg).reduce((s, x) => s + x.amt, 0);
    const w = A.activeWallets().find((x) => st.provider && x.name.toLowerCase().includes(st.provider.toLowerCase())) || A.activeWallets().find((x) => st.provider && x.id === (db().walletLinks || {})[st.provider]);
    const targetWallet = w ? w.id : (st.provider ? 'new' : A.defaultWallet().id);
    const rows = rp.map((x) => {
      const c = classify(x, owner), old = x.txId ? seenAct.get(x.txId) : null, conv = !!(old && old.type === 'ADJUSTMENT' && c.kind === 'MOVE'), dupe = !!old && !conv;
      const salary = !dupe && !x.neg ? salarySlipMatch(x) : null;
      let kind = dupe ? 'SKIP' : c.kind, cat = c.cat, partner = '', originActivityId = null, hint = x.hint || '';
      if (salary) {
        originActivityId = salary.id;
        if (salary.walletId === targetWallet) { kind = 'SKIP'; hint = `Cocok dengan pemasukan slip gaji ${R.rupiah(salary.amount)} tanggal ${R.formatDate(salary.occurredOn)} di dompet yang sama; dilewati agar tidak dihitung dua kali.`; }
        else { kind = 'MOVE'; cat = 'Pindah dana'; partner = salary.walletId; hint = `Cocok dengan pemasukan slip gaji ${R.rupiah(salary.amount)} (${R.formatDate(salary.occurredOn)}). Akan dicatat sebagai pindah dana, bukan pemasukan baru.`; }
      }
      return { ...x, hint, convertId: conv ? old.id : null, partner, originActivityId, id: S.uid(), kind, cat,
        orig: { kind: c.kind, cat: c.cat }, dupe, uncertain: !!c.uncertain, needsDirectionReview: !!c.needsDirectionReview, salaryMatchId: salary ? salary.id : null };
    });
    rows.forEach((row) => { if (row.kind === 'MOVE' && !row.partner) row.partner = guessPartner(row, targetWallet === 'new' ? null : targetWallet); });
    const cg = {}; rows.forEach((x) => { const nm = nameOf(x.desc); if (!nm || x.kind === 'SKIP') return; cg[nm] = cg[nm] || { name: nm, acct: '', n: 0, total: 0 }; cg[nm].n++; cg[nm].total += x.amt; if (!cg[nm].acct) cg[nm].acct = acctOf(x.sub); });
    const known = IDS(), cands = Object.values(cg).filter((c) => (c.n >= 2 || EW_TOPUP.test(c.name)) && !known.mine.some((m) => m.name === c.name || (c.acct && m.acct === c.acct)) && !known.notMine.includes(c.name));
    STM = { rows, coinPart: st.header.coinsUsed != null ? st.header.coinsUsed - coinOut : null, coins: st.rows.length - rp.length, header: st.header, sumPos, sumNeg, provider: st.provider, wallet: targetWallet, cands, imageUrl: r.res && r.res.imageUrl, ocrText: (r.res && r.res.words || []).map((w) => w.text).filter(Boolean).join(' ') };
  }
  const KIND_LABEL = { EXPENSE: 'Keluar', INCOME: 'Masuk', MOVE: 'Pindah dana', SKIP: 'Abaikan' };
  SCREENS.statement = () => {
    if (!STM) return frame({ title: 'Mutasi', back: true, children: [h('p', { class: 'empty card' }, 'Tidak ada mutasi yang dibuka.')] });
    const st = STM, sum = h('div'), list = h('div'), candBox = h('div'); let filter = 'ALL';
    const drawCands = () => candBox.replaceChildren(...(st.cands || []).map((c) => card(h('h3', null, 'Rekening milik Anda?'),
      h('p', null, `Transfer ke ${c.name}${c.acct ? ' (rek. ' + c.acct + ')' : ''} muncul ${c.n} kali, total ${R.rupiah(c.total)}. Kalau ini rekening atau dompet Anda sendiri, semuanya dihitung pindah dana, bukan pengeluaran. Jawaban diingat untuk impor berikutnya.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: () => { IDS().mine.push({ name: c.name, acct: c.acct }); S.save(); st.rows.forEach((r) => { if (r.kind !== 'SKIP' && isMine(r)) { r.kind = 'MOVE'; r.cat = 'Penyesuaian'; r.needsDirectionReview = false; r.partner = guessPartner(r, st.wallet); } }); st.cands = st.cands.filter((x) => x !== c); drawCands(); drawList(); drawSum(); } }, 'Ya, milik saya'),
        h('button', { class: 'btn ghost sm', onclick: () => { IDS().notMine.push(c.name); S.save(); st.cands = st.cands.filter((x) => x !== c); drawCands(); } }, 'Bukan')))));
    const keep = () => st.rows.filter((r) => r.kind !== 'SKIP');
    const total = (k) => st.rows.filter((r) => r.kind === k).reduce((s, r) => s + r.amt, 0);
    const recon = (label, doc, got, coin, tol, alt) => {
      if (doc == null) return null; tol = tol || 0;
      const near = (x) => Math.abs(x - doc) <= tol, exact = got === doc, ok = near(got) || (coin && near(got - coin)), okAlt = alt != null && alt > 0 && near(alt), good = exact || ok || okAlt;
      const title = good ? `${label} cocok` : `${label} beda ${R.rupiah(Math.abs(got - doc))}`;
      const note = exact ? '' : ok ? (coin && !near(got) ? `Selisih ${R.rupiah(coin)} karena sebagian dibayar dengan koin.` : 'Angka di dokumen dibulatkan.')
        : okAlt ? `Cocok dengan pengeluaran terpilih ${R.rupiah(alt)}; pindah dana tidak dihitung.` : 'Periksa baris yang kurang.';
      return h('p', { class: (good ? 'ok-text' : 'warn-text') + ' callout' }, h('span', { class: 'cb' }, h('strong', null, title), h('span', null, `Dokumen ${R.rupiah(doc)} · Terbaca ${R.rupiah(got)}${note ? '. ' + note : ''}`)));
    };
    const drawSum = () => {
      const byCat = {}; st.rows.filter((r) => r.kind === 'EXPENSE').forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + r.amt; });
      const ex = total('EXPENSE'), cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
      sum.replaceChildren(
        card(h('h3', null, `${st.rows.length} transaksi terbaca`), h('div', { class: 'stats' }, [['Keluar', total('EXPENSE'), 'out'], ['Masuk', total('INCOME'), 'in'], ['Pindah dana', total('MOVE'), '']].map(([l, v, c]) => h('div', { class: 'stat' }, h('small', null, l), h('strong', { class: c }, R.rupiah(v))))),
          recon('Total pemasukan', st.header.in, st.sumPos, 0, st.header.tolIn), recon('Total pengeluaran', st.header.out, st.sumNeg, st.coinPart, st.header.tolOut, total('EXPENSE')),
          st.coins ? null : null,
          null,
          st.ocrText ? h('details', { class: 'ocr-text-details' }, h('summary', null, 'Lihat semua teks hasil pembacaan'), null, h('textarea', { class: 'input', rows: 6, readOnly: true, value: st.ocrText })) : null),
        card(h('h3', null, 'Pengeluaran per kategori'), cats.length ? h('div', { class: 'list' }, cats.map(([c, v]) => h('div', { class: 'cat-row' }, h('div', { class: 'cat-top' }, h('strong', null, c), h('span', null, `${R.rupiah(v)} (${Math.round(v * 100 / ex)}%)`)), h('div', { class: 'bar' }, h('i', { style: { width: Math.max(2, Math.round(v * 100 / ex)) + '%' } }))))) : h('p', { class: 'empty' }, 'Belum ada pengeluaran terpilih.')),
        card(field('Masuk ke dompet', h('select', { class: 'input', onchange: (e) => { st.wallet = e.target.value; st.rows.forEach((r) => { if (r.kind === 'MOVE' && (!r.partner || r.partner === st.wallet)) r.partner = guessPartner(r, st.wallet); }); drawList(); } }, A.orderWallets(A.activeWallets()).map((w) => h('option', { value: w.id, selected: st.wallet === w.id }, w.name)), st.provider && !A.activeWallets().some((w) => w.name.toLowerCase().includes(st.provider.toLowerCase())) ? h('option', { value: 'new', selected: st.wallet === 'new' }, `Buat dompet baru: ${st.provider}`) : null)),
          h('div', { class: 'chips' }, [['ALL', 'Semua'], ...Object.entries(KIND_LABEL)].map(([k, l]) => h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; drawList(); drawSum(); } }, l)))));
    };
    const rowEl = (r) => {
      const el = h('section', { class: 'card entry', 'data-row-id': r.id });
      const draw = () => {
        const cats = r.kind === 'INCOME' ? R.CAT.income : R.CAT.expense;
        el.className = 'card entry' + (r.kind === 'SKIP' ? ' muted' : '');
        const kindButtons = Object.entries(KIND_LABEL).map(([k, l]) => h('button', { type: 'button', class: 'seg-b' + (r.kind === k ? ' on' : ''), 'aria-pressed': String(r.kind === k), onclick: () => {
          const changed = r.kind !== k;
          r.kind = k; r.needsDirectionReview = false;
          if (k === 'MOVE' && !r.partner) r.partner = guessPartner(r, st.wallet);
          if (k === 'INCOME' && !R.CAT.income.includes(r.cat)) { r.cat = 'Lainnya'; if (changed) r.uncertain = true; }
          if (k === 'EXPENSE' && !R.CAT.expense.includes(r.cat)) { r.cat = 'Lainnya'; if (changed) r.uncertain = true; }
          if (k === 'SKIP') r.uncertain = false;
          draw(); drawSum();
        } }, l));
        const directionField = h('div', { class: 'field', 'data-field': 'direction' }, h('span', { class: 'label' }, 'Jenis transaksi'), h('div', { class: 'seg' }, kindButtons));
        const categoryField = (r.kind === 'EXPENSE' || r.kind === 'INCOME') ? h('label', { class: 'field', 'data-field': 'category' },
          h('span', { class: 'label' }, 'Kategori'),
          h('select', { class: 'input', 'aria-label': 'Kategori', value: r.uncertain ? '__unknown__' : r.cat, onchange: (e) => { if (e.target.value !== '__unknown__') { r.cat = e.target.value; r.uncertain = false; } drawSum(); draw(); } },
            r.uncertain ? h('option', { value: '__unknown__', selected: true }, 'Pilih kategori') : null,
            cats.map((c) => h('option', { value: c, selected: !r.uncertain && c === r.cat }, c)))) : null;
        const amountField = h('div', { class: 'field', 'data-field': 'amount' }, h('span', { class: 'label' }, 'Nominal'), moneyInput(r.amt, (n) => { r.amt = n; const shown = el.querySelector('.entry-head .amt'); if (shown) shown.textContent = (r.neg ? '-' : '+') + R.rupiah(n); drawSum(); }));
        const pairField = r.kind === 'MOVE' ? h('div', { class: 'field', 'data-field': 'wallet-pair' },
          h('span', { class: 'label' }, r.neg ? 'Dana pindah ke dompet' : 'Dana berasal dari dompet'),
          h('select', { class: 'input', 'aria-label': 'Pasangan dompet', value: r.partner || '', onchange: (e) => {
            if (e.target.value === '__create_cash__') {
              let cash = A.activeWallets().find((w) => w.type === 'CASH' || /^(tunai|kas|cash)(\s|$)/i.test(w.name || ''));
              if (!cash) { cash = { id: S.uid(), name: 'Tunai', type: 'CASH', openingBalance: 0, includeInTotal: true, archived: false, createdAt: Date.now() }; db().wallets.push(cash); }
              r.partner = cash.id; S.save(); draw(); return;
            }
            r.partner = e.target.value;
          } }, [h('option', { value: '', selected: !r.partner }, 'Pilih dompet pasangan'), ...A.orderWallets(A.activeWallets()).filter((w) => w.id !== st.wallet).map((w) => h('option', { value: w.id, selected: r.partner === w.id }, w.name)), ...(/tarik\s*tunai|atm.*tunai|penarikan.*tunai/i.test((r.desc || '') + ' ' + (r.sub || '')) && !A.activeWallets().some((w) => w.type === 'CASH' || /^(tunai|kas|cash)(\s|$)/i.test(w.name || '')) ? [h('option', { value: '__create_cash__' }, 'Buat dompet Tunai')] : [])])) : null;
        el.replaceChildren(
          h('div', { class: 'entry-head' }, h('span', { class: 'act-main' }, h('strong', null, r.desc || 'Transaksi'), h('small', null, `${R.formatDate(r.date)} ${r.time}${r.sub ? ' · ' + r.sub : ''}${r.dupe ? ' · sudah pernah dicatat' : ''}`), r.hint ? h('small', { class: 'provenance-note' }, r.hint) : null), h('span', { class: 'amt ' + (r.neg ? 'out' : 'in') }, (r.neg ? '-' : '+') + R.rupiah(r.amt))),
          directionField,
          amountField,
          categoryField,
          r.needsDirectionReview ? h('p', { class: 'warn-text' }, 'Jenis transaksi belum pasti. Pilih Keluar, Masuk, Pindah dana, atau Abaikan.') : null,
          r.uncertain && (r.kind === 'EXPENSE' || r.kind === 'INCOME') ? h('p', { class: 'warn-text' }, 'Kategori perlu dipastikan.') : null,
          r.hint && r.kind !== 'MOVE' ? h('p', { class: 'warn-text' }, r.hint) : null,
          pairField);
      };
      draw(); return el;
    };
    const drawList = () => { const rows = st.rows.filter((r) => filter === 'ALL' || r.kind === filter); list.replaceChildren(...(rows.length ? rows.map(rowEl) : [h('p', { class: 'empty card' }, 'Tidak ada baris.')])); };
    const focusStatementIssue = (r, key, message) => {
      filter = 'ALL'; drawList();
      list.querySelectorAll('.field-attention').forEach((x) => x.classList.remove('field-attention'));
      const row = [...list.querySelectorAll('[data-row-id]')].find((x) => x.dataset.rowId === r.id);
      const wrap = row && row.querySelector(`[data-field="${key}"]`);
      if (!wrap) { toast(message); return; }
      wrap.classList.add('field-attention');
      try { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* older browser */ }
      const target = wrap.querySelector('input:not([type="hidden"]),select,textarea,button') || wrap;
      if (target && typeof target.focus === 'function') { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
      toast(message);
    };
    function learn(r) {
      const t = r.desc.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40); if (!t) return;
      const i = db().memory.findIndex((m) => m.term.toLowerCase() === t), rec = { id: i >= 0 ? db().memory[i].id : S.uid(), term: t, kind: r.kind, category: r.cat, merchant: null, createdAt: Date.now() };
      if (i >= 0) db().memory[i] = rec; else db().memory.push(rec);
    }
    async function save() {
      const rows = keep(); if (!rows.length) return toast('Belum ada transaksi yang dipilih.');
      const unclearKind = rows.find((r) => r.needsDirectionReview);
      if (unclearKind) return focusStatementIssue(unclearKind, 'direction', `Pilih jenis transaksi untuk “${unclearKind.desc}”.`);
      const invalidAmount = rows.find((r) => !Number.isSafeInteger(Number(r.amt)) || Number(r.amt) <= 0);
      if (invalidAmount) return focusStatementIssue(invalidAmount, 'amount', `Periksa nominal “${invalidAmount.desc}”.`);
      const unclearCategory = rows.find((r) => (r.kind === 'EXPENSE' || r.kind === 'INCOME') && r.uncertain);
      if (unclearCategory) return focusStatementIssue(unclearCategory, 'category', `Pilih kategori untuk “${unclearCategory.desc}”.`);
      const unpaired = rows.find((r) => r.kind === 'MOVE' && (!r.partner || (st.wallet !== 'new' && r.partner === st.wallet)));
      if (unpaired) return focusStatementIssue(unpaired, 'wallet-pair', `Pilih dompet sumber atau tujuan untuk “${unpaired.desc}”.`);
      let wid = st.wallet;
      const candidates = rows.filter((r) => r.kind === 'INCOME' || r.kind === 'EXPENSE').map((r) => ({ type: r.kind, amount: r.amt, walletId: wid === 'new' ? null : wid, category: r.cat, occurredOn: r.date, merchant: r.desc.slice(0, 60), source: 'mutasi' }));
      if (!(await A.authorizeActivities(candidates))) return;
      const expenseCandidates = candidates.filter((r) => r.type === 'EXPENSE');
      let ci = 0; rows.forEach((r) => { if (r.kind === 'EXPENSE') { const cd = expenseCandidates[ci++]; r.budgetSavingsUsed = cd.budgetSavingsUsed || 0; r.budgetFreeUsed = cd.budgetFreeUsed || 0; r.budgetTopUp = cd.budgetTopUp || 0; r.budgetSavingsKinds = cd.budgetSavingsKinds || null; r.budgetSavingsByBucket = cd.budgetSavingsByBucket; } });
      const before = snapMonths(rows.map((r) => r.date));
      const activitiesBefore = db().activities.map((a) => ({ ...a }));
      const walletsBeforeSave = db().wallets.map((w) => ({ ...w }));
      const linksBefore = { ...(db().walletLinks || {}) };
      const memoryBefore = db().memory.map((m) => ({ ...m }));
      if (wid === 'new') { wid = S.uid(); db().wallets.push({ id: wid, name: st.provider, type: 'EWALLET', openingBalance: 0, includeInTotal: true, archived: false, createdAt: Date.now() }); }
      if (st.provider) { db().walletLinks = db().walletLinks || {}; db().walletLinks[st.provider] = wid; }
      const now = Date.now(); let n = 0, learned = 0, twins = 0;
      try {
        const priority = (r) => r.kind === 'INCOME' ? 0 : r.kind === 'MOVE' ? 1 : r.kind === 'EXPENSE' ? 2 : 3;
        const toWrite = rows.slice().sort((a, b) => R.monthOf(a.date).localeCompare(R.monthOf(b.date)) || priority(a) - priority(b) || a.date.localeCompare(b.date));
        toWrite.forEach((r) => {
          if (r.kind === 'MOVE') { if (saveMove(r, wid, now) === 'twin') { twins++; return; } }
          else A.addActivity({ type: r.kind, amount: r.amt, walletId: wid, category: r.cat, occurredOn: r.date, merchant: r.desc.slice(0, 60), note: '', source: 'mutasi', sourceId: r.txId || null, budgetSavingsUsed: r.budgetSavingsUsed || 0, budgetFreeUsed: r.budgetFreeUsed || 0, budgetTopUp: r.budgetTopUp || 0, budgetSavingsKinds: r.budgetSavingsKinds || null, budgetSavingsByBucket: r.budgetSavingsByBucket });
          n++;
          if ((r.kind !== r.orig.kind || r.cat !== r.orig.cat) && (r.kind === 'EXPENSE' || r.kind === 'INCOME')) { learn(r); learned++; }
        });
      } catch (e) { db().activities = activitiesBefore; db().wallets = walletsBeforeSave; db().walletLinks = linksBefore; db().memory = memoryBefore; S.save(); return toast(e.message); }
      S.save();
      STM = null; A.root('home'); toast(`${n} transaksi dicatat` + (twins ? `. ${twins} pindah dana sudah tercatat, tidak digandakan.` : '') + (learned ? `. ${learned} pilihan Anda diingat.` : '')); notify(before);
    }
    drawSum(); drawList(); drawCands();
    return frame({ title: 'Mutasi dan tagihan', back: true, children: [candBox, sum, list, h('button', { class: 'btn primary block', onclick: save }, 'Catat transaksi terpilih'), h('button', { class: 'btn ghost block', onclick: () => { STM = null; A.back(); } }, 'Batal')] });
  };

  // ---------- cerita gaji -> teks slip ----------
  const gr = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  function storyToSlipText(story) {
    return String(story || '').split(/[\n;,]+|\bdan\b/i).map((seg) => {
      const m = R.MoneyAmountParser.parse(seg);
      if (!m.value) return '';
      const label = seg.replace(/rp\.?\s*/ig, '').replace(/[\d.,]+\s*(juta|jt|ribu|rb|k)?/ig, ' ').replace(/\b(sebesar|sekitar|kena|dapat|ada|sebanyak|sejumlah)\b/ig, ' ').replace(/\s+/g, ' ').trim();
      return label ? `${label} ${gr(m.value)}` : '';
    }).filter(Boolean).join('\n');
  }

  root.KHExtra = { customStart, markChosen, plan, state, allocationForIncome, allocationSnapshot, spendingLimitForIncome, snap, snapMonths, notify, applyPreset, homeCard, meter, lifeRing, mkPlan, PRESETS, readDoc, parseStatement, parseAppList: (w, t) => KHScan.parseAppList(w, t), openStatement, attachButtons, storyToSlipText, analyzeLines, findDate, isBudgetExpense, isSavingsWalletExpense, assertExpenseAllowed };
})(typeof self !== 'undefined' ? self : this);
