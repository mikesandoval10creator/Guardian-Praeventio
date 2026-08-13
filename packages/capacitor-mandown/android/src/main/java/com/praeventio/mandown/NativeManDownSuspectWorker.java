package com.praeventio.mandown;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Durable expiry for the worker-facing "Estoy bien" window. A foreground
 * service may be reclaimed while the WebView is suspended; this worker is the
 * process-independent transition from suspected signal to a queued alert.
 */
public final class NativeManDownSuspectWorker extends Worker {
    private static final String PREFS = "guardian_native_mandown_state";
    private static final String PREF_SUSPECTED_PAYLOAD = "suspectedPayload";
    private static final String PREF_SUSPECTED_DEADLINE = "suspectedDeadline";
    private static final String PREF_CONFIG_PROJECT = "configProject";
    private static final String PREF_CONFIG_SESSION = "configSession";
    private static final String PREF_CONFIG_CAPABILITY = "configCapability";
    private static final String PREF_CONFIG_API_BASE = "configApiBase";
    private static final String WORK_NAME = "guardian-native-mandown-suspect";
    /** Serializes cancel-vs-expiry across the FGS action and WorkManager worker. */
    private static final Object SUSPECT_LOCK = new Object();

    public NativeManDownSuspectWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void schedule(Context context, long delayMs) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NativeManDownSuspectWorker.class)
            .setInitialDelay(Math.max(0L, delayMs), TimeUnit.MILLISECONDS)
            .setInputData(new Data.Builder().build())
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request);
    }

    static void cancel(Context context) {
        synchronized (SUSPECT_LOCK) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
            clearSuspected(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE));
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        synchronized (SUSPECT_LOCK) {
            String raw = prefs.getString(PREF_SUSPECTED_PAYLOAD, null);
            long deadline = prefs.getLong(PREF_SUSPECTED_DEADLINE, 0L);
            if (raw == null || deadline <= 0L) return Result.success(); // User cancelled.
            long now = System.currentTimeMillis();
            if (deadline > now) {
                schedule(getApplicationContext(), deadline - now);
                return Result.success();
            }
            try {
                JSONObject payload = new JSONObject(raw);
                boolean saved = NativeManDownRetryWorker.enqueuePending(
                    getApplicationContext(),
                    prefs.getString(PREF_CONFIG_PROJECT, null),
                    prefs.getString(PREF_CONFIG_SESSION, null),
                    prefs.getString(PREF_CONFIG_CAPABILITY, null),
                    prefs.getString(PREF_CONFIG_API_BASE, null),
                    payload
                );
                if (!saved) return Result.retry();
                clearSuspected(prefs);
                NativeManDownRetryWorker.enqueueRetry(getApplicationContext());
                return Result.success();
            } catch (Exception ignored) {
                return Result.retry();
            }
        }
    }

    static void clearSuspected(SharedPreferences prefs) {
        prefs.edit()
            .remove(PREF_SUSPECTED_PAYLOAD)
            .remove(PREF_SUSPECTED_DEADLINE)
            .commit();
    }
}
