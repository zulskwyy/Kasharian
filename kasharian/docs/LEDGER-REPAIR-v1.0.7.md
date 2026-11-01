# Perbaikan buku besar, Catat, OCR, dan Planning v1.0.7

## Perilaku transaksi

- Arah saldo ditentukan oleh jenis transaksi yang dinormalisasi, bukan tanda nominal: `INCOME` menambah saldo, `EXPENSE` mengurangi saldo, `TRANSFER` memindahkan antar-dompet tanpa mengubah total gabungan, dan `ADJUSTMENT` mempertahankan tanda.
- Nominal lama berbentuk angka, teks rupiah Indonesia (`Rp 25.000`), pengelompokan ribuan, dan nilai negatif lama dinormalisasi dengan `ledgerAmountValue` sebelum dihitung.
- `store.js` memperbaiki tipe dan nominal aktivitas lama saat database dimuat, lalu menyimpan hasil migrasi jika berubah.
- Saldo awal dompet juga melewati parser yang sama; data lama yang menyimpan saldo awal sebagai teks rupiah tidak jatuh menjadi `NaN`/nol.
- Beranda, saldo dompet, ringkasan, E-Statement, grafik, Rapikan Data, analisis kebiasaan, pencocokan mutasi, dan Planning menggunakan normalisasi/nominal ledger yang sama.

## OCR

- Hasil OCR struk langsung mengisi draft transaksi, termasuk satu nominal pilihan terbaik dari proses penilaian OCR. Daftar kandidat lain tetap dipakai internal untuk menentukan confidence, bukan ditampilkan sebagai pilihan nominal kepada pengguna.
- Draft struk tetap dapat diperiksa dan dikoreksi sebelum tombol Simpan; OCR tidak langsung menulis transaksi ke buku besar tanpa tindakan pengguna.
- Slip gaji dengan klasifikasi baris ambigu sekarang memilih hasil terbaik otomatis berdasarkan kecocokan total bersih, tebakan kamus/kolom, dan kosakata payroll Indonesia. Hasil tetap dapat diperiksa dan diedit pada layar review.
- Slip gaji yang disimpan dicatat sebagai `INCOME`; struk yang disimpan melalui Catat dicatat sebagai `EXPENSE`.

## Catat dan penyimpanan

- Jalur tambah transaksi menormalisasi jenis dan nominal sebelum validasi saldo, validasi Planning, dan penyimpanan.
- Pengeluaran disimpan dengan nominal positif bertipe `EXPENSE`; mesin saldo menguranginya. Pemasukan bertipe `INCOME` dan menambah saldo. Transfer mengurangi dompet asal dan menambah dompet tujuan dengan jumlah sama.
- Kegagalan penulisan native storage tidak boleh ditampilkan sebagai sukses. Jalur Catat dan slip memeriksa hasil `save()`; Catat mengembalikan perubahan in-memory bila penyimpanan gagal.

## Pengujian

Jalankan `bash scripts/check-web-assets.sh`. Suite `scripts/ledger-regression.test.js` menguji pengeluaran/pemasukan langsung melalui fungsi produksi `KHApp.addActivity`, nominal rupiah string, saldo awal lama, transfer netral, E-Statement/Rapikan Data, migrasi store, parser kalimat Catat (`mkn siang 25rb`, `gaji masuk 5jt`), klasifikasi otomatis slip ambigu, dan alokasi Planning.

APK belum dibuat dari lingkungan pengerjaan ini karena Android SDK/Gradle tidak tersedia di runner; build release dilakukan melalui workflow GitHub Actions yang ada.
