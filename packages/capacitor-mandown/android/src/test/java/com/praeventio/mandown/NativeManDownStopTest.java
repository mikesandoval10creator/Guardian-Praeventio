package com.praeventio.mandown;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Looper;
import android.os.Handler;
import androidx.work.WorkManager;
import androidx.work.Operation;
import androidx.work.impl.utils.futures.SettableFuture;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.getcapacitor.PluginCall;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;

/** Exercises the real plugin, service, preferences and expiry worker without HTTP. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public final class NativeManDownStopTest {
    private static final String STATE = "guardian_native_mandown_state";
    private Context app;
    private SharedPreferences state;
    private WorkManager manager;
    private MockedStatic<WorkManager> work;
    private MockedStatic<NativeManDownSecureStore> secure;
    private MockedStatic<NativeManDownRetryWorker> retry;
    private ServiceController<NativeManDownForegroundService> controller;
    private NativeManDownForegroundService service;

    @Before public void setup() {
        app = RuntimeEnvironment.getApplication();
        state = app.getSharedPreferences(STATE, Context.MODE_PRIVATE);
        state.edit().clear().commit();
        manager = mock(WorkManager.class);
        work = mockStatic(WorkManager.class);
        work.when(() -> WorkManager.getInstance(any(Context.class))).thenReturn(manager);
        when(manager.cancelUniqueWork(anyString())).thenAnswer(invocation -> completedCancellation());
        secure = mockStatic(NativeManDownSecureStore.class, CALLS_REAL_METHODS);
        secure.when(() -> NativeManDownSecureStore.persist(any(), anyString(), anyString(), anyString())).thenReturn(true);
        secure.when(() -> NativeManDownSecureStore.load(any(), anyString())).thenReturn(
            new NativeManDownSecureStore.Secrets("a".repeat(32), "https://app.praeventio.net"));
        retry = mockStatic(NativeManDownRetryWorker.class);
        retry.when(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)))
            .thenReturn(true);
    }

    @After public void cleanup() {
        if (controller != null) controller.destroy();
        if (service != null) {
            Handler handler = ReflectionHelpers.getField(service, "handler");
            handler.removeCallbacksAndMessages(null);
        }
        retry.close();
        secure.close();
        work.close();
    }

    private NativeManDownPlugin plugin(Context context) {
        NativeManDownPlugin plugin = spy(new NativeManDownPlugin());
        doReturn(context).when(plugin).getContext();
        return plugin;
    }

    private Operation completedCancellation() {
        Operation operation = mock(Operation.class);
        SettableFuture<Operation.State.SUCCESS> result = SettableFuture.create();
        result.set(Operation.SUCCESS);
        when(operation.getResult()).thenReturn(result);
        return operation;
    }

    private void pending() {
        state.edit().putString("configProject", "project").putString("configSession", "session")
            .putString("suspectedPayload", "{\"kind\":\"impact\"}")
            .putLong("suspectedDeadline", System.currentTimeMillis() - 1).commit();
    }

    private void startService() {
        controller = Robolectric.buildService(NativeManDownForegroundService.class).create();
        service = controller.get();
        SensorManager sensors = mock(SensorManager.class);
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt())).thenReturn(true);
        ReflectionHelpers.setField(service, "sensorManager", sensors);
        ReflectionHelpers.setField(service, "accelerometer", mock(Sensor.class));
        PluginCall call = mock(PluginCall.class);
        when(call.getString("projectId")).thenReturn("project");
        when(call.getString("sessionId")).thenReturn("session");
        when(call.getString("capability")).thenReturn("a".repeat(32));
        when(call.getString("capabilityExpiresAt")).thenReturn(Instant.now().plusSeconds(60).toString());
        when(call.getString("apiBaseUrl")).thenReturn("https://app.praeventio.net");
        when(call.getInt("inactivityThresholdMs")).thenReturn(30_000);
        when(call.getDouble("impactThresholdMps2", 25d)).thenReturn(25d);
        plugin(app).start(call);
        service.onStartCommand(Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService(), 0, 1);
    }

    @Test public void explicitStopDurablyCancelsPendingCountdownBeforeAcknowledging() {
        pending();
        PluginCall call = mock(PluginCall.class);
        plugin(app).stop(call);
        assertFalse(state.contains("suspectedPayload"));
        assertFalse(state.contains("suspectedDeadline"));
        assertTrue(state.getBoolean("explicitlyStopped", false));
        verify(manager).cancelUniqueWork("guardian-native-mandown-suspect");
        verify(call).resolve();
        verify(call, never()).reject(anyString());
    }

    @Test public void stoppedCountdownCannotBeEnqueuedByALateWorker() {
        pending();
        plugin(app).stop(mock(PluginCall.class));
        assertEquals(Worker.Result.success(), new NativeManDownSuspectWorker(app, mock(WorkerParameters.class)).doWork());
        retry.verify(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)), never());
    }

    @Test public void explicitStopRetainsAlreadyQueuedAlertsAndTheirSecureMaterial() {
        pending();
        SharedPreferences queue = app.getSharedPreferences("guardian_native_mandown_outbox", Context.MODE_PRIVATE);
        queue.edit().putString("queue", "[{\"clientEventId\":\"queued\"}]").commit();
        SharedPreferences secrets = app.getSharedPreferences("guardian_native_mandown_secure_v1", Context.MODE_PRIVATE);
        String reference = NativeManDownSecureStore.referenceForSession("session");
        secrets.edit().putString(reference, "encrypted-existing-alert").commit();
        plugin(app).stop(mock(PluginCall.class));
        assertEquals("[{\"clientEventId\":\"queued\"}]", queue.getString("queue", null));
        assertEquals("encrypted-existing-alert", secrets.getString(reference, null));
    }

    @Test public void failedMemoryFirstCommitIsRejectedAndRetryMustPersistAgain() {
        pending();
        AtomicBoolean writable = new AtomicBoolean(false);
        SharedPreferences failing = mock(SharedPreferences.class);
        when(failing.edit()).thenAnswer(invocation -> {
            SharedPreferences.Editor memory = state.edit();
            SharedPreferences.Editor edit = mock(SharedPreferences.Editor.class, RETURNS_SELF);
            when(edit.putBoolean(anyString(), anyBoolean())).thenAnswer(change -> { memory.putBoolean(change.getArgument(0), change.getArgument(1)); return edit; });
            when(edit.remove(anyString())).thenAnswer(change -> { memory.remove(change.getArgument(0)); return edit; });
            when(edit.commit()).thenAnswer(commit -> { memory.commit(); return writable.get(); });
            return edit;
        });
        Context context = new ContextWrapper(app) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return STATE.equals(name) ? failing : super.getSharedPreferences(name, mode);
            }
        };
        NativeManDownPlugin plugin = plugin(context);
        PluginCall failed = mock(PluginCall.class);
        plugin.stop(failed);
        verify(failed).reject(startsWith("native_man_down_stop_failed"));
        verify(failed, never()).resolve();
        writable.set(true);
        PluginCall retried = mock(PluginCall.class);
        plugin.stop(retried);
        verify(retried).resolve();
        verify(failing, times(2)).edit();
    }

    @Test public void workManagerFailureIsReportedAndAnExplicitRetryCanComplete() {
        pending();
        when(manager.cancelUniqueWork(anyString())).thenThrow(new IllegalStateException("unavailable")).thenReturn(completedCancellation());
        NativeManDownPlugin plugin = plugin(app);
        PluginCall failed = mock(PluginCall.class);
        plugin.stop(failed);
        verify(failed).reject(startsWith("native_man_down_stop_failed"));
        verify(failed, never()).resolve();
        PluginCall retried = mock(PluginCall.class);
        plugin.stop(retried);
        verify(retried).resolve();
    }

    @Test public void androidDestructionPreservesDurableCountdownAndRemovesOldCapabilityTimer() {
        startService();
        // Initial configuration can cancel a different persisted owner; isolate destruction.
        clearInvocations(manager);
        pending();
        service.onDestroy();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(61));
        assertTrue(state.contains("suspectedPayload"));
        verify(manager, never()).cancelUniqueWork(anyString());
        assertEquals(Worker.Result.success(), new NativeManDownSuspectWorker(app, mock(WorkerParameters.class)).doWork());
        retry.verify(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)));
    }

    @Test public void lateServiceExpiryCannotEnqueueAfterExplicitStop() {
        startService();
        pending();
        plugin(app).stop(mock(PluginCall.class));
        ReflectionHelpers.callInstanceMethod(service, "expireSuspected");
        retry.verify(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)), never());
    }

    @Test public void lateSensorCallbackCannotRecreateAStoppedCountdown() {
        startService();
        plugin(app).stop(mock(PluginCall.class));
        ReflectionHelpers.callInstanceMethod(service, "suspect", ClassParameter.from(String.class, "impact"),
            ClassParameter.from(Float.class, 30f), ClassParameter.from(Long.class, null));
        assertFalse(state.contains("suspectedPayload"));
    }

    @Test public void oldServiceCannotExpireTheReplacementSessionsCountdown() {
        startService();
        pending();
        state.edit().putString("configSession", "replacement").commit();
        ReflectionHelpers.callInstanceMethod(service, "expireSuspected");
        retry.verify(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)), never());
        assertTrue(state.contains("suspectedPayload"));
    }

    @Test public void aFreshSessionStartCanResumeDetectionAfterExplicitStop() {
        startService();
        plugin(app).stop(mock(PluginCall.class));
        controller.destroy();
        controller = null;
        startService();
        ReflectionHelpers.callInstanceMethod(service, "suspect", ClassParameter.from(String.class, "impact"),
            ClassParameter.from(Float.class, 30f), ClassParameter.from(Long.class, null));
        assertFalse(state.getBoolean("explicitlyStopped", true));
        assertTrue(state.contains("suspectedPayload"));
    }

    @Test public void failedAsynchronousCancellationIsRejectedAndCanBeRetried() {
        pending();
        Operation operation = mock(Operation.class);
        SettableFuture<Operation.State.SUCCESS> failedResult = SettableFuture.create();
        failedResult.setException(new IllegalStateException("cancellation_failed"));
        when(operation.getResult()).thenReturn(failedResult);
        when(manager.cancelUniqueWork(anyString())).thenReturn(operation).thenReturn(completedCancellation());
        NativeManDownPlugin plugin = plugin(app);
        PluginCall failed = mock(PluginCall.class);
        plugin.stop(failed);
        verify(failed).reject(startsWith("native_man_down_stop_failed"));
        verify(failed, never()).resolve();
        PluginCall retried = mock(PluginCall.class);
        plugin.stop(retried);
        verify(retried).resolve();
    }

    @Test public void capabilityCallbackCannotDeleteQueuedSecretsAfterExplicitStop() {
        startService();
        Runnable expiry = ReflectionHelpers.getField(service, "capabilityExpiryRunnable");
        String reference = NativeManDownSecureStore.referenceForSession("session");
        SharedPreferences secrets = app.getSharedPreferences("guardian_native_mandown_secure_v1", Context.MODE_PRIVATE);
        secrets.edit().putString(reference, "encrypted-queued-alert").commit();
        plugin(app).stop(mock(PluginCall.class));
        expiry.run(); // Already dispatched before Android delivers onDestroy.
        assertEquals("encrypted-queued-alert", secrets.getString(reference, null));
        assertTrue(state.getBoolean("explicitlyStopped", false));
    }

    @Test public void capabilityCallbackCannotClearTheReplacementSessionsState() {
        startService();
        Runnable expiry = ReflectionHelpers.getField(service, "capabilityExpiryRunnable");
        pending();
        state.edit().putString("configSession", "replacement").commit();
        expiry.run();
        assertEquals("replacement", state.getString("configSession", null));
        assertTrue(state.contains("suspectedPayload"));
    }

    @Test public void pendingCancellationStopsTheServiceWithoutBlockingThePluginOrAcknowledgingEarly() throws Exception {
        pending();
        Context context = spy(new ContextWrapper(app));
        doReturn(false).when(context).stopService(any(Intent.class));
        Operation operation = mock(Operation.class);
        SettableFuture<Operation.State.SUCCESS> completion = SettableFuture.create();
        CountDownLatch waiting = new CountDownLatch(1);
        when(operation.getResult()).thenAnswer(invocation -> { waiting.countDown(); return completion; });
        when(manager.cancelUniqueWork(anyString())).thenReturn(operation);
        PluginCall call = mock(PluginCall.class);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<?> stopping = executor.submit(() -> {
            // Mockito static mocks are thread-local, like Capacitor's plugin executor.
            try (MockedStatic<WorkManager> background = mockStatic(WorkManager.class)) {
                background.when(() -> WorkManager.getInstance(any(Context.class))).thenReturn(manager);
                plugin(context).stop(call);
            }
        });
        try {
            assertTrue(waiting.await(5, TimeUnit.SECONDS));
            verify(context).stopService(any(Intent.class));
            verify(call, never()).resolve();
            // Capacitor shares one plugin handler: a slow cancellation must not
            // block other native calls (including emergency actions).
            stopping.get(5, TimeUnit.SECONDS);
        } finally {
            completion.set(Operation.SUCCESS);
            stopping.get(5, TimeUnit.SECONDS);
            executor.shutdownNow();
        }
        verify(call).resolve();
    }
}
