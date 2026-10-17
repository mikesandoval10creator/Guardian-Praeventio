package com.praeventio.mandown;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.work.Configuration;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.testing.WorkManagerTestInitHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Exercise the real producer, worker, preferences and scheduler. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeManDownOutboxConcurrencyTest {
    private Context context;
    private SharedPreferences prefs;
    private static final String ORIGIN = "https://app.praeventio.net";
    private static final String CAPABILITY = "a".repeat(32);

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        prefs = context.getSharedPreferences(NativeManDownRetryWorker.PREFS, Context.MODE_PRIVATE);
        prefs.edit().clear().commit();
        WorkManagerTestInitHelper.initializeTestWorkManager(context,
            new Configuration.Builder().setExecutor(Runnable::run).build());
    }

    private JSONObject event(String id) throws Exception {
        return NativeManDownOutboxCodec.queueEvent("project", "first-session", "first-secret",
            new JSONObject().put("clientEventId", id).put("kind", "man_down"), 1L);
    }

    @Test public void acceptedDeliveryPreservesArrivalDuringHttp() throws Exception {
        verifyArrival(NativeManDownForegroundService.DELIVERY_ACCEPTED, false);
    }

    @Test public void revokedDeliveryPreservesArrivalAndScrubsDeadLetter() throws Exception {
        verifyArrival(NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE, true);
    }

    private void verifyArrival(int outcome, boolean deadLetter) throws Exception {
        prefs.edit().putString("queue", new JSONArray().put(event("first")).toString()).commit();
        JSONObject arrival = new JSONObject().put("kind", "man_down");
        try (MockedStatic<NativeManDownSecureStore> secure = mockStatic(NativeManDownSecureStore.class);
             MockedStatic<NativeManDownForegroundService> http = mockStatic(NativeManDownForegroundService.class)) {
            secure.when(() -> NativeManDownSecureStore.load(context, "first-secret"))
                .thenReturn(new NativeManDownSecureStore.Secrets(CAPABILITY, ORIGIN));
            secure.when(() -> NativeManDownSecureStore.persist(context, "second-session", CAPABILITY, ORIGIN))
                .thenReturn(true);
            secure.when(() -> NativeManDownSecureStore.referenceForSession("second-session"))
                .thenReturn("second-secret");
            http.when(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class))).thenAnswer(invocation -> {
                    assertTrue(NativeManDownRetryWorker.enqueuePending(context, "project", "second-session",
                        CAPABILITY, ORIGIN, arrival));
                    return outcome;
                });
            Worker.Result result = new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork();
            JSONArray remaining = new JSONArray(prefs.getString("queue", "[]"));
            assertEquals("a new alert must survive acknowledgement of the old snapshot", 1, remaining.length());
            assertEquals(arrival.getString("clientEventId"), remaining.getJSONObject(0).getString("clientEventId"));
            assertEquals(Worker.Result.retry(), result);
            JSONArray letters = new JSONArray(prefs.getString("deadLetters", "[]"));
            assertEquals(deadLetter ? 1 : 0, letters.length());
            if (deadLetter) {
                assertEquals("first", letters.getJSONObject(0).getString("clientEventId"));
                assertFalse(letters.toString().contains("first-secret"));
                assertFalse(letters.toString().contains(CAPABILITY));
            }
        }
    }

    @Test public void arrivalSchedulesFollowUpBehindAnExistingDrain() throws Exception {
        NativeManDownRetryWorker.enqueueRetry(context);
        NativeManDownRetryWorker.enqueueRetry(context);
        java.util.List<WorkInfo> work = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork("guardian-native-mandown-delivery").get();
        assertEquals("KEEP can drop the only wake-up as the current worker finishes", 2, work.size());
    }

    @Test public void anotherProducerCanPersistWhileTransportIsBlocked() throws Exception {
        prefs.edit().putString("queue", new JSONArray().put(event("first")).toString()).commit();
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        try (MockedStatic<NativeManDownSecureStore> secure = mockStatic(NativeManDownSecureStore.class);
             MockedStatic<NativeManDownForegroundService> http = mockStatic(NativeManDownForegroundService.class)) {
            secure.when(() -> NativeManDownSecureStore.load(context, "first-secret"))
                .thenReturn(new NativeManDownSecureStore.Secrets(CAPABILITY, ORIGIN));
            http.when(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class))).thenAnswer(invocation -> {
                    Thread producer = new Thread(() -> {
                        try (MockedStatic<NativeManDownSecureStore> threadSecure = mockStatic(NativeManDownSecureStore.class)) {
                            threadSecure.when(() -> NativeManDownSecureStore.persist(context, "second-session", CAPABILITY, ORIGIN))
                                .thenReturn(true);
                            threadSecure.when(() -> NativeManDownSecureStore.referenceForSession("second-session"))
                                .thenReturn("second-secret");
                            assertTrue(NativeManDownRetryWorker.enqueuePending(context, "project", "second-session",
                                CAPABILITY, ORIGIN, new JSONObject().put("kind", "man_down")));
                        } catch (Throwable error) { failure.set(error); }
                    });
                    producer.setDaemon(true);
                    producer.start();
                    producer.join(5_000);
                    assertFalse("network must not hold the queue mutation lock", producer.isAlive());
                    if (failure.get() != null) throw new AssertionError(failure.get());
                    return NativeManDownForegroundService.DELIVERY_ACCEPTED;
                });
            assertEquals(Worker.Result.retry(),
                new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork());
            assertEquals(1, new JSONArray(prefs.getString("queue", "[]")).length());
        }
    }

    @Test public void staleAcknowledgementDoesNotRemoveTheNextAlert() throws Exception {
        prefs.edit().putString("queue", new JSONArray().put(event("first")).toString()).commit();
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        JSONObject arrival = new JSONObject().put("kind", "man_down");
        try (MockedStatic<NativeManDownSecureStore> secure = mockStatic(NativeManDownSecureStore.class);
             MockedStatic<NativeManDownForegroundService> http = mockStatic(NativeManDownForegroundService.class)) {
            secure.when(() -> NativeManDownSecureStore.load(context, "first-secret"))
                .thenReturn(new NativeManDownSecureStore.Secrets(CAPABILITY, ORIGIN));
            secure.when(() -> NativeManDownSecureStore.persist(context, "second-session", CAPABILITY, ORIGIN))
                .thenReturn(true);
            secure.when(() -> NativeManDownSecureStore.referenceForSession("second-session"))
                .thenReturn("second-secret");
            http.when(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class))).thenAnswer(invocation -> {
                    if (calls.incrementAndGet() == 1) {
                        assertEquals(Worker.Result.success(),
                            new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork());
                        assertTrue(NativeManDownRetryWorker.enqueuePending(context, "project", "second-session",
                            CAPABILITY, ORIGIN, arrival));
                    }
                    return NativeManDownForegroundService.DELIVERY_ACCEPTED;
                });
            assertEquals(Worker.Result.retry(),
                new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork());
            JSONArray remaining = new JSONArray(prefs.getString("queue", "[]"));
            assertEquals(1, remaining.length());
            assertEquals(arrival.getString("clientEventId"), remaining.getJSONObject(0).getString("clientEventId"));
        }
    }
}
