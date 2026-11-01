/* KasHarian backup: cadangan terenkripsi dengan kata sandi. Tanpa server, tanpa izin penyimpanan: berkas disimpan lewat
   unduhan peramban dan dibuka lewat pemilih berkas. Format JSON: kunci diturunkan dengan PBKDF2-SHA256, isi dikunci AES-256-GCM.
   Salah kata sandi atau berkas diubah orang lain akan ditolak oleh autentikasi GCM. */
(function (root, factory) {
  const m = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.KHBackup = m;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const FORMAT = 'kasharian-backup', VERSION = 1, ITER = 250000, MIN_PASSWORD = 8;
  /** Versi web (PWA) dan aplikasi Android adalah dua produk terpisah dengan data terpisah. Cadangan ditandai asalnya dan tidak saling terbuka. */
  const CHANNEL = root.KHNativeStorage ? 'apk' : 'pwa', CHANNEL_NAME = { pwa: 'aplikasi ini', apk: 'aplikasi Android' };
  const getCrypto = () => (root.crypto && root.crypto.subtle ? root.crypto : require('node:crypto').webcrypto);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return (root.btoa || ((x) => Buffer.from(x, 'binary').toString('base64')))(s); };
  const unb64 = (s) => { const bin = (root.atob || ((x) => Buffer.from(x, 'base64').toString('binary')))(s); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
  /** Data perangkat (PIN, sidik jari, hitungan salah PIN) tidak ikut dicadangkan. */
  const DEVICE_KEYS = ['pin', 'bio', 'failed', 'recovery'];
  const snapshot = (db) => { const copy = JSON.parse(JSON.stringify(db)); DEVICE_KEYS.forEach((k) => { delete copy[k]; }); return copy; };

  async function deriveKey(password, salt, iter) {
    const c = getCrypto(), base = await c.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  /** -> string JSON siap disimpan sebagai berkas. */
  async function encrypt(db, password, meta) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`Kata sandi minimal ${MIN_PASSWORD} karakter.`);
    const c = getCrypto(), salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const plain = enc.encode(JSON.stringify({ app: 'KasHarian', channel: (meta && meta.channel) || CHANNEL, exportedAt: Date.now(), meta: meta || null, data: snapshot(db) }));
    const cipher = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return JSON.stringify({ format: FORMAT, v: VERSION, kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(cipher) });
  }
  /** -> { exportedAt, meta, data } atau melempar Error berbahasa Indonesia. */
  async function decrypt(text, password, opts) {
    let box; try { box = JSON.parse(text); } catch (e) { throw new Error('Berkas ini bukan cadangan KasHarian.'); }
    if (!box || box.format !== FORMAT || !box.kdf || !box.cipher || !box.data) throw new Error('Berkas ini bukan cadangan KasHarian.');
    if (box.v > VERSION) throw new Error('Cadangan dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi dulu.');
    let plain;
    try {
      const key = await deriveKey(String(password || ''), unb64(box.kdf.salt), Math.min(Math.max(+box.kdf.iter || ITER, 100000), 2000000));
      plain = await getCrypto().subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.cipher.iv) }, key, unb64(box.data));
    } catch (e) { throw new Error('Kata sandi salah, atau berkas rusak.'); }
    let out; try { out = JSON.parse(dec.decode(plain)); } catch (e) { throw new Error('Isi cadangan tidak terbaca.'); }
    const d = out && out.data;
    if (!d || !Array.isArray(d.wallets) || !Array.isArray(d.activities)) throw new Error('Isi cadangan tidak lengkap.');
    const want = (opts && opts.channel) || CHANNEL, have = out.channel || CHANNEL;     // cadangan lama tanpa penanda berasal dari versi web
    if (have !== want) throw new Error(`Cadangan ini berasal dari ${CHANNEL_NAME[have] || have} dan tidak bisa dipakai di ${CHANNEL_NAME[want] || want}. Data keduanya sengaja dipisah.`);
    DEVICE_KEYS.forEach((k) => { delete d[k]; });
    return out;
  }
  const fileName = (d) => `KasHarian-cadangan-${d || new Date().toISOString().slice(0, 10)}.khbak`;
  return { encrypt, decrypt, snapshot, fileName, MIN_PASSWORD, DEVICE_KEYS, FORMAT, CHANNEL };
});
