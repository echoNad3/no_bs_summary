package dev.echonad3.nobssummary;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String PREFS = "nbs_updater";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String FILE_NAME = "no-bs-summary-update.apk";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_URL =
            "https://github.com/echoNad3/no_bs_summary/releases/latest/download/app-debug.apk";

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (!UPDATE_URL.equals(url)) {
            call.reject("The update URL is not trusted.");
            return;
        }

        Context context = getContext();
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Download service unavailable.");
            return;
        }

        long previousId = readDownloadId(context);
        if (previousId >= 0) manager.remove(previousId);
        File file = updateFile(context);
        if (file.exists() && !file.delete()) {
            call.reject("Could not replace the previous update file.");
            return;
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("No BS Summary update")
                    .setDescription("Downloading the latest build")
                    .setMimeType(APK_MIME)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(false)
                    .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(
                            context, Environment.DIRECTORY_DOWNLOADS, FILE_NAME);
            long id = manager.enqueue(request);
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(DOWNLOAD_ID, id)
                    .apply();
            call.resolve(readStatus(context, manager, id));
        } catch (Exception error) {
            call.reject("Could not start the update download.", error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Download service unavailable.");
            return;
        }
        call.resolve(readStatus(context, manager, readDownloadId(context)));
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context context = getContext();
        File file = updateFile(context);
        if (!isValidUpdate(context, file)) {
            call.resolve(result("failed", 0, "The downloaded update is invalid."));
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName()));
            try {
                startActivityForResult(call, settings, "installPermissionCallback");
            } catch (Exception error) {
                call.resolve(result(
                        "permission-required",
                        100,
                        "Allow installs from No BS Summary in Android settings.",
                        archiveBuild(context, file)));
            }
            return;
        }
        openInstaller(call);
    }

    @ActivityCallback
    private void installPermissionCallback(PluginCall call, ActivityResult activityResult) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.getPackageManager().canRequestPackageInstalls()) {
            call.resolve(result(
                    "permission-required",
                    100,
                    "Allow installs from No BS Summary to continue.",
                    archiveBuild(context, updateFile(context))));
            return;
        }
        openInstaller(call);
    }

    private void openInstaller(PluginCall call) {
        Context context = getContext();
        File file = updateFile(context);
        Uri uri = FileProvider.getUriForFile(
                context, context.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve(result("installing", 100, null, archiveBuild(context, file)));
        } catch (Exception error) {
            call.resolve(result("failed", 100, "Android's installer is unavailable."));
        }
    }

    private JSObject readStatus(Context context, DownloadManager manager, long id) {
        if (id < 0) return result("idle", 0, null);
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return result("idle", 0, null);
            int status = cursor.getInt(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(
                    DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(
                    DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int progress = total > 0
                    ? (int) Math.min(100, Math.round((downloaded * 100.0) / total))
                    : 0;

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                File file = updateFile(context);
                return isValidUpdate(context, file)
                        ? result("ready", 100, null, archiveBuild(context, file))
                        : result("failed", 0, "The downloaded update is invalid.");
            }
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_REASON));
                return result("failed", progress, "Download failed (" + reason + ").");
            }
            return result("downloading", progress, null);
        } catch (Exception error) {
            return result("failed", 0, "Could not read download progress.");
        }
    }

    private static long readDownloadId(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(DOWNLOAD_ID, -1L);
    }

    private static File updateFile(Context context) {
        File directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return new File(directory != null ? directory : context.getFilesDir(), FILE_NAME);
    }

    private static boolean isValidUpdate(Context context, File file) {
        if (!file.isFile() || file.length() == 0) return false;
        PackageManager packageManager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo archive = packageManager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (archive == null || !context.getPackageName().equals(archive.packageName)) return false;

        try {
            PackageInfo installed = packageManager.getPackageInfo(context.getPackageName(), flags);
            long installedBuild = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? installed.getLongVersionCode()
                    : installed.versionCode;
            long downloadedBuild = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archive.getLongVersionCode()
                    : archive.versionCode;
            return downloadedBuild >= installedBuild && signaturesMatch(installed, archive);
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private static boolean signaturesMatch(PackageInfo installed, PackageInfo archive) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (installed.signingInfo == null || archive.signingInfo == null) return false;
            return sameSignatures(
                    installed.signingInfo.getApkContentsSigners(),
                    archive.signingInfo.getApkContentsSigners());
        }
        return sameSignatures(installed.signatures, archive.signatures);
    }

    private static boolean sameSignatures(Signature[] installed, Signature[] archive) {
        if (installed == null || archive == null ||
                installed.length == 0 || installed.length != archive.length) return false;
        for (Signature installedSigner : installed) {
            boolean found = false;
            for (Signature archiveSigner : archive) {
                if (installedSigner.equals(archiveSigner)) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private static long archiveBuild(Context context, File file) {
        PackageInfo info = context.getPackageManager()
                .getPackageArchiveInfo(file.getAbsolutePath(), 0);
        if (info == null) return -1L;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
    }

    private static JSObject result(String status, int progress, String detail) {
        return result(status, progress, detail, -1L);
    }

    private static JSObject result(String status, int progress, String detail, long build) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("progress", progress);
        if (detail != null) result.put("detail", detail);
        if (build > 0) result.put("build", build);
        return result;
    }
}
