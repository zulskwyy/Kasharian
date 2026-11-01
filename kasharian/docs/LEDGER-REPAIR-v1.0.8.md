# Perbaikan v1.0.8: pengeluaran Catat menambah saldo, OCR tidak tercatat

## Penyebab yang ditemukan
1. **Kamus saya membalik arah transaksi.** Pencocokan kata memakai potongan teks tanpa batas kata dan tanpa memeriksa isi. Entri kosong, kata sangat pendek ("a"), atau jenis tidak sah (mis. `masuk`) cocok ke hampir semua kalimat, sehingga `mkn siang 25rb` menjadi pemasukan (saldo bertambah).
2. **Kegagalan simpan Android dianggap sukses.** `NativeBridge.setItem` mengembalikan `false` bila gagal, tetapi `KHStore.save()` mengabaikannya dan selalu `true`. Catatan terlihat masuk di layar tetapi tidak tersimpan permanen.
3. **OCR struk memakai Kamus yang sama** (cocok potongan teks, tanpa memeriksa jenis/kategori), sehingga kategori bisa dipaksa ke kategori pemasukan dan draf tertahan.

## Perbaikan
- `rules.js`: Kamus hanya berlaku bila kata >= 3 huruf, cocok per kata utuh, dan jenisnya sah; Kamus Masuk diabaikan untuk kalimat pengeluaran yang jelas (beli, makan, bayar, ...). Tambahan: `cleanMemory`, `findLearned`, `memoryKind`.
- `store.js`: Kamus rusak dibersihkan otomatis saat database dimuat; `save()` kini `false` bila bridge mengembalikan `false`.
- `extra.js`: OCR struk hanya memakai Kamus berjenis Keluar dengan kategori pengeluaran sah.
- `app.js` (Catat): kata terlalu pendek/jenis tidak sah tidak lagi diingat; kategori OCR di luar daftar pengeluaran menjadi "Belum pasti"; kartu pratinjau menampilkan penjelasan arah ("saldo akan BERKURANG/BERTAMBAH"); penjaga akhir membatalkan penyimpanan bila perubahan total saldo tidak sesuai jenis transaksi.
- Versi 1.0.8 (versionCode 108) dan BUILD service worker diganti agar cache lama tidak dipakai.

## Pengujian
`bash scripts/check-web-assets.sh` kini mencakup: Kamus rusak, pembersihan Kamus saat muat, `save()` saat bridge gagal, dan alur penuh Catat + OCR dengan Planning nyata (saldo 5.309.932, lalu keluar 25.000 dua kali -> 5.259.932).
