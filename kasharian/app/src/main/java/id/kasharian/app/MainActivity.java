package id.kasharian.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.webkit.WebViewAssetLoader;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/**
 * KasHarian Android shell.
 * The full UI is bundled locally as assets; it never loads the PWA website.
 * Financial key/value data is stored in SQLCipher using a random key wrapped by Android Keystore.
 */
public final class MainActivity extends FragmentActivity {
    private static final int REQ_OPEN_FILE = 4101;
    private static final int REQ_CREATE_FILE = 4102;
    private static final int REQ_POST_NOTIFICATIONS = 4103;
    private static final String APP_ASSET_HOST = "appassets.androidplatform.net";
    private static final String NOTIFICATION_CHANNEL = "kasharian-local-reminders";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private byte[] pendingSaveBytes;
    private String pendingSaveName;
    private String pendingSaveMime;
    private String pendingNotificationCallback;
    private SQLiteDatabase secureDb;
    private final Object dbLock = new Object();
    private final SecureRandom random = new SecureRandom();
    private NativeBridge nativeBridge;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        try {
            secureDb = openEncryptedDatabase();
        } catch (Exception e) {
            showFatalStorageError(e);
            return;
        }
        createNotificationChannel();
        nativeBridge = new NativeBridge();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF000000);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // Financial data is stored only through the SQLCipher bridge, never WebView localStorage.
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        // The bridge is only exposed to our own bundled page. External URLs are opened outside this WebView.
        webView.addJavascriptInterface(nativeBridge, "KHNativeStorage");
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_ASSET_HOST.equalsIgnoreCase(uri.getHost())) return false;
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if (scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto") || scheme.equals("tel")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, REQ_OPEN_FILE);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    filePathCallback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Pemilih berkas tidak tersedia.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        setContentView(new FrameLayout(this) {{ addView(webView, new FrameLayout.LayoutParams(-1, -1)); }});
        webView.loadUrl("https://" + APP_ASSET_HOST + "/assets/www/index.html");
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(0xFF000000);
        window.setNavigationBarColor(0xFF000000);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
    }

    private void showFatalStorageError(Exception error) {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Penyimpanan KasHarian tidak dapat dibuka")
                .setMessage("Data aplikasi tidak dihapus. Coba buka ulang aplikasi. Jika masalah berlanjut, hubungi pembuat aplikasi.\n\n" + error.getClass().getSimpleName())
                .setCancelable(false)
                .setPositiveButton("Tutup", (d, w) -> finish())
                .show();
    }

    private SQLiteDatabase openEncryptedDatabase() throws Exception {
        System.loadLibrary("sqlcipher");
        String passphrase = getOrCreateWrappedDatabaseKey();
        File databaseFile = getDatabasePath("kasharian_secure.db");
        File parent = databaseFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Folder basis data tidak dapat dibuat.");
        }
        SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(databaseFile, passphrase, null, null, null);
        db.execSQL("CREATE TABLE IF NOT EXISTS kh_secure_kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)");
        return db;
    }

    /** A random 256-bit SQLCipher passphrase is wrapped by a non-exportable Android Keystore AES key. */
    private String getOrCreateWrappedDatabaseKey() throws Exception {
        SharedPreferences prefs = getSharedPreferences("kh_db_key_v1", MODE_PRIVATE);
        String ivB64 = prefs.getString("iv", null);
        String cipherB64 = prefs.getString("cipher", null);
        SecretKey wrappingKey = getOrCreateKeystoreKey();
        byte[] rawKey;
        if (ivB64 != null && cipherB64 != null) {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey,
                    new GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)));
            rawKey = cipher.doFinal(Base64.decode(cipherB64, Base64.NO_WRAP));
        } else {
            rawKey = new byte[32];
            random.nextBytes(rawKey);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(rawKey);
            boolean saved = prefs.edit()
                    .putString("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                    .putString("cipher", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .commit();
            if (!saved) throw new IllegalStateException("Kunci basis data tidak dapat disimpan.");
        }
        return Base64.encodeToString(rawKey, Base64.NO_WRAP);
    }

    private SecretKey getOrCreateKeystoreKey() throws Exception {
        final String alias = "id.kasharian.app.sqlcipher.wrap.v1";
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(alias)) {
            return (SecretKey) keyStore.getKey(alias, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build();
        generator.init(spec);
        return generator.generateKey();
    }

    private void openSystemFilePickerForSave(String name, String mime, byte[] bytes) {
        pendingSaveName = safeFileName(name);
        pendingSaveMime = (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime;
        pendingSaveBytes = bytes;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(pendingSaveMime);
        intent.putExtra(Intent.EXTRA_TITLE, pendingSaveName);
        try {
            startActivityForResult(intent, REQ_CREATE_FILE);
        } catch (Exception e) {
            pendingSaveBytes = null;
            Toast.makeText(this, "Pemilih lokasi penyimpanan tidak tersedia.", Toast.LENGTH_LONG).show();
        }
    }

    private String safeFileName(String value) {
        String name = value == null ? "KasHarian-export" : value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (name.isEmpty()) name = "KasHarian-export";
        return name.length() > 100 ? name.substring(0, 100) : name;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN_FILE) {
            if (pendingFileCallback != null) {
                Uri[] uris = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        uris = new Uri[count];
                        for (int i = 0; i < count; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        uris = new Uri[]{data.getData()};
                    }
                }
                pendingFileCallback.onReceiveValue(uris);
                pendingFileCallback = null;
            }
        } else if (requestCode == REQ_CREATE_FILE) {
            byte[] bytes = pendingSaveBytes;
            pendingSaveBytes = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "w")) {
                    if (out == null) throw new IllegalStateException("Berkas tujuan tidak bisa dibuka.");
                    out.write(bytes);
                    out.flush();
                    Toast.makeText(this, "Berkas berhasil disimpan.", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Berkas gagal disimpan. Coba lokasi lain.", Toast.LENGTH_LONG).show();
                }
            }
            pendingSaveName = null;
            pendingSaveMime = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_POST_NOTIFICATIONS) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            deliverNotificationPermissionResult(pendingNotificationCallback, granted);
            pendingNotificationCallback = null;
        }
    }

    private void deliverNotificationPermissionResult(String callbackId, boolean granted) {
        if (callbackId == null || webView == null) return;
        String js = "window.__khNativeNotificationPermissionResult && window.__khNativeNotificationPermissionResult(" +
                JSONObject.quote(callbackId) + "," + granted + ");";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private boolean isNotificationsGranted() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(NOTIFICATION_CHANNEL,
                    "Pengingat KasHarian", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Notifikasi uji dan pengingat lokal KasHarian.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void showNotification(String title, String body) {
        if (!isNotificationsGranted()) return;
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(this, 1, intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_kh)
                .setContentTitle(title == null ? "KasHarian" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(this).notify(101, builder.build());
        } catch (SecurityException ignored) {
            // The user can revoke notification permission at any time.
        }
    }

    private void showBiometricPrompt(String callbackId) {
        if (!isBiometricAvailable()) {
            deliverBiometricResult(callbackId, false, "not_available");
            return;
        }
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                deliverBiometricResult(callbackId, true, "");
            }

            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                deliverBiometricResult(callbackId, false, errString.toString());
            }

            @Override
            public void onAuthenticationFailed() {
                // The system keeps the prompt open for another attempt.
            }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Buka KasHarian")
                .setSubtitle("Konfirmasi identitas untuk membuka data")
                .setNegativeButtonText("Gunakan PIN")
                .build();
        prompt.authenticate(info);
    }

    private boolean isBiometricAvailable() {
        try {
            return BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                    == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    private void deliverBiometricResult(String callbackId, boolean ok, String error) {
        if (webView == null) return;
        String js = "window.__khNativeBioResult && window.__khNativeBioResult(" +
                JSONObject.quote(callbackId) + "," + ok + "," + JSONObject.quote(error == null ? "" : error) + ");";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("KHNativeStorage");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        synchronized (dbLock) {
            if (secureDb != null && secureDb.isOpen()) secureDb.close();
            secureDb = null;
        }
        super.onDestroy();
    }

    public final class NativeBridge {
        @JavascriptInterface
        public String getItem(String key) {
            if (key == null) return null;
            synchronized (dbLock) {
                if (secureDb == null || !secureDb.isOpen()) return null;
                try (Cursor c = secureDb.rawQuery("SELECT v FROM kh_secure_kv WHERE k = ?", new String[]{key})) {
                    return c.moveToFirst() ? c.getString(0) : null;
                } catch (Exception e) {
                    return null;
                }
            }
        }

        @JavascriptInterface
        public boolean setItem(String key, String value) {
            if (key == null || value == null) return false;
            synchronized (dbLock) {
                if (secureDb == null || !secureDb.isOpen()) return false;
                try {
                    secureDb.execSQL("INSERT OR REPLACE INTO kh_secure_kv (k, v) VALUES (?, ?)", new Object[]{key, value});
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void removeItem(String key) {
            if (key == null) return;
            synchronized (dbLock) {
                if (secureDb != null && secureDb.isOpen()) {
                    try { secureDb.execSQL("DELETE FROM kh_secure_kv WHERE k = ?", new Object[]{key}); }
                    catch (Exception ignored) { }
                }
            }
        }

        @JavascriptInterface
        public void clear() {
            synchronized (dbLock) {
                if (secureDb != null && secureDb.isOpen()) {
                    try { secureDb.execSQL("DELETE FROM kh_secure_kv"); }
                    catch (Exception ignored) { }
                }
            }
        }

        @JavascriptInterface
        public int length() {
            synchronized (dbLock) {
                if (secureDb == null || !secureDb.isOpen()) return 0;
                try (Cursor c = secureDb.rawQuery("SELECT COUNT(*) FROM kh_secure_kv", null)) {
                    return c.moveToFirst() ? c.getInt(0) : 0;
                } catch (Exception e) { return 0; }
            }
        }

        @JavascriptInterface
        public String keyAt(int index) {
            if (index < 0) return null;
            synchronized (dbLock) {
                if (secureDb == null || !secureDb.isOpen()) return null;
                try (Cursor c = secureDb.rawQuery("SELECT k FROM kh_secure_kv ORDER BY k LIMIT 1 OFFSET ?", new String[]{String.valueOf(index)})) {
                    return c.moveToFirst() ? c.getString(0) : null;
                } catch (Exception e) { return null; }
            }
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                runOnUiThread(() -> openSystemFilePickerForSave(name, mime, bytes));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Berkas tidak dapat disiapkan.", Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public boolean isBiometricAvailable() {
            return MainActivity.this.isBiometricAvailable();
        }

        @JavascriptInterface
        public void authenticate(String callbackId) {
            if (callbackId == null || !callbackId.matches("[a-zA-Z0-9_-]{1,48}")) return;
            runOnUiThread(() -> showBiometricPrompt(callbackId));
        }

        @JavascriptInterface
        public boolean isNotificationsGranted() {
            return MainActivity.this.isNotificationsGranted();
        }

        @JavascriptInterface
        public void requestNotificationsPermission(String callbackId) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33 || isNotificationsGranted()) {
                    deliverNotificationPermissionResult(callbackId, true);
                } else {
                    pendingNotificationCallback = callbackId;
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
                }
            });
        }

        @JavascriptInterface
        public boolean showNotification(String title, String body) {
            if (!isNotificationsGranted()) return false;
            runOnUiThread(() -> MainActivity.this.showNotification(title, body));
            return true;
        }
    }
}
