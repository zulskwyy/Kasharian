# Perbaikan v1.0.9: screenshot riwayat panjang (GoPay)

Diuji dengan OCR sungguhan (Tesseract bawaan aplikasi, Chromium headless) pada tangkapan layar riwayat GoPay yang dilaporkan.

## Yang salah (terbukti dari hasil OCR)
1. **Transaksi "Gagal" ikut menjadi pengeluaran** (4x PLN Pascabayar Rp214.849). Parser tidak membaca status.
2. **Nominal salah**: OCR membaca `-Rp1.150.000` sebagai `-Rp1150.000`, parser menghitung Rp1.150.
3. **Ikon di kiri ikut jadi nama transaksi** ("a PDAM...", "3, PT Tokopedia", "Li Planet Ban...").
4. **Transfer ke rekening sendiri tercatat sebagai pengeluaran** (Ditransfer ke Zulfiarudin Trian Masada, BNI): Rp2.000.000 + Rp1.150.000 mengurangi total saldo padahal uangnya hanya pindah. Inilah yang membuat saldo di aplikasi jauh di bawah saldo asli, dan limit planning (termasuk planning 4 kategori) ikut terpotong.
5. **Simpan impor bisa gagal diam-diam**: pengecekan saldo mengabaikan pindah dana masuk (mis. Top Up Rp4.000.000), hasil simpan tidak diperiksa, dan pesan error hanya toast sekilas.
6. Pembanding "Total pengeluaran" membandingkan total semua bulan dengan ringkasan satu bulan sehingga selalu tampak beda.

## Perbaikan
- `scan.js`: status Gagal/Batal/Ditolak/Kedaluwarsa/Menunggu/Diproses (termasuk OCR rusak seperti "agal") dilewati dan dilaporkan; nominal memakai semua digit setelah Rp; ikon dibuang berdasarkan kolom teks; ringkasan Pengeluaran/Pemasukan dicatat per bulan ("RpO" dibaca Rp0).
- `extra.js`: transfer ke nama sendiri (nama profil) otomatis Pindah dana, lebih dulu dari Kamus lama; pasangan dompet dipilih otomatis bila hanya ada satu dompet lain; urutan tulis: dana masuk, dana keluar, lalu belanja; bila saldo dompet tujuan kurang karena saldo awal belum dicatat, ditawarkan penyesuaian saldo awal (bukan pemasukan); data difoto sebelum menulis dan dikembalikan bila gagal; hasil `S.save()` diperiksa; penjaga arah saldo; kegagalan tampil sebagai pop-up; pembanding per bulan.
- `app.js`: proyeksi saldo batch ikut menghitung pindah dana; pesan "Saldo dompet tidak cukup" menampilkan saldo dompet lain.
- Versi 1.0.9 (versionCode 109), BUILD service worker baru.

## Pengujian
`bash scripts/check-web-assets.sh` kini juga menjalankan `scripts/history-ocr-regression.test.js` dengan fixture OCR asli (`scripts/fixtures`).
Data yang sudah tersimpan dari versi lama tidak diperbaiki otomatis: ubah catatan transfer ke rekening sendiri menjadi Pindah dana (atau hapus lalu impor ulang).
