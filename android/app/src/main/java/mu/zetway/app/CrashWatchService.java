package mu.zetway.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

/**
 * Watches the accelerometer while Zetway is not on screen, and gathers the
 * two signals that say whether the bang was a vehicle or a dropped phone.
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
 * The accelerometer decides, and only the accelerometer. The gyroscope and
 * the speed from the location provider are measured alongside it and travel
 * with the alert, but nothing they say can stop the alarm or lower the bar.
 * That is deliberate and it is the whole design: a missed crash costs far
 * more than a false one, the thirty-second countdown is already the app's
 * answer to being wrong, and a rule that could suppress an alert would be
 * the one bug in here nobody discovers until it matters. What these two add
 * is evidence, so a rider looking at the red screen — and whoever they hand
 * the phone to — can see whether the phone spun and whether the vehicle was
 * moving, instead of one number with no context.
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
    public static final String EXTRA_IMPACT_ROTATION = "impactRotation";
    public static final String EXTRA_SPEED_BEFORE = "speedBefore";
    public static final String EXTRA_SPEED_AFTER = "speedAfter";

    private static final String TAG = "ZetwayCrashWatch";
    private static final String CHANNEL_WATCH = "zetway.watch";
    private static final String CHANNEL_ALERT = "zetway.alert.v3";
    private static final int NOTE_WATCH = 1001;
    private static final int NOTE_ALERT = 1002;

    /** Nothing measured. Used for every figure the phone could not supply, so
     *  "we do not know" is never dressed up as a zero the rider might read as
     *  "you were stopped" or "it did not spin". */
    public static final float UNKNOWN = -1f;

    /** How far back the gyroscope is searched for the peak that belongs to
     *  this impact. A car that is struck starts yawing with the contact, but a
     *  rider usually loses the bike a moment before the phone registers the
     *  hit, so the window reaches back far enough to catch that. */
    private static final long ROTATION_LOOKBACK_MS = 3000;

    /** How long the service keeps measuring after the spike. Covers the spin
     *  that follows a collision and gives a 1 Hz location provider two or
     *  three chances to report the speed the vehicle is left at. The alert is
     *  already on screen throughout: nothing here delays it. */
    private static final long EVIDENCE_WINDOW_MS = 3000;

    /** A fix older than this says nothing useful about the speed at the
     *  moment of the crash, so it is reported as unknown rather than quoted. */
    private static final long FIX_STALE_MS = 20_000;

    /**
     * One impact and everything measured around it.
     *
     * The accelerometer alone cannot tell a collision from a phone hitting the
     * footwell, which is why the countdown exists. These extra figures do not
     * change that and must never be allowed to: they ride along so the rider,
     * and whoever they end up talking to, can see what the phone actually
     * sensed instead of one number with no context.
     */
    public static final class Impact {
        /** Peak acceleration magnitude at the trigger, m/s², gravity included. */
        public final float peak;
        /** Peak angular rate around the impact, rad/s. UNKNOWN with no gyroscope. */
        public final float rotation;
        /** Speed from the last fix before the spike, m/s. UNKNOWN if none. */
        public final float speedBefore;
        /** Speed once the dust settled, m/s. UNKNOWN until the window closes. */
        public final float speedAfter;
        public final boolean test;
        /** False while the post-impact window is still open. */
        public final boolean complete;

        Impact(float peak, float rotation, float speedBefore, float speedAfter,
               boolean test, boolean complete) {
            this.peak = peak;
            this.rotation = rotation;
            this.speedBefore = speedBefore;
            this.speedAfter = speedAfter;
            this.test = test;
            this.complete = complete;
        }
    }

    /** Set by the plugin while a web view is alive to receive the news. */
    public interface ImpactListener {
        /** The alert. Sent the instant the accelerometer crosses the bar. */
        void onImpact(Impact impact);
        /** The same impact once the post-impact window has closed, carrying
         *  the figures that did not exist yet when the alarm went off. */
        void onEvidence(Impact impact);
    }

    private static volatile ImpactListener listener;

    /**
     * An impact that has not reached the web layer yet, because the web view
     * was not running when it happened. The plugin collects it once the page
     * is up, so a crash detected with the app closed still raises the alert
     * rather than vanishing. null means nothing pending.
     */
    private static volatile Impact pending;

    public static void setListener(ImpactListener l) {
        listener = l;
    }

    public static Impact consumePending() {
        Impact p = pending;
        pending = null;
        return p;
    }

    /** So the UI can show the truth about whether background watching is on. */
    public static volatile boolean running = false;

    private SensorManager sensors;
    private Sensor accelerometer;
    private Sensor gyroscope;
    private LocationManager locations;
    private PowerManager.WakeLock wakeLock;
    private final Handler main = new Handler(Looper.getMainLooper());
    private float threshold = 30f;
    private boolean testMode = false;
    private boolean armed = true;

    /**
     * Recent angular rates, newest at gyroHistoryHead - 1, wrapping.
     *
     * A ring rather than a running maximum because the peak has to be the peak
     * of a window that ends at the impact. A running maximum would still be
     * carrying the spin from a turn taken a minute ago.
     *
     * 256 slots is about five seconds at SENSOR_DELAY_GAME, comfortably more
     * than the three the lookback asks for even if the rate drifts.
     */
    private static final int GYRO_HISTORY = 256;
    private final float[] gyroRate = new float[GYRO_HISTORY];
    private final long[] gyroAt = new long[GYRO_HISTORY];
    private int gyroHistoryHead = 0;
    /** False until a gyroscope reading actually arrives, so a sensor that is
     *  listed but silent reads as "no rotation measured", not "0 rad/s". */
    private boolean gyroSeen = false;

    /** Last speed the location provider gave us, and when, on the monotonic
     *  clock. elapsedRealtime, not wall time: the phone can change timezone
     *  mid-ride and NTP can step the clock. */
    private float lastSpeed = UNKNOWN;
    private long lastSpeedAt = 0;
    private Location lastFix;

    /** The impact currently being measured, held while the post-impact window
     *  is open so the late figures can be folded into it. */
    private Impact inFlight;
    private float windowRotation = UNKNOWN;

    private final SensorEventListener sensorListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
                onGyro(event);
                return;
            }
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

    /** Angular rate about all three axes, in rad/s. A phone lying still reads
     *  near zero; a phone being carried reads a few; a vehicle being spun
     *  reads far more, and that difference is the point of measuring it. */
    private void onGyro(SensorEvent event) {
        float x = event.values[0], y = event.values[1], z = event.values[2];
        float rate = (float) Math.sqrt(x * x + y * y + z * z);
        gyroSeen = true;
        gyroRate[gyroHistoryHead] = rate;
        gyroAt[gyroHistoryHead] = SystemClock.elapsedRealtime();
        gyroHistoryHead = (gyroHistoryHead + 1) % GYRO_HISTORY;
        // While the window after an impact is open, every later reading can
        // still raise the peak: the spin usually outlasts the bang.
        if (inFlight != null && rate > windowRotation) windowRotation = rate;
    }

    private float peakRotationSince(long sinceMs) {
        if (!gyroSeen) return UNKNOWN;
        float peak = 0f;
        for (int i = 0; i < GYRO_HISTORY; i++) {
            if (gyroAt[i] >= sinceMs && gyroRate[i] > peak) peak = gyroRate[i];
        }
        return peak;
    }

    /**
     * Speed at this moment, or UNKNOWN.
     *
     * A fix from four minutes ago describes a different part of the ride, so
     * it is thrown away rather than quoted. Saying nothing is recoverable;
     * telling a dispatcher the rider was doing 60 when the phone last looked
     * five minutes earlier is not.
     */
    private float freshSpeed() {
        if (lastSpeed < 0) return UNKNOWN;
        if (SystemClock.elapsedRealtime() - lastSpeedAt > FIX_STALE_MS) return UNKNOWN;
        return lastSpeed;
    }

    /**
     * Speed from each fix, preferring what the provider measured.
     *
     * GPS derives speed from Doppler shift, which is more accurate than
     * differencing two positions and does not need a second fix to exist. The
     * fallback is for providers that report no speed at all — the network
     * provider is one — where two positions and the time between them is the
     * only answer available.
     */
    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location fix) {
            float speed = UNKNOWN;
            if (fix.hasSpeed()) {
                speed = fix.getSpeed();
            } else if (lastFix != null) {
                float seconds = (fix.getElapsedRealtimeNanos()
                    - lastFix.getElapsedRealtimeNanos()) / 1_000_000_000f;
                if (seconds > 0.1f) speed = lastFix.distanceTo(fix) / seconds;
            }
            lastFix = fix;
            if (speed >= 0) {
                lastSpeed = speed;
                lastSpeedAt = SystemClock.elapsedRealtime();
            }
        }

        // Required on API levels below 30, where the default methods on
        // LocationListener do not exist yet and an abstract method would
        // crash the service the first time a provider changed state.
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
        @Override public void onProviderEnabled(String provider) { }
        @Override public void onProviderDisabled(String provider) { }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) {
            accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            // May be null. Cheap phones ship without one, and the watch has to
            // work on those exactly as it did before: the rotation figure is
            // simply reported as not measured.
            gyroscope = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        }
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
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
        if (gyroscope != null && sensors != null) {
            // Same rate as the accelerometer so the two histories line up and
            // the rotation window can be cut at the moment of the spike.
            sensors.registerListener(sensorListener, gyroscope, SensorManager.SENSOR_DELAY_GAME);
        }
        startLocationUpdates();

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

    /**
     * Ask the platform for a fix every second or so, if the rider granted it.
     *
     * "Was moving fast, then suddenly was not" is the single most telling
     * thing about a car crash, and it cannot be read off an accelerometer.
     * Refused permission is not a failure here: the speeds are reported as
     * not measured and nothing else about the watch changes.
     */
    private void startLocationUpdates() {
        if (locations == null) return;
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        // GPS for the speed itself; network as the one that still answers in
        // a tunnel or a multi-storey, where its own fix is poor but a change
        // from moving to stopped is still visible.
        String[] providers = { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER };
        for (String provider : providers) {
            try {
                if (!locations.isProviderEnabled(provider)) continue;
                // 1000 ms and 0 m: a crash is over in under a second, so the
                // last fix before it has to be recent. Distance filtering is
                // off because a vehicle that has stopped stops producing
                // fixes under one, and a stop is exactly what we want to see.
                locations.requestLocationUpdates(provider, 1000L, 0f, locationListener,
                    Looper.getMainLooper());
            } catch (SecurityException | IllegalArgumentException ignored) {
                // A provider this device does not have, or a permission
                // revoked between the check and the call. Neither is worth
                // stopping the watch for.
            }
        }
    }

    private void onImpact(float peak) {
        long now = SystemClock.elapsedRealtime();
        float rotation = peakRotationSince(now - ROTATION_LOOKBACK_MS);
        float speedBefore = freshSpeed();

        // Dispatched with what is known right now, before anything waits for
        // anything. The figures that need the next few seconds follow in a
        // second message; the alarm must not be one of them.
        Impact immediate = new Impact(peak, rotation, speedBefore, UNKNOWN, testMode, false);
        inFlight = immediate;
        windowRotation = rotation;
        dispatch(immediate, false);
        raiseAlert(peak);

        main.postDelayed(this::closeEvidenceWindow, EVIDENCE_WINDOW_MS);
    }

    /**
     * The same impact, measured through.
     *
     * Nothing here can cancel or downgrade the alert that is already running.
     * It exists so the rider can see what the phone sensed rather than one
     * number: a 5g spike with the vehicle still doing 40 and barely turning
     * reads very differently from a 5g spike that ended at a standstill.
     */
    private void closeEvidenceWindow() {
        Impact i = inFlight;
        if (i == null) return;
        inFlight = null;
        Impact complete = new Impact(
            i.peak, windowRotation, i.speedBefore, freshSpeed(), i.test, true);
        Log.i(TAG, "impact peak=" + complete.peak + " m/s2"
            + " rotation=" + complete.rotation + " rad/s"
            + " speedBefore=" + complete.speedBefore + " m/s"
            + " speedAfter=" + complete.speedAfter + " m/s"
            + " test=" + complete.test);
        dispatch(complete, true);
    }

    private void dispatch(Impact impact, boolean isEvidence) {
        ImpactListener l = listener;
        if (l != null) {
            if (isEvidence) l.onEvidence(impact); else l.onImpact(impact);
        }
        // Kept only for an impact no page has seen. An impact already
        // delivered to a live listener must never also sit here, or reopening
        // the app hours later would raise the same crash a second time.
        if (l == null) {
            pending = impact;
        } else if (isEvidence && pending != null) {
            // A page appeared mid-window. The waiting copy becomes the full
            // one rather than the half-measured one.
            pending = impact;
        }
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
            .putExtra(EXTRA_IMPACT_PEAK, peak)
            // Built at the moment of the spike, so these are what was known
            // then: the speed afterwards does not exist yet. This intent is
            // the route used when Android has killed the process entirely,
            // where a half-measured impact still beats no impact.
            .putExtra(EXTRA_IMPACT_ROTATION, inFlight == null ? UNKNOWN : inFlight.rotation)
            .putExtra(EXTRA_SPEED_BEFORE, inFlight == null ? UNKNOWN : inFlight.speedBefore)
            .putExtra(EXTRA_SPEED_AFTER, UNKNOWN);

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
        if (locations != null) {
            try {
                locations.removeUpdates(locationListener);
            } catch (Exception ignored) {
                // Never registered, or the permission was revoked under us.
            }
        }
        main.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Started, not bound; the plugin talks to it through statics.
    }
}
