package dev.echonad3.nobssummary;

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LaunchScreen")
public class LaunchScreenPlugin extends Plugin {
    @PluginMethod
    public void hide(PluginCall call) {
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(() -> ((MainActivity) activity).hideLaunchSplash());
        }
        call.resolve();
    }
}
