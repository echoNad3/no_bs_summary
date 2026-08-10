package dev.echonad3.nobssummary;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String SHARE_URL =
            "https://no-bs-summary.echonad3.workers.dev/share";
    private volatile boolean keepLaunchSplash = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen launchSplash = SplashScreen.installSplashScreen(this);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(LaunchScreenPlugin.class);
        super.onCreate(savedInstanceState);

        launchSplash.setKeepOnScreenCondition(() -> keepLaunchSplash);
        launchSplash.setOnExitAnimationListener(splashScreenView -> splashScreenView.remove());

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        openSharedVideo(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openSharedVideo(intent);
    }

    void hideLaunchSplash() {
        keepLaunchSplash = false;
    }

    private void openSharedVideo(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) {
            return;
        }

        CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        CharSequence sharedTitle = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        if ((sharedText == null || sharedText.length() == 0) &&
                (sharedTitle == null || sharedTitle.length() == 0)) {
            return;
        }

        Uri.Builder target = Uri.parse(SHARE_URL).buildUpon();
        if (sharedText != null && sharedText.length() > 0) {
            target.appendQueryParameter("text", sharedText.toString());
        }
        if (sharedTitle != null && sharedTitle.length() > 0) {
            target.appendQueryParameter("title", sharedTitle.toString());
        }

        String targetUrl = target.build().toString();
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(targetUrl));
    }
}
