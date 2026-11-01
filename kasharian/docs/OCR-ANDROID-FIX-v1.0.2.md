# Perbaikan OCR Android — KasHarian 1.0.2

## Gejala yang dilaporkan

Di Android WebView 156, proses scan gagal dengan 404 saat mengambil:

- `vendor/tessdata/ind.traineddata.gz`
- `vendor/tessdata/eng.traineddata.gz`

UI juga menampilkan fallback `data bahasa dari memori` dan `mode kompatibilitas`, tetapi keduanya mengulang pembacaan model melalui URL `appassets.androidplatform.net` sehingga gagal dengan cara yang sama.

## Temuan pada source ZIP

Kedua model bahasa sebenarnya ada di `app/src/main/assets/www/vendor/tessdata/`. Worker dan kedua core Tesseract juga ikut di dalam ZIP. Jadi, pesan 404 tidak disebabkan oleh pengguna memilih gambar yang salah dan tidak berarti model bahasa tidak ada di source project.

Implementasi sebelumnya membuat Tesseract Worker mengambil model bahasa lewat `fetch()` pada URL WebView AssetLoader. Pada perangkat yang dilaporkan, request dari jalur worker tersebut mendapat 404. Fallback memori juga terlebih dahulu melakukan fetch dari halaman ke URL yang sama, sehingga bukan fallback yang independen.

## Perubahan implementasi

1. Tambah `NativeBridge.hasOcrAssets()` untuk memeriksa langsung keberadaan seluruh model, worker dan core OCR di Android `AssetManager`.
2. Tambah `NativeBridge.readOcrAssetBase64(name)` dengan allow-list nama file yang ketat. Java hanya membaca lima aset OCR yang dibutuhkan; path bebas tidak diterima.
3. Tambah `startNativeEngine()` pada `ocr.js`. Jika bridge native terdeteksi, JavaScript membaca model Indonesia, model Inggris, worker, dan core langsung dari APK, lalu menyusun worker Blob lokal memakai pola embed yang sudah dipakai versi single-file.
4. Shim `fetch` di dalam worker menyajikan `ind.traineddata.gz` dan `eng.traineddata.gz` dari memori. Worker tidak perlu meminta data bahasa dari `appassets` atau jaringan.
5. Memilih core SIMD jika didukung; jika tidak, menggunakan core LSTM low-memory. Dengan demikian, jalur native tidak ditolak hanya karena SIMD tidak tersedia.
6. Self-test OCR melaporkan keberadaan bridge dan kelengkapan aset native serta memperhitungkan jalur low-memory.
7. Memperkuat pemeriksaan CI agar file model, core, worker, dan jembatan native wajib hadir sebelum APK dibangun.

Jalur PWA/browser tetap menggunakan mekanisme fetch lamanya; perubahan native hanya aktif bila `KHNativeStorage.readOcrAssetBase64` tersedia.

## Pemeriksaan yang dilakukan pada source

- Semua JavaScript assets lulus `node --check` melalui `scripts/check-web-assets.sh`.
- File model `eng` dan `ind`, worker, kedua core, MainActivity bridge dan pemanggilan bridge terdeteksi oleh cross-check source.
- Jalur Android native menggunakan core dan model dari APK dan tidak membutuhkan permission INTERNET.

## Batas verifikasi

APK belum dikompilasi atau diuji di perangkat Android pada sesi ini karena Android SDK, Gradle dan toolchain build tidak tersedia. Build release dilakukan oleh GitHub Actions pada repository pengguna. Setelah APK 1.0.2 terbangun, tes perangkat wajib dilakukan untuk foto kamera, JPG/PNG galeri, screenshot struk, PDF scan, dan mode pesawat. Ini memverifikasi perilaku Android WebView riil, bukan hanya kelengkapan source.
