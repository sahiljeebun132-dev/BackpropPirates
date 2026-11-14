package mu.zetway.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that ship as npm packages are discovered automatically.
        // One that lives inside the app, as ours does, has to be named here
        // before the web layer can call it.
        registerPlugin(CrashResponsePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * The activity is singleTask, so when the crash notification opens an app
     * that is already running, Android delivers the intent here rather than
     * creating a new activity — and getIntent() would still hand back the one
     * that launched the app originally. Without this line the peak reading
     * travelling on the new intent would never be seen.
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    /**
     * Back goes back, rather than straight out of the app.
     *
     * Without this the system back button closed Zetway from whatever
     * screen the rider was on, which on a phone is the single most jarring
     * thing an app can do: every other app on the device treats back as
     * "up one level", so the one that quits feels broken rather than
     * minimal.
     *
     * The web layer owns the navigation, so it decides. __zetwayBack
     * returns true when it handled the press by going up a screen, and
     * false when there is nowhere left to go — only then does the activity
     * behave the way it used to.
     *
     * Done here rather than with @capacitor/app because adding an npm
     * dependency hours before a demonstration is a worse trade than twenty
     * lines of Java.
     */
    @Override
    public void onBackPressed() {
        if (bridge == null || bridge.getWebView() == null) {
            super.onBackPressed();
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "(function(){try{return !!(window.__zetwayBack && window.__zetwayBack())}catch(e){return false}})()",
            value -> {
                if (!"true".equals(value)) {
                    runOnUiThread(MainActivity.super::onBackPressed);
                }
            }
        );
    }
}
