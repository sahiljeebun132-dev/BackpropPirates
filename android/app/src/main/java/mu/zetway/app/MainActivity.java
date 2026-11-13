package mu.zetway.app;

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
}
