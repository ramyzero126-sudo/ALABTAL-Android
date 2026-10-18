package com.alabtal.live;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Toast;
import com.chaquo.python.Python;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.io.FileInputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String TAG = "ALABTAL";
    private static final String CHANNEL_ID = "alabtal_updates";
    private static final int NOTIFICATION_PERMISSION_CODE = 101;
    private WebView web;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        createNotificationChannel();

        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.clearCache(true);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void show(String title, String message) {
                runOnUiThread(() -> showNativeNotification(title, message));
            }

            @JavascriptInterface
            public void openExternal(String targetUrl) {
                try {
                    Uri uri = Uri.parse(targetUrl);
                    if (!"https".equalsIgnoreCase(uri.getScheme())) return;
                    runOnUiThread(() -> {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        } catch (Exception e) {
                            Log.e(TAG, "Cannot open external URL", e);
                            Toast.makeText(MainActivity.this,
                                "تعذر فتح الفورم في المتصفح",
                                Toast.LENGTH_LONG).show();
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Invalid external URL", e);
                }
            }
        }, "AndroidNotifications");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });
        setContentView(web);

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_CODE
            );
        }

        try {
            String[] files = {
                "index.html", "styles.css", "app.js",
                "alabtal_v2/index.html",
                "alabtal_v2/styles.css",
                "alabtal_v2/app.js",
                "alabtal_v2/typewriter.js"
            };

            for (String name : files) {
                File out = new File(getFilesDir(), name);
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();

                try (InputStream in = getAssets().open(name);
                     FileOutputStream os = new FileOutputStream(out)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = in.read(buffer)) != -1) {
                        os.write(buffer, 0, count);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Asset copy failed", e);
            Toast.makeText(this, "تعذر تجهيز ملفات الواجهة",
                Toast.LENGTH_LONG).show();
            return;
        }

        new Thread(() -> {
            try {
                downloadUiUpdates();
                Python py = Python.getInstance();
                py.getModule("os").callAttr(
                    "chdir", getFilesDir().getAbsolutePath());

                new Thread(() -> {
                    try {
                        py.getModule("proxy").callAttr("main");
                    } catch (Throwable e) {
                        Log.e(TAG, "Proxy stopped", e);
                    }
                }, "ALABTAL-Proxy").start();

                boolean ready = false;
                for (int i = 0; i < 40; i++) {
                    try (Socket socket = new Socket()) {
                        socket.connect(
                            new InetSocketAddress("127.0.0.1", 8765), 300);
                        ready = true;
                        break;
                    } catch (Exception ignored) {
                        Thread.sleep(250);
                    }
                }

                final boolean serverReady = ready;
                runOnUiThread(() -> {
                    if (serverReady) {
                        web.clearCache(true);
                        web.loadUrl("http://127.0.0.1:8765/alabtal_v2/?ui_refresh=" + System.currentTimeMillis());
                    } else {
                        Toast.makeText(this,
                            "تعذر تشغيل البروكسي. راجع اتصال الخادم.",
                            Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Throwable e) {
                Log.e(TAG, "App startup failed", e);
                runOnUiThread(() -> Toast.makeText(
                    this, "فشل تشغيل التطبيق: " + e.getMessage(),
                    Toast.LENGTH_LONG).show());
            }
        }, "ALABTAL-Startup").start();
    }


    private void downloadUiUpdates() {
        String base = "https://raw.githubusercontent.com/ramyzero126-sudo/ALABTAL-Android/main/app/src/main/assets/alabtal_v2/";
        String[] names = {"index.html", "styles.css", "app.js", "typewriter.js"};

        for (String name : names) {
            File temp = null;
            HttpURLConnection conn = null;
            try {
                URL url = new URL(base + name + "?update=" + System.currentTimeMillis());
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Cache-Control", "no-cache");
                conn.setRequestProperty("User-Agent", "ALABTAL-Android");
                conn.connect();

                if (conn.getResponseCode() != 200) {
                    Log.w(TAG, "UI update skipped: " + name + " HTTP " + conn.getResponseCode());
                    continue;
                }

                File dir = new File(getFilesDir(), "alabtal_v2");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new java.io.IOException("Cannot create UI directory");
                }

                temp = new File(dir, name + ".update.tmp");
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    out.getFD().sync();
                }

                File target = new File(dir, name);
                try (InputStream in = new FileInputStream(temp);
                     FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                }
                Log.i(TAG, "UI updated from GitHub: " + name);
            } catch (Exception e) {
                Log.w(TAG, "Using bundled UI for " + name + ": " + e.getMessage());
            } finally {
                if (temp != null) temp.delete();
                if (conn != null) conn.disconnect();
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "إشعارات ALABTAL",
                NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("تنبيهات تغيّر حالة المناديب");
            getSystemService(NotificationManager.class)
                .createNotificationChannel(channel);
        }
    }

    private void showNativeNotification(String title, String message) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Notification notification = builder
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title == null ? "ALABTAL LIVE" : title)
            .setContentText(message == null ? "" : message)
            .setAutoCancel(true)
            .build();

        NotificationManager manager =
            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.notify((int) System.currentTimeMillis(), notification);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            // Keep the live dashboard open when there is no page to return to.
            Toast.makeText(
                MainActivity.this,
                "أنت في صفحة اللايف",
                Toast.LENGTH_SHORT
            ).show();
        }
    }
}
