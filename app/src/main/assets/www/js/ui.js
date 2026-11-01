/* Small DOM helpers: h(), toast, modal, PIN pad, money input. No framework. */
(function (root) {
  'use strict';
  const storage = root.KHNativeStorage || root.localStorage;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; } }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'multiple') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  function toast(msg, opts) {
    opts = opts || {};
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite', 'aria-relevant': 'additions text' }); document.body.append(box); }
    const t = h('div', { class: 'toast', role: 'status' }, h('span', null, msg));
    let removed = false;
    const dismiss = () => {
      if (removed) return;
      removed = true;
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 230);
    };
    if (opts.action) t.append(h('button', { class: 'toast-act', onclick: () => { opts.action.run(); dismiss(); } }, opts.action.label));
    box.append(t);
    setTimeout(dismiss, opts.ms || 4500);
  }

  /** Pop-up bertema: tone = 'warn' | 'error' | 'info' | 'ok'. buttons = [{label, kind:'primary'|'danger'|'ghost', value}] -> Promise(value). Muncul dan hilang dengan animasi. */
  const instant = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
  function modal({ title, body, buttons, tone }) {
    return new Promise((resolve) => {
      const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
      let closed = false;
      const close = (v) => { if (closed) return; closed = true; resolve(v); if (instant()) { back.remove(); return; } back.classList.add('is-closing'); setTimeout(() => back.remove(), 220); };
      const box = h('div', { class: 'modal' + (tone ? ' tone-' + tone : '') }, h('span', { class: 'modal-grip', 'aria-hidden': 'true' }), h('h3', null, title), h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' }, (buttons || [{ label: 'Oke', kind: 'primary', value: true }]).map((b) => h('button', { class: 'btn ' + (b.kind || 'ghost'), onclick: () => close(b.value) }, b.label))));
      back.append(box);
      back.addEventListener('click', (e) => { if (e.target === back) close(undefined); });
      document.body.append(back);
    });
  }
  // Tidak pernah menampilkan tulisan "null": anak kosong diabaikan oleh replaceChildren/append/prepend.
  ['replaceChildren', 'append', 'prepend'].forEach((m) => { const orig = Element.prototype[m]; if (!orig) return; Element.prototype[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); }; });

  // ---------- tema terang / gelap ----------
  const Theme = {
    get() { try { return storage.getItem('kh-theme') || 'auto'; } catch (e) { return 'auto'; } },
    effective() { const m = Theme.get(); if (m !== 'auto') return m; return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; },
    apply(animate) {
      const m = Theme.get(), el = document.documentElement;
      if (animate) { el.classList.add('theme-anim'); setTimeout(() => el.classList.remove('theme-anim'), 420); }
      if (m === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', m);
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', Theme.effective() === 'light' ? '#F2F2F7' : '#000000');
    },
    set(m) { try { if (m === 'auto') storage.removeItem('kh-theme'); else storage.setItem('kh-theme', m); } catch (e) { /* tema tetap berlaku sesi ini */ } Theme.apply(true); },
    toggle() { Theme.set(Theme.effective() === 'light' ? 'dark' : 'light'); }
  };
  if (typeof matchMedia === 'function') { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (Theme.get() === 'auto') Theme.apply(false); }); } catch (e) { /* peramban lama */ } }
  Theme.apply(false);

  // ---------- layar proses scan ----------
  /** Layar penuh selama membaca berkas: pratinjau dengan garis pindai, cincin kemajuan, tiga tahap, dan tombol Batal. stage(teks) menggerakkan kemajuan. */
  function scanOverlay({ file, count }) {
    const NS = 'http://www.w3.org/2000/svg', R0 = 46, C = 2 * Math.PI * R0;
    const isImg = file && (/^image\//.test(file.type || '') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name || '')), url = isImg ? URL.createObjectURL(file) : null;
    const ext = file && file.name ? (file.name.split('.').pop() || '').toUpperCase().slice(0, 4) : '';
    // Pratinjau kecil: foto kamera belasan megapiksel tidak perlu di-decode penuh hanya untuk gambar mini ini.
    const previewImg = h('img', { alt: 'Pratinjau berkas yang dibaca' });
    let smallUrl = null, destroyed = false;
    if (url) {
      const useFull = () => { if (!destroyed) previewImg.src = url; };
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file, { resizeWidth: 720, resizeQuality: 'low', imageOrientation: 'from-image' }).then((bmp) => {
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
          c.toBlob((b) => { if (destroyed) return; if (b && b.size) { smallUrl = URL.createObjectURL(b); previewImg.src = smallUrl; } else useFull(); }, 'image/jpeg', 0.7);
        }).catch(useFull);
      } else useFull();
    }
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'scan-ring-svg'); svg.setAttribute('aria-hidden', 'true');
    const mkC = (cls) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', 50); c.setAttribute('cy', 50); c.setAttribute('r', R0); c.setAttribute('class', cls); svg.append(c); return c; };
    mkC('trk'); const arc = mkC('val'); arc.setAttribute('stroke-dasharray', C); arc.setAttribute('stroke-dashoffset', C);
    const pctEl = h('strong', { class: 'scan-pct' }, '0%'), detail = h('p', { class: 'scan-detail', 'aria-live': 'polite' }, 'Memulai');
    const logList = h('ol', { class: 'scan-log-list' });
    const logSum = h('summary', null, 'Riwayat proses');
    const logDetails = h('details', { class: 'scan-log' }, logSum, logList);
    const stageHistory = [];
    const STEPS = ['Siapkan', 'Baca teks', 'Cocokkan'], stepEls = STEPS.map((t) => h('li', { class: 'scan-step' }, h('span', { class: 'scan-dot' }), h('span', null, t)));
    const view = h('div', { class: 'scan-view' + (url ? '' : ' is-doc') }, url ? previewImg : h('div', { class: 'scan-doc' }, h('strong', null, ext || 'DOC'), h('small', null, count > 1 ? count + ' berkas' : 'Dokumen')),
      h('span', { class: 'scan-line' }), h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
    let cancelled = false, p = 0, step = 0, closed = false;
    const cancelBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => { cancelled = true; api.close(); } }, 'Batal');
    const box = h('div', { class: 'scan', role: 'status' }, h('span', { class: 'scan-kicker' }, 'Memindai'), view,
      h('div', { class: 'scan-ring' }, svg, pctEl), h('ol', { class: 'scan-steps' }, stepEls), detail, logDetails, cancelBtn);
    const back = h('div', { class: 'scan-back', 'aria-modal': 'true', role: 'dialog', 'aria-label': 'Memindai berkas' }, box);
    let pendingText = null, flushId = 0;
    const paint = () => {
      const v = Math.min(100, Math.max(0, p)); arc.setAttribute('stroke-dashoffset', C * (1 - v / 100)); pctEl.textContent = Math.round(v) + '%';
      stepEls.forEach((el, i) => { el.classList.toggle('done', i < step || v >= 100); el.classList.toggle('on', i === step && v < 100); });
    };
    const flush = () => { flushId = 0; if (closed) return; if (pendingText !== null) { detail.textContent = pendingText; pendingText = null; } paint(); };
    const scheduleFlush = () => { if (flushId) return; flushId = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(flush) : setTimeout(flush, 16); };
    const CAP = [22, 72, 94];
    // Do not inflate the ring while OCR reports its real recognition percentage.
    // For preparation/matching steps, use a gentle phase indicator; during text
    // recognition, only logger callbacks advance the number.
    const timer = setInterval(() => { if (step !== 1 && p < CAP[step]) { p += (CAP[step] - p) * 0.035; paint(); } }, 300);
    const api = {
      get cancelled() { return cancelled; },
      tick(sec) { if (!closed) logSum.textContent = 'Riwayat proses · ' + sec + ' dtk'; },
      history() { return stageHistory.slice(); },
      stage(text) {
        if (closed) return; const t = String(text || '');
        const cleanText = t.replace(/^\(\d+\/\d+\)\s*/, '');
        pendingText = cleanText; scheduleFlush();               // teks dan kemajuan digambar paling banyak sekali per frame
        const phase = cleanText.replace(/\s*\d+%\s*$/, '');    // riwayat mencatat tahap, bukan tiap persen
        if (phase && stageHistory[stageHistory.length - 1] !== phase) {
          stageHistory.push(phase);
          if (stageHistory.length > 12) stageHistory.shift();
          logList.replaceChildren(...stageHistory.map((entry) => h('li', null, entry)));
        }
        let target = p, s = step, m;
        if ((m = /mesin baca[^\d%]*(\d+)%/i.exec(t))) { s = 0; target = 8 + (+m[1]) * 0.14; }
        else if ((m = /membaca teks (\d+)%/i.exec(t))) { s = 1; target = 22 + (+m[1]) * 0.45; }
        else if ((m = /(bagian|halaman)\s+(\d+)\s+dari\s+(\d+)/i.exec(t)) && !/ulang/i.test(t)) { s = 1; target = 22 + ((+m[2] - 1) / Math.max(1, +m[3])) * 46; }
        else if (/ulang|memeriksa|mencocokkan|pengaturan lain/i.test(t)) { s = 2; target = Math.max(72, p); if ((m = /\((\d+) dari (\d+)\)/.exec(t))) target = 72 + (+m[1] / +m[2]) * 20; }
        else if (/mesin baca|gambar|pdf|dokumen|word|excel/i.test(t)) { s = Math.max(step, 0); target = Math.max(p, 10); }
        step = Math.max(step, s); p = Math.max(p, target); scheduleFlush();
      },
      async finish() { if (closed) return; step = 2; p = 100; pendingText = null; detail.textContent = 'Selesai'; paint(); await new Promise((r) => setTimeout(r, instant() ? 0 : 450)); },
      close() { if (closed) return; closed = true; destroyed = true; clearInterval(timer); if (url) setTimeout(() => URL.revokeObjectURL(url), 400); if (smallUrl) setTimeout(() => URL.revokeObjectURL(smallUrl), 400); if (instant()) { back.remove(); return; } back.classList.add('is-closing'); setTimeout(() => back.remove(), 260); }
    };
    paint(); document.body.append(back);
    return api;
  }
  const notice = (title, body, tone, buttons) => modal({ title, body, tone: tone || 'info', buttons });
  const confirmBox = (title, body, yes, no) => modal({ title, body, buttons: [{ label: no || 'Batal', kind: 'ghost', value: false }, { label: yes || 'Lanjut', kind: 'primary', value: true }] });

  /** 6-digit PIN pad. onDone(pin) is called when length reached; returns {el, clear, shake}. */
  function pinPad({ length = 6, onDone, extra }) {
    let val = '';
    const dots = h('div', { class: 'pin-dots', 'aria-label': 'PIN' }, Array.from({ length }, () => h('span', { class: 'dot' })));
    const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < val.length));
    const push = (d) => { if (val.length >= length) return; val += d; paint(); if (val.length === length) { const v = val; setTimeout(() => onDone(v), 80); } };
    const pop = () => { val = val.slice(0, -1); paint(); };
    const key = (label, fn, cls) => h('button', { class: 'key ' + (cls || ''), type: 'button', onclick: fn }, label);
    const pad = h('div', { class: 'pad' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => push(d))),
      extra ? key(extra.label, extra.run, 'key-small') : h('span'),
      key('0', () => push('0')),
      key('Hapus', pop, 'key-small'));
    const onKey = (e) => { if (/^\d$/.test(e.key)) push(e.key); else if (e.key === 'Backspace') pop(); };
    document.addEventListener('keydown', onKey);
    const el = h('div', { class: 'pinpad' }, dots, pad);
    const obs = new MutationObserver(() => { if (!document.body.contains(el)) { document.removeEventListener('keydown', onKey); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
    return { el, clear() { val = ''; paint(); }, shake() { dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); } };
  }

  const digits = (s) => parseInt(String(s).replace(/\D/g, '') || '0', 10);
  const group = (n) => String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  /** Text input that shows 1.234.567 and returns a number via onChange. */
  function moneyInput(value, onChange, attrs) {
    const input = h('input', Object.assign({ type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'input money', value: value ? group(value) : '' }, attrs || {}));
    input.addEventListener('input', () => {
      const n = digits(input.value);
      input.value = n ? group(n) : '';
      onChange(n);
    });
    return input;
  }

  /** Pilihan bahasa Indonesia / English, bentuk dan gaya sama dengan pilihan tema (kelas .seg). */
  function langSwitch() {
    const L = root.KHI18n;
    if (!L) return null;
    const seg = h('div', { class: 'seg seg2', role: 'group', 'aria-label': 'Bahasa' });
    const draw = () => seg.replaceChildren(...[['id', 'Indonesia'], ['en', 'English']].map(([k, l]) => h('button', { class: 'seg-b' + (L.get() === k ? ' on' : ''), type: 'button', lang: k, 'aria-pressed': String(L.get() === k), onclick: () => { L.set(k); draw(); } }, l)));
    draw();
    return seg;
  }

  root.KHUI = { h, toast, modal, notice, Theme, scanOverlay, confirmBox, pinPad, moneyInput, digits, group, langSwitch };
})(typeof self !== 'undefined' ? self : this);
