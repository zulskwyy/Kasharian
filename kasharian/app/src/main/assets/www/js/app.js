/* KasHarian web (offline test version). One file for routing, auth/PIN flow and the main screens.
   Slip screens live in slipui.js. All data stays in this browser (localStorage). */
(function () {
  'use strict';
  const R = KHRules, S = KHStore, { h, toast, modal, confirmBox, pinPad, moneyInput } = KHUI;
  const $app = document.getElementById('app');
  const db = () => S.db;
  const VERSION = '1.0.8';

  // ---------- state ----------
  const session = { unlocked: false, email: null, flow: null };
  const nav = { stack: [] };
  const SCREENS = {};
  let hiddenAt = 0;

  function go(name, params, opts) {
    if (opts && opts.replace) nav.stack[nav.stack.length - 1] = { name, params }; else nav.stack.push({ name, params });
    try { history.pushState({ d: nav.stack.length }, ''); } catch (e) { /* ignore */ }
    render();
  }
  function root(name, params) { nav.stack = [{ name, params }]; render(); }
  function back() { if (nav.stack.length > 1) { nav.stack.pop(); render(); } }
  function render() {
    const r = nav.stack[nav.stack.length - 1];
    const fn = SCREENS[r.name];
    $app.replaceChildren(fn(r.params || {}));
    syncNav(r.name);
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', () => { if (nav.stack.length > 1) back(); });

  // ---------- chrome ----------
  const logo = (size) => {
    const s = size || 40;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('width', s); svg.setAttribute('height', s); svg.setAttribute('aria-label', 'KasHarian');
    svg.innerHTML = '<rect width="64" height="64" rx="15" fill="#265DCC"/><path d="M22 14v36" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M44 15L26 33l19 17" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    return svg;
  };
  function frame({ title, back: showBack, tabs, children, right, left }) {
    const top = h('header', { class: 'top' },
      left || showBack ? (left || h('button', { class: 'back', 'aria-label': 'Kembali', onclick: back }, h('span', { class: 'back-arrow', 'aria-hidden': 'true' }), h('span', { class: 'sr' }, 'Kembali'))) : h('span', { class: 'back-sp' }),
      h('h1', null, title || ''), right || h('span', { class: 'back-sp' }));
    const el = h('div', { class: 'screen' }, top, h('main', { class: 'main' }, children));
    el.dataset.tab = tabs || '';
    return el;
  }
  /** Navigasi bawah dibuat sekali dan tidak ikut dibuang saat layar berganti, jadi tidak berkedip atau hilang. */
  const NAV_HIDDEN = new Set(['welcome', 'lock', 'pinsetup', 'forgotpin', 'recoveryenter', 'recoverysetup', 'profilesetup', 'opening']);
  const NAV_GROUP = { home: 'home', activities: 'activities', editact: 'activities', bills: 'bills', catat: 'catat' };
  let navEl = null;
  function buildNav() {
    const tab = (id, label) => h('button', { class: 'tab', 'data-tab': id, onclick: () => root(id) }, label);
    return h('nav', { class: 'tabs', id: 'kh-nav', 'aria-label': 'Navigasi utama' }, tab('home', 'Beranda'), tab('activities', 'Aktivitas'),
      h('button', { class: 'tab-catat', 'data-tab': 'catat', onclick: () => { const r = nav.stack[nav.stack.length - 1]; if (r.name !== 'catat') go('catat'); } }, 'Catat'), tab('bills', 'Tagihan'), tab('more', 'Lainnya'));
  }
  function syncNav(name) {
    if (!navEl) { navEl = buildNav(); document.body.append(navEl); }
    const show = !NAV_HIDDEN.has(name), group = NAV_GROUP[name] || 'more';
    navEl.hidden = !show; document.body.classList.toggle('has-nav', show);
    navEl.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === group; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  /** Jalankan pembacaan berkas dengan layar proses. Mengembalikan null bila dibatalkan. */
  async function scanWith(files, run) {
    const ov = KHUI.scanOverlay({ file: files[0], count: files.length });
    // Pengawas: bila tahap yang sama tidak berganti selama STALL_MS (atau total lewat MAX_MS), hentikan dan laporkan di tahap mana macetnya.
    const STALL_MS = 90000, MAX_MS = 300000, t0 = Date.now();
    let lastStage = 'Memulai', lastChange = t0, aborted = false, timer = null;
    const guard = new Promise((_, reject) => {
      timer = setInterval(() => {
        const now = Date.now(); ov.tick && ov.tick(Math.round((now - t0) / 1000));
        if (!aborted && (now - lastChange > STALL_MS || now - t0 > MAX_MS)) {
          aborted = true;
          reject(new Error('Pembacaan berhenti di tahap \"' + lastStage + '\" setelah ' + Math.round((now - t0) / 1000) + ' detik. Tutup aplikasi, buka lagi, lalu coba sekali lagi. Kalau terulang, kirim nama tahap ini ke pengembang.'));
        }
      }, 1000);
    });
    try {
      const r = await Promise.race([run((t) => { const s = String(t || ''); if (s && s !== lastStage) { lastStage = s; lastChange = Date.now(); } ov.stage(t); }), guard]);
      if (ov.cancelled) return null; await ov.finish(); return r;
    } catch (e) {
      if (aborted) { try { window.KHOCR && KHOCR.reset && await KHOCR.reset(); } catch (_) { /* mesin sudah mati */ } }
      throw e;
    } finally { clearInterval(timer); ov.close(); }
  }
  const themeButton = () => h('button', { class: 'theme-btn', type: 'button', 'aria-label': 'Ganti tampilan terang atau gelap', onclick: () => KHUI.Theme.toggle() }, h('span', { class: 'theme-glyph', 'aria-hidden': 'true' }));
  const card = (...kids) => h('section', { class: 'card' }, kids);
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const errBox = () => h('p', { class: 'error', role: 'alert', hidden: true });
  const showErr = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  // ---------- data helpers ----------
  const activeWallets = () => db().wallets.filter((w) => !w.archived);
  const liveActs = () => db().activities.filter((a) => !a.deletedAt).map((a) => Object.assign(a, R.normalizeActivity(a)));
  const sortedActs = () => liveActs().slice().sort((a, b) => (a.occurredOn === b.occurredOn ? b.createdAt - a.createdAt : a.occurredOn < b.occurredOn ? 1 : -1));
  const WALLET_ORDER = { BANK: 0, EWALLET: 1, OTHER: 2, SAVINGS: 3, EMERGENCY: 4, CASH: 5 };
  const isCashWallet = (w) => w.type === 'CASH' || /^(tunai|kas|cash)(\s|$)/i.test(w.name || '');
  const orderWallets = (list) => list.slice().sort((x, y) => ((isCashWallet(x) ? 5 : WALLET_ORDER[x.type] ?? 2) - (isCashWallet(y) ? 5 : WALLET_ORDER[y.type] ?? 2)) || (x.createdAt || 0) - (y.createdAt || 0));
  const totalBalance = () => R.BalanceEngine.total(activeWallets(), liveActs());
  function defaultWallet() {
    let w = activeWallets()[0];
    if (!w) { w = { id: S.uid(), name: 'Uang Saya', type: 'OTHER', openingBalance: 0, includeInTotal: true, archived: false, createdAt: Date.now() }; db().wallets.push(w); S.save(); }
    return w;
  }
  const walletName = (id) => (db().wallets.find((w) => w.id === id) || { name: '-' }).name;
  /** Sumber dana saat limit habis, berurutan: 1) dompet dan uang tunai lain di luar rencana, 2) dana darurat, 3) tabungan.
   * Angka tersedia dihitung dari saldo nyata dan alokasi rencana, tanpa menghitung cadangan tabungan dua kali. */
  const isEmgBucket = (b) => /darurat|emg/i.test((b.id || '') + ' ' + (b.name || ''));
  function ladderAvailability(s) {
    const ws = activeWallets(), bal = R.BalanceEngine.balances(db().wallets, liveActs()), pos = (w) => Math.max(0, Number(bal[w.id]) || 0), sum = (l) => l.reduce((n, v) => n + v, 0);
    const savW = ws.filter((w) => w.type === 'SAVINGS'), emgW = ws.filter((w) => w.type === 'EMERGENCY'), regW = ws.filter((w) => w.type !== 'SAVINGS' && w.type !== 'EMERGENCY');
    const buckets = ((window.KHExtra && KHExtra.plan().buckets) || []).filter((b) => b.save), byB = s.savingsByBucket || {};
    const planEmg = sum(buckets.filter(isEmgBucket).map((b) => byB[b.id] || 0)), planSav = sum(buckets.filter((b) => !isEmgBucket(b)).map((b) => byB[b.id] || 0));
    const physSav = sum(savW.map(pos)), physEmg = sum(emgW.map(pos));
    const unmoved = Math.max(0, planEmg + planSav - physSav - physEmg);
    const free = Math.max(0, sum(regW.map(pos)) - unmoved - Math.max(0, Number(s.spendable) || 0));
    return { free, emergency: Math.max(planEmg, physEmg), savings: Math.max(planSav, physSav),
      exists: { free: regW.length > 0, emergency: emgW.length > 0 || buckets.some(isEmgBucket), savings: savW.length > 0 || buckets.some((b) => !isEmgBucket(b)) },
      freeParts: regW.map((w) => ({ name: w.name, amount: pos(w) })).filter((x) => x.amount > 0) };
  }
  /** Pindahkan dana ke dompet transaksi sesuai sumber yang Anda setujui. Setiap pindahan adalah catatan buku besar sungguhan;
   * budgetSavingsTransferred mencegah dana yang sama dipotong dua kali. */
  function fundSavingsOverage(rec) {
    const authSav = Math.max(0, Number(rec.budgetSavingsUsed) || 0), authFree = Math.max(0, Number(rec.budgetFreeUsed) || 0) + Math.max(0, Number(rec.budgetTopUp) || 0);
    if (rec.type !== 'EXPENSE' || authSav + authFree <= 0 || Number(rec.budgetSavingsTransferred) >= authSav + authFree) return;
    const balances = R.BalanceEngine.balances(db().wallets, liveActs());
    const walletAvailable = Math.max(0, Number(balances[rec.walletId]) || 0);
    const shortfall = Math.max(0, R.ledgerAmountValue(rec.amount) - walletAvailable);
    if (shortfall > authSav + authFree) throw new Error(`Saldo dompet ${walletName(rec.walletId)} kurang ${R.rupiah(shortfall - authSav - authFree)} di luar dana yang Anda setujui. Pilih dompet dengan saldo cukup atau catat pemasukan terlebih dahulu.`);
    const pos = (w) => Math.max(0, Number(balances[w.id]) || 0);
    const freeSources = db().wallets.filter((w) => !w.archived && w.type !== 'SAVINGS' && w.type !== 'EMERGENCY' && w.id !== rec.walletId).sort((x, y) => pos(y) - pos(x)).map((w) => ({ wallet: w, available: pos(w) }));
    const kinds = Array.isArray(rec.budgetSavingsKinds) && rec.budgetSavingsKinds.length ? rec.budgetSavingsKinds : ['SAVINGS', 'EMERGENCY'];
    const savingSources = db().wallets.filter((w) => !w.archived && kinds.includes(w.type) && w.id !== rec.walletId).map((w) => ({ wallet: w, available: pos(w) }));
    // uang di luar rencana hanya dipindah sebesar kekurangan saldo dompet; tabungan dipindah sebesar yang disetujui
    const freeNeed = Math.min(shortfall, authFree), freeAvail = freeSources.reduce((n, x) => n + x.available, 0);
    const savAvail = savingSources.reduce((n, x) => n + x.available, 0);
    if (freeAvail < freeNeed) throw new Error(`Dompet dan uang tunai lain hanya memiliki ${R.rupiah(freeAvail)}, kurang dari yang dibutuhkan ${R.rupiah(freeNeed)}. Periksa saldo atau pilih sumber lain.`);
    const savTransfer = Math.min(authSav, savAvail);
    const move = (sources, total, note) => { let remaining = total; for (const src of sources) { if (remaining <= 0) break; const amount = Math.min(remaining, src.available); if (amount <= 0) continue; addActivity({ type: 'TRANSFER', amount, walletId: src.wallet.id, toWalletId: rec.walletId, category: 'Pindah dompet', note, source: 'budget-savings', sourceId: rec.id || null }); remaining -= amount; } return total - remaining; };
    const movedFree = freeNeed > 0 ? move(freeSources, freeNeed, 'Dana lain dipindahkan setelah konfirmasi') : 0;
    let movedSav = savTransfer > 0 ? move(savingSources, savTransfer, 'Dana tabungan dipindahkan setelah konfirmasi') : 0;
    // Cadangan tabungan yang masih berupa rencana (belum dipindah ke dompet tabungan) fisiknya ada di dompet biasa.
    const remaining = Math.max(0, shortfall - movedFree - movedSav);
    if (remaining > 0) {
      if (authSav <= 0 || remaining > authSav - movedSav) throw new Error(`Dompet transaksi kurang ${R.rupiah(remaining)}. Tambahkan pemasukan, pilih dompet yang tepat, atau periksa saldo.`);
      const b2 = R.BalanceEngine.balances(db().wallets, liveActs()), p2 = (w) => Math.max(0, Number(b2[w.id]) || 0);
      const regSources = db().wallets.filter((w) => !w.archived && w.type !== 'SAVINGS' && w.type !== 'EMERGENCY' && w.id !== rec.walletId).sort((x, y) => p2(y) - p2(x)).map((w) => ({ wallet: w, available: p2(w) }));
      const regAvail = regSources.reduce((n, x) => n + x.available, 0);
      if (regAvail < remaining) throw new Error(`Dompet transaksi kurang ${R.rupiah(remaining)}. Saldo yang bisa dipindahkan hanya ${R.rupiah(regAvail)}. Tambahkan pemasukan atau periksa saldo.`);
      movedSav += move(regSources, remaining, 'Cadangan tabungan dipindahkan setelah konfirmasi');
    }
    rec.budgetSavingsTransferred = movedFree + movedSav;
  }

  function addActivity(a) {
    const rec = Object.assign({ id: S.uid(), type: 'EXPENSE', walletId: defaultWallet().id, toWalletId: null, category: 'Lainnya', occurredOn: R.todayISO(), merchant: null, note: '', source: 'manual', sourceId: null, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null }, a || {});
    Object.assign(rec, R.normalizeActivity(rec));
    if (!['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT'].includes(rec.type)) throw new Error('Jenis transaksi tidak valid. Pilih Masuk, Keluar, Pindah dana, atau Penyesuaian.');
    // Amounts for income/expense/transfer are always positive magnitudes; type alone
    // controls whether the ledger adds or subtracts. Adjustments remain signed.
    rec.amount = rec.type === 'ADJUSTMENT' ? Math.round(R.ledgerAmountValue(rec.amount)) : Math.round(Math.abs(R.ledgerAmountValue(rec.amount)));
    if (!Number.isSafeInteger(rec.amount)) throw new Error('Nominal transaksi tidak valid. Periksa kembali angka yang dimasukkan.');
    const err = R.validateAmount(Math.abs(rec.amount));
    if (err) throw new Error(err);
    // Snapshot the allocation rules at the time an income is recorded so future
    // plan changes never rewrite the history of savings goals.
    if (rec.type === 'INCOME' && !rec.planAllocation && window.KHExtra && typeof KHExtra.allocationSnapshot === 'function') {
      rec.planAllocation = KHExtra.allocationSnapshot(rec.amount, rec.category);
    }
    if (!activeWallets().some((w) => w.id === rec.walletId)) throw new Error('Pilih dompet aktif untuk transaksi ini.');
    // Transfers must always have an explicit source and destination. A transfer
    // without two wallets is not a valid ledger event and must never become income.
    if (rec.type === 'TRANSFER') {
      if (!rec.walletId || !rec.toWalletId || rec.walletId === rec.toWalletId) throw new Error('Pilih dompet sumber dan dompet tujuan yang berbeda untuk mencatat pindah dana.');
      if (!db().wallets.some((w) => w.id === rec.toWalletId && !w.archived)) throw new Error('Dompet tujuan tidak ditemukan atau sudah diarsipkan. Periksa pengaturan dompet.');
    }
    if (rec.type === 'TRANSFER' && rec.source !== 'budget-savings') {
      // Keep the transfer lineage attached to the most recent earlier movement
      // touching the source wallet. The note explicitly flags when no root income
      // can be proven instead of pretending the source is certain.
      const parent = liveActs().filter((x) => x.id !== rec.id && !x.deletedAt && String(x.occurredOn || '') <= String(rec.occurredOn || R.todayISO()) &&
        (x.walletId === rec.walletId || x.toWalletId === rec.walletId) && ['INCOME', 'TRANSFER'].includes(x.type))
        .sort((a, b) => String(b.occurredOn || '').localeCompare(String(a.occurredOn || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
      if (parent) {
        rec.parentActivityId = rec.parentActivityId || parent.id;
        rec.originActivityId = rec.originActivityId || parent.originActivityId || (parent.type === 'INCOME' ? parent.id : null);
      }
      if (!rec.provenanceNote) rec.provenanceNote = rec.originActivityId ? 'Jejak dana terhubung ke pemasukan asal.' : 'Asal dana belum bisa dipastikan dari riwayat transaksi; periksa catatan sumber.';
    }
    // Enforce the budget and non-negative ledger invariant even when a caller
    // bypasses the visible form-level validation.
    if (rec.type === 'EXPENSE' && window.KHExtra && typeof KHExtra.assertExpenseAllowed === 'function') KHExtra.assertExpenseAllowed(rec);
    if (rec.type === 'EXPENSE' && (Number(rec.budgetSavingsUsed || 0) + Number(rec.budgetFreeUsed || 0) + Number(rec.budgetTopUp || 0)) > Number(rec.budgetSavingsTransferred || 0)) fundSavingsOverage(rec);
    const balances = R.BalanceEngine.balances(db().wallets, liveActs());
    const available = Math.max(0, Number(balances[rec.walletId]) || 0);
    const amount = Math.max(0, R.ledgerAmountValue(rec.amount));
    if ((rec.type === 'EXPENSE' || rec.type === 'TRANSFER') && amount > available) throw new Error(`Saldo dompet ${walletName(rec.walletId)} hanya ${R.rupiah(available)}. Tambahkan pemasukan atau pilih dompet yang memiliki saldo cukup sebelum menyimpan transaksi.`);
    db().activities.push(rec);
    return rec;
  }

  /** Ask before crossing the monthly planned spending limit. Candidates are not
   * written until the entire batch has been authorized, avoiding partial imports. */
  async function authorizeActivities(candidates) {
    const all = (candidates || []).filter((x) => x && (x.type === 'INCOME' || x.type === 'EXPENSE'));
    // Project wallet balances in entry order before budget checks so a batch cannot
    // silently create a negative wallet balance. Income should be recorded first.
    const currentBalances = R.BalanceEngine.balances(db().wallets, liveActs()), projected = {}, walletShortfalls = [];
    const projectionOrder = all.slice().sort((a, b) => {
      const monthOrder = R.monthOf(a.occurredOn || R.todayISO()).localeCompare(R.monthOf(b.occurredOn || R.todayISO()));
      if (monthOrder) return monthOrder;
      const priority = (x) => x.type === 'INCOME' ? 0 : 1;
      return priority(a) - priority(b) || String(a.occurredOn || '').localeCompare(String(b.occurredOn || ''));
    });
    for (const x of projectionOrder) {
      if (!x.walletId) continue; // a new wallet may be created by the import handler
      if (!(x.walletId in projected)) projected[x.walletId] = Number(currentBalances[x.walletId]) || 0;
      const amount = Math.abs(R.ledgerAmountValue(x.amount));
      if (x.type === 'INCOME') projected[x.walletId] += amount;
      else {
        const available = Math.max(0, projected[x.walletId]);
        if (amount > available) walletShortfalls.push({ item: x, shortfall: amount - available, available });
        projected[x.walletId] = Math.max(0, projected[x.walletId] - amount);
      }
    }
    if (!window.KHExtra || typeof KHExtra.state !== 'function') return true;
    const list = all.filter((x) => x.type === 'EXPENSE');
    const months = [...new Set(list.map((x) => R.monthOf(x.occurredOn || R.todayISO())) )];
    let projectedSavingsAvailable = null, ladderState = null;
    for (const ym of months) {
      const monthItems = list.filter((x) => R.monthOf(x.occurredOn || R.todayISO()) === ym);
      const s = KHExtra.state(ym);
      // Include income entries in this same unsaved batch in the projected limit.
      // The ledger itself is not mutated until every item passes authorization.
      const pendingIncomeLimit = all.filter((x) => x.type === 'INCOME' && R.monthOf(x.occurredOn || R.todayISO()) === ym)
        .reduce((n, x) => n + (typeof KHExtra.spendingLimitForIncome === 'function' ? KHExtra.spendingLimitForIncome(Math.abs(R.ledgerAmountValue(x.amount)), x.category) : 0), 0);
      const spendable = Math.max(0, s.spendable + pendingIncomeLimit);
      if (projectedSavingsAvailable === null) projectedSavingsAvailable = s.savingsAvailable;
      projectedSavingsAvailable = Math.min(projectedSavingsAvailable, s.savingsAvailable);
      const regular = monthItems.filter((x) => KHExtra.isBudgetExpense(x));
      const fromSavings = monthItems.filter((x) => KHExtra.isSavingsWalletExpense(x));
      if (fromSavings.length && spendable > 0) {
        const result = await modal({ title: 'Gunakan tabungan?', tone: 'warn', body: [h('p', null, `Masih ada ${R.rupiah(spendable)} pada limit kebutuhan dan keinginan bulan ini. Agar tabungan tetap terlindungi, gunakan dana tersebut lebih dahulu.`)], buttons: [{ label: 'Kembali', value: 'cancel' }, { label: 'Periksa dompet', kind: 'primary', value: 'regular' }] });
        if (result === 'regular') {
          const current = nav.stack[nav.stack.length - 1];
          if (!current || current.name !== 'catat') go('catat');
          toast('Transaksi belum disimpan. Pilih dompet belanja biasa atau catat pemasukan terlebih dahulu.');
        }
        return false;
      }
      const total = regular.reduce((n, x) => n + Math.abs(R.ledgerAmountValue(x.amount)), 0);
      const excess = Math.max(0, total - spendable);
      if (excess > 0) {
        if (!ladderState) ladderState = ladderAvailability(s);
        const av = ladderState, KEYS = ['free', 'emergency', 'savings'];
        const LABEL = { free: 'Dompet dan uang tunai lain', emergency: 'Dana darurat', savings: 'Tabungan' };
        const rows = KEYS.filter((k) => av.exists[k] || av[k] > 0), totalAvail = KEYS.reduce((n, k) => n + av[k], 0);
        const single = rows.find((k) => av[k] >= excess);
        let choice = single || (totalAvail >= excess ? 'mix' : null);
        const list = h('div', { class: 'ladder', role: 'radiogroup', 'aria-label': 'Sumber dana' });
        const row = (k, i, label, amount, detail, ok) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(choice === k), class: 'ladder-row' + (choice === k ? ' on' : '') + (ok ? '' : ' off'), disabled: !ok, onclick: () => { choice = k; draw(); } },
          h('span', { class: 'ladder-no' }, i), h('span', { class: 'ladder-main' }, h('strong', null, label), detail ? h('small', null, detail) : null), h('strong', { class: 'ladder-amt' }, R.rupiah(amount)));
        const draw = () => list.replaceChildren(...rows.map((k, i) => row(k, String(i + 1), LABEL[k], av[k], k === 'free' ? 'Di luar limit dan rencana tabungan' : k === 'emergency' ? 'Cadangan darurat' : 'Tujuan tabungan', av[k] >= excess)),
          rows.length > 1 ? row('mix', '+', 'Gabungan berurutan', totalAvail, 'Dipakai dari nomor 1 ke bawah', totalAvail >= excess) : null);
        draw();
        const buttons = [{ label: 'Batalkan', kind: 'ghost', value: 'cancel' }, { label: 'Catat pemasukan', kind: 'ghost', value: 'income' }];
        if (choice) buttons.push({ label: 'Pakai pilihan ini', kind: 'primary', value: 'use' });
        const result = await modal({ title: 'Limit bulan ini habis', tone: 'warn', body: [
          h('p', null, `Selisih ${R.rupiah(excess)} di atas limit ${R.monthLabel(ym)}. ${choice ? 'Tutup dari:' : `Dana yang tersedia ${R.rupiah(totalAvail)} belum cukup.`}`), choice ? list : null], buttons });
        if (result === 'income') {
          const current = nav.stack[nav.stack.length - 1];
          if (!current || current.name !== 'catat') go('catat');
          toast('Tambahkan pemasukan untuk bulan ini, lalu ulangi transaksi.'); return false;
        }
        if (result !== 'use' || !choice) return false;
        const order = choice === 'mix' ? KEYS : [choice], rem = { free: av.free, emergency: av.emergency, savings: av.savings };
        const goals = ((window.KHExtra && KHExtra.plan().buckets) || []).filter((b) => b.save), availableByGoal = { ...(s.savingsByBucket || {}) };
        let remaining = spendable;
        for (const x of regular) {
          const amt = Math.abs(R.ledgerAmountValue(x.amount)), fromLimit = Math.min(remaining, amt); remaining -= fromLimit;
          let portion = amt - fromLimit; const kinds = new Set();
          x.budgetSavingsUsed = 0; x.budgetFreeUsed = 0; x.budgetSavingsByBucket = {};
          for (const k of order) {
            if (portion <= 0) break;
            const take = Math.min(portion, rem[k]); if (take <= 0) continue;
            rem[k] -= take; portion -= take;
            if (k === 'free') { x.budgetFreeUsed += take; continue; }
            x.budgetSavingsUsed += take; kinds.add(k === 'emergency' ? 'EMERGENCY' : 'SAVINGS');
            let need = take;
            for (const b of goals.filter((g) => (k === 'emergency') === isEmgBucket(g))) {
              if (need <= 0) break;
              const got = Math.min(need, Math.max(0, Number(availableByGoal[b.id]) || 0));
              if (got > 0) { x.budgetSavingsByBucket[b.id] = (x.budgetSavingsByBucket[b.id] || 0) + got; availableByGoal[b.id] -= got; need -= got; }
            }
          }
          x.budgetSavingsKinds = kinds.size ? [...kinds] : null;
        }
        av.free = rem.free; av.emergency = rem.emergency; av.savings = rem.savings;
      }
    }
    const authorizedOf = (x) => Math.max(0, Number(x.budgetSavingsUsed) || 0) + Math.max(0, Number(x.budgetFreeUsed) || 0) + Math.max(0, Number(x.budgetTopUp) || 0);
    let unfunded = walletShortfalls.filter((x) => authorizedOf(x.item) < x.shortfall);
    if (unfunded.length) {
      // Kekurangan saldo dompet di dalam limit: tawarkan memindahkan dari dompet dan uang tunai lain lebih dulu.
      const balances = R.BalanceEngine.balances(db().wallets, liveActs());
      const others = (wid) => activeWallets().filter((w) => w.id !== wid && w.type !== 'SAVINGS' && w.type !== 'EMERGENCY').map((w) => ({ name: w.name, amount: Math.max(0, Number(balances[w.id]) || 0) })).filter((o) => o.amount > 0);
      const x0 = unfunded[0], need0 = x0.shortfall - authorizedOf(x0.item), pool0 = others(x0.item.walletId), poolTotal = pool0.reduce((n, o) => n + o.amount, 0);
      if (poolTotal >= need0) {
        const r = await modal({ title: 'Saldo dompet tidak cukup', tone: 'warn', body: [h('p', null, `${walletName(x0.item.walletId)} kurang ${R.rupiah(need0)}. Pindahkan dari:`), h('div', { class: 'ladder' }, pool0.map((o, i) => h('div', { class: 'ladder-row on static' }, h('span', { class: 'ladder-no' }, String(i + 1)), h('span', { class: 'ladder-main' }, h('strong', null, o.name)), h('strong', { class: 'ladder-amt' }, R.rupiah(o.amount)))))],
          buttons: [{ label: 'Kembali', kind: 'ghost', value: false }, { label: 'Pindahkan otomatis', kind: 'primary', value: 'move' }] });
        if (r !== 'move') return false;
        for (const x of unfunded) { const need = x.shortfall - authorizedOf(x.item); if (need > 0 && others(x.item.walletId).reduce((n, o) => n + o.amount, 0) >= need) x.item.budgetTopUp = (Number(x.item.budgetTopUp) || 0) + need; }
        unfunded = walletShortfalls.filter((x) => authorizedOf(x.item) < x.shortfall);
      }
      if (unfunded.length) {
        const x = unfunded[0];
        await modal({ title: 'Saldo dompet tidak cukup', tone: 'warn', body: [
          h('p', null, `${walletName(x.item.walletId)} memiliki ${R.rupiah(x.available)}, transaksi ${R.rupiah(Math.max(0, R.ledgerAmountValue(x.item.amount)))}.`),
          h('p', null, 'Pilih dompet dengan saldo cukup atau catat pemasukan terlebih dahulu.')], buttons: [{ label: 'Kembali', kind: 'primary', value: false }] });
        return false;
      }
    }
    return true;
  }
  const catList = (kind) => (kind === 'INCOME' ? R.CAT.income : R.CAT.expense);
  const sign = (a) => (a.type === 'INCOME' ? 1 : a.type === 'EXPENSE' ? -1 : a.type === 'ADJUSTMENT' ? (a.amount >= 0 ? 1 : -1) : 0);
  const kindLabel = { INCOME: 'Masuk', EXPENSE: 'Keluar', TRANSFER: 'Pindah dompet', ADJUSTMENT: 'Penyesuaian' };

  function countUp(el, to) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || to === 0) { el.textContent = R.rupiah(to); return; }
    const t0 = performance.now(), dur = 600;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = R.rupiah(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ---------- biometrics: Android BiometricPrompt in APK, WebAuthn in PWA ----------
  function nativeBioAuth() {
    return new Promise((resolve, reject) => {
      const bridge = window.KHNativeStorage;
      if (!bridge || typeof bridge.authenticate !== 'function') return reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
      const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
      window.__khNativeBioCallbacks = window.__khNativeBioCallbacks || {};
      window.__khNativeBioCallbacks[id] = (ok, code) => {
        if (ok) resolve(true);
        else reject(Object.assign(new Error(code || 'Biometric verification cancelled'), { name: 'NotAllowedError' }));
      };
      try { bridge.authenticate(id); }
      catch (e) { delete window.__khNativeBioCallbacks[id]; reject(e); }
    });
  }
  window.__khNativeBioResult = function (id, ok, code) {
    const callbacks = window.__khNativeBioCallbacks || {}, cb = callbacks[id];
    if (!cb) return;
    delete callbacks[id]; cb(!!ok, String(code || ''));
  };
  async function bioSupported() {
    try {
      if (window.KHNativeStorage && typeof window.KHNativeStorage.isBiometricAvailable === 'function') return !!window.KHNativeStorage.isBiometricAvailable();
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || typeof navigator.credentials.create !== 'function') return false;
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
      return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
  }
  function bioError(e) {
    const n = (e && e.name) || '', m = String((e && e.message) || '');
    if (window.KHNativeStorage) return n === 'NotAllowedError' ? 'Verifikasi dibatalkan atau tidak cocok. Gunakan PIN untuk membuka aplikasi.' : 'Verifikasi perangkat belum bisa digunakan. PIN tetap bisa dipakai.';
    if (!window.isSecureContext || /TLS|certificate|insecure|secure context/i.test(m) || n === 'SecurityError') return 'Sidik jari membutuhkan alamat HTTPS dengan sertifikat yang sah. Peramban tidak dapat mengubah pengaturan sidik jari HP. PIN tetap bisa dipakai.';
    if (!window.PublicKeyCredential || !navigator.credentials) return 'Peramban ini tidak mendukung WebAuthn. Gunakan PIN untuk membuka aplikasi.';
    if (n === 'NotAllowedError') return 'Permintaan dibatalkan atau waktunya habis. Coba lagi dan ikuti dialog keamanan perangkat.';
    if (n === 'NotSupportedError') return 'Perangkat atau peramban tidak menyediakan autentikator platform. Aktifkan sidik jari atau kunci layar di Pengaturan HP bila tersedia.';
    if (n === 'InvalidStateError') return 'Autentikator sudah terdaftar di perangkat ini.';
    return 'Sidik jari belum bisa diaktifkan di sini. PIN tetap bisa dipakai.';
  }
  async function bioEnroll() {
    if (window.KHNativeStorage && typeof window.KHNativeStorage.authenticate === 'function') {
      if (!await bioSupported()) throw Object.assign(new Error('Biometrik tidak tersedia'), { name: 'NotSupportedError' });
      await nativeBioAuth();
      db().bio = { native: true }; S.save(); return;
    }
    if (!window.isSecureContext) throw Object.assign(new Error('secure context required'), { name: 'SecurityError' });
    if (!window.PublicKeyCredential || !navigator.credentials) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    const rp = { name: 'KasHarian' }; if (location.hostname) rp.id = location.hostname;
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: S.randomBytes(32), rp, user: { id: S.randomBytes(16), name: (db().profile && db().profile.username) || 'kasharian', displayName: (db().profile && db().profile.name) || 'KasHarian' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000 } });
    db().bio = { id: S.b64(cred.rawId) }; S.save();
  }
  async function bioUnlock() {
    if (window.KHNativeStorage && db().bio && db().bio.native) return nativeBioAuth();
    const pk = { challenge: S.randomBytes(32), allowCredentials: [{ type: 'public-key', id: S.unb64(db().bio.id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 };
    if (location.hostname) pk.rpId = location.hostname;
    await navigator.credentials.get({ publicKey: pk });
    return true;
  }

  // ---------- profile: avatar, name, username, greeting ----------
  const AVATAR_COLORS = ['#C4FF3D', '#FF375F', '#04C7DD', '#FFD60A', '#FF9F0A', '#BF5AF2', '#0A84FF', '#D1D1D6'];
  function avatarEl(p, size) {
    const s = size || 40;
    if (p && p.avatar && p.avatar.type === 'photo') return h('img', { class: 'avatar', src: p.avatar.data, alt: 'Foto profil', style: { width: s + 'px', height: s + 'px' } });
    const color = (p && p.avatar && p.avatar.color) || AVATAR_COLORS[0];
    const letter = ((p && p.name) || 'K').trim().charAt(0).toUpperCase() || 'K';
    return h('span', { class: 'avatar', role: 'img', 'aria-label': 'Avatar', style: { width: s + 'px', height: s + 'px', background: color, fontSize: Math.round(s * 0.46) + 'px' } }, letter);
  }
  async function photoToAvatar(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
    c.width = c.height = 192;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 192, 192);
    return c.toDataURL('image/jpeg', 0.82);
  }
  const toneInfo = { akrab: 'Hangat dan akrab', santai: 'Singkat dan santai', sopan: 'Sopan dan formal' };

  function profileForm(init, submitLabel, onSave) {
    const st = { name: init.name || '', username: init.username || '', greeting: init.greeting === undefined ? 'Kak' : init.greeting, tone: init.tone || 'akrab', avatar: init.avatar || { type: 'initial', color: AVATAR_COLORS[0] } };
    const avatarBox = h('div', { class: 'avatar-big' }), swatches = h('div', { class: 'swatches' }), preview = h('div', { class: 'preview-msg' }), photoBtns = h('div', { class: 'btn-row' });
    const chipsG = h('div', { class: 'chips' }), chipsT = h('div', { class: 'chips' }), err = errBox();
    const drawAvatar = () => avatarBox.replaceChildren(avatarEl({ name: st.name || 'K', avatar: st.avatar }, 84));
    const drawSwatches = () => swatches.replaceChildren(...AVATAR_COLORS.map((c, i) => h('button', { type: 'button', class: 'swatch' + (st.avatar.type === 'initial' && st.avatar.color === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Warna ' + (i + 1), onclick: () => { st.avatar = { type: 'initial', color: c }; drawAvatar(); drawSwatches(); drawPhotoBtns(); } })));
    const drawPreview = () => {
      const m = R.Reminder.billMessage(st, { name: 'listrik', amount: 450000 }, 1, 9);
      preview.replaceChildren(h('strong', null, m.title), h('p', null, m.body));
    };
    const drawChips = () => {
      chipsG.replaceChildren(...R.Reminder.GREETINGS.map((g) => h('button', { type: 'button', class: 'chip' + (st.greeting === g ? ' on' : ''), onclick: () => { st.greeting = g; drawChips(); drawPreview(); } }, g || 'Tanpa sapaan')));
      chipsT.replaceChildren(...Object.entries(R.Reminder.TONES).map(([k, v]) => h('button', { type: 'button', class: 'chip' + (st.tone === k ? ' on' : ''), onclick: () => { st.tone = k; drawChips(); drawPreview(); } }, v + ': ' + toneInfo[k].toLowerCase())));
    };
    const pick = (extra) => h('input', Object.assign({ type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { st.avatar = { type: 'photo', data: await photoToAvatar(f) }; drawAvatar(); drawSwatches(); drawPhotoBtns(); } catch (x) { toast('Foto tidak bisa dibuka. Coba foto lain (JPG atau PNG).'); }
    } }, extra || {}));
    const gal = pick(), cam = pick({ capture: 'user' });
    const drawPhotoBtns = () => photoBtns.replaceChildren(...[h('button', { type: 'button', class: 'btn sm', onclick: () => gal.click() }, 'Pilih foto'), h('button', { type: 'button', class: 'btn sm', onclick: () => cam.click() }, 'Ambil selfie'),
      st.avatar.type === 'photo' ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.avatar = { type: 'initial', color: AVATAR_COLORS[0] }; drawAvatar(); drawSwatches(); drawPhotoBtns(); } }, 'Hapus foto') : null].filter(Boolean));
    drawAvatar(); drawSwatches(); drawPreview(); drawChips(); drawPhotoBtns();
    const submit = () => {
      const e = R.Profile.validate(st);
      if (e.name || e.username) return showErr(err, [e.name, e.username].filter(Boolean).join(' '));
      onSave({ name: st.name.replace(/\s+/g, ' ').trim(), username: R.Profile.normalizeUsername(st.username), greeting: st.greeting, tone: st.tone, avatar: st.avatar, updatedAt: Date.now() });
    };
    return h('div', { class: 'stack' },
      card(h('div', { class: 'avatar-row' }, avatarBox, h('div', null, h('span', { class: 'label' }, 'Foto atau warna avatar'), photoBtns)), swatches, gal, cam),
      card(field('Nama panggilan', h('input', { class: 'input', value: st.name, maxlength: 24, autocomplete: 'nickname', placeholder: 'Contoh: Zulsky', oninput: (e) => { st.name = e.target.value; drawAvatar(); drawPreview(); } })),
        field('Username', h('input', { class: 'input', value: st.username, maxlength: 21, autocapitalize: 'none', autocomplete: 'off', placeholder: '@zulsky', oninput: (e) => { st.username = e.target.value; } }))),
      card(h('h3', null, 'Cara aplikasi menyapa Anda'), h('span', { class: 'label' }, 'Sapaan'), chipsG, h('span', { class: 'label' }, 'Gaya pengingat'), chipsT, preview),
      err, h('button', { class: 'btn primary block', onclick: submit }, submitLabel));
  }

  // ---------- onboarding ----------
  SCREENS.welcome = () => {
    const agree = h('input', { type: 'checkbox', id: 'agree' });
    const btn = h('button', { class: 'btn primary block', disabled: true, onclick: () => go('profilesetup', { flow: 'new' }) }, 'Mulai');
    agree.addEventListener('change', () => { btn.disabled = !agree.checked; });
    return h('div', { class: 'screen center-screen' }, h('div', { class: 'welcome' },
      logo(72), h('h1', { class: 'brand' }, 'KasHarian'),
      window.KHI18n ? KHUI.langSwitch() : null,
      card(h('p', null, 'Semua data hanya disimpan di perangkat ini dan tidak dikirim ke mana pun.'),
        h('label', { class: 'check' }, agree, h('span', null, 'Saya mengerti dan setuju data disimpan di perangkat ini.'))),
      btn,
      h('button', { class: 'link', type: 'button', onclick: () => go('restore') }, 'Pulihkan dari cadangan')));
  };


  SCREENS.profilesetup = ({ flow }) => frame({ title: flow === 'new' || flow === 'migrate' ? 'Kenalan dulu' : 'Profil', back: flow === 'new' && nav.stack.length > 1, children: [
    null,
    profileForm(db().profile || {}, 'Lanjut', (p) => {
      db().profile = p; S.save();
      if (flow === 'new') go('pinsetup', { flow: 'newpin' }, { replace: true });
      else if (!db().onboarded) root('opening');
      else root('home');
    })] });

  SCREENS.pinsetup = ({ flow }) => {
    let first = null;
    const title = h('h2', { class: 'pin-title' }, flow === 'change' ? 'Buat PIN baru' : flow === 'resetpin' ? 'Buat PIN baru' : 'Buat PIN 6 angka');
    const sub = null;
    const err = errBox();
    const pad = pinPad({ onDone: async (pin) => {
      if (!first) { first = pin; title.textContent = 'Ulangi PIN'; pad.clear(); return; }
      if (pin !== first) { first = null; title.textContent = 'Buat PIN 6 angka'; showErr(err, 'PIN tidak sama. Coba lagi.'); pad.shake(); pad.clear(); return; }
      const salt = S.newSalt();
      db().pin = { salt, hash: await S.hashSecret(pin, salt) }; db().failed = { n: 0, until: 0 }; S.save();
      session.unlocked = true;
      if (flow === 'newpin' && window.KHRecovery) { if (!KHRecovery.exists()) return go('recoverysetup', { then: 'afterpin' }, { replace: true }); }
      else if (flow === 'newpin' && !db().lastBackupAt) KHUI.notice('PIN tidak dapat dipulihkan', h('p', null, 'Jika PIN terlupa dan tidak ada cadangan, data tidak bisa dibuka lagi. Buat cadangan terenkripsi dari menu Lainnya.'), 'warn');
      if (flow === 'change') { toast('PIN diganti'); nav.stack = [{ name: 'more' }]; render(); return; }
      if (flow === 'resetpin') { if (!db().onboarded) return go('opening', null, { replace: true }); return root('home'); }
      if (!db().bio && await bioSupported()) return go('bio', null, { replace: true });
      if (!db().onboarded) go('opening', null, { replace: true }); else root('home');
    } });
    return frame({ title: 'PIN', back: flow === 'change', children: [h('div', { class: 'pin-wrap' }, title, sub, pad.el, err)] });
  };

  SCREENS.bio = () => {
    const err = errBox();
    const next = () => { if (!db().onboarded) go('opening', null, { replace: true }); else root('home'); };
    return frame({ title: 'Sidik jari', children: [card(
      null,
      err,
      h('button', { class: 'btn primary block', onclick: async () => { showErr(err, ''); try { await bioEnroll(); toast('Sidik jari aktif'); next(); } catch (e) { showErr(err, bioError(e)); } } }, 'Aktifkan sidik jari'),
      h('button', { class: 'btn ghost block', onclick: next }, 'Lanjut dengan PIN saja'),
      null)] });
  };

  // Recovery-code/account screen removed. Local-only PINs cannot be restored by a server.
  SCREENS.forgotpin = () => { const rec = !!(window.KHRecovery && KHRecovery.exists()); return frame({ title: 'Lupa PIN', back: true, children: [card(
    h('h3', null, rec ? 'Pulihkan akses' : 'PIN tidak dapat dipulihkan'),
    rec ? h('button', { class: 'btn primary block', onclick: () => go('recoveryenter') }, 'Pulihkan dengan 12 kata') : h('p', { class: 'note' }, '12 kata pemulihan belum dibuat di perangkat ini. Kamu masih bisa memulihkan dari cadangan.'),
    h('button', { class: 'btn ' + (rec ? '' : 'primary ') + 'block', onclick: () => go('restore') }, 'Pulihkan dari cadangan'),
    h('button', { class: 'btn danger block', onclick: async () => { if (await confirmBox('Hapus semua data lokal?', 'Tindakan ini permanen di peramban ini. Lanjutkan hanya jika Anda memahami bahwa data tidak dapat dipulihkan.', 'Hapus dan mulai ulang')) { S.reset(); location.reload(); } } }, 'Hapus data dan mulai ulang')
  )] }); };

  // "Uang Anda sekarang": opening balance as a story
  SCREENS.opening = () => {
    const ta = h('textarea', { class: 'input', rows: 3, placeholder: 'Contoh: uang tunai 300rb, di BCA 2jt, di Dana 150rb' });
    const preview = h('div');
    let drafts = [];
    const draw = () => {
      preview.replaceChildren();
      if (!drafts.length) return;
      preview.append(h('div', { class: 'list' }, drafts.map((d, i) => h('div', { class: 'row-edit' },
        h('input', { class: 'input', value: d.name, 'aria-label': 'Nama dompet', oninput: (e) => { d.name = e.target.value; } }),
        moneyInput(d.amount, (n) => { d.amount = n; total.textContent = R.rupiah(drafts.reduce((s, x) => s + x.amount, 0)); }),
        h('button', { class: 'btn ghost sm', onclick: () => { drafts.splice(i, 1); draw(); } }, 'Hapus')))));
      const total = h('strong', null, R.rupiah(drafts.reduce((s, x) => s + x.amount, 0)));
      preview.append(h('p', { class: 'total-line' }, 'Total: ', total));
    };
    const read = () => {
      drafts = R.WalletStoryParser.parse(ta.value);
      if (!drafts.length && ta.value.trim()) { const n = R.MoneyAmountParser.parse(ta.value).value; if (n) drafts = [{ name: 'Uang Saya', type: 'OTHER', amount: n }]; }
      if (!drafts.length) toast('Nominal belum terbaca. Contoh: tunai 300rb, BCA 2jt');
      draw();
    };
    const saveOpening = () => {
      const used = new Set();
      drafts.filter((d) => d.amount > 0 && d.name.trim()).forEach((d) => {
        let name = d.name.trim(), k = 2; while (used.has(name.toLowerCase())) name = `${d.name.trim()} ${k++}`; used.add(name.toLowerCase());
        db().wallets.push({ id: S.uid(), name, type: d.type, openingBalance: d.amount, includeInTotal: true, archived: false, createdAt: Date.now() });
      });
      defaultWallet(); db().onboarded = true; S.save();
    };
    const finish = (toSlip) => { saveOpening(); if (toSlip) { root('home'); go('slip'); } else root('home'); };
    const sst = h('p', { class: 'note', 'aria-live': 'polite' });
    const story = h('textarea', { class: 'input', rows: 3, placeholder: 'Atau ceritakan: gaji pokok 4,5jt, tunjangan 500rb, BPJS 100rb, pajak 50rb' });
    const launch = async (build, files) => { sst.textContent = 'Menyiapkan pembacaan...'; try { if (files && files.length) { const r = await scanWith(files, (cb) => build(cb)); if (!r) return; } else await build(); saveOpening(); root('home'); go('slipreview'); } catch (e) { sst.textContent = e.message || 'Gagal membaca.'; await KHUI.notice('Pembacaan belum berhasil', h('p', null, sst.textContent), 'error', [{ label: 'Tutup', value: false }]); } };
    return frame({ title: 'Uang Anda sekarang', children: [
      card(h('h3', null, 'Punya slip gaji?'), null,
        KHExtra.attachButtons((f) => launch((cb) => KHSlipUI.load(f, cb), f), { cam: 'Foto slip', gal: 'Galeri', doc: 'Dokumen' }), story,
        h('button', { class: 'btn block', onclick: () => launch(async () => KHSlipUI.loadText(story.value)) }, 'Baca cerita gaji'), sst),
      card(null, ta,
        h('button', { class: 'btn primary block', onclick: read }, 'Baca cerita'), preview),
      h('button', { class: 'btn primary block', onclick: () => finish(false) }, 'Simpan dan mulai'),
      h('button', { class: 'btn ghost block', onclick: () => finish(true) }, 'Simpan, lalu baca slip gaji'),
      h('button', { class: 'link', onclick: () => { drafts = []; finish(false); } }, 'Lewati (saldo Rp 0)')] });
  };

  // ---------- lock ----------
  function lockNow() { session.unlocked = false; root('lock'); }
  /** Complete essential setup for older local profiles, without a recovery-code step. */
  function ensureSetup() {
    if (!db().profile) { root('profilesetup', { flow: 'migrate' }); return true; }
    if (!db().onboarded) { root('opening'); return true; }
    return false;
  }
  SCREENS.lock = () => {
    const msg = h('p', { class: 'error pin-msg', role: 'alert', hidden: true });
    let timer = null;
    const info = () => {
      const left = db().failed.until - Date.now();
      if (left > 0) { msg.textContent = `Terlalu banyak salah. Coba lagi dalam ${Math.ceil(left / 1000)} detik.`; msg.hidden = false; }
      else { msg.hidden = !msg.textContent || msg.textContent.startsWith('Terlalu'); if (msg.textContent.startsWith('Terlalu')) msg.textContent = ''; }
    };
    const pad = pinPad({
      extra: db().bio ? { label: 'Sidik jari', run: tryBio } : null,
      onDone: async (pin) => {
        if (db().failed.until > Date.now()) { pad.clear(); return info(); }
        if ((await S.hashSecret(pin, db().pin.salt)) === db().pin.hash) { db().failed = { n: 0, until: 0 }; S.save(); return unlocked(); }
        const f = db().failed; f.n += 1;
        if (f.n % 5 === 0) f.until = Date.now() + Math.min(900000, 30000 * Math.pow(2, f.n / 5 - 1));
        S.save(); pad.shake(); pad.clear();
        msg.textContent = f.until > Date.now() ? '' : `PIN salah. Sisa percobaan sebelum jeda: ${5 - (f.n % 5)}.`; msg.hidden = false; info();
      } });
    async function tryBio() { try { await bioUnlock(); unlocked(); } catch (e) { msg.textContent = e && e.name === 'NotAllowedError' ? 'Sidik jari dibatalkan atau tidak dikenali. Pakai PIN.' : bioError(e); msg.hidden = false; } }
    function unlocked() { session.unlocked = true; clearInterval(timer); nav.stack.length = 0; if (!ensureSetup()) root('home'); }
    timer = setInterval(() => { if (!document.body.contains(msg)) clearInterval(timer); else info(); }, 1000);
    setTimeout(() => { if (db().bio) tryBio(); }, 300);
    const p = db().profile;
    return h('div', { class: 'screen center-screen pin-screen' }, h('div', { class: 'welcome' },
      h('div', { class: 'pin-avatar' }, p ? avatarEl(p, 88) : logo(72)),
      h('h2', { class: 'pin-title' }, p ? 'Halo, ' + R.Reminder.salutation(p) : 'Masukkan PIN'), h('p', { class: 'pin-sub' }, p ? 'Masukkan PIN Anda' : ''), pad.el, msg,
      h('button', { class: 'link', onclick: () => go('forgotpin') }, 'Lupa PIN?')));
  };

  // ---------- Beranda ----------
  function upcomingBills(days) {
    const today = R.todayISO();
    return db().bills.filter((b) => b.status === 'UNPAID' && R.daysBetween(today, b.dueOn) <= days).sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  }
  const actRow = (a) => {
    const s = sign(a), title = a.type === 'TRANSFER' ? 'Pindah dompet' : (a.merchant || a.note || a.category);
    const nature = a.type === 'EXPENSE' && window.KHBucket ? ({ need: 'Kebutuhan', want: 'Keinginan', save: 'Tabungan' })[KHBucket.classify(a, { memory: db().bucketMemory || {}, userMap: (db().plan && db().plan.mapUser) || {} }).nature] : '';
    const meta = a.type === 'TRANSFER' ? `${walletName(a.walletId)} \u2192 ${walletName(a.toWalletId)}` : [a.category, nature].filter(Boolean).join(' \u00b7 ');
    return h('button', { class: 'act', onclick: () => go('editact', { id: a.id }) },
      h('span', { class: 'act-main' }, h('strong', null, title), h('small', null, meta)),
      h('span', { class: 'act-side' }, h('span', { class: 'amt ' + (s > 0 ? 'in' : s < 0 ? 'out' : 'mv') }, (s > 0 ? '+' : s < 0 ? '-' : '') + R.rupiah(Math.abs(R.ledgerAmountValue(a.amount)))), a.type === 'TRANSFER' ? null : h('small', null, walletName(a.walletId))));
  };

  let homeView = 'ALL';                                   // 'ALL' = gabungan semua dompet (seperti satu rekening); atau id dompet
  SCREENS.home = () => {
    const ym = R.monthOf(R.todayISO());
    const ws = orderWallets(activeWallets());
    if (homeView !== 'ALL' && !ws.some((w) => w.id === homeView)) homeView = 'ALL';
    const one = homeView === 'ALL' ? null : ws.find((w) => w.id === homeView);
    const viewActs = () => (one ? liveActs().filter((a) => a.walletId === one.id || a.toWalletId === one.id) : liveActs());
    const sm = R.SummaryEngine.month(one ? liveActs().filter((a) => a.walletId === one.id) : liveActs(), ym);
    const p = db().profile;
    const budgetState = window.KHExtra && typeof KHExtra.state === 'function' ? KHExtra.state(ym) : null;
    const ledger = R.BalanceEngine.balances(ws, liveActs());
    const shownBalance = () => budgetState ? Math.max(0, Number(budgetState.spendable) || 0) : (one ? (ledger[one.id] || 0) : totalBalance());
    const bal = h('div', { class: 'big hero-spendable', 'aria-live': 'polite' }, R.rupiah(0));
    setTimeout(() => countUp(bal, shownBalance()), 0);
    const viewChips = ws.length > 1 ? h('div', { class: 'chips hero-views', role: 'group', 'aria-label': 'Tampilan dompet' }, [{ id: 'ALL', name: 'Semua' }, ...ws].map((w) => h('button', { class: 'chip' + (homeView === w.id ? ' on' : ''), onclick: () => { homeView = w.id; render(); } }, w.name))) : null;
    const stat = (label, val, cls, filter) => h('button', { class: 'stat', onclick: () => go('activities', { kind: filter, month: ym, wallet: one ? one.id : null }) }, h('small', null, label), h('strong', { class: cls }, R.rupiah(val)));
    const today = R.todayISO(), bills = upcomingBills(7);
    const latest = sortedActs().filter((a) => viewActs().includes(a)).slice(0, 5);
    const cashWallets = ws.filter(isCashWallet);
    const cashOnHand = cashWallets.reduce((n, w) => n + Math.max(0, Number(ledger[w.id]) || 0), 0);
    const physicalSavings = ws.filter((w) => w.type === 'SAVINGS' || w.type === 'EMERGENCY').reduce((n, w) => n + Math.max(0, Number(ledger[w.id]) || 0), 0);
    const fundRow = (label, val) => h('div', { class: 'fund-row' }, h('span', null, label), h('strong', null, R.rupiah(val)));
    const fundsPanel = card(h('div', { class: 'card-head' }, h('h3', null, 'Sumber dana'), h('button', { class: 'link', onclick: () => go('wallets') }, 'Kelola')),
      h('div', { class: 'fund-list' }, fundRow('Tabungan terencana', budgetState ? budgetState.savingsProgress : 0), fundRow('Dompet tabungan', physicalSavings),
        cashWallets.length ? fundRow('Uang tunai', cashOnHand) : h('button', { class: 'fund-row fund-add', onclick: () => { db().wallets.push({ id: S.uid(), name: 'Tunai', type: 'CASH', openingBalance: 0, includeInTotal: true, archived: false, createdAt: Date.now() }); S.save(); render(); } }, h('span', null, 'Uang tunai'), h('strong', null, 'Tambah'))));
    const exhausted = budgetState && budgetState.spendable <= 0;
    // Ajakan sekali di awal: tidak memaksa pindah layar, bisa ditunda dengan "Nanti".
    const needsPlan = window.KHExtra && typeof KHExtra.plan === 'function' && !KHExtra.plan().chosen && !db().planNudgeDismissed;
    const planNudge = needsPlan ? h('section', { class: 'card plan-nudge' },
      h('strong', null, 'Atur rencana uang dulu'),
      h('p', null, 'Pilih pembagian uang supaya setiap pemasukan langsung terbagi untuk kebutuhan, keinginan, dan tabungan.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => go('plan', { from: 'home' }) }, 'Atur sekarang'),
        h('button', { class: 'btn ghost', onclick: () => { db().planNudgeDismissed = true; S.save(); render(); } }, 'Nanti'))) : null;
    return frame({ title: 'KasHarian', tabs: 'home', left: themeButton(), right: h('button', { class: 'avatar-btn', 'aria-label': 'Profil', onclick: () => go('profile') }, avatarEl(p, 36)), children: [
      planNudge,
      h('section', { class: 'card hero home-budget-hero' },
        h('small', { class: 'hero-kicker' }, budgetState ? 'SISA LIMIT BELANJA' : 'UANG ANDA SEKARANG'), bal,
        h('div', { class: 'hero-pills' }, h('span', { class: 'pill' }, h('small', null, one ? one.name : 'Saldo'), h('strong', null, R.rupiah(one ? (ledger[one.id] || 0) : totalBalance()))),
          budgetState ? h('span', { class: 'pill save' }, h('small', null, 'Tabungan'), h('strong', null, R.rupiah(budgetState.savingsProgress))) : null),
        exhausted ? h('div', { class: 'budget-exhausted' }, h('strong', null, budgetState.spendingBudget <= 0 ? 'Belum ada limit aktif' : 'Limit bulan ini habis'),
          h('button', { class: 'btn primary sm', onclick: () => go('catat') }, 'Catat pemasukan')) : null,
        viewChips, window.KHTidy && KHTidy.heroNote ? KHTidy.heroNote() : null),
      card(h('div', { class: 'card-head' }, h('h3', null, R.monthLabel(ym) + (one ? ` · ${one.name}` : '')), h('button', { class: 'link', onclick: () => go('summary') }, 'Ringkasan')),
        h('div', { class: 'stats' }, stat('Masuk', sm.income, 'in', 'INCOME'), stat('Keluar', sm.expense, 'out', 'EXPENSE'), stat('Selisih', sm.difference, sm.difference < 0 ? 'out' : 'in', 'ALL'))),
      window.KHCharts ? KHCharts.spendCard(one ? liveActs().filter((a) => a.walletId === one.id) : liveActs(), ym, { link: true }) : null,
      window.KHHabit ? KHHabit.banner() : null,
      window.KHExtra ? KHExtra.homeCard() : null,
      fundsPanel,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => go('catat') }, 'Catat transaksi'), h('button', { class: 'btn', onclick: () => go('slip') }, 'Baca slip gaji')),
      bills.length ? card(h('h3', null, 'Tagihan'), h('div', { class: 'list' }, bills.map((b) => {
        const d = R.daysBetween(today, b.dueOn), late = d < 0;
        return h('div', { class: 'reminder bill-mini' + (late ? ' late' : '') }, h('span', null, h('strong', null, b.name), h('small', null, late ? `Lewat ${-d} hari` : d === 0 ? 'Hari ini' : `${d} hari lagi`)), h('strong', null, R.rupiah(b.amount)));
      }))) : null,
      card(h('div', { class: 'card-head' }, h('h3', null, 'Aktivitas terbaru'), latest.length ? h('button', { class: 'link', onclick: () => root('activities') }, 'Semua') : null),
        latest.length ? h('div', { class: 'list' }, latest.map(actRow)) : h('p', { class: 'empty' }, 'Belum ada aktivitas'))] });
  };

  // ---------- Catat (type a sentence, check the preview, save) ----------
  const splitEntries = (t) => t.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
  SCREENS.catat = () => {
    const ta = h('textarea', { class: 'input', rows: 3, placeholder: 'Contoh: mkn siang 25rb', autofocus: true });
    const box = h('div');
    let entries = [];
    let getEntryIssue = () => null, focusEntryIssue = () => {};
    const mkEntry = (raw, p, extra) => Object.assign({ raw, kind: p.kind, amount: p.amount || 0, category: p.category, merchant: p.merchant, note: p.note, date: p.date, walletId: defaultWallet().id, toWalletId: null, remember: p.category === 'Belum pasti', term: (p.merchant || p.note || raw.replace(/[\d.,]+\s*(rb|ribu|jt|juta|k)?/gi, '').trim()).toLowerCase().slice(0, 40), unknownCat: p.category === 'Belum pasti', message: p.message, orig: { kind: p.kind, category: p.category }, source: 'cerita' }, extra || {});
    const ast = h('p', { class: 'note', 'aria-live': 'polite' });
    async function onFiles(files) {
      try {
        const r = await scanWith(files, (cb) => KHExtra.readDoc(files, cb)); if (!r) return;
        if (r.kind === 'statement') { KHExtra.openStatement(r); return go('statement'); }
        // OCR-classified salary slips go directly to the populated salary review.
        // Do not interrupt the recognized result with a two-choice confirmation dialog.
        if (r.kind === 'slip') { KHSlipUI.fromResult(r.res); return go('slipreview'); }
        const x = r;
        entries.push(mkEntry(x.merchant || 'Struk', { kind: 'EXPENSE', amount: x.amount, category: R.CAT.expense.includes(x.category) ? x.category : 'Belum pasti', merchant: x.merchant, note: 'Struk', date: x.date || R.todayISO() }, { source: 'struk', imageUrl: r.res.imageUrl, ocrText: (window.KHScan && r.res.words ? KHScan.groupLines(r.res.words).lines.map((l) => l.text).join('\n') : (r.res.words || []).map((w) => w.text).join(' ')), term: (x.merchant || '').toLowerCase(), advice: (r.res.advice || []).join(' '), amountSure: !!x.sure, dateGuess: !x.date, remember: x.category !== 'Belum pasti' ? false : true }));
        const issues = []; if (!x.amount) issues.push('Nominal belum terbaca. Nominal sudah diisi otomatis bila terbaca; periksa atau isi sendiri.'); else if (!x.sure) issues.push('Nominal belum pasti. Cocokkan dengan foto, lalu ubah nominal bila perlu.');
        if (x.sure === false || !x.amount) (r.res.advice || []).forEach((t) => issues.push(t));
        if (issues.length) KHUI.notice(x.amount ? 'Periksa nominal' : 'Foto kurang jelas', h('div', null, issues.map((t) => h('p', null, t))), 'warn');
        drawPreview();
        if (!issues.length) toast('Hasil OCR sudah diisi. Periksa catatan lalu tekan Simpan catatan.');
      } catch (e) {
        const act = await KHUI.notice('Scan belum berhasil', h('p', null, (e && e.message) || 'Berkas tidak bisa dibaca.'), 'error', [{ label: 'Isi manual', kind: 'ghost', value: 'manual' }, { label: 'Coba lagi', kind: 'primary', value: 'retry' }]);
        if (act === 'retry') return onFiles(files);
      }
    }
    /** OCR mengisi pratinjau secara otomatis; pengguna tetap memeriksa dan menyimpan melalui tombol utama. */
    const attachCard = () => card(h('h3', null, 'Kirim foto atau dokumen'), null, KHExtra.attachButtons(onFiles, { cam: 'Foto struk' }), ast);
    const examples = ['mkn siang 25rb', 'bensin 30rb kemarin', 'gaji masuk 5jt', 'ngojek 120rb'];
    const drawInput = () => {
      box.replaceChildren(
        card(null, ta,
          h('div', { class: 'chips' }, examples.map((e) => h('button', { class: 'chip', onclick: () => { ta.value = e; ta.focus(); } }, e))),
          h('button', { class: 'btn primary block', onclick: analyze }, 'Periksa catatan')),
        attachCard(),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => go('slip') }, 'Baca slip gaji'), h('button', { class: 'btn', onclick: () => root('bills') }, 'Tambah tagihan')));
    };
    const analyze = () => {
      const lines = splitEntries(ta.value);
      if (!lines.length) return toast('Tulis dulu ceritanya.');
      entries = lines.map((l) => mkEntry(l, R.FreeTextParser.parse(l, R.todayISO(), db().memory)));
      drawPreview();
    };
    const drawPreview = () => {
      const status = h('p', { class: 'error', role: 'alert', hidden: true });
      const fieldNames = { amount: 'Nominal', category: 'Kategori', wallet: 'Dompet asal', 'wallet-pair': 'Dompet tujuan', date: 'Tanggal', direction: 'Jenis transaksi' };
      // R.validDate menerima (tahun, bulan, hari), bukan teks YYYY-MM-DD.
      const validIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && ((p) => R.validDate(p.y, p.m, p.d))(R.parts(String(s)));
      const firstIssue = () => {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (R.validateAmount(e.amount)) return { index: i, field: 'amount' };
          if (!['EXPENSE', 'INCOME', 'TRANSFER'].includes(e.kind)) return { index: i, field: 'direction' };
          if (e.kind !== 'TRANSFER' && (e.category === 'Belum pasti' || !catList(e.kind).includes(e.category))) return { index: i, field: 'category' };
          if (!activeWallets().some((w) => w.id === e.walletId)) return { index: i, field: 'wallet' };
          if (e.kind === 'TRANSFER' && (!activeWallets().some((w) => w.id === e.toWalletId) || e.toWalletId === e.walletId)) return { index: i, field: 'wallet-pair' };
          if (!validIsoDate(e.date)) return { index: i, field: 'date' };
        }
        return null;
      };
      const focusIssue = (issue) => {
        box.querySelectorAll('.field-attention').forEach((x) => x.classList.remove('field-attention'));
        const entry = [...box.querySelectorAll('.entry')].find((x) => x.dataset.entryIndex === String(issue.index));
        const wrap = entry && entry.querySelector(`[data-field="${issue.field}"]`);
        if (!wrap) return;
        wrap.classList.add('field-attention');
        try { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* browser without scrollIntoView options */ }
        const target = wrap.querySelector('input:not([type="hidden"]),select,textarea,button') || wrap;
        if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
        status.textContent = `Periksa ${fieldNames[issue.field] || 'bagian ini'} pada catatan ${issue.index + 1}.`;
        status.hidden = false;
      };
      focusEntryIssue = focusIssue;
      getEntryIssue = firstIssue;
      const check = () => {
        const issue = firstIssue();
        status.textContent = issue ? `Periksa ${fieldNames[issue.field] || 'bagian ini'} pada catatan ${issue.index + 1} sebelum menyimpan.` : '';
        status.hidden = !issue;
        // Keep the action available: pressing it takes the user to the exact field that needs attention.
        saveBtn.disabled = false;
      };
      const saveBtn = h('button', { class: 'btn primary block', onclick: save }, 'Simpan catatan');
      const cards = entries.map((e, i) => {
        const hint = h('p', { class: 'hint' });
        const chips = h('div', { class: 'chips' });
        const drawChips = () => {
          if (e.kind === 'TRANSFER' || e.kind === 'UNKNOWN') { chips.replaceChildren(); hint.textContent = ''; return; }
          chips.replaceChildren(...[...catList(e.kind), 'Belum pasti'].map((c) => h('button', { class: 'chip' + (e.category === c ? ' on' : ''), onclick: () => { e.category = c; markChanged(); drawChips(); check(); } }, c)));
          hint.textContent = e.category === 'Belum pasti' ? 'Kategori belum pasti. Pilih salah satu.' : R.CAT.hints[e.category] || '';
        };
        drawChips();
        const kindSeg = h('div', { class: 'seg seg3' }, ['EXPENSE', 'INCOME', 'TRANSFER'].map((k) => h('button', { type: 'button', class: 'seg-b' + (e.kind === k ? ' on' : ''), onclick: (ev) => {
          e.kind = k;
          if (k === 'TRANSFER') { e.category = 'Pindah dompet'; if (!activeWallets().some((w) => w.id === e.toWalletId && w.id !== e.walletId)) e.toWalletId = (orderWallets(activeWallets()).find((w) => w.id !== e.walletId) || {}).id || null; }
          else if (!catList(k).includes(e.category)) e.category = 'Belum pasti';
          markChanged();
          // Rebuild the entry so changing to/from transfer also adds/removes the paired-wallet field.
          drawPreview();
        } }, kindLabel[k])));
        const directionField = h('div', { class: 'field', 'data-field': 'direction' }, h('span', { class: 'label' }, 'Jenis transaksi'), kindSeg);
        const amountField = field('Nominal', moneyInput(e.amount, (n) => { e.amount = n; check(); })); amountField.dataset.field = 'amount';
        const categoryField = (e.kind === 'TRANSFER' || e.kind === 'UNKNOWN') ? null : h('div', { class: 'field', 'data-field': 'category' }, h('span', { class: 'label' }, 'Kategori'), chips, hint);
        const walletSelect = h('select', { class: 'input', onchange: (ev) => { e.walletId = ev.target.value; if (e.kind === 'TRANSFER' && e.toWalletId === e.walletId) e.toWalletId = (orderWallets(activeWallets()).find((w) => w.id !== e.walletId) || {}).id || null; if (e.kind === 'TRANSFER') drawPreview(); else check(); } }, orderWallets(activeWallets()).map((w) => h('option', { value: w.id, selected: w.id === e.walletId }, w.name)));
        const walletField = field(e.kind === 'TRANSFER' ? 'Dompet asal' : 'Dompet', walletSelect); walletField.dataset.field = 'wallet';
        const walletPairSelect = h('select', { class: 'input', onchange: (ev) => { e.toWalletId = ev.target.value || null; check(); } }, [h('option', { value: '', selected: !e.toWalletId }, 'Pilih dompet tujuan'), ...orderWallets(activeWallets()).filter((w) => w.id !== e.walletId).map((w) => h('option', { value: w.id, selected: w.id === e.toWalletId }, w.name))]);
        const walletPairField = e.kind === 'TRANSFER' ? field('Dompet tujuan', walletPairSelect) : null;
        if (walletPairField) walletPairField.dataset.field = 'wallet-pair';
        const dateField = field('Tanggal', h('input', { class: 'input', type: 'date', value: e.date, onchange: (ev) => { e.date = ev.target.value || e.date; check(); } })); dateField.dataset.field = 'date';
        const rc = h('input', { type: 'checkbox', checked: e.remember, onchange: (ev) => { e.remember = ev.target.checked; } });
        const markChanged = () => { if (e.kind !== e.orig.kind || e.category !== e.orig.category) { e.remember = true; rc.checked = true; } };
        const monthNote = null;
        const rem = h('div', { class: 'remember' });
        rem.append(h('label', { class: 'check' }, rc, h('span', null, 'Ingat kata ini untuk lain kali (Kamus saya): ')),
          h('input', { class: 'input', value: e.term, 'aria-label': 'Kata yang diingat', oninput: (ev) => { e.term = ev.target.value; } }));
        const cardEl = h('section', { class: 'card entry', 'data-entry-index': i },
          h('div', { class: 'entry-head' }, h('small', null, e.raw), h('button', { class: 'btn ghost sm', onclick: () => { entries.splice(i, 1); entries.length ? drawPreview() : drawInput(); } }, 'Hapus')),
          e.imageUrl ? h('img', { class: 'slip-img', src: e.imageUrl, alt: 'Foto struk' }) : null,
          directionField,
          h('p', { class: 'hint dir-note', 'data-dir-note': e.kind }, e.kind === 'EXPENSE' ? 'Pengeluaran: saldo dompet akan BERKURANG.' : e.kind === 'INCOME' ? 'Pemasukan: saldo dompet akan BERTAMBAH.' : e.kind === 'TRANSFER' ? 'Pindah dana: total saldo tidak berubah.' : ''),
          amountField,
          categoryField,
          e.ocrText ? h('details', { class: 'ocr-text-details' }, h('summary', null, 'Lihat teks hasil baca'), h('textarea', { class: 'input', rows: 5, readOnly: true, value: e.ocrText })) : null,
          h('div', { class: e.kind === 'TRANSFER' ? 'two' : 'two' }, walletField, e.kind === 'TRANSFER' ? walletPairField : dateField),
          e.kind === 'TRANSFER' ? dateField : null,
          monthNote, e.dateGuess ? null : null,
          field('Catatan', h('input', { class: 'input', value: [e.merchant, e.note].filter(Boolean).join(' ').trim(), oninput: (ev) => { e.note = ev.target.value; e.merchant = null; } })), rem);
        return cardEl;
      });
      box.replaceChildren(...cards, attachCard(), h('div', { class: 'save-bar' }, status, saveBtn), h('button', { class: 'btn ghost block', onclick: drawInput }, 'Ubah cerita'));
      check();
    };
    function learn(e) {
      const t = e.term.trim().toLowerCase(), i = db().memory.findIndex((m) => m.term.toLowerCase() === t);
      if (t.length < 3 || !R.memoryKind(e.kind)) return false;   // kata terlalu pendek atau jenis tidak sah tidak boleh masuk Kamus
      const rec = { id: i >= 0 ? db().memory[i].id : S.uid(), term: t, kind: e.kind, category: e.category, merchant: e.merchant, createdAt: Date.now() };
      if (i >= 0) db().memory[i] = rec; else db().memory.push(rec);
      return true;
    }
    async function save() {
      const issue = getEntryIssue();
      if (issue) { focusEntryIssue(issue); return; }
      const candidates = entries.map((e) => ({ type: e.kind, amount: e.amount, walletId: e.walletId, toWalletId: e.kind === 'TRANSFER' ? e.toWalletId : null, category: e.kind === 'TRANSFER' ? 'Pindah dompet' : e.category, occurredOn: e.date, merchant: e.merchant, note: e.note, source: e.source || 'cerita' }));
      if (!(await authorizeActivities(candidates))) return;
      const before = KHExtra.snapMonths(entries.map((e) => e.date)); let learned = 0;
      const beforeCount = db().activities.length, beforeMemory = db().memory.slice();
      const balancesBefore = R.BalanceEngine.balances(db().wallets, liveActs());
      try {
        const order = entries.map((e, i) => ({ e, i })).sort((a, b) => {
          const monthOrder = R.monthOf(a.e.date).localeCompare(R.monthOf(b.e.date));
          if (monthOrder) return monthOrder;
          const priority = (e) => e.kind === 'INCOME' ? 0 : e.kind === 'TRANSFER' ? 1 : 2;
          return priority(a.e) - priority(b.e) || a.e.date.localeCompare(b.e.date) || a.i - b.i;
        });
        order.forEach(({ e, i }) => {
          addActivity({ ...candidates[i], budgetSavingsUsed: candidates[i].budgetSavingsUsed || 0 });
          if (e.remember && e.term.trim() && e.category !== 'Belum pasti' && learn(e)) learned++;
        });
        // Penjaga arah saldo: total semua dompet harus berubah persis sebesar pemasukan dikurangi pengeluaran
        // (pindah dana, termasuk dana tabungan yang dipindah otomatis, tidak mengubah total).
        {
          const sumAll = (m) => Object.values(m).reduce((n, v) => n + (Number(v) || 0), 0);
          const delta = sumAll(R.BalanceEngine.balances(db().wallets, liveActs())) - sumAll(balancesBefore);
          const expected = candidates.reduce((n, c) => { const v = Math.abs(R.ledgerAmountValue(c.amount)); return n + (c.type === 'INCOME' ? v : c.type === 'EXPENSE' ? -v : 0); }, 0);
          if (Math.round(delta) !== Math.round(expected)) throw new Error('Arah saldo tidak sesuai jenis transaksi (Masuk menambah, Keluar mengurangi), jadi catatan dibatalkan. Periksa jenis transaksi lalu coba lagi.');
        }
        if (!S.save()) throw new Error('Transaksi belum tersimpan ke penyimpanan perangkat. Periksa ruang penyimpanan, lalu coba lagi.');
        const bal = R.BalanceEngine.balances(db().wallets, liveActs()), one = entries.length === 1 && entries[0].kind !== 'TRANSFER' ? entries[0] : null;
        toast((entries.length > 1 ? `${entries.length} catatan tersimpan` : 'Tersimpan') + (one ? `. Saldo ${walletName(one.walletId)}: ${R.rupiah(Math.max(0, bal[one.walletId] || 0))}` : '') + (learned ? '. Kata diingat di Kamus saya.' : '')); KHExtra.notify(before); root('home');
      } catch (err) { db().activities.splice(beforeCount); db().memory = beforeMemory; S.save(); KHUI.notice('Catatan belum tersimpan', h('p', null, err.message), 'error'); }
    }
    drawInput();
    return frame({ title: 'Catat', back: true, children: [box] });
  };

  // Grafik arus uang harian; pindah dana sengaja tidak dihitung agar tidak ganda. Ketuk batang untuk melihat nominal hari itu.
  function activityChart(activities, ym) {
    const days = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const income = Array(days).fill(0), expense = Array(days).fill(0);
    activities.filter((a) => R.monthOf(a.occurredOn) === ym && (a.type === 'INCOME' || a.type === 'EXPENSE')) .forEach((a) => {
      const day = Number(String(a.occurredOn).slice(8, 10)) - 1;
      if (day < 0 || day >= days) return;
      if (a.type === 'INCOME') income[day] += Math.abs(R.ledgerAmountValue(a.amount));
      else expense[day] += Math.abs(R.ledgerAmountValue(a.amount));
    });
    const sumIn = income.reduce((a, b) => a + b, 0), sumOut = expense.reduce((a, b) => a + b, 0);
    if (!sumIn && !sumOut) return card(h('h3', null, 'Arus uang harian'), null);
    const K = window.KHCharts, NS = 'http://www.w3.org/2000/svg', mk = (n, at) => { const e = document.createElementNS(NS, n); Object.keys(at || {}).forEach((k) => e.setAttribute(k, at[k])); return e; };
    const width = 340, top = 20, plotH = 92, bottom = 24, left = 40, plotW = 294, groupW = plotW / days, max = Math.max(1, ...income, ...expense);
    const svg = mk('svg', { viewBox: `0 0 ${width} ${top + plotH + bottom}`, role: 'img', 'aria-label': `Grafik pemasukan dan pengeluaran harian ${R.monthLabel(ym)}` }); svg.classList.add('activity-chart-svg');
    [0, .5, 1].forEach((k) => {
      const y = top + plotH * k;
      svg.append(mk('line', { x1: left, x2: left + plotW, y1: y, y2: y, class: 'chart-gridline' }));
      if (K) { const t = mk('text', { x: left - 6, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' }); t.textContent = k === 1 ? '0' : K.compact(max * (1 - k)); svg.append(t); }
    });
    const bands = [], peak = { in: income.indexOf(Math.max(...income)), out: expense.indexOf(Math.max(...expense)) };
    for (let i = 0; i < days; i++) { const b = mk('rect', { x: left + i * groupW, y: top - 6, width: groupW, height: plotH + 10, rx: 3, class: 'chart-band' }); bands.push(b); svg.append(b); }
    const labelAt = (i, v, cls, lift) => { if (!K || !(v > 0)) return; const cx = Math.min(width - 18, Math.max(left + 14, left + i * groupW + groupW / 2)); const t = mk('text', { x: cx, y: top + plotH - v / max * plotH - 4 - lift, 'text-anchor': 'middle', class: 'chart-val ' + cls }); t.textContent = K.compact(v); svg.append(t); };
    for (let i = 0; i < days; i++) {
      const x = left + i * groupW + groupW * .16, bw = Math.max(1.1, groupW * .32);
      [[income[i], x, 'chart-income'], [expense[i], x + bw + Math.max(.7, groupW * .06), 'chart-expense']].forEach(([v, bx, cls]) => {
        const rect = mk('rect', { x: bx, y: top + plotH - Math.max(0, Number(v) / max * plotH), width: bw, height: Math.max(0, Number(v) / max * plotH), rx: Math.min(1.8, bw / 2), class: cls });
        svg.append(rect);
      });
      if (i === 0 || ((i + 1) % 5 === 0 && days - (i + 1) >= 3) || i === days - 1) { const t = mk('text', { x: left + i * groupW + groupW / 2, y: top + plotH + 17, 'text-anchor': 'middle', class: 'chart-axis-label' }); t.textContent = String(i + 1); svg.append(t); }
    }
    labelAt(peak.in, income[peak.in], 'in', peak.in === peak.out ? 11 : 0);
    labelAt(peak.out, expense[peak.out], 'out', 0);
    const tip = h('div', { class: 'chart-detail', 'aria-live': 'polite' }, h('span', { class: 'chart-tip' }, 'Ketuk batang untuk melihat nominal per hari.'));
    let sel = -1;
    const pick = (i) => {
      sel = sel === i ? -1 : i;
      bands.forEach((b, k) => b.classList.toggle('on', k === sel));
      if (sel < 0) { tip.replaceChildren(h('span', { class: 'chart-tip' }, 'Ketuk batang untuk melihat nominal per hari.')); return; }
      tip.replaceChildren(h('strong', null, `${i + 1} ${R.monthLabel(ym)}`), h('span', { class: 'in' }, 'Masuk ', R.rupiah(income[i])), h('span', { class: 'out' }, 'Keluar ', R.rupiah(expense[i])));
    };
    for (let i = 0; i < days; i++) { const hit = mk('rect', { x: left + i * groupW, y: top - 6, width: groupW, height: plotH + bottom + 6, class: 'chart-hit' }); hit.addEventListener('click', () => pick(i)); svg.append(hit); }
    return card(h('div', { class: 'chart-head' }, h('h3', null, 'Arus uang harian')),
      h('div', { class: 'chart-summary' }, h('span', null, h('small', null, 'Masuk'), h('strong', { class: 'in' }, R.rupiah(sumIn))), h('span', null, h('small', null, 'Keluar'), h('strong', { class: 'out' }, R.rupiah(sumOut))), h('span', null, h('small', null, 'Selisih'), h('strong', { class: sumIn - sumOut < 0 ? 'out' : 'in' }, R.rupiah(sumIn - sumOut)))),
      svg, tip, h('div', { class: 'chart-legend' }, h('span', null, h('i', { class: 'chart-income' }), 'Pemasukan'), h('span', null, h('i', { class: 'chart-expense' }), 'Pengeluaran')),
      null);
  }

  // ---------- Aktivitas ----------
  SCREENS.activities = (p) => {
    let ym = p.month || R.monthOf(R.todayISO()), kind = p.kind || 'ALL', cat = p.category || null, wal = p.wallet || null;
    const list = h('div'), chart = h('div'), filters = h('div', { class: 'chips' }), head = h('div', { class: 'month-nav' });
    const draw = () => {
      head.replaceChildren(h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, -1); draw(); } }, 'Sebelumnya'), h('strong', null, R.monthLabel(ym)), h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, 1); draw(); } }, 'Berikutnya'));
      const monthRows = sortedActs().filter((a) => R.monthOf(a.occurredOn) === ym && (!wal || a.walletId === wal || a.toWalletId === wal));
      const rows = monthRows.filter((a) => (kind === 'ALL' || a.type === kind) && (!cat || a.category === cat));
      const groups = {}; rows.forEach((a) => { (groups[a.occurredOn] = groups[a.occurredOn] || []).push(a); });
      list.replaceChildren(...(rows.length ? Object.entries(groups).map(([d, items]) => h('section', { class: 'card' }, h('h4', null, R.formatDate(d)), h('div', { class: 'list' }, items.map(actRow)))) : [h('p', { class: 'empty card' }, 'Belum ada aktivitas di bulan ini.')]));
      chart.replaceChildren(activityChart(monthRows, ym), ...(window.KHCharts ? [KHCharts.spendCard(monthRows, ym)].filter(Boolean) : []));
      filters.replaceChildren(...[
        ...[['ALL', 'Semua'], ['INCOME', 'Masuk'], ['EXPENSE', 'Keluar'], ['TRANSFER', 'Pindah'], ['ADJUSTMENT', 'Penyesuaian']].map(([k, l]) => h('button', { class: 'chip' + (kind === k ? ' on' : ''), onclick: () => { kind = k; draw(); } }, l)),
        cat ? h('button', { class: 'chip on', onclick: () => { cat = null; draw(); } }, cat + ' (hapus)') : null,
        wal ? h('button', { class: 'chip on', onclick: () => { wal = null; draw(); } }, ((db().wallets.find((w) => w.id === wal) || {}).name || 'Dompet') + ' (hapus)') : null
      ].filter(Boolean));
    };
    draw();
    return frame({ title: 'Aktivitas', tabs: 'activities', children: [head, chart, filters, list] });
  };

  SCREENS.editact = ({ id }) => {
    const a = db().activities.find((x) => x.id === id);
    if (!a) return frame({ title: 'Aktivitas', back: true, children: [h('p', { class: 'empty' }, 'Aktivitas tidak ditemukan.')] });
    const f = { amount: Math.abs(R.ledgerAmountValue(a.amount)), category: a.category, walletId: a.walletId, date: a.occurredOn, merchant: a.merchant || '', note: a.note || '', kind: a.type };
    const err = errBox();
    const simple = a.type === 'INCOME' || a.type === 'EXPENSE';
    f.bucket = a.bucket || 'auto';
    const LB = { auto: 'Otomatis', need: 'Kebutuhan', want: 'Keinginan', save: 'Tabungan' };
    const autoNote = h('small', { class: 'hint' });
    const bucketRow = h('div', { class: 'chips' });
    const drawBucket = () => { const c = window.KHBucket ? KHBucket.classify({ ...a, category: f.category, merchant: f.merchant || null, note: f.note, bucket: null }, { memory: db().bucketMemory || {}, userMap: (db().plan && db().plan.mapUser) || {} }) : null; autoNote.textContent = c ? `Otomatis: ${LB[c.nature]}` : ''; bucketRow.replaceChildren(...Object.keys(LB).map((k) => h('button', { class: 'chip' + (f.bucket === k ? ' on' : ''), type: 'button', onclick: () => { f.bucket = k; drawBucket(); } }, LB[k]))); };
    drawBucket();
    const catSel = h('select', { class: 'input', onchange: (e) => { f.category = e.target.value; drawBucket(); } });
    const fillCats = () => { catSel.replaceChildren(...[...new Set([...catList(f.kind), f.category])].map((c) => h('option', { value: c, selected: c === f.category }, c))); };
    fillCats();
    return frame({ title: kindLabel[a.type] || 'Aktivitas', back: true, children: [card(
      simple ? h('div', { class: 'seg' }, ['EXPENSE', 'INCOME'].map((k) => h('button', { class: 'seg-b' + (f.kind === k ? ' on' : ''), onclick: (ev) => { f.kind = k; if (!catList(k).includes(f.category)) f.category = 'Lainnya'; [...ev.target.parentNode.children].forEach((b) => b.classList.toggle('on', b === ev.target)); fillCats(); } }, kindLabel[k]))) : null,
      field('Nominal', moneyInput(f.amount, (n) => { f.amount = n; })),
      simple ? field('Kategori', catSel) : null,
      simple && f.kind === 'EXPENSE' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Kelompok rencana'), bucketRow, autoNote) : null,
      field('Dompet', h('select', { class: 'input', onchange: (e) => { f.walletId = e.target.value; } }, db().wallets.map((w) => h('option', { value: w.id, selected: w.id === f.walletId }, w.name)))),
      field('Tanggal', h('input', { class: 'input', type: 'date', value: f.date, onchange: (e) => { f.date = e.target.value || f.date; } })),
      field('Nama / toko', h('input', { class: 'input', value: f.merchant, oninput: (e) => { f.merchant = e.target.value; } })),
      field('Catatan', h('input', { class: 'input', value: f.note, oninput: (e) => { f.note = e.target.value; } })), err,
      h('button', { class: 'btn primary block', onclick: async () => {
        const bad = R.validateAmount(f.amount); if (bad) return showErr(err, bad);
        const originalActivity = { ...a };
        const oldRelatedTransfers = db().activities.filter((x) => !x.deletedAt && x.type === 'TRANSFER' && x.source === 'budget-savings' && x.sourceId === a.id);
        const oldDeletedAt = a.deletedAt;
        const hiddenAt = Date.now();
        // Evaluate the replacement without counting the old expense or its linked
        // savings funding transfers. Restore everything if the user cancels.
        a.deletedAt = hiddenAt; oldRelatedTransfers.forEach((x) => { x._editOldDeletedAt = x.deletedAt; x.deletedAt = hiddenAt; });
        let candidate = null;
        if (simple && f.kind === 'EXPENSE') {
          candidate = { id: a.id, type: f.kind, amount: f.amount, walletId: f.walletId, category: f.category, occurredOn: f.date, source: a.source, note: f.note };
          const authorized = await authorizeActivities([candidate]);
          if (!authorized) { a.deletedAt = oldDeletedAt; oldRelatedTransfers.forEach((x) => { x.deletedAt = x._editOldDeletedAt; delete x._editOldDeletedAt; }); return; }
        }
        // Remove the old source transfers only after authorization succeeds. They
        // can be recreated for the edited amount, or reversed if the entry changes type.
        oldRelatedTransfers.forEach((x) => { delete x._editOldDeletedAt; });
        db().activities = db().activities.filter((x) => !oldRelatedTransfers.includes(x));
        try {
          if (a.type === 'ADJUSTMENT') { a.amount = a.amount < 0 ? -f.amount : f.amount; } else a.amount = f.amount;
          if (simple) {
            a.type = f.kind; a.category = f.category;
            if (candidate) { a.budgetSavingsUsed = candidate.budgetSavingsUsed || 0; a.budgetFreeUsed = candidate.budgetFreeUsed || 0; a.budgetTopUp = candidate.budgetTopUp || 0; a.budgetSavingsKinds = candidate.budgetSavingsKinds || null; a.budgetSavingsByBucket = candidate.budgetSavingsByBucket || a.budgetSavingsByBucket; a.budgetSavingsTransferred = 0; }
            else { delete a.budgetSavingsUsed; delete a.budgetFreeUsed; delete a.budgetTopUp; delete a.budgetSavingsKinds; delete a.budgetSavingsTransferred; }
            if (f.bucket === 'auto') delete a.bucket; else { a.bucket = f.bucket; if (window.KHBucket) KHBucket.learn(db(), { merchant: f.merchant, note: f.note }, f.bucket); }
          }
          Object.assign(a, { walletId: f.walletId, occurredOn: f.date, merchant: f.merchant || null, note: f.note, updatedAt: Date.now() });
          Object.assign(a, R.normalizeActivity(a));
          if (candidate && (Number(candidate.budgetSavingsUsed) > 0 || Number(candidate.budgetFreeUsed) > 0 || Number(candidate.budgetTopUp) > 0)) {
            const funding = { ...candidate, id: a.id };
            fundSavingsOverage(funding);
            a.budgetSavingsTransferred = funding.budgetSavingsTransferred || 0;
          }
          a.deletedAt = oldDeletedAt;
          if (!S.save()) throw new Error('Perubahan belum tersimpan ke perangkat.');
          toast('Perubahan disimpan'); back();
        } catch (e) {
          // Make the edit atomic if funding fails: discard newly-created transfers,
          // restore the original activity, and put back its former funding entries.
          db().activities = db().activities.filter((x) => !(x.type === 'TRANSFER' && x.source === 'budget-savings' && x.sourceId === a.id));
          oldRelatedTransfers.forEach((x) => { delete x._editOldDeletedAt; x.deletedAt = null; db().activities.push(x); });
          Object.assign(a, originalActivity); S.save(); toast(e.message);
        }
      } }, 'Simpan'),
      h('button', { class: 'btn danger block', onclick: () => { a.deletedAt = Date.now(); S.save(); back(); toast('Aktivitas dihapus', { action: { label: 'Urungkan', run: () => { a.deletedAt = null; S.save(); render(); } } }); } }, 'Hapus'))] });
  };

  // ---------- Tagihan ----------
  SCREENS.bills = () => {
    const today = R.todayISO(), ym = R.monthOf(today);
    const monthBills = db().bills.filter((b) => R.monthOf(b.dueOn) === ym);
    const total = monthBills.reduce((s, b) => s + b.amount, 0), paid = monthBills.filter((b) => b.status === 'PAID').reduce((s, b) => s + b.amount, 0);
    const next = db().bills.filter((b) => b.status === 'UNPAID').sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0];
    const overdue = db().bills.filter((b) => b.status === 'UNPAID' && b.dueOn < today).length;
    const ta = h('textarea', { class: 'input', rows: 2, placeholder: 'Contoh: listrik 450rb tiap tanggal 20, wifi 350rb tgl 5 bulanan' });
    const prev = h('div'); let drafts = [];
    const bst = h('p', { class: 'note', 'aria-live': 'polite' });
    async function readBill(files) {
      try {
        const r = await scanWith(files, (cb) => KHExtra.readDoc(files, cb)); if (!r) return;
        if (r.kind === 'statement') { KHExtra.openStatement(r); return go('statement'); }
        if (r.kind === 'slip') return toast('Ini terlihat seperti slip gaji. Buka Catat > Baca slip gaji.');
        drafts.push({ name: r.merchant || 'Tagihan', choices: r.choices || [], amount: r.amount || 0, dueOn: r.due || R.addDays(today, 7), recurrence: 'NONE', reminderDays: [7, 3, 1, 0], category: r.category === 'Belum pasti' ? 'Lainnya' : r.category });
        toast(r.due ? 'Tagihan terbaca. Periksa nominal dan jatuh tempo.' : 'Jatuh tempo belum terbaca. Atur sendiri.'); drawDrafts();
      } catch (e) { const act = await KHUI.notice('Scan belum berhasil', h('p', null, (e && e.message) || 'Berkas tidak bisa dibaca.'), 'error', [{ label: 'Tutup', kind: 'ghost', value: 'x' }, { label: 'Coba lagi', kind: 'primary', value: 'retry' }]); if (act === 'retry') return readBill(files); }
    }
    const drawDrafts = () => {
      prev.replaceChildren(...[...drafts.map((d, i) => h('section', { class: 'card entry' },
        field('Nama tagihan', h('input', { class: 'input', value: d.name, oninput: (e) => { d.name = e.target.value; } })),
        field('Nominal', moneyInput(d.amount || 0, (n) => { d.amount = n; })),
        h('div', { class: 'two' }, field('Jatuh tempo', h('input', { class: 'input', type: 'date', value: d.dueOn, onchange: (e) => { d.dueOn = e.target.value || d.dueOn; } })),
          field('Ulang', h('select', { class: 'input', onchange: (e) => { d.recurrence = e.target.value; } }, [['NONE', 'Sekali'], ['MONTHLY', 'Tiap bulan']].map(([v, l]) => h('option', { value: v, selected: d.recurrence === v }, l))))),
        h('button', { class: 'btn ghost sm', onclick: () => { drafts.splice(i, 1); drawDrafts(); } }, 'Hapus')),
      ), drafts.length ? h('button', { class: 'btn primary block', onclick: saveDrafts }, 'Simpan tagihan') : null].filter(Boolean));
    };
    function saveDrafts() {
      const bad = drafts.find((d) => R.validateAmount(d.amount || 0));
      if (bad) return toast('Isi nominal untuk "' + bad.name + '".');
      drafts.forEach((d) => db().bills.push({ id: S.uid(), name: d.name, amount: d.amount, dueOn: d.dueOn, recurrence: d.recurrence, reminderDays: d.reminderDays, category: d.category === 'Belum pasti' ? 'Lainnya' : d.category, status: 'UNPAID', paidActivityId: null, createdAt: Date.now() }));
      S.save(); drafts = []; toast('Tagihan tersimpan'); render();
    }
    async function pay(b) {
      const sel = h('select', { class: 'input' }, orderWallets(activeWallets()).map((w) => h('option', { value: w.id }, w.name)));
      const ok = await modal({ title: 'Tandai dibayar', body: [h('p', null, `${b.name} ${R.rupiah(b.amount)}. Dibayar dari dompet mana?`), sel], buttons: [{ label: 'Batal', value: false }, { label: 'Tandai dibayar', kind: 'primary', value: true }] });
      if (!ok) return;
      const candidate = { type: 'EXPENSE', amount: b.amount, walletId: sel.value, category: b.category, occurredOn: today, merchant: b.name, note: 'Bayar tagihan', source: 'tagihan', sourceId: b.id };
      if (!(await authorizeActivities([candidate]))) return;
      const act = addActivity({ ...candidate, budgetSavingsUsed: candidate.budgetSavingsUsed || 0 });
      b.status = 'PAID'; b.paidActivityId = act.id;
      if (b.recurrence === 'MONTHLY') {
        const day = R.parts(b.dueOn).d, nx = R.addMonths(R.monthOf(b.dueOn), 1).split('-').map(Number);
        db().bills.push({ ...b, id: S.uid(), dueOn: R.iso(nx[0], nx[1], Math.min(day, R.daysInMonth(nx[0], nx[1]))), status: 'UNPAID', paidActivityId: null, createdAt: Date.now() });
      }
      S.save(); toast('Tagihan dibayar dan dicatat'); render();
    }
    const items = db().bills.slice().sort((a, b) => (a.status === b.status ? (a.dueOn < b.dueOn ? -1 : 1) : a.status === 'UNPAID' ? -1 : 1));
    return frame({ title: 'Tagihan', tabs: 'bills', children: [
      card(h('h3', null, R.monthLabel(ym)), h('p', null, `${monthBills.length} tagihan, total ${R.rupiah(total)}, terbayar ${R.rupiah(paid)}.` + (next ? ` Berikutnya: ${next.name} ${R.formatDate(next.dueOn)}.` : '') + (overdue ? ` ${overdue} terlambat.` : ''))),
      card(null, ta,
        h('button', { class: 'btn primary block', onclick: () => { drafts = R.BillStoryParser.parse(ta.value, today); if (!drafts.length) toast('Tulis tagihannya dulu.'); drawDrafts(); } }, 'Baca cerita')),
      card(h('h3', null, 'Foto atau unggah tagihan'), null, KHExtra.attachButtons(readBill, { cam: 'Foto tagihan' }), bst),
      prev,
      items.length ? card(h('h3', null, 'Semua tagihan'), h('div', { class: 'list' }, items.map((b) => h('div', { class: 'bill' },
        h('p', { class: b.status === 'PAID' ? 'muted' : '' }, R.BillStoryParser.sentence(b), b.status === 'PAID' ? ' (sudah dibayar)' : ''),
        h('div', { class: 'btn-row' }, b.status === 'UNPAID' ? h('button', { class: 'btn sm', onclick: () => pay(b) }, 'Tandai dibayar') : null,
          h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmBox('Hapus tagihan', `Hapus "${b.name}"?`, 'Hapus')) { db().bills = db().bills.filter((x) => x.id !== b.id); S.save(); render(); } } }, 'Hapus')))))) : h('p', { class: 'empty card' }, 'Belum ada tagihan.')] });
  };

  window.KHApp = { orderWallets, isCashWallet, scanWith, h, R, S, db, go, root, back, render, frame, card, field, errBox, showErr, SCREENS, toast, modal, confirmBox, defaultWallet, activeWallets, liveActs, sortedActs, totalBalance, addActivity, authorizeActivities, walletName, lockNow, session, nav, logo, bioSupported, bioEnroll, bioUnlock, bioError, VERSION, catList, avatarEl, profileForm, ensureSetup, AVATAR_COLORS };
})();
