package com.alabtal.live;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import com.chaquo.python.Python;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

public class MainActivity extends Activity {
    private static final String TAG = "ALABTAL";
    private WebView web;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        setContentView(web);

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
            Toast.makeText(this, "تعذر تجهيز ملفات الواجهة", Toast.LENGTH_LONG).show();
            return;
        }

        new Thread(() -> {
            try {
                Python py = Python.getInstance();
                py.getModule("os").callAttr("chdir", getFilesDir().getAbsolutePath());

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
                        socket.connect(new InetSocketAddress("127.0.0.1", 8765), 300);
                        ready = true;
                        break;
                    } catch (Exception ignored) {
                        Thread.sleep(250);
                    }
                }

                final boolean serverReady = ready;
                runOnUiThread(() -> {
                    if (serverReady) {
                        web.loadUrl("http://127.0.0.1:8765/alabtal_v2/");
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

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
