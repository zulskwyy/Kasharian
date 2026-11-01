/* Other settings: wallets, budget plan, data cleanup, summaries, memory, security and profile settings. */
(function () {
  'use strict';
  const A = KHApp, { h, R, S, db, go, root, back, frame, card, field, errBox, showErr, SCREENS, toast, modal, confirmBox } = A;
  const { moneyInput } = KHUI;
  const TYPE = { BANK: 'Rekening bank', EWALLET: 'Dompet digital', SAVINGS: 'Tabungan', EMERGENCY: 'Dana darurat', CASH: 'Tunai', OTHER: 'Lainnya' };

  SCREENS.more = () => {
    const item = (label, sub, fn) => h('button', { class: 'menu-item', onclick: fn }, h('span', null, h('strong', null, label), sub ? h('small', null, sub) : null), h('span', { class: 'chev' }, '>'));
    const p = db().profile;
    return frame({ title: 'Lainnya', tabs: 'more', children: [
      card(h('div', { class: 'profile-card' }, A.avatarEl(p, 56), h('div', { class: 'profile-id' }, h('strong', null, p ? p.name : 'Profil'), h('small', null, p ? '@' + p.username : '')), h('button', { class: 'btn sm', onclick: () => go('profile') }, 'Ubah profil'))),
      card(h('h4', null, 'Tampilan'), (() => { const seg = h('div', { class: 'seg seg3', role: 'group', 'aria-label': 'Tema tampilan' }); const draw = () => seg.replaceChildren(...[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => h('button', { class: 'seg-b' + (KHUI.Theme.get() === k ? ' on' : ''), type: 'button', onclick: () => { KHUI.Theme.set(k); draw(); } }, l))); draw(); return seg; })()),
      window.KHI18n ? card(h('h4', null, 'Bahasa'), KHUI.langSwitch()) : null,
      card(h('div', { class: 'list' },
        item('Dompet', null, () => go('wallets')),
        item('Rencana uang', null, () => go('plan')),
        item('Rapikan data', null, () => go('rapikan')),
        window.KHStatement ? item('E-Statement', null, () => go('estatement')) : null,
        item('Ringkasan bulan', null, () => go('summary')),
        item('Notifikasi pengingat', null, () => go('notif')),
        item('Kamus saya', null, () => go('memory')),
        item('Cadangan', backupDays() >= 7 ? (db().lastBackupAt ? 'Terakhir ' + backupDays() + ' hari lalu' : 'Belum pernah dicadangkan') : null, () => go('backup')),
        item('Keamanan', null, () => go('security')),
        item('Tentang', null, () => go('about')))),
      h('button', { class: 'btn block', onclick: A.lockNow }, 'Kunci sekarang'),
      h('button', { class: 'btn danger block', onclick: () => go('delete') }, 'Hapus semua data')] });
  };

  // ----- wallets -----
  SCREENS.wallets = () => {
    const bal = R.BalanceEngine.balances(db().wallets, A.liveActs());
    const name = h('input', { class: 'input', placeholder: 'Nama dompet, mis. BCA' });
    const type = h('select', { class: 'input' }, Object.entries(TYPE).map(([k, v]) => h('option', { value: k }, v)));
    let open = 0, inTotal = true;
    async function adjust(w) {
      let actual = bal[w.id] || 0;
      const input = moneyInput(Math.max(actual, 0), (n) => { actual = n; });
      const ok = await modal({ title: 'Sesuaikan saldo', body: [h('p', null, `Saldo di aplikasi ${R.rupiah(bal[w.id] || 0)}. Masukkan saldo sebenarnya di ${w.name}.`), input], buttons: [{ label: 'Batal', value: false }, { label: 'Sesuaikan', kind: 'primary', value: true }] });
      if (!ok) return;
      const diff = actual - (bal[w.id] || 0);
      if (!diff) return toast('Saldo sudah sama.');
      const now = Date.now();
      db().activities.push({ id: S.uid(), ...R.Reconcile.record(diff, w.id, R.todayISO(), now) });
      S.save(); toast(diff < 0 ? `Saldo disesuaikan. Selisih ${R.rupiah(-diff)} dicatat sebagai pengeluaran belum tercatat.` : 'Saldo disesuaikan'); A.render();
    }
    async function transfer(from) {
      const others = A.orderWallets(A.activeWallets()).filter((w) => w.id !== from.id);
      if (!others.length) return toast('Tambah dompet lain dulu.');
      const to = h('select', { class: 'input' }, others.map((w) => h('option', { value: w.id }, w.name)));
      let amt = 0;
      const ok = await modal({ title: 'Pindah dana', body: [h('p', null, `Dari ${from.name} ke:`), to, h('p', null, 'Nominal'), moneyInput(0, (n) => { amt = n; })], buttons: [{ label: 'Batal', value: false }, { label: 'Pindahkan', kind: 'primary', value: true }] });
      if (!ok) return;
      if (R.validateAmount(amt)) return toast(R.validateAmount(amt));
      A.addActivity({ type: 'TRANSFER', amount: amt, walletId: from.id, toWalletId: to.value, category: 'Pindah dompet', note: `Pindah dana ke ${A.walletName(to.value)}`, source: 'pindah' });
      S.save(); toast('Dana dipindahkan'); A.render();
    }
    return frame({ title: 'Dompet', back: true, children: [
      card(h('div', { class: 'card-head' }, h('h3', null, 'Dompet'), h('strong', { class: 'card-total' }, R.rupiah(A.totalBalance()))), h('div', { class: 'list' }, A.orderWallets(A.activeWallets()).map((w) => h('div', { class: 'wallet' },
        h('div', { class: 'wallet-head' }, h('span', { class: 'wallet-name' }, h('strong', null, w.name), h('small', { class: 'tag' }, TYPE[w.type] || 'Lainnya')), h('strong', { class: 'wallet-bal' }, R.rupiah(bal[w.id] || 0))),
        h('div', { class: 'wallet-actions' }, h('button', { class: 'btn sm', onclick: () => adjust(w) }, 'Sesuaikan'), h('button', { class: 'btn sm', onclick: () => transfer(w) }, 'Pindah'),
          A.activeWallets().length > 1 ? h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmBox('Arsipkan dompet', `Sembunyikan "${w.name}"? Riwayatnya tetap ada.`, 'Arsipkan')) { w.archived = true; S.save(); A.render(); } } }, 'Arsipkan') : null))))),
      card(h('h3', null, 'Tambah dompet'), field('Nama', name), field('Jenis', type), field('Saldo awal', moneyInput(0, (n) => { open = n; })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { inTotal = e.target.checked; } }), h('span', null, 'Hitung di total uang')),
        h('button', { class: 'btn primary block', onclick: () => {
          if (!name.value.trim()) return toast('Isi nama dompet.');
          db().wallets.push({ id: S.uid(), name: name.value.trim(), type: type.value, openingBalance: open, includeInTotal: inTotal, archived: false, createdAt: Date.now() });
          S.save(); toast('Dompet ditambahkan'); A.render();
        } }, 'Tambah'))] });
  };

  // ----- summary -----
  SCREENS.summary = () => {
    let ym = R.monthOf(R.todayISO());
    const out = h('div'), head = h('div', { class: 'month-nav' });
    const draw = () => {
      head.replaceChildren(h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, -1); draw(); } }, 'Sebelumnya'), h('strong', null, R.monthLabel(ym)), h('button', { class: 'btn ghost sm', onclick: () => { ym = R.addMonths(ym, 1); draw(); } }, 'Berikutnya'));
      const sm = R.SummaryEngine.month(A.liveActs(), ym), rows = R.SummaryEngine.categoryBreakdown(A.liveActs(), ym);
      out.replaceChildren(
        card(h('div', { class: 'stats' }, [['Masuk', sm.income, 'in'], ['Keluar', sm.expense, 'out'], ['Selisih', sm.difference, sm.difference < 0 ? 'out' : 'in']].map(([l, v, c]) => h('div', { class: 'stat' }, h('small', null, l), h('strong', { class: c }, R.rupiah(v))))),
          sm.biggestCategory ? null : null),
        window.KHCharts ? KHCharts.spendCard(A.liveActs(), ym, { growth: true, empty: true }) : card(h('h3', null, 'Pengeluaran per kategori'), null,
          rows.length ? h('div', { class: 'list' }, rows.map((r) => h('button', { class: 'cat-row', onclick: () => go('activities', { month: ym, kind: 'EXPENSE', category: r.category }) },
            h('div', { class: 'cat-top' }, h('strong', null, r.category), h('span', null, `${R.rupiah(r.amount)} (${r.sharePercent}%)`)),
            h('div', { class: 'bar' }, h('i', { style: { width: Math.max(2, r.sharePercent) + '%' } })),
            r.growthPercent != null ? h('small', { class: 'warn-text' }, `Naik ${r.growthPercent}% dari bulan lalu`) : null))) : h('p', { class: 'empty' }, 'Belum ada pengeluaran di bulan ini.')));
    };
    draw();
    return frame({ title: 'Ringkasan', back: true, children: [head, out] });
  };

  // ----- memory -----
  SCREENS.memory = () => frame({ title: 'Kamus saya', back: true, children: [card(
    null,
    db().memory.length ? h('div', { class: 'list' }, db().memory.map((m) => h('div', { class: 'row-between' }, h('span', null, h('strong', null, m.term), h('small', null, `${m.kind === 'INCOME' ? 'Masuk' : 'Keluar'} · ${m.category}`)),
      h('button', { class: 'btn ghost sm', onclick: () => { db().memory = db().memory.filter((x) => x.id !== m.id); S.save(); A.render(); } }, 'Hapus')))) : h('p', { class: 'empty' }, 'Belum ada kata tersimpan'))] });

  // ----- security -----
  SCREENS.security = () => {
    const bioBox = h('div', { 'aria-live': 'polite' });
    const drawBio = async () => {
      const secure = !!window.isSecureContext;
      const apiAvailable = !!(window.PublicKeyCredential && navigator.credentials && typeof navigator.credentials.create === 'function');
      const supported = await A.bioSupported();
      if (supported) {
        bioBox.replaceChildren(h('p', { class: 'note' }, db().bio ? 'Aktif' : 'Tersedia di perangkat ini'),
          db().bio ? h('button', { class: 'btn block', onclick: () => { db().bio = null; S.save(); drawBio(); } }, 'Matikan verifikasi perangkat')
            : h('button', { class: 'btn primary block', onclick: async () => { try { await A.bioEnroll(); toast('Verifikasi perangkat aktif'); drawBio(); } catch (e) { toast(A.bioError(e), { ms: 9000 }); } } }, 'Aktifkan verifikasi perangkat'),
          null);
      } else {
        let reason;
        if (!secure) reason = 'Butuh alamat HTTPS yang valid';
        else if (!apiAvailable) reason = 'Tidak didukung peramban ini';
        else reason = 'Aktifkan kunci layar atau sidik jari di pengaturan perangkat';
        bioBox.replaceChildren(h('p', { class: 'note' }, reason),
          h('button', { class: 'btn block', onclick: drawBio }, 'Periksa dukungan lagi'),
          null);
      }
    };
    drawBio();
    const sel = h('select', { class: 'input', onchange: (e) => { db().settings.autolockMin = parseInt(e.target.value, 10); S.save(); toast('Kunci otomatis diubah'); } },
      [[0, 'Langsung saat keluar dari aplikasi'], [1, 'Setelah 1 menit'], [5, 'Setelah 5 menit'], [15, 'Setelah 15 menit']].map(([v, l]) => h('option', { value: v, selected: db().settings.autolockMin === v }, l)));
    return frame({ title: 'Keamanan', back: true, children: [
      card(h('button', { class: 'btn block', onclick: () => go('pinsetup', { flow: 'change' }) }, 'Ganti PIN')),
      window.KHRecovery ? card(h('h3', null, 'Pemulihan PIN'),
        h('p', { class: 'note' }, KHRecovery.exists() ? '12 kata pemulihan aktif. Dengan 12 kata itu kamu bisa membuat PIN baru tanpa internet.' : 'Belum dibuat. Buat 12 kata untuk berjaga-jaga kalau PIN terlupa.'),
        h('button', { class: 'btn ' + (KHRecovery.exists() ? '' : 'primary ') + 'block', onclick: () => go('recoverysetup') }, KHRecovery.exists() ? 'Buat ulang 12 kata' : 'Buat 12 kata pemulihan')) : null,
      card(h('h3', null, 'Kunci otomatis'), sel), card(h('h3', null, 'Sidik jari'), bioBox)] });
  };


  // ----- cadangan terenkripsi dan pulihkan -----
  function backupDays() { const d = db(); return d.lastBackupAt ? Math.floor((Date.now() - d.lastBackupAt) / 864e5) : 999; }
  function restoreCard(keepDevice) {
    const err = A.errBox(), pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Kata sandi cadangan', 'aria-label': 'Kata sandi cadangan' });
    const fileInput = h('input', { type: 'file', accept: '.khbak,.json,application/json', hidden: true }), fileName = h('span', { class: 'file-name' }, 'Belum ada berkas');
    let file = null; fileInput.addEventListener('change', () => { file = fileInput.files && fileInput.files[0]; fileName.textContent = file ? file.name : 'Belum ada berkas'; });
    const run = async () => {
      A.showErr(err, '');
      if (!file) return A.showErr(err, 'Pilih berkas cadangan dulu.');
      if (!pw.value) return A.showErr(err, 'Isi kata sandi cadangan.');
      let out; try { out = await KHBackup.decrypt(await file.text(), pw.value, { channel: KHBackup.CHANNEL }); } catch (e) { return A.showErr(err, e.message); }
      const d = out.data, when = out.exportedAt ? new Date(out.exportedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
      const ok = await KHUI.modal({ title: 'Ganti data dengan cadangan?', tone: 'warn', body: [h('p', null, `${d.wallets.length} dompet, ${d.activities.length} transaksi, dibuat ${when}.`), h('p', null, keepDevice ? 'Data di perangkat ini akan diganti. PIN Anda tetap.' : 'Data di perangkat ini akan diganti. Setelah itu Anda membuat PIN baru.')], buttons: [{ label: 'Batal', kind: 'ghost', value: false }, { label: 'Ganti data', kind: 'danger', value: true }] });
      if (!ok) return;
      const cur = db(), keep = keepDevice ? { pin: cur.pin, bio: cur.bio, failed: cur.failed, recovery: cur.recovery } : { pin: null, bio: null, failed: { n: 0, until: 0 }, recovery: null };
      Object.keys(cur).forEach((k) => { delete cur[k]; });
      Object.assign(cur, { v: 3, profile: null, onboarded: false, settings: { autolockMin: 1 }, wallets: [], activities: [], bills: [], slips: [], memory: [] }, d, keep);
      if (cur.wallets.length && cur.profile) cur.onboarded = true;
      S.save(); A.session.unlocked = !!cur.pin; toast('Data dipulihkan');
      if (!cur.pin) return A.root('pinsetup', { flow: 'newpin' });
      A.root('home');
    };
    return card(h('h3', null, 'Pulihkan dari cadangan'),
      h('button', { class: 'file-pick', type: 'button', onclick: () => fileInput.click() }, h('strong', null, 'Pilih berkas'), fileName), fileInput,
      field('Kata sandi', pw), err, h('button', { class: 'btn primary block', onclick: run }, 'Pulihkan'));
  }
  function backupCard() {
    const err = A.errBox(), pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Kata sandi (minimal 8 karakter)', 'aria-label': 'Kata sandi' }), pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Ulangi kata sandi', 'aria-label': 'Ulangi kata sandi' });
    const days = backupDays(), tag = days >= 999 ? 'Belum pernah' : days === 0 ? 'Hari ini' : days + ' hari lalu';
    const run = async () => {
      A.showErr(err, '');
      if (pw.value.length < KHBackup.MIN_PASSWORD) return A.showErr(err, `Kata sandi minimal ${KHBackup.MIN_PASSWORD} karakter.`);
      if (pw.value !== pw2.value) return A.showErr(err, 'Kedua kata sandi harus sama.');
      const go1 = await KHUI.modal({ title: 'Ingat kata sandi ini', tone: 'warn', body: [h('p', null, 'Kata sandi tidak bisa dipulihkan. Tanpanya cadangan tidak bisa dibuka siapa pun.')], buttons: [{ label: 'Kembali', kind: 'ghost', value: false }, { label: 'Saya mengerti, simpan', kind: 'primary', value: true }] });
      if (!go1) return;
      try {
        db().lastBackupAt = Date.now();
        const text = await KHBackup.encrypt(db(), pw.value, { channel: KHBackup.CHANNEL, version: A.VERSION });
        if (window.KHNativeFiles) window.KHNativeFiles.saveText(KHBackup.fileName(), 'application/json', text);
        else { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: KHBackup.fileName() }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
        S.save(); pw.value = ''; pw2.value = ''; toast('Cadangan disimpan'); A.render();
      } catch (e) { A.showErr(err, e.message || 'Cadangan gagal dibuat.'); }
    };
    return card(h('div', { class: 'card-head' }, h('h3', null, 'Buat cadangan'), h('small', { class: 'tag' + (days >= 7 ? ' warn' : '') }, tag)), field('Kata sandi', pw), field('Ulangi kata sandi', pw2), err, h('button', { class: 'btn primary block', onclick: run }, 'Simpan berkas cadangan'));
  }
  SCREENS.backup = () => frame({ title: 'Cadangan', back: true, children: [backupCard(), restoreCard(true)] });
  SCREENS.restore = () => frame({ title: 'Pulihkan data', back: true, children: [restoreCard(false)] });

  // Pembuat dan kontak. Tautan hanya terbuka bila pengguna mengetuknya; aplikasi tidak mengirim data apa pun.
  const MAKER = { name: 'Zulfiarudin Trian Masada', initials: 'ZT', wa: '6285806808015', waShow: '0858-0680-8015', email: 'zulfiarudintrian@gmail.com', ig: 'zulskwy', linkedin: 'zulfiarudin-trian-masada-57943b245' };
  SCREENS.about = () => {
    const wa = (text) => 'https://wa.me/' + MAKER.wa + '?text=' + encodeURIComponent(text);
    const row = (href, title, sub) => h('a', { class: 'menu-item about-link', href, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, h('strong', null, title), h('small', null, sub)), h('span', { class: 'chev' }, '>'));
    const privacy = () => {
      const notes = [
        'Semua data tersimpan di perangkat ini. Tanpa akun, server, iklan, atau analitik.',
        'Aplikasi tidak mengirim data keuanganmu ke mana pun. Membuka tautan kontak memakai internet, tetapi data keuanganmu tidak ikut terkirim.',
        window.KHNativeStorage ? 'Data keuangan disimpan dalam basis data SQLCipher terenkripsi. Kunci acak dilindungi Android Keystore; PIN mengunci akses aplikasi.' : 'Data di peramban belum dienkripsi saat disimpan. PIN mengunci tampilan, bukan mengenkripsi data.',
        'Lupa PIN? Pakai 12 kata pemulihan (Lainnya > Keamanan) atau cadangan terenkripsi dari menu Cadangan.'
      ];
      KHUI.notice('Privasi', h('div', { class: 'info-body' }, notes.map((t) => h('p', null, t))), 'info');
    };
    return frame({ title: 'Tentang', back: true, children: [
      h('section', { class: 'card about-hero' }, A.logo(76), h('h2', null, 'KasHarian'), h('span', { class: 'about-ver' }, 'Versi ' + A.VERSION),
        h('p', null, 'Catatan uang harian yang rapi, jujur, dan tersimpan di perangkatmu sendiri.')),
      h('section', { class: 'card about-maker' }, h('div', { class: 'about-avatar', 'aria-hidden': 'true' }, MAKER.initials),
        h('div', null, h('small', null, 'Dibuat oleh'), h('strong', null, MAKER.name))),
      card(h('h3', null, 'Kritik, saran, dan order'),
        h('p', { class: 'note' }, 'Ada yang kurang pas, punya ide, atau ingin dibuatkan aplikasi? Kirim pesan, aku balas secepatnya.'),
        h('div', { class: 'stack' },
          h('a', { class: 'btn primary block', href: wa('Halo ' + MAKER.name.split(' ')[0] + ', aku pengguna KasHarian. Aku mau kasih kritik dan saran:'), target: '_blank', rel: 'noopener noreferrer' }, 'Kirim kritik dan saran'),
          h('a', { class: 'btn block', href: wa('Halo ' + MAKER.name.split(' ')[0] + ', aku tertarik order pembuatan aplikasi. Boleh tanya-tanya dulu?'), target: '_blank', rel: 'noopener noreferrer' }, 'Tanya soal order'))),
      card(h('h3', null, 'Hubungi langsung'),
        h('div', { class: 'list' },
          row(wa('Halo, aku pengguna KasHarian.'), 'WhatsApp', MAKER.waShow),
          row('mailto:' + MAKER.email + '?subject=' + encodeURIComponent('KasHarian: kritik, saran, atau order'), 'Email', MAKER.email),
          row('https://www.instagram.com/' + MAKER.ig, 'Instagram', '@' + MAKER.ig),
          row('https://www.linkedin.com/in/' + MAKER.linkedin, 'LinkedIn', MAKER.name)),
        null),
      card(h('button', { class: 'btn block', onclick: privacy }, 'Privasi')),
      null] });
  };

  // ----- profile -----
  SCREENS.profile = () => frame({ title: 'Profil', back: true, children: [
    A.profileForm(db().profile || {}, 'Simpan', (p) => { db().profile = p; S.save(); toast('Profil disimpan'); back(); })] });

  // ----- reminders (native notification bridge in APK; browser notification in PWA) -----
  SCREENS.notif = () => {
    const p = db().profile, hour = new Date().getHours();
    const msg = (days) => R.Reminder.billMessage(p, { name: 'listrik', amount: 450000 }, days, hour);
    const native = !!(window.KHNativeStorage && typeof window.KHNativeStorage.isNotificationsGranted === 'function');
    const sup = native || typeof Notification !== 'undefined';
    const granted = () => native ? !!window.KHNativeStorage.isNotificationsGranted() : sup && Notification.permission === 'granted';
    const status = h('p', { class: 'note' });
    const paint = () => { status.textContent = !sup ? 'Peramban ini tidak mendukung notifikasi sistem.' : granted() ? 'Notifikasi sistem aktif.' : 'Notifikasi sistem belum diaktifkan.'; };
    paint();
    async function askPermission() {
      try {
        if (native && window.KHNativePermissions) await window.KHNativePermissions.requestNotifications();
        else if (sup) await Notification.requestPermission();
      } catch (e) { /* izin bisa ditolak dari pengaturan HP */ }
      paint(); A.render();
    }
    async function systemNotify(title, body) {
      if (window.KHI18n) { title = KHI18n.t(title); body = KHI18n.t(body); }
      try {
        if (native) return !!window.KHNativeStorage.showNotification(title, body);
        if (!sup || Notification.permission !== 'granted') return false;
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'kh-test' }); else new Notification(title, { body });
        return true;
      } catch (e) { return false; }
    }
    return frame({ title: 'Notifikasi pengingat', back: true, children: [
      card(h('div', { class: 'card-head' }, h('h3', null, 'Pengingat'), h('button', { class: 'link', onclick: () => go('profile') }, 'Sapaan')), h('div', { class: 'list' }, [1, -2].map((d) => { const m = msg(d); return h('div', { class: 'reminder' }, h('strong', null, m.title), h('p', null, m.body)); }))),
      card(h('h3', null, 'Coba sekarang'), status,
        sup && !granted() ? h('button', { class: 'btn block', onclick: askPermission }, 'Aktifkan notifikasi sistem') : null,
        h('button', { class: 'btn primary block', onclick: async () => { const m = msg(1); toast(m.title + ': ' + m.body, { ms: 6000 }); if (!(await systemNotify(m.title, m.body)) && sup && !granted()) toast('Notifikasi sistem belum aktif, pesan di atas hanya tampil di aplikasi.'); } }, 'Tes notifikasi'))] });
  };

  SCREENS.delete = () => {
    const t = h('input', { class: 'input', placeholder: 'Ketik HAPUS' });
    return frame({ title: 'Hapus semua data', back: true, children: [card(h('p', null, 'Semua data lokal akan dihapus permanen: profil, PIN, dompet, saldo awal, aktivitas, rencana, dan tagihan. Pastikan Anda benar-benar ingin menghapus data ini.'), t,
      h('button', { class: 'btn danger block', onclick: () => { if (t.value.trim().toUpperCase() !== 'HAPUS') return toast('Ketik HAPUS untuk melanjutkan.'); S.reset(); location.reload(); } }, 'Hapus semuanya'))] });
  };
})();
