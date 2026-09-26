package com.praeventio.loneworker;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Process-independent delivery loop for the native heartbeat outbox.
 * Network loss never deletes a pulse; explicit authority revocation or a
 * malformed locally-created payload moves it to a scrubbed dead-letter record.
 */
public final class NativeLoneWorkerRetryWorker extends Worker {
    private static final String WORK_NAME = "guardian-native-lone-worker-delivery";

    public NativeLoneWorkerRetryWorker(
        @NonNull Context context,
        @NonNull WorkerParameters parameters
    ) {
        super(context, parameters);
    }

    static void enqueueRetry(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(
            NativeLoneWorkerRetryWorker.class
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        );
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        JSONObject event = NativeLoneWorkerOutbox.first(context);
        if (event == null) return Result.success();

        int outcome = NativeLoneWorkerTransport.post(event);
        if (outcome == NativeLoneWorkerTransport.ACCEPTED) {
            int remaining = NativeLoneWorkerOutbox.removeFirst(context);
            return remaining > 0 ? Result.retry() : Result.success();
        }

        String projectId = event.optString("projectId", null);
        String sessionId = event.optString("sessionId", null);
        if (outcome == NativeLoneWorkerTransport.AUTHORITY_GONE) {
            NativeLoneWorkerOutbox.moveFirstToDeadLetter(context, "authority_gone");
            if (projectId != null && sessionId != null) {
                NativeLoneWorkerForegroundService.authorityGone(
                    context,
                    projectId,
                    sessionId
                );
            }
            return NativeLoneWorkerOutbox.first(context) != null
                ? Result.retry()
                : Result.success();
        }

        if (outcome == NativeLoneWorkerTransport.MALFORMED) {
            NativeLoneWorkerOutbox.moveFirstToDeadLetter(context, "malformed_payload");
            return NativeLoneWorkerOutbox.first(context) != null
                ? Result.retry()
                : Result.success();
        }

        // Keep the event intact. WorkManager applies exponential backoff and
        // resumes after network recovery/reboot.
        return Result.retry();
    }
}
