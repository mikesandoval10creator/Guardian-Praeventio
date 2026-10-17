package com.praeventio.loneworker;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.app.Service;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.getcapacitor.PluginCall;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;

/** Exercise native stop acknowledgment, durable quarantine and restoration. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeLoneWorkerSessionCleanupTest {
    private static final String STATE = "guardian_native_lone_worker_state";
    private Context app;
    private SharedPreferences state;
    private SharedPreferences outbox;

    @Before public void setup() throws Exception {
        app = RuntimeEnvironment.getApplication();
        state = app.getSharedPreferences(STATE, Context.MODE_PRIVATE);
        outbox = app.getSharedPreferences(NativeLoneWorkerOutbox.PREFS, Context.MODE_PRIVATE);
        state.edit().clear().putString("projectId", "project").putString("sessionId", "session")
            .putString("capability", "a".repeat(32)).putString("apiBaseUrl", "https://app.praeventio.net")
            .putLong("capabilityExpiresAt", 4_070_908_800_000L).putLong("heartbeatIntervalMs", 30_000L)
            .putString("lastHeartbeatAt", "previous-heartbeat").commit();
        outbox.edit().clear().commit();
        assertTrue(NativeLoneWorkerOutbox.enqueue(app, "project", "session", "a".repeat(32),
            "https://app.praeventio.net", new JSONObject()));
        assertTrue(NativeLoneWorkerOutbox.enqueue(app, "project", "other-session", "b".repeat(32),
            "https://app.praeventio.net", new JSONObject()));
        ReflectionHelpers.setStaticField(NativeLoneWorkerForegroundService.class, "running", true);
    }

    @Test public void stopRejectsFailedQuarantineAndPreservesItsRetryTarget() throws Exception {
        verifyStopFailure(NativeLoneWorkerOutbox.PREFS, false);
    }

    @Test public void stopRejectsThrowingQuarantineAndPreservesItsRetryTarget() throws Exception {
        verifyStopFailure(NativeLoneWorkerOutbox.PREFS, true);
    }

    @Test public void stopRejectsFailedConfigClearAndRestoresItsRetryTarget() throws Exception {
        verifyStopFailure(STATE, false);
    }

    @Test public void stopRejectsThrowingConfigClearAndRestoresItsRetryTarget() throws Exception {
        verifyStopFailure(STATE, true);
    }

    private void verifyStopFailure(String failingStore, boolean throwsAfterMemory) throws Exception {
        Faults faults = new Faults(failingStore, throwsAfterMemory);
        NativeLoneWorkerPlugin plugin = spy(new NativeLoneWorkerPlugin());
        doReturn(faults.context).when(plugin).getContext();
        PluginCall failed = mock(PluginCall.class);
        String previousQueue = outbox.getString("queue", "[]");
        String previousLetters = outbox.getString("deadLetters", "[]");
        plugin.stop(failed);
        verify(failed, never()).resolve();
        verify(failed).reject(startsWith("native_lone_worker_stop_failed"));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        assertEquals(1, faults.stops.get());
        assertEquals("session", state.getString("sessionId", null));
        assertEquals("a".repeat(32), state.getString("capability", null));
        assertEquals(4_070_908_800_000L, state.getLong("capabilityExpiresAt", 0L));
        if (NativeLoneWorkerOutbox.PREFS.equals(failingStore)) {
            assertEquals(previousQueue, outbox.getString("queue", "[]"));
            assertEquals(previousLetters, outbox.getString("deadLetters", "[]"));
        }
        faults.writable.set(true);
        PluginCall retry = mock(PluginCall.class);
        plugin.stop(retry);
        verify(retry).resolve();
        verify(retry, never()).reject(anyString());
        assertClosed();
    }

    private void assertClosed() throws Exception {
        assertNull(state.getString("sessionId", null));
        assertNull(state.getString("capability", null));
        assertFalse(state.contains("capabilityExpiresAt"));
        assertEquals("previous-heartbeat", state.getString("lastHeartbeatAt", null));
        assertNull(state.getString("lastError", null));
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(app);
        assertEquals(1, queue.length());
        assertEquals("other-session", queue.getJSONObject(0).getString("sessionId"));
        JSONArray letters = new JSONArray(outbox.getString("deadLetters", "[]"));
        assertEquals(1, letters.length());
        assertFalse(letters.getJSONObject(0).has("capability"));
        assertFalse(letters.getJSONObject(0).has("apiBaseUrl"));
    }

    @Test public void successfulStopIsIdempotentAndPreservesOtherSessions() throws Exception {
        Faults faults = new Faults("unused-store", false);
        NativeLoneWorkerPlugin plugin = spy(new NativeLoneWorkerPlugin());
        doReturn(faults.context).when(plugin).getContext();
        PluginCall call = mock(PluginCall.class);
        plugin.stop(call);
        plugin.stop(call);
        verify(call, times(2)).resolve();
        verify(call, never()).reject(anyString());
        assertClosed();
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
    }

    @Test public void revokedCleanupWriteFailureRetainsTheEventForRetry() throws Exception {
        verifyRevokedCleanupFailure(NativeLoneWorkerOutbox.PREFS, false);
    }

    @Test public void revokedConfigClearFailureRetainsTheEventForRetry() throws Exception {
        verifyRevokedCleanupFailure(STATE, false);
    }

    @Test public void revokedConfigClearExceptionRetainsTheEventForRetry() throws Exception {
        verifyRevokedCleanupFailure(STATE, true);
    }

    private void verifyRevokedCleanupFailure(String failingStore, boolean throwsAfterMemory) throws Exception {
        Faults faults = new Faults(failingStore, throwsAfterMemory);
        String previous = outbox.getString("queue", "[]");
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenAnswer(call -> "session".equals(((JSONObject) call.getArgument(0)).optString("sessionId"))
                    ? NativeLoneWorkerTransport.AUTHORITY_GONE : NativeLoneWorkerTransport.RETRYABLE);
            assertEquals(Worker.Result.retry(), new NativeLoneWorkerRetryWorker(faults.context,
                mock(WorkerParameters.class)).doWork());
            assertEquals(previous, outbox.getString("queue", "[]"));
            if (STATE.equals(failingStore)) assertEquals("session", state.getString("sessionId", null));
            assertFalse(NativeLoneWorkerForegroundService.isRunning());
            faults.writable.set(true);
            assertEquals(Worker.Result.retry(), new NativeLoneWorkerRetryWorker(faults.context,
                mock(WorkerParameters.class)).doWork());
            assertClosed();
        }
    }

    @Test public void revokedOldSessionDoesNotStopTheCurrentOwner() throws Exception {
        state.edit().putString("sessionId", "other-session").commit();
        Faults faults = new Faults("unused-store", false);
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenReturn(NativeLoneWorkerTransport.AUTHORITY_GONE);
            assertEquals(Worker.Result.retry(), new NativeLoneWorkerRetryWorker(faults.context,
                mock(WorkerParameters.class)).doWork());
            assertEquals("other-session", state.getString("sessionId", null));
            assertTrue(NativeLoneWorkerForegroundService.isRunning());
            assertEquals(0, faults.stops.get());
        }
    }

    @Test public void expiredRestoreRetainsFailedCleanupForRetryAndStopsMonitoring() throws Exception {
        state.edit().putLong("capabilityExpiresAt", 1L).commit();
        Faults faults = new Faults(NativeLoneWorkerOutbox.PREFS, false);
        ServiceController<NativeLoneWorkerForegroundService> controller =
            Robolectric.buildService(NativeLoneWorkerForegroundService.class).create();
        try {
            NativeLoneWorkerForegroundService service = spy(controller.get());
            doReturn(faults.context).when(service).getApplicationContext();
            doReturn(faults.context.getSharedPreferences(STATE, Context.MODE_PRIVATE))
                .when(service).getSharedPreferences(STATE, Context.MODE_PRIVATE);
            assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1));
            assertFalse(NativeLoneWorkerForegroundService.isRunning());
            assertEquals("session", state.getString("sessionId", null));
            assertEquals("native_lone_worker_session_cleanup_persist_failed", state.getString("lastError", null));
            assertEquals(2, NativeLoneWorkerOutbox.readQueue(app).length());
        } finally {
            controller.destroy();
        }
    }

    @Test public void coldStopIntentQuarantinesThePersistedSession() throws Exception {
        ServiceController<NativeLoneWorkerForegroundService> controller =
            Robolectric.buildService(NativeLoneWorkerForegroundService.class).create();
        try {
            Intent stop = new Intent(app, NativeLoneWorkerForegroundService.class)
                .setAction(NativeLoneWorkerForegroundService.ACTION_STOP);
            assertEquals(Service.START_NOT_STICKY, controller.get().onStartCommand(stop, 0, 1));
            assertClosed();
        } finally {
            controller.destroy();
        }
    }

    @Test public void sessionQuarantinePreservesUnrelatedMalformedRecords() throws Exception {
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(app).put("unidentified-record");
        outbox.edit().putString("queue", queue.toString()).commit();
        NativeLoneWorkerOutbox.deadLetterSession(app, "project", "session", "explicit_stop");
        JSONArray remaining = NativeLoneWorkerOutbox.readQueue(app);
        assertEquals(2, remaining.length());
        assertEquals("unidentified-record", remaining.getString(1));
    }

    @Test public void corruptQueueRejectsStopWithoutDiscardingItsEvidence() {
        verifyCorruptArray("queue");
    }

    @Test public void corruptDeadLettersRejectStopWithoutDiscardingTheirEvidence() {
        verifyCorruptArray("deadLetters");
    }

    private void verifyCorruptArray(String key) {
        outbox.edit().putString(key, "not-json").commit();
        Faults faults = new Faults("unused-store", false);
        NativeLoneWorkerPlugin plugin = spy(new NativeLoneWorkerPlugin());
        doReturn(faults.context).when(plugin).getContext();
        PluginCall call = mock(PluginCall.class);
        plugin.stop(call);
        verify(call, never()).resolve();
        verify(call).reject(startsWith("native_lone_worker_stop_failed"));
        assertEquals("not-json", outbox.getString(key, null));
        assertEquals("session", state.getString("sessionId", null));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
    }

    private final class Faults {
        final AtomicBoolean writable = new AtomicBoolean(false);
        final AtomicInteger stops = new AtomicInteger();
        final Context context;

        Faults(String failingStore, boolean throwsAfterMemory) {
            Map<String, SharedPreferences> stores = new HashMap<>();
            for (String name : new String[] { STATE, NativeLoneWorkerOutbox.PREFS }) {
                SharedPreferences real = app.getSharedPreferences(name, Context.MODE_PRIVATE);
                SharedPreferences wrapped = mock(SharedPreferences.class);
                when(wrapped.getAll()).thenAnswer(call -> real.getAll());
                when(wrapped.getString(anyString(), nullable(String.class))).thenAnswer(call ->
                    real.getString(call.getArgument(0), call.getArgument(1)));
                when(wrapped.getLong(anyString(), anyLong())).thenAnswer(call ->
                    real.getLong(call.getArgument(0), call.getArgument(1)));
                when(wrapped.edit()).thenAnswer(call -> {
                    Map<String, Object> changes = new HashMap<>();
                    SharedPreferences.Editor edit = mock(SharedPreferences.Editor.class, RETURNS_SELF);
                    when(edit.putString(anyString(), nullable(String.class))).thenAnswer(put -> {
                        changes.put(put.getArgument(0), put.getArgument(1)); return edit;
                    });
                    when(edit.putLong(anyString(), anyLong())).thenAnswer(put -> {
                        changes.put(put.getArgument(0), put.getArgument(1)); return edit;
                    });
                    when(edit.remove(anyString())).thenAnswer(remove -> {
                        changes.put(remove.getArgument(0), null); return edit;
                    });
                    when(edit.commit()).thenAnswer(commit -> {
                        SharedPreferences.Editor memory = real.edit();
                        changes.forEach((key, value) -> {
                            if (value == null) memory.remove(key);
                            else if (value instanceof Long) memory.putLong(key, (Long) value);
                            else memory.putString(key, (String) value);
                        });
                        memory.commit();
                        boolean failed = name.equals(failingStore) && !writable.get();
                        if (failed && throwsAfterMemory) throw new IllegalStateException("disk_failure");
                        return !failed;
                    });
                    return edit;
                });
                stores.put(name, wrapped);
            }
            context = new ContextWrapper(app) {
                @Override public Context getApplicationContext() { return this; }
                @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                    return stores.containsKey(name) ? stores.get(name) : super.getSharedPreferences(name, mode);
                }
                @Override public boolean stopService(Intent service) { stops.incrementAndGet(); return true; }
            };
        }
    }
}
