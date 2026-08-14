package com.praeventio.mandown;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Durable, private Android outbox for native ManDown events. Events are queued
 * before network I/O with a stable clientEventId. Transport failures retry
 * indefinitely under WorkManager; only server-confirmed authority revocation
 * moves an item to a persistent dead-letter record.
 */
public final class NativeManDownRetryWorker extends Worker {
    static final String PREFS = "guardian_native_mandown_outbox";
    private static final String PREF_QUEUE = "queue";
    private static final String PREF_DEAD_LETTERS = "deadLetters";
    private static final String WORK_NAME = "guardian-native-mandown-delivery";

    public NativeManDownRetryWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void enqueueRetry(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NativeManDownRetryWorker.class)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        );
    }

    /** Synchronous commit is deliberate: process death after return must retain alert. */
    static boolean enqueuePending(
        Context context,
        String projectId,
        String sessionId,
        String capability,
        String apiBaseUrl,
        JSONObject payload
    ) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
            // Persist the UUID inside the actual request payload so every
            // WorkManager retry maps to the same server-side event document.
            String clientEventId = UUID.randomUUID().toString();
            payload.put("clientEventId", clientEventId);
            JSONObject event = new JSONObject();
            event.put("clientEventId", clientEventId);
            event.put("projectId", projectId);
            event.put("sessionId", sessionId);
            event.put("capability", capability);
            event.put("apiBaseUrl", apiBaseUrl);
            event.put("payload", payload);
            event.put("capturedAt", System.currentTimeMillis());
            queue.put(event);
            return prefs.edit().putString(PREF_QUEUE, queue.toString()).commit();
        } catch (Exception ignored) {
            return false;
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
        if (queue.length() == 0) return Result.success();

        JSONObject event = queue.optJSONObject(0);
        if (event == null) {
            removeFirst(prefs, queue);
            return Result.retry();
        }
        int outcome = NativeManDownForegroundService.postPersistedEvent(
            event.optString("apiBaseUrl", null),
            event.optString("projectId", null),
            event.optString("sessionId", null),
            event.optString("capability", null),
            event.optJSONObject("payload")
        );
        if (outcome == NativeManDownForegroundService.DELIVERY_ACCEPTED) {
            removeFirst(prefs, queue);
            return queue.length() > 1 ? Result.retry() : Result.success();
        }
        if (outcome == NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE) {
            moveFirstToDeadLetter(prefs, queue, "authority_gone");
            return queue.length() > 1 ? Result.retry() : Result.success();
        }
        // Do not delete life-safety evidence for elapsed retry count/age. WorkManager
        // supplies exponential backoff and resumes after reboot/network recovery.
        return Result.retry();
    }

    private static JSONArray readArray(String raw) {
        try { return new JSONArray(raw == null ? "[]" : raw); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private static void removeFirst(SharedPreferences prefs, JSONArray queue) {
        JSONArray remaining = new JSONArray();
        for (int i = 1; i < queue.length(); i++) remaining.put(queue.opt(i));
        prefs.edit().putString(PREF_QUEUE, remaining.toString()).commit();
    }

    private static void moveFirstToDeadLetter(SharedPreferences prefs, JSONArray queue, String reason) {
        JSONArray letters = readArray(prefs.getString(PREF_DEAD_LETTERS, "[]"));
        JSONObject event = queue.optJSONObject(0);
        if (event != null) {
            try {
                // Capability is authentication material, not diagnostic evidence.
                // Never retain it after the server has revoked the authority.
                event.remove("capability");
                event.remove("apiBaseUrl");
                event.put("deadLetterReason", reason);
                event.put("deadLetteredAt", System.currentTimeMillis());
            } catch (Exception ignored) { }
            letters.put(event);
        }
        JSONArray remaining = new JSONArray();
        for (int i = 1; i < queue.length(); i++) remaining.put(queue.opt(i));
        prefs.edit()
            .putString(PREF_QUEUE, remaining.toString())
            .putString(PREF_DEAD_LETTERS, letters.toString())
            .commit();
    }
}
