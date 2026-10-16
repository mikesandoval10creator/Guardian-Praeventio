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
        String eventId = event.optString("clientEventId", null);
        if (eventId == null || eventId.trim().isEmpty()) {
            int remaining = NativeLoneWorkerOutbox.quarantineUnidentifiedHead(context, event.toString());
            return remaining == 0 ? Result.success() : Result.retry();
        }

        int outcome = NativeLoneWorkerTransport.post(event);
        if (outcome == NativeLoneWorkerTransport.AUTHORITY_GONE) {
            String projectId = event.optString("projectId", null);
            String sessionId = event.optString("sessionId", null);
            if (projectId != null && sessionId != null) {
                // Keep the retry anchor until session cleanup is durable.
                if (!NativeLoneWorkerForegroundService.authorityGone(context, projectId, sessionId)) {
                    return Result.retry();
                }
                return NativeLoneWorkerOutbox.first(context) != null ? Result.retry() : Result.success();
            }
        }
        if (outcome == NativeLoneWorkerTransport.ACCEPTED
            || outcome == NativeLoneWorkerTransport.AUTHORITY_GONE
            || outcome == NativeLoneWorkerTransport.MALFORMED) {
            String reason = outcome == NativeLoneWorkerTransport.AUTHORITY_GONE
                ? "authority_gone"
                : outcome == NativeLoneWorkerTransport.MALFORMED ? "malformed_payload" : null;
            int remaining = NativeLoneWorkerOutbox.acknowledge(context, eventId, reason);
            if (remaining < 0) return Result.retry();
            return remaining > 0 ? Result.retry() : Result.success();
        }

        // Keep the event intact. WorkManager applies exponential backoff and
        // resumes after network recovery/reboot.
        return Result.retry();
    }
}
