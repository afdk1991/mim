package com.afdk1991.mim;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/* Mim OTA 插件：下载新版本 APK → SHA-256 校验 → FileProvider 调起系统安装器。
   GitHub Releases 直链 302 跳转对象存储，HttpURLConnection 默认跟随，无需特殊处理。 */
@CapacitorPlugin(name = "MimOta")
public class MimOtaPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT = 15000;
    private static final int READ_TIMEOUT = 60000;

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canRequestInstalls());
        call.resolve(ret);
    }

    /* 跳系统「安装未知应用」授权页；用户授权返回后可重试 */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /* 下载 + 校验 + 调起安装；sha256 不匹配时 reject SHA256_MISMATCH，前端静默处理 */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256");
        if (url == null || url.isEmpty() || sha256 == null || sha256.isEmpty()) {
            call.reject("url 与 sha256 必填");
            return;
        }

        // 网络操作放后台线程，避免阻塞 bridge
        new Thread(() -> {
            File apk;
            try {
                apk = download(url);
            } catch (Exception e) {
                call.reject("DOWNLOAD_FAILED: " + safeMessage(e));
                return;
            }

            try {
                String actual = sha256Hex(apk);
                if (!actual.equalsIgnoreCase(sha256.trim())) {
                    apk.delete();
                    call.reject("SHA256_MISMATCH");
                    return;
                }
            } catch (Exception e) {
                apk.delete();
                call.reject("HASH_FAILED: " + safeMessage(e));
                return;
            }

            try {
                install(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject("INSTALL_FAILED: " + safeMessage(e));
            }
        }).start();
    }

    private boolean canRequestInstalls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private File download(String url) throws IOException {
        File out = new File(getContext().getCacheDir(), "mim-ota.apk");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setInstanceFollowRedirects(true);
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code);
            }
            InputStream in = conn.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            try {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            } finally {
                fos.close();
                in.close();
            }
            return out;
        } finally {
            conn.disconnect();
        }
    }

    private String sha256Hex(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        InputStream in = new FileInputStream(file);
        try {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        } finally {
            in.close();
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format(Locale.US, "%02x", b));
        return sb.toString();
    }

    private void install(File apk) throws Exception {
        Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private String safeMessage(Exception e) {
        String m = e.getMessage();
        return m == null ? e.getClass().getSimpleName() : m;
    }
}
