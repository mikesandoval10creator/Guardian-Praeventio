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
                JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
                if (queue.length() >= MAX_QUEUE) {
                    moveFirstToDeadLetter(prefs, queue, "queue_capacity");
                    queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
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
                return prefs.edit().putString(PREF_QUEUE, queue.toString()).commit();
            } catch (Exception ignored) {
                return false;
            }
        }
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

    static int removeFirst(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
            if (queue.length() == 0) return 0;
            JSONArray remaining = new JSONArray();
            for (int i = 1; i < queue.length(); i++) remaining.put(queue.opt(i));
            prefs.edit().putString(PREF_QUEUE, remaining.toString()).commit();
            return remaining.length();
        }
    }

    static int moveFirstToDeadLetter(Context context, String reason) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
            if (queue.length() == 0) return 0;
            moveFirstToDeadLetter(prefs, queue, reason);
            return readArray(prefs.getString(PREF_QUEUE, "[]")).length();
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
