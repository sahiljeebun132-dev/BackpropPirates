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

        /** The engine or language in use changed. What this feature can
         *  understand depends on both, so the screen states them. */
        void onConfig(String language, boolean onDevice);

        /** Words are no longer possible, but loudness still is: the shout
         *  trigger is live and the word trigger is not. */
        void onPartlyDegraded(String reason);

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

    /**
     * Languages to try, best first, ending in the phone's own default.
     *
     * French leads because Kreol is French-lexified and that is the only way
     * "oskour" is ever going to match. But a phone with no French pack is not
     * a phone that cannot help: English still catches "help", "ambulance" and
     * "I can't move", and English is the pack most likely to be installed.
     * Null means "whatever this phone is set to", which is the last resort
     * and still better than silence.
     *
     * This ladder exists because the first device this ran on had no French
     * pack at all: the recogniser returned LANGUAGE_NOT_SUPPORTED forever
     * while the app sat there looking like it was listening.
     */
    private static final String[] LANGUAGES = { "fr-FR", "en-US", null };

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private boolean onDevice = false;
    private boolean triedCloud = false;
    private boolean wordsAvailable = true;
    private int langIndex = 0;
    private int consecutiveErrors = 0;
    private ShoutWatch shout;

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

    /** False once recognition has been given up on and only the shout
     *  trigger remains. The screen says so rather than inviting the rider to
     *  say a word nothing is listening for. */
    boolean hasWords() {
        return wordsAvailable;
    }

    /** The language tag actually in use, or "default" when the phone's own
     *  setting is being relied on. Printed on screen, because what the app
     *  can understand depends entirely on it. */
    String language() {
        String tag = LANGUAGES[Math.min(langIndex, LANGUAGES.length - 1)];
        return tag == null ? "default" : tag;
    }

    /** Begin. Safe to call twice; the second call is ignored. */
    void start() {
        if (listening) return;
        listening = true;
        consecutiveErrors = 0;
        langIndex = 0;
        triedCloud = false;
        wordsAvailable = true;
        main.post(this::openRecognizer);
    }

    void stop() {
        listening = false;
        if (shout != null) shout.stop();
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
            if (!triedCloud
                && Build.VERSION.SDK_INT >= 33
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
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
            // Deliberately does NOT clear the error count. A recogniser with
            // no language pack happily reports itself ready and then fails,
            // every single time, so treating readiness as success turned a
            // dead configuration into an endless retry loop that never told
            // anybody. Only actual words count as working.
            @Override public void onReadyForSpeech(Bundle params) { }
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

                // A missing language pack is not a broken phone, it is the
                // wrong language. Step down the ladder rather than counting
                // it as a failure: French, then English, then whatever this
                // phone is set to, and only then the cloud.
                boolean wrongLanguage =
                    error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED
                        || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE;

                if (wrongLanguage) {
                    if (langIndex < LANGUAGES.length - 1) {
                        langIndex++;
                        restart();
                        return;
                    }
                    // Out of languages on this engine. The on-device
                    // recogniser is preferred because it needs no signal, but
                    // a cloud recogniser that works beats an offline one that
                    // does not, so try that before giving up — and say which
                    // one was settled on, because it decides whether this
                    // feature works in a dead spot.
                    if (!triedCloud && SpeechRecognizer.isRecognitionAvailable(context)) {
                        triedCloud = true;
                        langIndex = 0;
                        restart();
                        return;
                    }
                    fail(describe(error));
                    return;
                }

                if (!benign) consecutiveErrors++;

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    fail(describe(error));
                    return;
                }
                restart();
            }
        });

        listener.onConfig(language(), onDevice);

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
        String tag = LANGUAGES[Math.min(langIndex, LANGUAGES.length - 1)];
        if (tag != null) {
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag);
        }
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
        // Words came back, so this configuration works.
        consecutiveErrors = 0;
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

    /**
     * Words are no longer possible. Loudness still is.
     *
     * This is the whole point of having two triggers. Recognition needs a
     * language pack and often a signal; a shout needs neither. So a failure
     * here is a step down rather than a stop, and the rider is told which of
     * the two they still have rather than being left to guess.
     */
    private void fail(String reason) {
        closeRecognizer();

        if (!listening) {
            listener.onDegraded(reason);
            return;
        }

        if (shout == null) {
            shout = new ShoutWatch(new ShoutWatch.Listener() {
                @Override
                public void onLevel(float level) {
                    listener.onLevel(level);
                }

                @Override
                public void onFailed(String why) {
                    listening = false;
                    listener.onDegraded(why);
                }
            });
        }

        shout.start();
        if (shout.isRunning()) {
            wordsAvailable = false;
            listener.onConfig("shout-only", onDevice);
            listener.onPartlyDegraded(reason);
            return;
        }

        listening = false;
        listener.onDegraded(reason);
    }

    private void closeRecognizer() {
        if (recognizer == null) return;
        SpeechRecognizer doomed = recognizer;
        recognizer = null;
        try {
            // Detach first. cancel() makes the recogniser report ERROR_CLIENT
            // to whoever is listening, and since the restart loop closes the
            // old session before opening the next one, every single restart
            // was counting its own teardown as a failure. Six restarts later
            // the circuit breaker tripped and hands-free help switched itself
            // off — on a working phone, for no reason at all.
            doomed.setRecognitionListener(null);
            doomed.cancel();
            doomed.destroy();
        } catch (Throwable ignored) {
            // Destroying a recogniser that already died is not worth a crash
            // in the one code path that exists for emergencies.
        }
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
