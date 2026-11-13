package mu.zetway.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;

/**
 * Saying it out loud, because the screen is not always reachable.
 *
 * The web build has no equivalent and cannot get one: speechSynthesis is
 * simply absent from the Android WebView — not empty, undefined — so every
 * read-aloud control in this app renders nothing once it is wrapped. That was
 * worth finding out before the pitch rather than during it, and it is the
 * whole reason this class exists in Java instead of six lines of TypeScript.
 *
 * Two decisions here are about being heard rather than about speaking.
 *
 * It goes out over the alarm stream, the same route the crash buzzer takes.
 * A phone face-down in a ditch is usually a phone on silent, and the usage
 * Android assigns by default to an app's speech is the first thing Do Not
 * Disturb throws away. An alarm is the one category that survives, and
 * confirming an ambulance is on the way is squarely an alarm.
 *
 * It queues rather than drops. The engine takes a moment to initialise, and
 * the first thing this class is ever asked to say — "I heard you" — arrives
 * inside that moment. Speaking it late is fine. Losing it is not, because the
 * rider is lying there with no other way to know the shout worked.
 */
class Speaker {

    private final TextToSpeech tts;
    private boolean ready = false;
    private boolean usable = false;

    /** Said before the engine finished waking up, replayed once it has. */
    private final Deque<String> pending = new ArrayDeque<>();

    Speaker(Context context) {
        tts = new TextToSpeech(context.getApplicationContext(), status -> {
            ready = true;
            usable = status == TextToSpeech.SUCCESS;
            if (usable) configure();
            flush();
        });
    }

    private void configure() {
        try {
            tts.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
        } catch (Throwable ignored) {
            // An engine that will not take audio attributes still speaks, just
            // on the default stream. Quieter is better than silent.
        }

        // English first because that is the language of this app's own words.
        // A device with no English voice is rare but real, and French is the
        // sensible second on a Mauritian phone, so it is tried before giving
        // up on the engine's default.
        if (!setLanguage(Locale.UK) && !setLanguage(Locale.US) && !setLanguage(Locale.FRANCE)) {
            // Leave whatever the engine chose. It may mispronounce, but a
            // mispronounced "calling an ambulance" still carries.
            usable = true;
        }

        // Slightly under normal pace. Every word here is one somebody needs to
        // catch first time, through a helmet, probably in pain.
        try {
            tts.setSpeechRate(0.92f);
        } catch (Throwable ignored) {
            // Not worth failing over.
        }
    }

    private boolean setLanguage(Locale locale) {
        try {
            int result = tts.setLanguage(locale);
            return result != TextToSpeech.LANG_MISSING_DATA
                && result != TextToSpeech.LANG_NOT_SUPPORTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** True once the engine has reported in and can actually speak. Lets the
     *  screen above stop promising spoken confirmation it will not get. */
    boolean isUsable() {
        return ready && usable;
    }

    /**
     * Say it, interrupting anything already being said.
     *
     * Interrupting is deliberate. These utterances are a countdown and a
     * confirmation; the newest is always the one that matters, and queueing
     * them would have the phone announcing "calling in five" after the call
     * had already connected.
     */
    void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ready) {
            pending.addLast(text);
            return;
        }
        if (!usable) return;
        try {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "zetway:" + text.hashCode());
        } catch (Throwable ignored) {
            // Nothing useful to do; the screen still shows the same words.
        }
    }

    private void flush() {
        if (!usable) {
            pending.clear();
            return;
        }
        // Only the last queued line is worth saying. Anything older was a
        // countdown step that has already elapsed.
        String last = pending.pollLast();
        pending.clear();
        if (last != null) speak(last);
    }

    void stop() {
        try {
            tts.stop();
        } catch (Throwable ignored) {
            // Already quiet.
        }
    }

    void release() {
        try {
            tts.stop();
            tts.shutdown();
        } catch (Throwable ignored) {
            // Shutting down a dead engine is not an error worth propagating.
        }
    }
}
