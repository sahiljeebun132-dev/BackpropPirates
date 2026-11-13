package mu.zetway.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Watches the accelerometer while Zetway is not on screen.
 *
 * This is the difference between a feature that demos well and one that would
 * actually help. A web page — and a web view — is throttled the moment it is
 * backgrounded and suspended when the screen goes off, so until now crash
 * watch only worked with the app open and the display lit. Nobody rides like
 * that. The phone is in a pocket or on a mount with the screen dark, which is
 * exactly the state in which the old build was watching nothing at all.
 *
 * What this service deliberately does NOT do is decide what happens next. The
 * countdown, the alarm, the texts and the call all stay in the web layer,
 * where they are written once and where the rider already knows the screen.
 * This class has one job: stay alive, watch one number, and when that number
 * is too big, get the app in front of the rider. Everything else is a message
 * passed along.
 *
 * Two Android facts shape the rest of it:
 *
 *   A foreground service keeps the process from being killed, but it does not
 *   keep the CPU awake. With the screen off the device dozes and sensor
 *   callbacks simply stop arriving, so a partial wake lock is not optional
 *   here. It costs battery, and the app says so where the rider arms it.
 *
 *   An app in the background may not simply start an activity. The reliable
 *   way to put a screen in front of someone is a full-screen-intent
 *   notification, the mechanism alarm clocks and incoming calls use. We post
 *   one and also attempt startActivity, because between them one will land.
 */
public class CrashWatchService extends Service {

    public static final String ACTION_START = "mu.zetway.app.WATCH_START";
    public static final String ACTION_STOP = "mu.zetway.app.WATCH_STOP";
    public static final String EXTRA_THRESHOLD = "threshold";
    public static final String EXTRA_TEST = "test";
    public static final String EXTRA_IMPACT_PEAK = "impactPeak";

    private static final String CHANNEL_WATCH = "zetway.watch";
    private static final String CHANNEL_ALERT = "zetway.alert.v3";
    private static final int NOTE_WATCH = 1001;
    private static final int NOTE_ALERT = 1002;

    /** Set by the plugin while a web view is alive to receive the news. */
    public interface ImpactListener {
        void onImpact(float peak, boolean test);
    }

    private static volatile ImpactListener listener;

    /**
     * An impact that has not reached the web layer yet, because the web view
     * was not running when it happened. The plugin collects it once the page
     * is up, so a crash detected with the app closed still raises the alert
     * rather than vanishing. -1 means nothing pending.
     */
    private static volatile float pendingPeak = -1f;
    /** Whether that pending impact came from a rehearsal threshold. Carried
     *  separately because the service outlives the page that knew it. */
    private static volatile boolean pendingTest = false;

    public static void setListener(ImpactListener l) {
        listener = l;
    }

    public static float consumePending() {
        float p = pendingPeak;
        pendingPeak = -1f;
        return p;
    }

    public static boolean lastPendingWasTest() {
        return pendingTest;
    }

    /** So the UI can show the truth about whether background watching is on. */
    public static volatile boolean running = false;

    private SensorManager sensors;
    private Sensor accelerometer;
    private PowerManager.WakeLock wakeLock;
    private float threshold = 30f;
    private boolean testMode = false;
    private boolean armed = true;

    private final SensorEventListener sensorListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (!armed) return;
            float x = event.values[0], y = event.values[1], z = event.values[2];
            // TYPE_ACCELEROMETER includes gravity, which is what the web build's
            // accelerationIncludingGravity reports too, so one threshold is
            // correct for both and a reading at rest is about 9.8.
            double magnitude = Math.sqrt(x * x + y * y + z * z);
            if (magnitude >= threshold) {
                armed = false; // one trigger; the rider decides what happens next
                onImpact((float) magnitude);
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            // Accuracy of a crash-sized reading is not in question.
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            threshold = intent.getFloatExtra(EXTRA_THRESHOLD, 30f);
            testMode = intent.getBooleanExtra(EXTRA_TEST, false);
        }
        armed = true;

        startForegroundCompat();

        if (accelerometer != null && sensors != null) {
            // GAME is about 50 readings a second: fast enough not to miss the
            // peak of an impact, slow enough not to eat the battery that has
            // to last the whole ride.
            sensors.registerListener(sensorListener, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        }

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "zetway:crashwatch");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }

        running = true;
        // START_STICKY: if Android reclaims the process under memory pressure,
        // bring the watch back rather than leaving the rider unwatched and
        // unaware of it.
        return START_STICKY;
    }

    private void onImpact(float peak) {
        ImpactListener l = listener;
        if (l != null) {
            l.onImpact(peak, testMode);
        } else {
            // No web view to tell. Hold it so the page can collect it when it
            // starts, and make sure the page does start.
            pendingPeak = peak;
            pendingTest = testMode;
        }
        raiseAlert(peak);
    }

    /**
     * Put the alert in front of the rider, by both routes available.
     *
     * The notification is the dependable one: a full-screen intent is how an
     * alarm clock gets a screen up from a locked, dark phone. The direct
     * startActivity is attempted as well because when the app happens to be
     * foregrounded it is instant, and when it is not the system simply
     * declines it.
     */
    private void raiseAlert(float peak) {
        Intent open = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_IMPACT_PEAK, peak);

        PendingIntent pi = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification alert = new Notification.Builder(this, CHANNEL_ALERT)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(testMode ? "Test impact detected" : "Heavy impact detected")
            .setContentText(testMode
                ? "Test mode: nobody will be contacted. Tap to open."
                : "Tap if you are alright. Zetway will get help if you do not.")
            .setPriority(Notification.PRIORITY_MAX)
            .setCategory(Notification.CATEGORY_ALARM)
            // PUBLIC, or a locked phone hides the text and the rider sees a
            // blank "notification" telling them nothing.
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(false)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build();

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTE_ALERT, alert);

        // Buzz from here as well as from the channel. When the web view has
        // been killed there is nothing left to call nativeVibrate, and this is
        // the one signal that reaches a phone in a pocket.
        vibrateHard();

        try {
            startActivity(open);
        } catch (Exception ignored) {
            // Background activity starts are restricted. The notification above
            // is the route that is meant to work; this was the shortcut.
        }
    }

    private void startForegroundCompat() {
        PendingIntent tap = PendingIntent.getActivity(
            this, 1, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification note = new Notification.Builder(this, CHANNEL_WATCH)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("Zetway is watching for a crash")
            .setContentText("Keeps running with the screen off. Uses extra battery.")
            .setOngoing(true)
            .setContentIntent(tap)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTE_WATCH, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTE_WATCH, note);
        }
    }

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        // Quiet: it is on screen for the whole ride and must not nag.
        NotificationChannel watch = new NotificationChannel(
            CHANNEL_WATCH, "Crash watch running", NotificationManager.IMPORTANCE_LOW);
        watch.setDescription("Shown while Zetway is watching the motion sensor.");
        nm.createNotificationChannel(watch);

        // Loud: this one has to wake someone who has just come off a bike.
        NotificationChannel alert = new NotificationChannel(
            CHANNEL_ALERT, "Crash alert", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Fires when an impact is detected.");
        // The channel does NOT vibrate, and that is deliberate. A channel's
        // own pattern is posted as a separate vibration, and the vibrator
        // dump showed it superseding our 35-second buzz 800ms in: the phone
        // shook for three seconds and then went still for the rest of the
        // countdown. vibrateHard() owns the buzz; the notification owns the
        // sound and the screen. (The id is versioned because a channel's
        // settings are frozen the moment it is first created.)
        alert.enableVibration(false);
        alert.setBypassDnd(true);
        // Shown in full on the lock screen. The default hides the text there.
        alert.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        // An alarm sound at alarm volume, not a notification blip at
        // notification volume. A phone on silent still rings for an alarm,
        // and somebody face-down on a road needs the louder one.
        Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (alarmSound == null) {
            alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        alert.setSound(alarmSound, new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build());
        nm.createNotificationChannel(alert);
    }

    private void vibrateHard() {
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm =
                    (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm == null ? null : vm.getDefaultVibrator();
            } else {
                v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v != null && v.hasVibrator()) {
                // Long enough to outlast the countdown, because a buzz that
                // stops after three seconds is the one a rider in a jacket
                // pocket never feels. Tiled rather than looped: an infinite
                // waveform would keep going if the notification were swiped
                // away instead of opened, and nothing would be left to cancel
                // it. stopVibration still ends it early on "I'm OK".
                long[] unit = { 0, 600, 250, 600, 250, 1500 };
                long[] shape = new long[unit.length * 11]; // 3.2s x 11 = 35.2s
                for (int i = 0; i < 11; i++) {
                    System.arraycopy(unit, 0, shape, i * unit.length, unit.length);
                }
                VibrationEffect effect = VibrationEffect.createWaveform(shape, -1);
                // Alarm usage, not the default. Without it Android files the
                // buzz under USAGE_UNKNOWN, which Do Not Disturb and a ringer
                // profile with vibration turned off both swallow silently —
                // the sound plays and nothing moves, which is exactly what we
                // saw on a real handset.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    v.vibrate(effect, new VibrationAttributes.Builder()
                        .setUsage(VibrationAttributes.USAGE_ALARM)
                        .build());
                } else {
                    v.vibrate(effect, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                }
            }
        } catch (Exception ignored) {
            // A missing buzz must never stop the alert being raised.
        }
    }

    /**
     * Whether this app may actually put a screen in front of a locked phone.
     *
     * Android 14 reserved full-screen intents for calling and alarm apps.
     * Everything else is silently downgraded to a heads-up notification,
     * which on a locked screen means the alert never appears — the rider
     * would have to wake the phone and look. Worth asking about before
     * someone relies on this on a ride, which is why it is exposed to the UI.
     */
    public static boolean canRaiseOnLockScreen(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
    }

    /** Whether Android has been told to stop throttling this app in the
     *  background. Without it many phones, and nearly every Chinese OEM skin,
     *  will kill the service after a few minutes in a pocket. */
    public static boolean isUnrestricted(Context context) {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    @Override
    public void onDestroy() {
        running = false;
        if (sensors != null) sensors.unregisterListener(sensorListener);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Started, not bound; the plugin talks to it through statics.
    }
}
