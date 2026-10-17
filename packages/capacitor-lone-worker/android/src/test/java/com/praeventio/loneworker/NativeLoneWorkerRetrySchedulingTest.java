package com.praeventio.loneworker;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import androidx.work.Configuration;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.impl.WorkManagerImpl;
import androidx.work.testing.WorkManagerTestInitHelper;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Real WorkManager persistence/dependencies; no device network or backend. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeLoneWorkerRetrySchedulingTest {
    private static final String WORK_NAME = "guardian-native-lone-worker-delivery";
    private Context context;
    private WorkManagerImpl manager;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences(NativeLoneWorkerOutbox.PREFS, Context.MODE_PRIVATE)
            .edit().clear().commit();
        WorkManagerTestInitHelper.initializeTestWorkManager(context, new Configuration.Builder()
            .setExecutor(Runnable::run)
            .setTaskExecutor(Runnable::run)
            .build());
        manager = (WorkManagerImpl) WorkManager.getInstance(context);
    }

    @After public void cleanup() {
        WorkManagerTestInitHelper.closeWorkDatabase();
    }

    private List<WorkInfo> work() throws Exception {
        return manager.getWorkInfosForUniqueWork(WORK_NAME).get(5, TimeUnit.SECONDS);
    }

    private void enqueueHeartbeat() {
        assertTrue(NativeLoneWorkerOutbox.enqueue(context, "project", "session",
            "a".repeat(32), "https://app.praeventio.net", new JSONObject()));
    }

    @Test public void arrivalWhileThePreviousDrainFinishesPersistsAFollowUp() throws Exception {
        NativeLoneWorkerRetryWorker.enqueueRetry(context);
        WorkInfo draining = work().get(0);
        // Reproduce the completion window: the old drain has read an empty
        // queue but WorkManager has not yet committed its terminal state.
        manager.getWorkDatabase().workSpecDao().setState(WorkInfo.State.RUNNING, draining.getId().toString());
        enqueueHeartbeat();
        NativeLoneWorkerRetryWorker.enqueueRetry(context);

        List<WorkInfo> scheduled = work();
        assertEquals("the only wake-up for the new heartbeat must survive", 2, scheduled.size());
        WorkInfo followUp = scheduled.stream().filter(info -> !info.getId().equals(draining.getId()))
            .findFirst().orElseThrow();
        assertEquals(WorkInfo.State.BLOCKED, followUp.getState());
        assertEquals(List.of(draining.getId().toString()), manager.getWorkDatabase().dependencyDao()
            .getPrerequisites(followUp.getId().toString()));
        assertEquals(1, NativeLoneWorkerOutbox.readQueue(context).length());
    }

    @Test public void repeatedRequestsRemainSerializedBehindThePendingDrain() throws Exception {
        NativeLoneWorkerRetryWorker.enqueueRetry(context);
        NativeLoneWorkerRetryWorker.enqueueRetry(context);
        NativeLoneWorkerRetryWorker.enqueueRetry(context);
        List<WorkInfo> scheduled = work();
        assertEquals(3, scheduled.size());
        assertEquals(1, scheduled.stream().filter(info -> info.getState() == WorkInfo.State.ENQUEUED).count());
        assertEquals(2, scheduled.stream().filter(info -> info.getState() == WorkInfo.State.BLOCKED).count());
        for (WorkInfo info : scheduled) {
            if (info.getState() == WorkInfo.State.BLOCKED) {
                assertEquals(1, manager.getWorkDatabase().dependencyDao().getPrerequisites(info.getId().toString()).size());
            }
        }
    }

    @Test public void failedChainDoesNotPoisonTheNextHeartbeatDelivery() throws Exception {
        verifyTerminalRecovery(WorkInfo.State.FAILED);
    }

    @Test public void cancelledChainDoesNotPoisonTheNextHeartbeatDelivery() throws Exception {
        verifyTerminalRecovery(WorkInfo.State.CANCELLED);
    }

    private void verifyTerminalRecovery(WorkInfo.State terminal) throws Exception {
        NativeLoneWorkerRetryWorker.enqueueRetry(context);
        WorkInfo old = work().get(0);
        manager.getWorkDatabase().workSpecDao().setState(terminal, old.getId().toString());
        enqueueHeartbeat();
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenReturn(NativeLoneWorkerTransport.ACCEPTED);
            NativeLoneWorkerRetryWorker.enqueueRetry(context);
            WorkInfo fresh = work().stream().filter(info -> !info.getId().equals(old.getId()))
                .findFirst().orElseThrow();
            assertEquals(WorkInfo.State.ENQUEUED, fresh.getState());
            assertTrue(manager.getWorkDatabase().dependencyDao().getPrerequisites(fresh.getId().toString()).isEmpty());
            WorkManagerTestInitHelper.getTestDriver(context).setAllConstraintsMet(fresh.getId());
            assertEquals(WorkInfo.State.SUCCEEDED, manager.getWorkInfoById(fresh.getId()).get(5, TimeUnit.SECONDS).getState());
            assertEquals(0, NativeLoneWorkerOutbox.readQueue(context).length());
            http.verify(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)), times(1));
        }
    }
}
