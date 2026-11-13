package mu.zetway.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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
        @Permission(alias = "phone", strings = { Manifest.permission.CALL_PHONE })
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
        // -1 means play the pattern once rather than looping it.
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
        call.resolve(result(true, null));
    }

    @PluginMethod
    public void stopVibration(PluginCall call) {
        Vibrator vibrator = resolveVibrator();
        if (vibrator != null) vibrator.cancel();
        call.resolve(result(true, null));
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

    // ----------------------------------------------------------------- shared

    private JSObject result(boolean ok, String message) {
        JSObject out = new JSObject();
        out.put("ok", ok);
        if (message != null) out.put("message", message);
        return out;
    }
}
