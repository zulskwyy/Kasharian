/* KasHarian: pilihan bahasa tampilan (Indonesia / English).
   Hanya mengubah TULISAN yang tampil di layar. Data, logika, pembaca struk/slip, dan format uang tidak disentuh.
   Bahasa Indonesia adalah bawaan dan tidak diubah sama sekali; saat English dipilih, tulisan di layar
   diterjemahkan lewat kamus (js/i18n-en.js) dan dikembalikan utuh bila kembali ke Indonesia.
   Pilihan disimpan di localStorage 'kh-lang' (di luar data keuangan, jadi tidak ikut cadangan). */
(function (root) {
  'use strict';
  const storage = root.KHNativeStorage || root.localStorage;
  const LS = 'kh-lang';
  const RAW = root.KH_EN || {};
  const exact = new Map(), pats = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  Object.keys(RAW).forEach((k) => {
    const key = k.trim(), v = RAW[k];
    if (key.indexOf('${}') < 0) { exact.set(key, v); return; }
    const parts = key.split('${}');
    pats.push({ re: new RegExp('^' + parts.map(esc).join('([\\s\\S]*?)') + '$'), v, lit: parts.reduce((a, b) => (b.length > a.length ? b : a), ''), weight: parts.join('').length });
  });
  pats.sort((a, b) => b.weight - a.weight);

  // Kata yang artinya bergantung tempatnya: [penanda induk, terjemahan]. Tanpa penanda cocok, dipakai kamus.
  const CTX = {
    Lainnya: [['nav, h1', 'More']],
    Dompet: [['.menu-item, h1', 'Wallets']]
  };

  const MON = { Januari: 'January', Februari: 'February', Maret: 'March', Mei: 'May', Juni: 'June', Juli: 'July', Agustus: 'August', Oktober: 'October', Desember: 'December', Agu: 'Aug', Okt: 'Oct', Des: 'Dec' };
  const RE_MON = new RegExp('(^|[^A-Za-z])(' + Object.keys(MON).join('|') + ')(?=\\s+\\d{4}\\b)', 'g');
  const dates = (s) => s.replace(RE_MON, (m, pre, name) => pre + MON[name]);

  function fill(v, caps, depth) {
    let seq = 0;
    return v.replace(/\$\{(\d+)?(?::([^|}]*)\|([^}]*))?\}/g, (m, idx, one, many) => {
      if (one !== undefined) return parseInt(String(caps[+idx - 1] || '').replace(/\D/g, ''), 10) === 1 ? one : many;
      const i = idx ? +idx - 1 : seq++;
      return caps[i] == null ? '' : tr(caps[i], depth + 1);
    });
  }
  // Kalimat gabungan ("judul: isi", "A · B", "A. B"): terjemahkan tiap potongan, dari pemisah terbesar ke terkecil.
  const SPLITS = [/^([\s\S]*?:)(\s+)([\s\S]+)$/, /(\s*·\s*)/, /((?<=[.!?])\s+)/];
  function pieces(core, depth) {
    for (const re of SPLITS) {
      const m = re.exec(core);
      if (!m) continue;
      const parts = re === SPLITS[0] ? [m[1], m[2], m[3]] : core.split(re);
      if (parts.length < 3) continue;
      let changed = false;
      const out = parts.map((p, i) => {
        if (i % 2) return p;
        const t = tr(re === SPLITS[0] && i === 0 ? p.slice(0, -1) : p, depth + 1);
        const r = re === SPLITS[0] && i === 0 ? t + ':' : t;
        if (r !== p) changed = true;
        return r;
      });
      if (changed) return out.join('');
    }
    return undefined;
  }
  function tr(s, depth, el) {
    depth = depth || 0;
    if (typeof s !== 'string' || !/[A-Za-z]/.test(s) || depth > 4) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2];
    if (!core) return s;
    let out;
    const ctx = el && CTX[core];
    if (ctx && el.closest) for (const [sel, en] of ctx) if (el.closest(sel)) { out = en; break; }
    if (out === undefined) out = exact.get(core);
    if (out === undefined) {
      for (const p of pats) {
        if (core.indexOf(p.lit) < 0) continue;
        const r = p.re.exec(core);
        if (r) { out = fill(p.v, r.slice(1), depth); break; }
      }
    }
    if (out === undefined) out = pieces(core, depth);
    if (out === undefined) { const d = dates(core); if (d === core) return s; out = d; }
    return m[1] + out + m[3];
  }

  // ---------- bahasa aktif ----------
  let lang = 'id';
  try { if (storage.getItem(LS) === 'en') lang = 'en'; } catch (e) { /* tetap Indonesia */ }
  const listeners = [];

  // ---------- penerjemah tampilan (hanya aktif untuk English) ----------
  const hasDom = typeof document !== 'undefined' && typeof MutationObserver === 'function';
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  const ATTRS = ['aria-label', 'placeholder', 'title', 'alt', 'aria-valuetext'];
  const tnodes = new WeakMap(), anodes = new WeakMap();
  let mo = null;

  function doText(node) {
    const p = node.parentElement;
    if (!p || SKIP[p.tagName] || (p.closest && p.closest('[translate="no"],[data-no-i18n]'))) return;
    const cur = node.data, rec = tnodes.get(node);
    if (rec && rec.out === cur) return;
    const out = tr(cur, 0, p);
    tnodes.set(node, { src: cur, out });
    if (out !== cur) node.data = out;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      let recs = anodes.get(el); if (!recs) { recs = {}; anodes.set(el, recs); }
      if (recs[a] && recs[a].out === cur) continue;
      const out = tr(cur, 0);
      recs[a] = { src: cur, out };
      if (out !== cur) el.setAttribute(a, out);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { doText(node); return; }
    if (node.nodeType !== 1) return;
    doAttrs(node);
    const tw = document.createTreeWalker(node, 1 | 4);
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function restore(node) {
    if (node.nodeType !== 1) return;
    const tw = document.createTreeWalker(node, 1 | 4);
    const back = (n) => {
      if (n.nodeType === 3) { const r = tnodes.get(n); if (r && n.data === r.out) n.data = r.src; tnodes.delete(n); return; }
      const recs = anodes.get(n); if (!recs) return;
      for (const a of Object.keys(recs)) if (n.getAttribute(a) === recs[a].out) n.setAttribute(a, recs[a].src);
      anodes.delete(n);
    };
    back(node);
    let n; while ((n = tw.nextNode())) back(n);
  }
  function apply() {
    if (!hasDom) return;
    document.documentElement.setAttribute('lang', lang);
    if (lang === 'en') {
      if (!mo) {
        mo = new MutationObserver((recs) => {
          for (const r of recs) {
            if (r.type === 'childList') r.addedNodes.forEach(walk);
            else if (r.type === 'characterData') doText(r.target);
            else if (r.target.nodeType === 1) doAttrs(r.target);
          }
        });
      }
      walk(document.documentElement);
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    } else {
      if (mo) { mo.disconnect(); restore(document.documentElement); }
    }
  }

  root.KHI18n = {
    LANGS: ['id', 'en'],
    get() { return lang; },
    set(l) {
      if (l !== 'id' && l !== 'en') return;
      lang = l;
      try { storage.setItem(LS, l); } catch (e) { /* berlaku sesi ini saja */ }
      apply();
      listeners.slice().forEach((fn) => { try { fn(l); } catch (e) { /* abaikan */ } });
    },
    /** Terjemahan satu kalimat bila English aktif; selain itu dikembalikan apa adanya. Untuk teks di luar layar (mis. notifikasi). */
    t(s) { return lang === 'en' ? tr(s) : s; },
    /** Selalu menerjemahkan ke English (dipakai tes). */
    toEnglish(s) { return tr(s); },
    onChange(fn) { listeners.push(fn); },
    _stats: { exact: exact.size, patterns: pats.length }
  };
  apply();
})(typeof self !== 'undefined' ? self : this);
