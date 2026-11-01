# Status Android v1.0.2

## Yang sudah disiapkan di proyek

- Aset aplikasi web ditempatkan di `app/src/main/assets/www`; tidak ada alamat PWA yang dipanggil saat startup.
- `WebViewAssetLoader` memakai origin lokal HTTPS `appassets.androidplatform.net` agar fitur web yang membutuhkan secure context dapat berjalan.
- Data aplikasi dan preferensi diarahkan ke tabel key/value dalam SQLCipher. Passphrase acak 256-bit disimpan hanya dalam bentuk terenkripsi dengan kunci AES Android Keystore.
- APK menggunakan applicationId terpisah dan penanda backup `apk`.
- Tampilan aplikasi dikemas sebagai aset lokal di WebView Android; halaman tidak diarahkan ke URL PWA/GitHub Pages. WebView localStorage dimatikan dan akses data dialihkan ke SQLCipher melalui bridge native.
- Biometrik menggunakan AndroidX BiometricPrompt; fallback PIN tetap disediakan.
- File import menggunakan `ACTION_OPEN_DOCUMENT`; file export/backup menggunakan `ACTION_CREATE_DOCUMENT`.
- Permission internet tidak dimasukkan ke manifest. Script workflow memeriksa permission hasil APK.

## Hal yang belum dibuktikan

1. APK belum dapat dikompilasi dalam sesi penyusunan ini karena tidak ada Android SDK, build-tools, Gradle, maupun koneksi untuk mengunduhnya. Workflow GitHub disediakan sebagai mesin build.
2. Belum ada pengujian UI otomatis pada Android WebView dari berbagai vendor/versi.
3. Pemindaian foto, PDF, XLSX, DOCX, dan backup perlu diuji di perangkat Android sebenarnya setelah build.
4. Pengingat tagihan yang terjadwal saat aplikasi tertutup (WorkManager) belum dibuat. Yang tersedia di layar Notifikasi adalah izin dan tes notifikasi native.
5. Pengujian wajib: instal bersih, buat PIN, kunci otomatis, biometrik, restart perangkat, cadangan salah/benar password, import file, ekspor PDF/Excel, OCR, dan mode pesawat.

## Catatan keamanan

- SQLCipher mengenkripsi database; PIN merupakan gerbang UI, sedangkan keystore melindungi passphrase database.
- Backup tetap menggunakan PBKDF2-SHA256 + AES-256-GCM dan hanya dapat dibuka oleh aplikasi asal yang sama (`apk` vs `pwa`).
- Data keuangan tidak dikirim ke server dari aplikasi. Tautan ke kontak/jejaring sosial hanya dibuka setelah pengguna mengetuk tautan; aplikasi Android sendiri tidak meminta permission internet.
- Penghapusan data aplikasi atau uninstall menghapus database dan kunci lokal. Cadangan manual adalah jalur pemindahan data.

## Perbaikan OCR v1.0.2 (scan struk/foto: "Network error while fetching ...ind.traineddata.gz ... 404")

**Gejala:** semua cara menyalakan mesin baca gagal dengan kode 404 pada `vendor/tessdata/*.traineddata.gz`, padahal berkas ada di proyek.
**Sebab:** `WebViewAssetLoader` membalas 404 bila `AssetManager.open()` gagal. Berkas `.gz` di assets tidak bisa dibuka di build tersebut, sementara `.js`/`.css`/`.png` dari folder yang sama berhasil.
Data modelnya sendiri sehat (diuji: `ind+eng`, OEM LSTM, confidence 94 pada contoh struk).

**Perbaikan (berlapis, satu sumber rusak tidak lagi mematikan OCR):**
1. `vendor/tessdata/<bahasa>.b64.js`: data yang sama dalam bentuk skrip, dimuat lewat `<script>` (jalur yang terbukti jalan). Dipakai mode "data bahasa dari memori" dan "mode kompatibilitas".
2. `TessdataServer.java`: permintaan `*.traineddata(.gz)` dilayani dengan urutan `.gz` -> tanpa `.gz` -> `.b64.js`, sehingga mode standar pun jalan.
3. `ocr.js`: urutan sumber skrip -> fetch -> jembatan native (`KHNativeStorage.readTessdata`); mode standar dilewati bila `.gz` tidak terbaca; pesan error memuat laporan isi APK (`tessdataReport`).
4. `scripts/check-web-assets.sh` memastikan `.gz` dan `.b64.js` ada dan identik. **Jika model bahasa diganti, buat ulang `.b64.js`** (base64 dari `.gz`, format `(self.KH_TESSDATA=self.KH_TESSDATA||{}).<bahasa>="<base64>";`).

**Pengujian yang sudah dilakukan di sandbox:** kompilasi Java terhadap android.jar, uji perilaku `TessdataServer` (4 skenario), uji alur `ocr.js` (4 skenario), serta OCR end-to-end dengan `worker.min.js` + core WASM asli pada kondisi `.gz` = 404, `.gz` normal, dan core `lowmem`.
**Belum teruji:** build APK dan jalan di perangkat Android sungguhan (tidak ada Android SDK di sandbox).
