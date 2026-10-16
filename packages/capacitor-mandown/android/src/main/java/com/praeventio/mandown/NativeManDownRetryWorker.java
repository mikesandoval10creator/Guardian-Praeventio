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
    // The service and WorkManager share this process. Never hold this lock over HTTP.
    private static final Object QUEUE_LOCK = new Object();

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
            ExistingWorkPolicy.APPEND_OR_REPLACE,
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
        synchronized (QUEUE_LOCK) {
            try {
                if (!NativeManDownSecureStore.persist(context, sessionId, capability, apiBaseUrl)) {
                    return false;
                }
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
                // Persist the UUID inside the actual request payload so every
                // WorkManager retry maps to the same server-side event document.
                String clientEventId = UUID.randomUUID().toString();
                payload.put("clientEventId", clientEventId);
                JSONObject event = NativeManDownOutboxCodec.queueEvent(
                    projectId,
                    sessionId,
                    NativeManDownSecureStore.referenceForSession(sessionId),
                    payload,
                    System.currentTimeMillis()
                );
                queue.put(event);
                return prefs.edit().putString(PREF_QUEUE, queue.toString()).commit();
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Object pending;
        synchronized (QUEUE_LOCK) {
            JSONArray queue = readArray(prefs.getString(PREF_QUEUE, "[]"));
            if (queue.length() == 0) return Result.success();
            pending = queue.opt(0);
        }

        JSONObject event = pending instanceof JSONObject ? (JSONObject) pending : null;
        if (event == null) {
            return completeEvent(prefs, pending, null);
        }
        String secretRef = event.optString("secretRef", null);
        NativeManDownSecureStore.Secrets secrets = NativeManDownSecureStore.load(
            getApplicationContext(),
            secretRef
        );
        if (secrets == null) {
            return completeEvent(prefs, pending, "secure_material_unavailable");
        }
        int outcome = NativeManDownForegroundService.postPersistedEvent(
            secrets.apiBaseUrl,
            event.optString("projectId", null),
            event.optString("sessionId", null),
            secrets.capability,
            event.optJSONObject("payload")
        );
        if (outcome == NativeManDownForegroundService.DELIVERY_ACCEPTED) {
            return completeEvent(prefs, pending, null);
        }
        if (outcome == NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE) {
            return completeEvent(prefs, pending, "authority_gone");
        }
        // Do not delete life-safety evidence for elapsed retry count/age. WorkManager
        // supplies exponential backoff and resumes after reboot/network recovery.
        return Result.retry();
    }

    private static JSONArray readArray(String raw) {
        try { return new JSONArray(raw == null ? "[]" : raw); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    /** Re-read durable state; an HTTP response only acknowledges its own event. */
    private Result completeEvent(SharedPreferences prefs, Object pending, String reason) {
        synchronized (QUEUE_LOCK) {
            try {
                String queueBefore = prefs.getString(PREF_QUEUE, "[]");
                String lettersBefore = prefs.getString(PREF_DEAD_LETTERS, "[]");
                JSONArray queue = readArray(queueBefore);
                int matched = -1;
                for (int i = 0; i < queue.length(); i++) {
                    if (sameEvent(queue.opt(i), pending)) { matched = i; break; }
                }
                if (matched < 0) return queue.length() > 0 ? Result.retry() : Result.success();

                JSONObject event = queue.optJSONObject(matched);
                JSONArray remaining = new JSONArray();
                for (int i = 0; i < queue.length(); i++) {
                    if (i != matched) remaining.put(queue.opt(i));
                }
                SharedPreferences.Editor edit = prefs.edit().putString(PREF_QUEUE, remaining.toString());
                if (reason != null && event != null) {
                    JSONArray letters = readArray(lettersBefore);
                    letters.put(NativeManDownOutboxCodec.scrubForDeadLetter(event, reason, System.currentTimeMillis()));
                    edit.putString(PREF_DEAD_LETTERS, letters.toString());
                }
                // Retain evidence and credentials until the transition is durable.
                boolean committed = false;
                try {
                    committed = edit.commit();
                } finally {
                    if (!committed) {
                        // commit() changes SharedPreferences memory before reporting disk failure.
                        // Even if this restore also cannot reach disk, its memory must retain
                        // the pre-transition evidence for subsequent workers/producers.
                        prefs.edit().putString(PREF_QUEUE, queueBefore)
                            .putString(PREF_DEAD_LETTERS, lettersBefore).commit();
                    }
                }
                if (!committed) return Result.retry();
                if (reason != null && event != null) {
                    String reference = event.optString("secretRef", null);
                    boolean stillReferenced = false;
                    for (int i = 0; i < remaining.length(); i++) {
                        JSONObject other = remaining.optJSONObject(i);
                        if (reference != null && other != null && reference.equals(other.optString("secretRef", null))) {
                            stillReferenced = true;
                            break;
                        }
                    }
                    if (!stillReferenced) NativeManDownSecureStore.clearReference(getApplicationContext(), reference);
                }
                return remaining.length() > 0 ? Result.retry() : Result.success();
            } catch (Exception ignored) {
                return Result.retry();
            }
        }
    }

    private static boolean sameEvent(Object candidate, Object pending) {
        if (candidate instanceof JSONObject && pending instanceof JSONObject) {
            String id = ((JSONObject) pending).optString("clientEventId", "");
            if (!id.isEmpty()) return id.equals(((JSONObject) candidate).optString("clientEventId", ""));
        }
        // Legacy or malformed records have no ID; only remove the exact record read.
        return String.valueOf(candidate).equals(String.valueOf(pending));
    }
}
