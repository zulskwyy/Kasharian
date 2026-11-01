#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/app/src/main/assets/www"
[ -f "$WWW/index.html" ] || { echo "Asset index.html tidak ditemukan" >&2; exit 1; }
[ -f "$WWW/vendor/tesseract/tesseract.min.js" ] || { echo "Tesseract tidak ditemukan" >&2; exit 1; }
[ -f "$WWW/vendor/pdfjs/pdf.min.js" ] || { echo "PDF.js tidak ditemukan" >&2; exit 1; }
for asset in \
  "$WWW/vendor/tessdata/eng.traineddata.gz" \
  "$WWW/vendor/tessdata/ind.traineddata.gz" \
  "$WWW/vendor/tesseract/worker.min.js" \
  "$WWW/vendor/tesseract/tesseract-core-simd-lstm.wasm.js" \
  "$WWW/vendor/tesseract/tesseract-core-lstm-lowmem.wasm.js"; do
  [ -s "$asset" ] || { echo "Aset OCR Android tidak ditemukan: $asset" >&2; exit 1; }
done
[ -f "$WWW/js/android-bridge.js" ] || { echo "Android bridge tidak ditemukan" >&2; exit 1; }
MAIN="$ROOT/app/src/main/java/id/kasharian/app/MainActivity.java"
[ -f "$MAIN" ] || { echo "MainActivity Android tidak ditemukan" >&2; exit 1; }
grep -q 'readOcrAssetBase64' "$MAIN" || { echo "Native OCR asset bridge tidak ditemukan" >&2; exit 1; }
grep -q 'hasOcrAssets' "$MAIN" || { echo "Pemeriksaan kelengkapan aset OCR native tidak ditemukan" >&2; exit 1; }
grep -q 'startNativeEngine' "$WWW/js/ocr.js" || { echo "Jalur OCR native tidak ditemukan" >&2; exit 1; }
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done < <(find "$WWW/js" -type f -name '*.js' -print0)
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
# Ensure the app contains the complete local OCR/PDF runtime.
find "$WWW/vendor" -type f -size +10k | grep -q .
echo "Asset check lulus."
