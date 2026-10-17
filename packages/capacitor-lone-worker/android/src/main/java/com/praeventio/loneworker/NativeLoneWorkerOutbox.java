package com.praeventio.loneworker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Small, synchronous Android-owned outbox for session heartbeats.
 *
 * The event is committed before any network I/O. A UUID is reused for every
 * retry, so the server transaction can make delivery idempotent. The opaque
 * capability is stripped from dead-letter records and is never logged.
 * SharedPreferences is sufficient for the bounded heartbeat payloads here and
 * avoids making the native service depend on the WebView/Capacitor SQLite.
 */
final class NativeLoneWorkerOutbox {
    static final String PREFS = "guardian_native_lone_worker_outbox";
    private static final String PREF_QUEUE = "queue";
    private static final String PREF_DEAD_LETTERS = "deadLetters";
    private static final int MAX_QUEUE = 10_000;
    private static final Object LOCK = new Object();

    private NativeLoneWorkerOutbox() { }

    static boolean enqueue(
        Context context,
        String projectId,
        String sessionId,
        String capability,
        String apiBaseUrl,
        JSONObject payload
    ) {
        synchronized (LOCK) {
            try {
                SharedPreferences prefs = prefs(context);
                String previousQueue = prefs.getString(PREF_QUEUE, "[]");
                String previousLetters = prefs.getString(PREF_DEAD_LETTERS, "[]");
                JSONArray queue = readArray(previousQueue);
                JSONArray letters = readArray(previousLetters);
                if (queue.length() >= MAX_QUEUE) {
                    // Prepare eviction and append in memory; persist both in
                    // one transaction only after the new event is valid.
                    JSONObject oldest = queue.optJSONObject(0);
                    if (oldest != null) {
                        sanitizeDeadLetter(oldest, "queue_capacity");
                        letters.put(oldest);
                    }
                    JSONArray remaining = new JSONArray();
                    for (int i = 1; i < queue.length(); i++) remaining.put(queue.opt(i));
                    queue = remaining;
                }
                String clientEventId = UUID.randomUUID().toString();
                payload.put("clientEventId", clientEventId);
                JSONObject event = new JSONObject();
                event.put("clientEventId", clientEventId);
                event.put("projectId", projectId);
                event.put("sessionId", sessionId);
                event.put("capability", capability);
                event.put("apiBaseUrl", apiBaseUrl);
                event.put("payload", payload);
                event.put("queuedAt", System.currentTimeMillis());
                queue.put(event);
                return commitEnqueue(prefs, queue.toString(), letters.toString(), previousQueue, previousLetters);
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    private static boolean commitEnqueue(
        SharedPreferences prefs, String queue, String letters, String previousQueue, String previousLetters
    ) {
        if (queue == null || letters == null) return false;
        try {
            if (prefs.edit()
                .putString(PREF_QUEUE, queue)
                .putString(PREF_DEAD_LETTERS, letters)
                .commit()) return true;
        } catch (Exception ignored) { }
        // Android changes memory before reporting a disk failure. Restore the
        // snapshot while the producer lock is still held, including dead letters.
        try {
            prefs.edit()
                .putString(PREF_QUEUE, previousQueue)
                .putString(PREF_DEAD_LETTERS, previousLetters)
                .commit();
        } catch (Exception ignored) { }
        return false;
    }

    static JSONArray readQueue(Context context) {
        synchronized (LOCK) {
            return readArray(prefs(context).getString(PREF_QUEUE, "[]"));
        }
    }

    static JSONObject first(Context context) {
        synchronized (LOCK) {
            JSONArray queue = readArray(prefs(context).getString(PREF_QUEUE, "[]"));
            return queue.optJSONObject(0);
        }
    }

    /** Confirm only the event actually sent, against the current queue. -1 means retry. */
    static int acknowledge(Context context, String clientEventId, String deadLetterReason) {
        return acknowledge(context, clientEventId, null, deadLetterReason);
    }

    /** An unidentified record may be quarantined only while it remains the exact head. */
    static int quarantineUnidentifiedHead(Context context, String expectedHead) {
        return acknowledge(context, null, expectedHead, "missing_client_event_id");
    }

    private static int acknowledge(
        Context context, String clientEventId, String expectedHead, String deadLetterReason
    ) {
        synchronized (LOCK) {
            boolean identified = clientEventId != null && !clientEventId.trim().isEmpty();
            if (!identified && expectedHead == null) return -1;
            SharedPreferences prefs = prefs(context);
            String previousQueue = prefs.getString(PREF_QUEUE, "[]");
            String previousLetters = prefs.getString(PREF_DEAD_LETTERS, "[]");
            JSONArray queue = readArray(previousQueue);
            JSONArray letters = readArray(previousLetters);
            JSONArray remaining = new JSONArray();
            boolean found = false;
            for (int i = 0; i < queue.length(); i++) {
                JSONObject event = queue.optJSONObject(i);
                String currentId = event == null ? null : event.optString("clientEventId", null);
                boolean matches = event != null && (identified
                    ? clientEventId.equals(currentId)
                    : i == 0 && (currentId == null || currentId.trim().isEmpty())
                        && expectedHead.equals(event.toString()));
                if (!found && matches) {
                    found = true;
                    if (deadLetterReason != null) {
                        sanitizeDeadLetter(event, deadLetterReason);
                        letters.put(event);
                    }
                } else {
                    remaining.put(queue.opt(i));
                }
            }
            // A stop/capacity eviction may already have removed the sent event.
            if (!found) return queue.length();
            try {
                if (prefs.edit()
                    .putString(PREF_QUEUE, remaining.toString())
                    .putString(PREF_DEAD_LETTERS, letters.toString())
                    .commit()) return remaining.length();
            } catch (Exception ignored) { }
            // SharedPreferences updates memory before reporting disk failure.
            // Restore both arrays so this process can retry the same event too.
            try {
                prefs.edit()
                    .putString(PREF_QUEUE, previousQueue)
                    .putString(PREF_DEAD_LETTERS, previousLetters)
                    .commit();
            } catch (Exception ignored) { }
            return -1;
        }
    }

    static void deadLetterSession(
        Context context,
        String projectId,
        String sessionId,
        String reason
    ) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
            JSONArray remaining = new JSONArray();
            JSONArray letters = readArray(prefs.getString(PREF_DEAD_LETTERS, "[]"));
            for (int i = 0; i < queue.length(); i++) {
                JSONObject event = queue.optJSONObject(i);
                if (event == null) continue;
                if (!projectId.equals(event.optString("projectId", null))
                    || !sessionId.equals(event.optString("sessionId", null))) {
                    remaining.put(event);
                    continue;
                }
                sanitizeDeadLetter(event, reason);
                letters.put(event);
            }
            prefs.edit()
                .putString(PREF_QUEUE, remaining.toString())
                .putString(PREF_DEAD_LETTERS, letters.toString())
                .commit();
        }
    }

    private static void moveFirstToDeadLetter(
        SharedPreferences prefs,
        JSONArray queue,
        String reason
    ) {
        JSONArray letters = readArray(prefs.getString(PREF_DEAD_LETTERS, "[]"));
        JSONObject event = queue.optJSONObject(0);
        if (event != null) {
            sanitizeDeadLetter(event, reason);
            letters.put(event);
        }
        JSONArray remaining = new JSONArray();
        for (int i = 1; i < queue.length(); i++) remaining.put(queue.opt(i));
        prefs.edit()
            .putString(PREF_QUEUE, remaining.toString())
            .putString(PREF_DEAD_LETTERS, letters.toString())
            .commit();
    }

    private static void sanitizeDeadLetter(JSONObject event, String reason) {
        event.remove("capability");
        event.remove("apiBaseUrl");
        try {
            event.put("deadLetterReason", reason);
            event.put("deadLetteredAt", System.currentTimeMillis());
        } catch (Exception ignored) { }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray readArray(String raw) {
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }
}
