#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/app/src/main/assets/www"
[ -f "$WWW/index.html" ] || { echo "Asset index.html tidak ditemukan" >&2; exit 1; }
[ -f "$WWW/vendor/tesseract/tesseract.min.js" ] || { echo "Tesseract tidak ditemukan" >&2; exit 1; }
[ -f "$WWW/vendor/pdfjs/pdf.min.js" ] || { echo "PDF.js tidak ditemukan" >&2; exit 1; }
[ -f "$WWW/js/android-bridge.js" ] || { echo "Android bridge tidak ditemukan" >&2; exit 1; }
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done < <(find "$WWW/js" -type f -name '*.js' -print0)
node "$ROOT/scripts/ledger-regression.test.js"
node - <<'NODE' "$WWW/js/backup.js"
(async () => {
  const file = process.argv[2];
  const pwa = require(file);
  if (pwa.CHANNEL !== 'pwa') throw new Error('Build browser harus memakai kanal cadangan PWA.');

  global.self = { KHNativeStorage: {} };
  delete require.cache[require.resolve(file)];
  const apk = require(file);
  if (apk.CHANNEL !== 'apk') throw new Error('Build Android harus memakai kanal cadangan APK.');

  const sample = { wallets: [], activities: [], bills: [], profile: null };
  const encrypted = await apk.encrypt(sample, 'kata-sandi-uji-123');
  await apk.decrypt(encrypted, 'kata-sandi-uji-123', { channel: 'apk' });
  let rejected = false;
  try { await apk.decrypt(encrypted, 'kata-sandi-uji-123', { channel: 'pwa' }); }
  catch (e) { rejected = /berasal dari aplikasi Android/.test(e.message); }
  if (!rejected) throw new Error('Cadangan APK harus ditolak oleh kanal PWA.');
  console.log('JavaScript assets OK; PWA/APK backup channels are isolated and authenticated.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
NODE
# Data bahasa OCR: berkas .gz (dipakai mode standar) dan salinan .b64.js (jalur cadangan yang terbukti bisa dimuat WebView) harus ada dan identik.
for L in eng ind; do
  [ -s "$WWW/vendor/tessdata/$L.traineddata.gz" ] || { echo "Data bahasa $L.traineddata.gz tidak ada" >&2; exit 1; }
  [ -s "$WWW/vendor/tessdata/$L.b64.js" ] || { echo "Data bahasa $L.b64.js tidak ada" >&2; exit 1; }
done
node - <<'NODE' "$WWW/vendor/tessdata"
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = process.argv[2];
global.self = global;
for (const l of ['eng', 'ind']) {
  const gz = fs.readFileSync(path.join(dir, l + '.traineddata.gz'));
  zlib.gunzipSync(gz); // harus gzip yang valid
  delete global.KH_TESSDATA;
  require(path.join(dir, l + '.b64.js'));
  const copy = Buffer.from(global.KH_TESSDATA[l], 'base64');
  if (!copy.equals(gz)) throw new Error('Salinan ' + l + '.b64.js tidak identik dengan ' + l + '.traineddata.gz. Buat ulang salinannya.');
}
console.log('Data bahasa OCR OK (.gz dan .b64.js identik).');
NODE
# Ensure the app contains the complete local OCR/PDF runtime.
find "$WWW/vendor" -type f -size +10k | grep -q .
echo "Asset check lulus."
