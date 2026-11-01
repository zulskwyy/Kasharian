# KasHarian Android — paket build GitHub

Paket ini mengambil UI dan logika KasHarian v1.0.2 dari PWA yang Anda kirim, lalu menyediakannya sebagai aset lokal di dalam aplikasi Android melalui WebView lokal (bukan membuka URL website). APK **tidak membuka alamat GitHub Pages** dan tidak memakai TWA. Penyimpanan transaksi dialihkan ke SQLCipher native, terpisah dari `localStorage` PWA. Identitas paket Android adalah `id.kasharian.app`, terpisah dari ID PWA `kasharian-pwa`.

## Fitur yang disambungkan untuk APK

- UI KasHarian, pengelolaan dompet/transaksi/rencana/tagihan, bahasa Indonesia/Inggris, grafik, dan pemindai dokumen berjalan dari aset lokal.
- OCR dan pembaca PDF memakai file Tesseract/PDF.js yang ikut di dalam APK. Mesin OCR Android membaca model bahasa, worker, dan inti WebAssembly langsung dari `AssetManager` melalui bridge native; tidak memakai fetch WebView worker ke URL `appassets` dan tidak membutuhkan jaringan.
- Data key/value aplikasi diarahkan ke basis data **SQLCipher**. Kunci acak 256-bit dibungkus oleh kunci AES di Android Keystore.
- PIN dan 12 kata pemulihan tetap dijalankan oleh logika KasHarian. Verifikasi biometrik Android menggunakan `BiometricPrompt`.
- Pilih file dan simpan cadangan/ekspor melalui pemilih file Android (Storage Access Framework), tanpa izin penyimpanan umum.
- Berkas cadangan APK diberi penanda `apk`; cadangan PWA tetap `pwa` dan tidak bisa saling dipulihkan.
- Manifest tidak meminta `INTERNET` atau `ACCESS_NETWORK_STATE`. Tautan kontak hanya dibuka di aplikasi luar setelah diketuk.

## Cara mendapatkan APK tanpa Android Studio

1. Buat repository GitHub baru, disarankan bernama `kasharian-android` agar proyek pembangun APK terpisah dari repository website.
2. Ekstrak ZIP proyek ini, lalu unggah **seluruh isi folder hasil ekstrak** ke akar repository, termasuk folder tersembunyi `.github`. Jangan unggah file keystore, Base64, atau kredensial.
3. Buka `Settings → Secrets and variables → Actions → New repository secret`.
4. Tambahkan empat secret berikut sesuai petunjuk `docs/GITHUB_SECRETS.md`:
   - `KASHARIAN_KEYSTORE_BASE64`
   - `KASHARIAN_KEYSTORE_PASSWORD`
   - `KASHARIAN_KEY_ALIAS`
   - `KASHARIAN_KEY_PASSWORD`
5. Buka tab `Actions`, pilih workflow `Build KasHarian APK`, lalu jalankan `Run workflow` (atau push ke branch `main`).
6. Setelah status workflow hijau, buka hasil run dan unduh artifact `KasHarian-v1.0.2-release`. Di dalam artifact ada `KasHarian-v1.0.2-release.apk`.
7. Untuk membuat halaman GitHub Release yang langsung menampilkan APK, buat dan push tag `v1.0.2`. Workflow akan melampirkan APK pada Release tersebut.

Build memakai GitHub-hosted runner. Anda tidak perlu memasang Android Studio, Android SDK, atau Gradle di HP/komputer Anda. Setelah build berhasil, workflow membuat file `KasHarian-v1.0.2-release.apk`; bila pemicu berupa tag `v1.0.2`, file itu juga dilampirkan ke GitHub Release.

## Kunci penandatanganan

Kunci rilis RSA 4096-bit dibuat untuk proyek ini. Gunakan file kunci yang diberikan terpisah, jangan masukkan file `.jks` atau password ke repository. Simpan salinan offline di tempat aman. Semua update APK harus ditandatangani dengan kunci yang sama agar bisa memasang pembaruan di atas instalasi sebelumnya.

## Versi dan identitas

- `applicationId`: `id.kasharian.app`
- `versionCode`: `102`
- `versionName`: `1.0.2`
- `minSdk`: 26 (Android 8.0)
- `targetSdk` / `compileSdk`: 36

Untuk rilis berikutnya, naikkan `versionCode` dan `versionName` di `app/build.gradle.kts`.

## Catatan sebelum dibagikan ke pengguna lain

Paket ini adalah build Android pertama yang disusun dari source web yang tersedia; bukan hasil kompilasi atau uji perangkat pada sesi ini. Lingkungan pengerjaan tidak menyediakan Android SDK/Gradle dan tidak dapat mengunduh toolchain. Kompilasi APK dilakukan di GitHub Actions ketika repository sudah diunggah. Setelah APK berhasil dibangun, uji di HP sungguhan: buat PIN, tutup dan buka ulang aplikasi, tes biometrik, impor/ekspor cadangan, pemindai struk, PDF, dan mode pesawat.

Layar notifikasi menyediakan permintaan izin dan tombol tes notifikasi Android. Penjadwalan pengingat tagihan otomatis saat aplikasi tertutup belum ditambahkan sebagai pekerjaan WorkManager; jangan mengiklankan notifikasi jatuh tempo terjadwal sampai bagian itu dibuat dan diuji.

Detail implementasi dan hal yang belum diverifikasi ada di `docs/STATUS-ANDROID.md`.
