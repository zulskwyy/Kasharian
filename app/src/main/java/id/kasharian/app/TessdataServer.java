package id.kasharian.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Menyajikan data bahasa OCR (Tesseract) untuk permintaan {@code .../vendor/tessdata/<bahasa>.traineddata[.gz]}.
 *
 * Latar belakang: {@code WebViewAssetLoader.AssetsPathHandler} membalas HTTP 404 bila {@code AssetManager.open()} gagal.
 * Pada sebagian build, berkas {@code *.traineddata.gz} di assets tidak bisa dibuka (404) padahal berkas .js/.css/.png
 * dari folder yang sama berhasil, sehingga OCR gagal dengan "Network error while fetching ... ind.traineddata.gz".
 * Kelas ini mencoba beberapa sumber secara berurutan sehingga satu sumber yang rusak tidak lagi mematikan OCR:
 *   1) assets/www/vendor/tessdata/&lt;bahasa&gt;.traineddata.gz   (sumber utama)
 *   2) assets/www/vendor/tessdata/&lt;bahasa&gt;.traineddata      (bila ekstensi .gz dibuang/didekompresi oleh proses build)
 *   3) assets/www/vendor/tessdata/&lt;bahasa&gt;.b64.js          (data yang sama dalam bentuk skrip; berkas .js terbukti bisa dimuat)
 * Seluruhnya hanya membaca dari APK; tidak ada akses jaringan.
 */
final class TessdataServer {
    private static final String TAG = "KHTessdata";
    static final String URL_PREFIX = "/assets/www/vendor/tessdata/";
    private static final String DIR = "www/vendor/tessdata";
    private static final Pattern URL_NAME = Pattern.compile("^([a-z_]{2,16})\\.traineddata(?:\\.gz)?$");
    private static final Pattern LANG = Pattern.compile("^[a-z_]{2,16}$");
    private static final int MIN_BYTES = 1000;
    private static final String[] REPORT_LANGS = {"eng", "ind"};

    private final AssetManager assets;

    TessdataServer(Context context) {
        this.assets = context.getApplicationContext().getAssets();
    }

    /** @return respons bila {@code uri} meminta data bahasa dan datanya ditemukan; selain itu null (biarkan pemuat aset biasa menangani). */
    WebResourceResponse handle(Uri uri) {
        if (uri == null) return null;
        String path = uri.getPath();
        if (path == null || !path.startsWith(URL_PREFIX)) return null;
        Matcher m = URL_NAME.matcher(path.substring(URL_PREFIX.length()));
        if (!m.matches()) return null;
        byte[] data = readLang(m.group(1));
        if (data == null) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, new ByteArrayInputStream(data));
    }

    /** Data bahasa mentah (gzip atau traineddata biasa), atau null bila tidak ada sumber yang bisa dibaca. */
    byte[] readLang(String lang) {
        if (lang == null || !LANG.matcher(lang).matches()) return null;
        byte[] data = readAsset(DIR + "/" + lang + ".traineddata.gz");
        if (data == null) data = readAsset(DIR + "/" + lang + ".traineddata");
        if (data == null) data = readBase64Script(DIR + "/" + lang + ".b64.js");
        if (data == null) Log.e(TAG, "Data bahasa '" + lang + "' tidak ditemukan di APK");
        return data;
    }

    /** Untuk jembatan JavaScript: data bahasa dalam base64 tanpa pemisah baris, atau null. */
    String readBase64(String lang) {
        byte[] data = readLang(lang);
        return data == null ? null : Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private byte[] readAsset(String path) {
        try (InputStream in = assets.open(path, AssetManager.ACCESS_STREAMING)) {
            byte[] bytes = readAll(in);
            if (bytes.length >= MIN_BYTES) return bytes;
            Log.w(TAG, path + " terlalu kecil (" + bytes.length + " byte)");
        } catch (Exception e) {
            Log.w(TAG, "Tidak bisa membuka " + path + ": " + e);
        }
        return null;
    }

    /** Membaca skrip berformat {@code (self.KH_TESSDATA=self.KH_TESSDATA||{}).<bahasa>="<base64>";} dan mengembalikan byte hasil dekode. */
    private byte[] readBase64Script(String path) {
        try (InputStream in = assets.open(path, AssetManager.ACCESS_STREAMING)) {
            String text = new String(readAll(in), StandardCharsets.ISO_8859_1);
            int marker = text.indexOf("||{})");
            int start = text.indexOf("=\"", Math.max(0, marker));
            int end = text.lastIndexOf('"');
            if (start < 0 || end <= start + 2) return null;
            byte[] bytes = Base64.decode(text.substring(start + 2, end), Base64.DEFAULT);
            if (bytes.length >= MIN_BYTES) return bytes;
        } catch (Exception e) {
            Log.w(TAG, "Tidak bisa membaca skrip " + path + ": " + e);
        }
        return null;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(256 * 1024);
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private boolean exists(String path) {
        try (InputStream in = assets.open(path, AssetManager.ACCESS_STREAMING)) {
            return in.read() != -1;
        } catch (Exception e) {
            return false;
        }
    }

    /** Ringkasan isi APK untuk pesan error, agar penyebab bisa langsung dibaca dari layar tanpa komputer. */
    String report() {
        StringBuilder sb = new StringBuilder();
        try {
            String[] names = assets.list(DIR);
            sb.append("folder=").append(names == null || names.length == 0 ? "KOSONG" : Arrays.toString(names));
        } catch (Exception e) {
            sb.append("folder=error");
        }
        for (String lang : REPORT_LANGS) {
            sb.append(' ').append(lang).append('[')
                    .append("gz=").append(exists(DIR + "/" + lang + ".traineddata.gz") ? "ada" : "tidak")
                    .append(",js=").append(exists(DIR + "/" + lang + ".b64.js") ? "ada" : "tidak")
                    .append(']');
        }
        return sb.toString();
    }
}
