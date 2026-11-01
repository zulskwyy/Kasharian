/* KasHarian web: local storage and PIN hashing. Data stays in this browser. */
(function (root) {
  'use strict';
  const storage = root.KHNativeStorage || root.localStorage;
  const KEY = 'kh_web_db_v1';
  const empty = () => ({
    v: 3, profile: null, pin: null, bio: null, onboarded: false,
    settings: { autolockMin: 1 }, wallets: [], activities: [], bills: [], slips: [], memory: [], failed: { n: 0, until: 0 }
  });
  let db = load();
  function load() {
    try {
      const raw = storage.getItem(KEY); if (!raw) return empty();
      const loaded = Object.assign(empty(), JSON.parse(raw));
      delete loaded.recovery; delete loaded.recFailed; loaded.v = 3;

      // One canonical ledger format is used at load, calculation, and write time.
      // This also repairs older Android records where rupiah was stored as text.
      let migrated = false;
      if (!Array.isArray(loaded.activities)) loaded.activities = [];
      loaded.activities.forEach((a) => {
        if (!a || typeof a !== 'object') return;
        const normalized = root.KHRules && typeof root.KHRules.normalizeActivity === 'function'
          ? root.KHRules.normalizeActivity(a) : a;
        if (!normalized) return;
        if (normalized.type !== a.type || normalized.amount !== a.amount) {
          Object.assign(a, { type: normalized.type, amount: normalized.amount });
          migrated = true;
        }
      });
      // Kamus saya: buang entri rusak (kata kosong/terlalu pendek, jenis tidak sah) yang bisa membalik arah transaksi.
      if (root.KHRules && typeof root.KHRules.cleanMemory === 'function') {
        const before = Array.isArray(loaded.memory) ? loaded.memory : [];
        const cleaned = root.KHRules.cleanMemory(before);
        if (cleaned.length !== before.length || cleaned.some((m, i) => m.kind !== before[i].kind || m.term !== before[i].term)) { loaded.memory = cleaned; migrated = true; }
      }
      try { if (migrated) storage.setItem(KEY, JSON.stringify(loaded)); } catch (e) { /* keep the in-memory migration */ }
      return loaded;
    } catch (e) { return empty(); }
  }
  // Bridge Android mengembalikan false bila penulisan gagal (tanpa melempar error); jangan dilaporkan sebagai sukses.
  function save() { try { return storage.setItem(KEY, JSON.stringify(db)) !== false; } catch (e) { return false; } }
  function reset() { try { storage.removeItem(KEY); } catch (e) { /* ignore */ } db = empty(); }
  const uid = () => (root.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  const enc = new TextEncoder();
  const subtle = root.crypto && crypto.subtle;
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; a.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const randomBytes = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  const newSalt = () => b64(randomBytes(16));

  async function hashSecret(secret, saltB64) {
    if (!subtle) { // very weak fallback (non-secure context); only so the test version still runs
      let h = 2166136261; const s = saltB64 + ':' + secret;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return 'f' + (h >>> 0).toString(16);
    }
    const key = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 120000 }, key, 256);
    return b64(bits);
  }

  root.KHStore = {
    get db() { return db; }, save, reset, uid, newSalt, hashSecret, b64, unb64, randomBytes
  };
})(typeof self !== 'undefined' ? self : this);
