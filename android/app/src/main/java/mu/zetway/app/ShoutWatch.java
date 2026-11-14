package mu.zetway.app;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

/**
 * Loudness, with nothing else involved.
 *
 * This exists because the first version made a quiet mistake: the shout
 * trigger read its levels from the speech recogniser's own metering, so the
 * moment recognition failed the shout trigger died with it. That is exactly
 * backwards. Recognition is the part that needs a language pack, a model and
 * frequently a signal; shouting is the part that was supposed to work when
 * none of those are there. Tying the robust trigger to the fragile one meant
 * there was really only the fragile one.
 *
 * So this reads the microphone directly. No model, no language, no network,
 * no Google services — sixteen thousand samples a second, squared and
 * averaged, which is arithmetic the phone was always going to manage.
 *
 * It cannot run at the same time as the recogniser: one process does not get
 * the microphone twice. So the two take turns, and the rule is simple —
 * recognition while it works, because words are better evidence than volume;
 * this the instant it does not.
 */
class ShoutWatch {

    interface Listener {
        /** Loudness on the same rough 0–10 scale the recogniser reports, so
         *  the detector above does not care which of the two is feeding it. */
        void onLevel(float level);

        /** The microphone could not be read at all. */
        void onFailed(String reason);
    }

    private static final int SAMPLE_RATE = 16000;
    /** A tenth of a second, which is about how often the recogniser reports
     *  and therefore what the shout detector's timings were tuned against. */
    private static final int FRAME = SAMPLE_RATE / 10;

    private final Listener listener;
    private AudioRecord record;
    private Thread thread;
    private volatile boolean running = false;

    ShoutWatch(Listener listener) {
        this.listener = listener;
    }

    boolean isRunning() {
        return running;
    }

    /** The microphone permission is checked by the caller, which is why this
     *  can suppress the lint rather than re-ask and race with it. */
    @SuppressLint("MissingPermission")
    void start() {
        if (running) return;

        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) {
            listener.onFailed("This phone would not open its microphone.");
            return;
        }
        // Four frames of headroom. A short buffer drops samples whenever the
        // phone is busy, and the phone is busiest right after a crash.
        int bufferSize = Math.max(minBuffer, FRAME * 2 * 4);

        try {
            record = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            );
        } catch (Throwable t) {
            listener.onFailed("This phone would not open its microphone.");
            return;
        }

        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            release();
            listener.onFailed("This phone would not open its microphone.");
            return;
        }

        try {
            record.startRecording();
        } catch (Throwable t) {
            release();
            listener.onFailed("The microphone is busy.");
            return;
        }

        running = true;
        thread = new Thread(this::loop, "zetway-shout");
        thread.setPriority(Thread.NORM_PRIORITY);
        thread.start();
    }

    private void loop() {
        short[] buffer = new short[FRAME];
        int consecutiveBad = 0;

        while (running) {
            int read;
            try {
                read = record.read(buffer, 0, buffer.length);
            } catch (Throwable t) {
                break;
            }
            if (read <= 0) {
                // An emulator with no audio device returns an error forever.
                // Give up rather than spin a thread against it.
                if (++consecutiveBad > 20) {
                    final String why = "The microphone returned no audio.";
                    running = false;
                    listener.onFailed(why);
                    break;
                }
                continue;
            }
            consecutiveBad = 0;

            // Root mean square over the frame. Summed as a long because
            // 1600 samples squared overflows an int comfortably.
            long sum = 0;
            for (int i = 0; i < read; i++) {
                sum += (long) buffer[i] * buffer[i];
            }
            double rms = Math.sqrt((double) sum / read);

            listener.onLevel(toLevel(rms));
        }
        release();
    }

    /**
     * Raw amplitude to the same 0–10 scale the recogniser uses.
     *
     * Full scale for 16-bit audio is 32767, so the ratio gives dBFS: about
     * -90 in a silent room, about -10 for someone shouting into the phone.
     * Mapping -60..0 onto 0..10 puts ordinary speech near the middle and
     * leaves the top of the range for the thing this is actually for.
     *
     * The absolute calibration matters less than it might look, because the
     * detector above judges the gap above a rolling background rather than
     * the number itself.
     */
    static float toLevel(double rms) {
        if (rms <= 1.0) return 0f;
        double dbfs = 20.0 * Math.log10(rms / 32767.0);
        double level = (dbfs + 60.0) / 6.0;
        if (level < 0) return 0f;
        if (level > 10) return 10f;
        return (float) level;
    }

    void stop() {
        running = false;
        Thread t = thread;
        thread = null;
        if (t != null) {
            try {
                t.join(500);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        release();
    }

    private void release() {
        AudioRecord r = record;
        record = null;
        if (r == null) return;
        try {
            if (r.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) r.stop();
        } catch (Throwable ignored) {
            // Already stopped.
        }
        try {
            r.release();
        } catch (Throwable ignored) {
            // Already gone.
        }
    }
}
