# Menyiapkan GitHub Actions secrets

GitHub Actions menandatangani build release menggunakan kunci yang disimpan sebagai repository secret. Jangan commit `.jks`, password, maupun file base64 ke repository.

## Empat secret

Tambahkan melalui `Settings → Secrets and variables → Actions → New repository secret`:

| Nama secret | Isi |
|---|---|
| `KASHARIAN_KEYSTORE_BASE64` | Seluruh teks Base64 dari file `KASHARIAN_KEYSTORE_BASE64.txt` yang diberikan terpisah. Tempel tanpa spasi tambahan/baris kosong. |
| `KASHARIAN_KEYSTORE_PASSWORD` | Password penyimpanan keystore dari `KASHARIAN_KEY_CREDENTIALS.txt`. |
| `KASHARIAN_KEY_ALIAS` | Alias dari file kredensial. |
| `KASHARIAN_KEY_PASSWORD` | Password kunci dari file kredensial. |

Password penyimpanan dan password kunci saat ini dibuat sama; masukkan nilai yang sama untuk kedua secret password.

Kunci yang disediakan adalah RSA 4096-bit, alias `kasharian_release`.

## Menjaga kunci

- Jangan pernah mengunggah `kasharian-release.jks`, file kredensial, atau teks Base64 ke repository, Issues, atau diskusi publik.
- Simpan file `.jks` dan password di dua tempat aman yang Anda kendalikan.
- Kehilangan kunci berarti APK yang sudah terpasang tidak dapat diperbarui menggunakan tanda tangan yang sama; pengguna perlu memasang ulang sebagai aplikasi baru setelah mengganti identitas/penandatanganan.
- Jangan mengganti kunci setelah rilis pertama.
