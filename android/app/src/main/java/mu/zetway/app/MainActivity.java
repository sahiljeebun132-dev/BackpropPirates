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
}
