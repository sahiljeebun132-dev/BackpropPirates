package mu.zetway.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.telephony.TelephonyManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The three things the browser would not let Zetway do after a crash.
 *
 * The web build detects an impact perfectly well, but every action that leaves
 * the phone needs a human tap, because a web page that could dial and text on
 * its own would be a gift to every scam site. Inside this app those same
 * actions are ordinary Android, so the countdown can finish by itself.
 *
 * One limit survives the move to native, and it is not ours. Android forbids
 * ACTION_CALL for emergency numbers: a third-party app that tries is redirected
 * to the preloaded dialler for confirmation, and TelecomManager.placeCall only
 * accepts an emergency number from the default or preloaded dialler.
 * CALL_PRIVILEGED, which would lift that, is not available to third-party apps.
 * So no app on the Play Store can auto-dial 999 or 114, and neither can this
 * one. Rather than fail at the worst possible moment, placeCall asks the
 * operating system whether a number is an emergency number and, if it is,
 * refuses and says so, leaving the screen's one-tap button to do the job.
 *
 * What is genuinely automatic is the part that matters most anyway: the people
 * who love you get a text with your location without anyone touching anything.
 */
@CapacitorPlugin(
    name = "CrashResponse",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "phone", strings = { Manifest.permission.CALL_PHONE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class CrashResponsePlugin extends Plugin {

    /** Fallback only, for a device whose telephony service will not answer.
     *  The operating system's own list is always preferred: it knows the
     *  emergency numbers for the SIM actually in the phone. */
    private static final List<String> FALLBACK_EMERGENCY =
        Arrays.asList("112", "911", "999", "114", "115", "116", "117", "118");

    // ---------------------------------------------------------------- vibrate

    /**
     * A long, unmissable pattern. Android's web view does not expose
     * navigator.vibrate reliably, and iOS never has, which is why the web build
     * had to fall back to sound alone.
     */
    @PluginMethod
    public void vibrate(PluginCall call) {
        long[] pattern = { 0, 600, 250, 600, 250, 1500 };
        JSArray supplied = call.getArray("pattern", null);
        if (supplied != null) {
            try {
                List<Integer> values = supplied.toList();
                if (!values.isEmpty()) {
                    pattern = new long[values.size()];
                    for (int i = 0; i < values.size(); i++) {
                        pattern[i] = values.get(i).longValue();
                    }
                }
            } catch (org.json.JSONException ignored) {
                // Keep the default pattern; a malformed argument is not worth
                // failing an alarm over.
            }
        }

        Vibrator vibrator = resolveVibrator();
        if (vibrator == null || !vibrator.hasVibrator()) {
            call.resolve(result(false, "This phone has no vibrator."));
            return;
        }
        // A three-second buzz is the one a rider in a jacket pocket never
        // feels, so the alarm asks for a pattern long enough to outlast the
        // countdown. It is tiled to that length rather than looped: an
        // infinite waveform depends on something later calling cancel, and a
        // phone left buzzing because a notification was swiped away instead
        // of opened is a worse bug than the one being fixed.
        if (Boolean.TRUE.equals(call.getBoolean("repeat", false))) {
            pattern = tile(pattern, ALARM_BUZZ_MS);
        }
        VibrationEffect effect = VibrationEffect.createWaveform(pattern, -1);

        // Alarm usage, not the default. A bare vibrate() is filed under
        // USAGE_UNKNOWN, and Do Not Disturb — along with a ringer profile that
        // has vibration switched off — drops that silently. The alarm still
        // sounds, so the phone appears to work while never moving, which is
        // precisely the failure a rider reported from a real handset.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, new VibrationAttributes.Builder()
                .setUsage(VibrationAttributes.USAGE_ALARM)
                .build());
        } else {
            vibrator.vibrate(effect, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        }
        call.resolve(result(true, null));
    }

    @PluginMethod
    public void stopVibration(PluginCall call) {
        Vibrator vibrator = resolveVibrator();
        if (vibrator != null) vibrator.cancel();
        call.resolve(result(true, null));
    }

    /** How long the alarm buzz runs: the 30-second countdown with a margin. */
    private static final long ALARM_BUZZ_MS = 35_000L;

    /** Repeat a waveform end to end until it lasts at least totalMs.
     *
     *  A waveform alternates off and on starting with off, so tiling has to
     *  keep the entries paired or the buzz inverts into silence. Patterns here
     *  always have an even length; an odd one is padded rather than rejected,
     *  because an alarm is no place to throw. */
    private static long[] tile(long[] pattern, long totalMs) {
        long unit = 0;
        for (long v : pattern) unit += v;
        if (unit <= 0) return pattern;

        long[] base = pattern;
        if (base.length % 2 != 0) base = Arrays.copyOf(base, base.length + 1);

        int copies = (int) Math.ceil((double) totalMs / unit);
        if (copies <= 1) return base;

        long[] out = new long[base.length * copies];
        for (int i = 0; i < copies; i++) {
            System.arraycopy(base, 0, out, i * base.length, base.length);
        }
        return out;
    }

    private Vibrator resolveVibrator() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager =
                (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    // -------------------------------------------------------------------- sms

    /**
     * Text every emergency contact, with no tap at all. This is the promise the
     * web build could not keep.
     */
    @PluginMethod
    public void sendSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        deliverSms(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.resolve(result(false, "Permission to send messages was refused."));
            return;
        }
        deliverSms(call);
    }

    private void deliverSms(PluginCall call) {
        JSArray numbers = call.getArray("numbers", null);
        String message = call.getString("message", "");
        if (numbers == null || message == null || message.isEmpty()) {
            call.reject("sendSms needs numbers and a message.");
            return;
        }

        List<String> recipients;
        try {
            recipients = numbers.toList();
        } catch (org.json.JSONException e) {
            call.reject("numbers must be a list of strings.");
            return;
        }

        SmsManager manager = resolveSmsManager();
        if (manager == null) {
            call.resolve(result(false, "This device cannot send text messages."));
            return;
        }

        List<String> sent = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        for (String raw : recipients) {
            String number = raw == null ? "" : raw.replaceAll("[^0-9+]", "");
            if (number.isEmpty()) continue;
            try {
                // A location link pushes most messages past the 160-character
                // limit, so they have to go as a multipart message or the tail
                // is silently dropped.
                ArrayList<String> parts = manager.divideMessage(message);
                if (parts.size() > 1) {
                    manager.sendMultipartTextMessage(number, null, parts, null, null);
                } else {
                    manager.sendTextMessage(number, null, message, null, null);
                }
                sent.add(number);
            } catch (Exception e) {
                failed.add(number);
            }
        }

        JSObject out = new JSObject();
        out.put("ok", !sent.isEmpty());
        out.put("sent", JSArray.from(sent.toArray(new String[0])));
        out.put("failed", JSArray.from(failed.toArray(new String[0])));
        call.resolve(out);
    }

    @SuppressWarnings("deprecation")
    private SmsManager resolveSmsManager() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getContext().getSystemService(SmsManager.class);
        }
        return SmsManager.getDefault();
    }

    // ------------------------------------------------------------------- call

    /**
     * Place a call without the user touching the dialler. Allowed for an
     * ordinary number, forbidden by Android for an emergency number — see the
     * note at the top of this file.
     */
    @PluginMethod
    public void placeCall(PluginCall call) {
        String number = call.getString("number", "");
        if (number == null || number.isEmpty()) {
            call.reject("placeCall needs a number.");
            return;
        }
        if (isEmergencyNumber(number)) {
            JSObject out = result(false,
                "Android does not let any third-party app dial an emergency number. "
                    + "The call has to be confirmed in the dialler.");
            out.put("reason", "emergency-number");
            call.resolve(out);
            return;
        }
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            requestPermissionForAlias("phone", call, "phonePermissionCallback");
            return;
        }
        dial(call, number);
    }

    @PermissionCallback
    private void phonePermissionCallback(PluginCall call) {
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            JSObject out = result(false, "Permission to place calls was refused.");
            out.put("reason", "permission-denied");
            call.resolve(out);
            return;
        }
        dial(call, call.getString("number", ""));
    }

    private void dial(PluginCall call, String number) {
        try {
            Intent intent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number)));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(result(true, null));
        } catch (SecurityException e) {
            JSObject out = result(false, "Android refused the call.");
            out.put("reason", "refused");
            call.resolve(out);
        } catch (Exception e) {
            call.resolve(result(false, "No app on this phone can place the call."));
        }
    }

    /**
     * Ask the operating system, because it knows the emergency numbers for the
     * SIM in this phone, which differ by country. The hard-coded list is only
     * for a device that will not answer.
     */
    private boolean isEmergencyNumber(String number) {
        String cleaned = number.replaceAll("[^0-9+]", "");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                TelephonyManager telephony =
                    (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
                if (telephony != null) return telephony.isEmergencyNumber(cleaned);
            } catch (Exception ignored) {
                // Falls through to the list below.
            }
        }
        return FALLBACK_EMERGENCY.contains(cleaned);
    }

    // ------------------------------------------------- background watching

    /**
     * Hand the sensor to a foreground service so the watch survives the screen
     * going off. Everything that happens after an impact still runs in the web
     * layer; the service only keeps the sensor alive and gets the app in front
     * of the rider.
     */
    @Override
    public void load() {
        CrashWatchService.setListener((peak, test) -> {
            JSObject data = new JSObject();
            data.put("peak", peak);
            data.put("test", test);
            // Retained: the page is very often suspended at the moment this
            // fires, and an impact must not be dropped for want of a listener.
            notifyListeners("impact", data, true);
        });
    }

    @PluginMethod
    public void startWatching(PluginCall call) {
        // Android 13 and later hide the notification without this, and the
        // notification is how a locked phone shows the alert at all.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
            return;
        }
        launchService(call);
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        // Deliberately started even if refused. Without the notification the
        // alert is quieter, but the detection itself still works and that is
        // worth more than refusing to run.
        launchService(call);
    }

    private void launchService(PluginCall call) {
        try {
            double threshold = call.getDouble("threshold", 30.0);
            boolean test = Boolean.TRUE.equals(call.getBoolean("test", false));
            Intent intent = new Intent(getContext(), CrashWatchService.class)
                .setAction(CrashWatchService.ACTION_START)
                .putExtra(CrashWatchService.EXTRA_THRESHOLD, (float) threshold)
                .putExtra(CrashWatchService.EXTRA_TEST, test);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            JSObject out = result(true, null);
            out.put("notifications",
                getPermissionState("notifications") == PermissionState.GRANTED);
            call.resolve(out);
        } catch (Exception e) {
            call.resolve(result(false, "Background watching could not be started."));
        }
    }

    @PluginMethod
    public void stopWatching(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), CrashWatchService.class));
        } catch (Exception ignored) {
            // Already gone is the outcome we wanted.
        }
        call.resolve(result(true, null));
    }

    @PluginMethod
    public void isWatching(PluginCall call) {
        JSObject out = new JSObject();
        out.put("running", CrashWatchService.running);
        call.resolve(out);
    }

    /**
     * An impact detected while no web view was running.
     *
     * Two places it can be waiting. If the process survived, the service kept
     * it in memory. If Android killed the process and the notification started
     * us again from scratch, it is on the intent that launched the activity.
     * The intent copy is cleared once read, so resuming or rotating does not
     * raise the same crash a second time.
     */
    @PluginMethod
    public void consumePendingImpact(PluginCall call) {
        float peak = CrashWatchService.consumePending();
        if (peak < 0 && getActivity() != null && getActivity().getIntent() != null) {
            peak = getActivity().getIntent()
                .getFloatExtra(CrashWatchService.EXTRA_IMPACT_PEAK, -1f);
            if (peak >= 0) {
                getActivity().getIntent().removeExtra(CrashWatchService.EXTRA_IMPACT_PEAK);
            }
        }
        JSObject out = new JSObject();
        out.put("hasImpact", peak >= 0);
        out.put("peak", peak);
        out.put("test", CrashWatchService.lastPendingWasTest());
        call.resolve(out);
    }

    // ------------------------------------------------- locked-screen readiness

    /**
     * The three things that decide whether an alert actually reaches someone
     * whose phone is locked in a pocket. All three are the rider's to grant,
     * none can be assumed, and silently failing any of them would be the
     * worst kind of bug in this app: one you only discover after a crash.
     */
    @PluginMethod
    public void checkReadiness(PluginCall call) {
        JSObject out = new JSObject();
        out.put("notifications",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState("notifications") == PermissionState.GRANTED);
        // The four that decide whether the escalation can run at all. Asking
        // for any of these at the moment of a crash would mean a permission
        // dialog in front of someone who cannot answer it.
        out.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        out.put("phone", getPermissionState("phone") == PermissionState.GRANTED);
        out.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        out.put("location", getPermissionState("location") == PermissionState.GRANTED);
        out.put("lockScreen", CrashWatchService.canRaiseOnLockScreen(getContext()));
        out.put("unrestricted", CrashWatchService.isUnrestricted(getContext()));
        out.put("watching", CrashWatchService.running);
        call.resolve(out);
    }

    /** Android 14's full-screen-intent screen, which is the only place this
     *  can be granted. There is no runtime prompt for it. */
    @PluginMethod
    public void openLockScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.resolve(result(true, "Not needed before Android 14."));
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(result(true, null));
        } catch (Exception e) {
            call.resolve(result(false, "Could not open that settings screen."));
        }
    }

    /**
     * Ask to be exempt from battery optimisation.
     *
     * Without it a great many phones — and nearly every Chinese OEM skin —
     * will kill a foreground service after a few minutes in a pocket, which
     * is precisely the situation this feature exists for. The direct request
     * shows a system dialog; where that is refused outright we fall back to
     * the settings list so the rider can still find it.
     */
    @PluginMethod
    public void requestUnrestricted(PluginCall call) {
        if (CrashWatchService.isUnrestricted(getContext())) {
            call.resolve(result(true, null));
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(result(true, null));
        } catch (Exception first) {
            try {
                Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(list);
                call.resolve(result(true, "Find Zetway in the list and allow it."));
            } catch (Exception second) {
                call.resolve(result(false, "This phone does not expose that setting."));
            }
        }
    }

    /** This app's own settings page. Needed because a permission refused
     *  twice never prompts again, and because every OEM hides its own
     *  background-killing switches somewhere different underneath it. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(result(true, null));
        } catch (Exception e) {
            call.resolve(result(false, "Could not open the app settings."));
        }
    }

    // ----------------------------------------------------------------- shared

    private JSObject result(boolean ok, String message) {
        JSObject out = new JSObject();
        out.put("ok", ok);
        if (message != null) out.put("message", message);
        return out;
    }
}
