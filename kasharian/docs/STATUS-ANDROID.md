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
- Jalur OCR Android tidak mengambil data bahasa melalui URL `appassets` dari Web Worker. Data `ind`/`eng`, `worker.min.js`, dan core WASM dibaca langsung dari aset APK melalui bridge native dengan daftar aset yang diizinkan.

## Hal yang belum dibuktikan

1. APK belum dapat dikompilasi dalam sesi penyusunan ini karena tidak ada Android SDK, build-tools, Gradle, maupun koneksi untuk mengunduhnya. Workflow GitHub disediakan sebagai mesin build.
2. Belum ada pengujian UI otomatis pada Android WebView dari berbagai vendor/versi.
3. Pemindaian foto, PDF, XLSX, DOCX, dan backup perlu diuji di perangkat Android sebenarnya setelah build. Khusus OCR Android v1.0.2, verifikasi bahwa bridge native melaporkan aset lengkap dan uji foto kamera serta gambar galeri dalam mode pesawat.
4. Pengingat tagihan yang terjadwal saat aplikasi tertutup (WorkManager) belum dibuat. Yang tersedia di layar Notifikasi adalah izin dan tes notifikasi native.
5. Pengujian wajib: instal bersih, buat PIN, kunci otomatis, biometrik, restart perangkat, cadangan salah/benar password, import file, ekspor PDF/Excel, OCR, dan mode pesawat.

## Catatan keamanan

- SQLCipher mengenkripsi database; PIN merupakan gerbang UI, sedangkan keystore melindungi passphrase database.
- Backup tetap menggunakan PBKDF2-SHA256 + AES-256-GCM dan hanya dapat dibuka oleh aplikasi asal yang sama (`apk` vs `pwa`).
- Data keuangan tidak dikirim ke server dari aplikasi. Tautan ke kontak/jejaring sosial hanya dibuka setelah pengguna mengetuk tautan; aplikasi Android sendiri tidak meminta permission internet.
- Penghapusan data aplikasi atau uninstall menghapus database dan kunci lokal. Cadangan manual adalah jalur pemindahan data.
