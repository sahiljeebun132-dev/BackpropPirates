package mu.zetway.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Listening for someone who cannot reach their phone.
 *
 * The case this exists for is narrow and grim: the rider is under the machine,
 * conscious, and the phone is a metre away in the gravel. Every other part of
 * Zetway assumes a hand free to tap. This part assumes none.
 *
 * Two things had to be true for it to be worth shipping, and neither was free.
 *
 * The first is that it must not need the internet. The browser's own
 * SpeechRecognition sends audio away and waits for a reply, so on the Flacq
 * back roads at night — the exact place this is for — it fails silently.
 * Android has offered an on-device recogniser since 13, so this asks for that
 * one by name (the dedicated on-device recogniser on 33 and up, the offline
 * hint below it) and reports honestly when it cannot have it.
 *
 * The second is that it must survive not being understood. A person pinned
 * under a bike is not enunciating. So the words are only the first of two
 * triggers: every listening session also reports its raw loudness, and a
 * sustained shout fires the same alarm with no language involved at all. That
 * path needs no model, no network and no particular vocabulary, which makes it
 * the one that is actually always there. The word trigger is the nicer of the
 * two; the shout trigger is the one that will save somebody.
 *
 * The recogniser stops itself after every utterance and after every silence,
 * which is sensible for a search box and useless here, so this restarts it in
 * a loop for as long as the screen above it is listening. The restart carries
 * a short delay: without one, a device that errors instantly spins the loop
 * into a flat battery, and a flat battery is a worse outcome than a missed
 * word.
 */
class VoiceSos {

    /** What the screen above needs to know, as it happens. */
    interface Listener {
        /** Something was understood. Partial results arrive too — a shout of
         *  "help" may never be final, and waiting for final would be waiting
         *  for a pause the rider may not make. */
        void onHeard(String text, boolean partial);

        /** Loudness, roughly 0 (silence) to 10 (shouting), from the
         *  recogniser's own metering. Drives the no-language trigger. */
        void onLevel(float level);

        /** Listening stopped and will not resume: no recogniser on the device,
         *  permission refused, or too many failures in a row. The screen says
         *  so rather than sitting there looking like it is listening. */
        void onDegraded(String reason);
    }

    /** Give up after this many consecutive failures. Chosen so a device with
     *  no usable recogniser gives up in a couple of seconds rather than
     *  pretending, while a device that merely hit one bad session recovers. */
    private static final int MAX_CONSECUTIVE_ERRORS = 6;

    /** Pause between restarts. Long enough not to spin, short enough that the
     *  gap in coverage is smaller than the gap between two shouts. */
    private static final long RESTART_DELAY_MS = 350L;

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private boolean onDevice = false;
    private int consecutiveErrors = 0;

    VoiceSos(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
    }

    /** True when the recogniser in use runs on the phone itself, which is the
     *  only configuration this feature can honestly claim works offline. */
    boolean isOnDevice() {
        return onDevice;
    }

    boolean isListening() {
        return listening;
    }

    /** Begin. Safe to call twice; the second call is ignored. */
    void start() {
        if (listening) return;
        listening = true;
        consecutiveErrors = 0;
        main.post(this::openRecognizer);
    }

    void stop() {
        listening = false;
        main.post(() -> {
            main.removeCallbacksAndMessages(null);
            closeRecognizer();
        });
    }

    // ------------------------------------------------------------- internals

    private void openRecognizer() {
        if (!listening) return;
        closeRecognizer();

        // Prefer the recogniser that runs on the phone. On 33 and up Android
        // exposes it directly; below that the best available is a hint on the
        // intent, which some devices honour and some quietly ignore — hence
        // the flag, so the screen can say which one it got rather than
        // claiming offline support it may not have.
        try {
            if (Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
                onDevice = true;
            } else if (SpeechRecognizer.isRecognitionAvailable(context)) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(context);
                onDevice = false;
            } else {
                fail("This phone has no speech recogniser installed.");
                return;
            }
        } catch (Throwable t) {
            fail("Speech recogniser would not start: " + t.getMessage());
            return;
        }

        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { consecutiveErrors = 0; }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onEvent(int eventType, Bundle params) { }

            @Override
            public void onRmsChanged(float rmsdB) {
                // The documented range is -2 to 10 dB and devices do leave it,
                // so this is clamped rather than trusted. The screen above
                // only compares it against a threshold, so the absolute
                // calibration matters less than it not going wild.
                float level = Math.max(0f, Math.min(10f, rmsdB));
                listener.onLevel(level);
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                deliver(partialResults, true);
            }

            @Override
            public void onResults(Bundle results) {
                deliver(results, false);
                restart();
            }

            @Override
            public void onError(int error) {
                // Hearing nothing is the normal state of a phone lying in a
                // ditch, so silence and no-match are not failures and must not
                // count toward giving up. Everything else does.
                boolean benign =
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                        || error == SpeechRecognizer.ERROR_NO_MATCH;
                if (!benign) consecutiveErrors++;

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    fail(describe(error));
                    return;
                }
                restart();
            }
        });

        try {
            recognizer.startListening(buildIntent());
        } catch (Throwable t) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                fail("Could not start listening: " + t.getMessage());
            } else {
                restart();
            }
        }
    }

    private Intent buildIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        // French, because Kreol is French-lexified and no phone ships a
        // Morisyen model. "Oskour" comes back close enough to "au secours" to
        // match on a root; "help" survives in any model because it is short.
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.FRENCH.toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(
            RecognizerIntent.EXTRA_CALLING_PACKAGE,
            context.getPackageName()
        );
        return intent;
    }

    private void deliver(Bundle bundle, boolean partial) {
        if (bundle == null) return;
        ArrayList<String> matches =
            bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        // Every alternative is passed up, not just the best one. A slurred
        // shout often lands in the second or third candidate, and the matcher
        // above is cheap enough to look at all of them.
        for (String m : matches) {
            if (m != null && !m.trim().isEmpty()) {
                listener.onHeard(m, partial);
            }
        }
    }

    private void restart() {
        if (!listening) return;
        main.removeCallbacksAndMessages(null);
        main.postDelayed(this::openRecognizer, RESTART_DELAY_MS);
    }

    private void fail(String reason) {
        listening = false;
        closeRecognizer();
        listener.onDegraded(reason);
    }

    private void closeRecognizer() {
        if (recognizer == null) return;
        try {
            recognizer.cancel();
            recognizer.destroy();
        } catch (Throwable ignored) {
            // Destroying a recogniser that already died is not worth a crash
            // in the one code path that exists for emergencies.
        }
        recognizer = null;
    }

    /** Android's error codes, in words that can go on a screen. */
    private static String describe(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "The microphone could not be read.";
            case SpeechRecognizer.ERROR_CLIENT:
                return "The speech recogniser stopped unexpectedly.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Zetway was not allowed to use the microphone.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "This phone's recogniser needs the internet and there is none.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Another app is using the microphone.";
            case SpeechRecognizer.ERROR_SERVER:
                return "The speech service refused the request.";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "No French speech model is installed on this phone.";
            default:
                return "The speech recogniser failed.";
        }
    }
}
