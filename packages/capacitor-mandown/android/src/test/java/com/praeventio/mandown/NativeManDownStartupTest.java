package com.praeventio.mandown;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;
import androidx.work.Operation;
import androidx.work.WorkManager;
import androidx.work.impl.utils.futures.SettableFuture;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.time.Duration;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.util.ReflectionHelpers;

/** Real plugin/service acknowledgment, with sensors and background delivery isolated. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public final class NativeManDownStartupTest {
    private Context app;
    private NativeManDownPlugin plugin;
    private NativeManDownForegroundService service;
    private ServiceController<NativeManDownForegroundService> controller;
    private SensorManager sensors;
    private MockedStatic<WorkManager> work;
    private MockedStatic<NativeManDownSecureStore> secure;
    private MockedStatic<NativeManDownRetryWorker> retry;

    @Before public void setup() {
        app = RuntimeEnvironment.getApplication();
        app.getSharedPreferences("guardian_native_mandown_state", 0).edit().clear().commit();
        app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).edit().clear().commit();
        app.getSharedPreferences("guardian_native_mandown_secure_v1", 0).edit().clear().commit();
        WorkManager manager = mock(WorkManager.class);
        Operation cancellation = mock(Operation.class);
        SettableFuture<Operation.State.SUCCESS> completed = SettableFuture.create();
        completed.set(Operation.SUCCESS);
        when(cancellation.getResult()).thenReturn(completed);
        when(manager.cancelUniqueWork(anyString())).thenReturn(cancellation);
        work = mockStatic(WorkManager.class);
        work.when(() -> WorkManager.getInstance(any(Context.class))).thenReturn(manager);
        secure = mockStatic(NativeManDownSecureStore.class, CALLS_REAL_METHODS);
        secure.when(() -> NativeManDownSecureStore.persist(any(), anyString(), anyString(), anyString())).thenReturn(true);
        secure.when(() -> NativeManDownSecureStore.load(any(), anyString())).thenReturn(
            new NativeManDownSecureStore.Secrets("a".repeat(32), "https://app.praeventio.net"));
        retry = mockStatic(NativeManDownRetryWorker.class);
        plugin = spy(new NativeManDownPlugin());
        doReturn(app).when(plugin).getContext();
        controller = Robolectric.buildService(NativeManDownForegroundService.class).create();
        service = spy(controller.get());
        sensors = mock(SensorManager.class);
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt())).thenReturn(true);
        ReflectionHelpers.setField(service, "sensorManager", sensors);
        ReflectionHelpers.setField(service, "accelerometer", mock(Sensor.class));
    }

    @After public void cleanup() {
        plugin.stop(mock(PluginCall.class));
        service.onDestroy();
        controller.destroy();
        ((Handler) ReflectionHelpers.getField(service, "handler")).removeCallbacksAndMessages(null);
        retry.close();
        secure.close();
        work.close();
    }

    private PluginCall startCall(String session) {
        PluginCall call = mock(PluginCall.class);
        when(call.getString("projectId")).thenReturn("project");
        when(call.getString("sessionId")).thenReturn(session);
        when(call.getString("capability")).thenReturn("a".repeat(32));
        when(call.getString("capabilityExpiresAt")).thenReturn("2099-01-01T00:00:00Z");
        when(call.getString("apiBaseUrl")).thenReturn("https://app.praeventio.net");
        when(call.getInt("inactivityThresholdMs")).thenReturn(30_000);
        when(call.getDouble("impactThresholdMps2", 25d)).thenReturn(25d);
        return call;
    }

    private Intent request(PluginCall call) {
        plugin.start(call);
        return Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService();
    }

    private void assertRunning(PluginCall call) {
        ArgumentCaptor<JSObject> result = ArgumentCaptor.forClass(JSObject.class);
        verify(call).resolve(result.capture());
        assertTrue(result.getValue().getBool("running"));
        assertTrue((boolean) ReflectionHelpers.getField(service, "monitoring"));
        verify(call, never()).reject(anyString());
    }

    private void assertStopped(PluginCall call, String error) {
        verify(call).reject(error);
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse((boolean) ReflectionHelpers.getField(service, "monitoring"));
    }

    @Test public void resolvesOnlyAfterSensorRegistrationAndIgnoresReplay() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        verify(call, never()).resolve(any(JSObject.class));
        doAnswer(invocation -> {
            verify(call, never()).resolve(any(JSObject.class));
            return true;
        }).when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        service.onStartCommand(intent, 0, 1);
        assertRunning(call);
        service.onStartCommand(intent, 0, 1);
        verify(call, times(1)).resolve(any(JSObject.class));
        verify(sensors, times(1)).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
    }

    @Test public void missingSensorRejectsInsteadOfClaimingProtection() {
        ReflectionHelpers.setField(service, "accelerometer", null);
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_sensor_unavailable");
    }

    @Test public void refusedRegistrationRejectsInsteadOfClaimingProtection() {
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt())).thenReturn(false);
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_sensor_unavailable");
    }

    @Test public void sensorExceptionRejectsAndCleansUp() {
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt()))
            .thenThrow(new SecurityException("denied"));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_initialization_failed");
        verify(sensors).unregisterListener(service);
    }

    @Test public void foregroundRefusalRejectsAndCleansUp() {
        doThrow(new SecurityException("denied")).when(service).startForeground(anyInt(), any(Notification.class));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_initialization_failed");
    }

    @Test public void invalidCapabilityCannotResolveRunning() {
        PluginCall call = startCall("session");
        when(call.getString("capability")).thenReturn("invalid");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_config_invalid_or_unpersisted");
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void failedPersistenceCannotResolveRunning() {
        secure.when(() -> NativeManDownSecureStore.persist(any(), anyString(), anyString(), anyString())).thenReturn(false);
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_config_invalid_or_unpersisted");
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void timeoutRejectsAndPreventsDelayedStartup() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(7_999));
        verify(call, never()).resolve(any(JSObject.class));
        verify(call, never()).reject(anyString());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1));
        service.onStartCommand(intent, 0, 1);
        assertStopped(call, "native_man_down_start_timeout");
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void elapsedDeadlineDuringInitializationCannotResolveRunning() {
        doAnswer(invocation -> {
            org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofSeconds(9));
            return true;
        }).when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_start_timeout");
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        verify(call, times(1)).reject(anyString());
    }

    @Test public void stopCancelsUndeliveredStartup() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        plugin.stop(mock(PluginCall.class));
        service.onStartCommand(intent, 0, 1);
        assertStopped(call, "native_man_down_start_cancelled");
        verify(sensors, never()).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
    }

    @Test public void stopDuringRegistrationCannotResolveRunning() {
        doAnswer(invocation -> { plugin.stop(mock(PluginCall.class)); return true; })
            .when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_start_cancelled");
    }

    @Test public void overlappingStartDoesNotReplacePendingAttempt() {
        PluginCall first = startCall("first");
        Intent intent = request(first);
        PluginCall second = startCall("second");
        plugin.start(second);
        verify(second).reject("native_man_down_start_in_progress");
        assertNull(Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService());
        service.onStartCommand(intent, 0, 1);
        assertRunning(first);
    }

    @Test public void staleCancelledIntentCannotReplaceNewMonitoring() {
        PluginCall old = startCall("old");
        Intent stale = request(old);
        plugin.stop(mock(PluginCall.class));
        PluginCall current = startCall("current");
        service.onStartCommand(request(current), 0, 2);
        assertRunning(current);
        service.onStartCommand(stale, 0, 1);
        assertTrue((boolean) ReflectionHelpers.getField(service, "monitoring"));
        assertEquals("current", app.getSharedPreferences("guardian_native_mandown_state", 0).getString("configSession", null));
        verify(old, never()).resolve(any(JSObject.class));
    }

    @Test public void dispatchFailureRejectsOnceWithoutALaterTimeout() {
        Context denied = spy(app);
        doThrow(new SecurityException("denied")).when(denied).startForegroundService(any(Intent.class));
        doReturn(denied).when(plugin).getContext();
        PluginCall call = startCall("session");
        plugin.start(call);
        verify(call).reject("native_man_down_start_failed: denied");
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(9));
        verify(call, times(1)).reject(anyString());
        verify(call, never()).resolve(any(JSObject.class));
    }

    @Test public void failedOlderStartupCannotStopANewerAcceptedDelivery() {
        PluginCall old = startCall("old");
        PluginCall newer = startCall("newer");
        Intent[] replacement = new Intent[1];
        doAnswer(invocation -> {
            replacement[0] = request(newer);
            return null;
        }).when(old).reject("native_man_down_start_timeout");
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt()))
            .thenAnswer(invocation -> {
                org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofSeconds(9));
                return true;
            }).thenReturn(true);
        service.onStartCommand(request(old), 0, 1);
        assertNotNull(replacement[0]);
        verify(service).stopSelfResult(1);
        verify(service, never()).stopSelf();
        service.onStartCommand(replacement[0], 0, 2);
        assertRunning(newer);
    }

    @Test public void refreshingSameSessionPreservesItsPendingCountdown() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        long deadline = System.currentTimeMillis() + 20_000L;
        SharedPreferences state = app.getSharedPreferences("guardian_native_mandown_state", 0);
        state.edit().putString("suspectedPayload", "{\"kind\":\"impact\"}")
            .putLong("suspectedDeadline", deadline).commit();
        PluginCall refreshed = startCall("session");
        when(refreshed.getInt("inactivityThresholdMs")).thenReturn(45_000);
        service.onStartCommand(request(refreshed), 0, 2);
        assertRunning(refreshed);
        assertEquals(deadline, state.getLong("suspectedDeadline", 0L));
        assertEquals(45_000L, (long) ReflectionHelpers.getField(service, "inactivityThresholdMs"));
    }

    private JSObject readStatus() {
        PluginCall call = mock(PluginCall.class);
        plugin.getStatus(call);
        ArgumentCaptor<JSObject> result = ArgumentCaptor.forClass(JSObject.class);
        verify(call).resolve(result.capture());
        return result.getValue();
    }

    @Test public void statusAcknowledgesSensorsAndReturnsOnlyPublicReceipt() throws Exception {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        assertFalse(readStatus().getBool("running"));
        doAnswer(invocation -> {
            assertFalse(readStatus().getBool("running"));
            assertEquals("native_man_down_initializing", readStatus().getString("lastError"));
            return true;
        }).when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        service.onStartCommand(intent, 0, 1);
        JSObject status = readStatus();
        assertTrue(status.getBool("running"));
        assertEquals(intent.getStringExtra("startRequestId"), status.getString("monitoringId"));
        ArgumentCaptor<JSObject> receipt = ArgumentCaptor.forClass(JSObject.class);
        verify(call).resolve(receipt.capture());
        assertEquals(status.getString("monitoringId"), receipt.getValue().getString("monitoringId"));
        assertEquals("2099-01-01T00:00:00Z", status.getString("capabilityExpiresAt"));
        assertEquals(3, status.length());
        assertFalse(status.toString().contains("a".repeat(32)));
        assertFalse(status.toString().contains("praeventio.net"));
    }

    @Test public void statusReportsSensorFailure() {
        when(sensors.registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt())).thenReturn(false);
        service.onStartCommand(request(startCall("session")), 0, 1);
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_sensor_unavailable", readStatus().getString("lastError"));
    }

    @Test public void statusObservesExplicitStopBeforeServiceDestructionWithoutDiscardingOutbox() throws Exception {
        service.onStartCommand(request(startCall("session")), 0, 1);
        String id = readStatus().getString("monitoringId");
        String queue = queuedAlert();
        plugin.stop(mock(PluginCall.class));
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_explicitly_stopped", readStatus().getString("lastError"));
        assertEquals(id, readStatus().getString("monitoringId"));
        assertEquals(queue, app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).getString("queue", null));
        assertQueuedSecretRetained();
    }

    @Test public void statusRejectsExpiredAuthorityEvenBeforeTimerDispatch() {
        PluginCall call = startCall("session");
        when(call.getString("capabilityExpiresAt")).thenReturn(java.time.Instant.ofEpochMilli(System.currentTimeMillis() + 2_000L).toString());
        service.onStartCommand(request(call), 0, 1);
        assertTrue(readStatus().getBool("running"));
        // Robolectric's monotonic clock does not advance Java's wall clock.
        // Move the receipt's authority boundary into the past without dispatching callbacks.
        ReflectionHelpers.setField(ReflectionHelpers.getStaticField(NativeManDownForegroundService.class,
            "runtimeStatus"), "expiresAtMs", System.currentTimeMillis() - 1L);
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_authority_expired", readStatus().getString("lastError"));
        assertTrue((boolean) ReflectionHelpers.getField(service, "monitoring"));
    }

    @Test public void expiryReasonSurvivesDestruction() {
        PluginCall call = startCall("session");
        when(call.getString("capabilityExpiresAt")).thenReturn(java.time.Instant.ofEpochMilli(System.currentTimeMillis() + 2_000L).toString());
        service.onStartCommand(request(call), 0, 1);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3));
        service.onDestroy();
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_authority_expired", readStatus().getString("lastError"));
    }

    @Test public void explicitStopReasonSurvivesNormalDestruction() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        plugin.stop(mock(PluginCall.class));
        service.onDestroy();
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_explicitly_stopped", readStatus().getString("lastError"));
    }

    @Test public void persistedConfigurationWithoutLiveProcessEvidenceIsUnknown() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        ReflectionHelpers.setStaticField(NativeManDownForegroundService.class, "runtimeStatus", null);
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_state_unknown", readStatus().getString("lastError"));
        assertFalse(readStatus().has("monitoringId"));
        assertEquals("session", app.getSharedPreferences("guardian_native_mandown_state", 0).getString("configSession", null));
    }

    @Test public void unexpectedDestructionReportsInterruptionAndRetainsEvidence() throws Exception {
        service.onStartCommand(request(startCall("session")), 0, 1);
        String queue = queuedAlert();
        service.onDestroy();
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_service_destroyed", readStatus().getString("lastError"));
        assertEquals("session", app.getSharedPreferences("guardian_native_mandown_state", 0).getString("configSession", null));
        assertEquals(queue, app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).getString("queue", null));
        assertQueuedSecretRetained();
    }

    @Test public void oldServiceDestructionCannotOverwriteNewReceipt() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        ServiceController<NativeManDownForegroundService> nextController = Robolectric.buildService(NativeManDownForegroundService.class).create();
        NativeManDownForegroundService next = nextController.get();
        ReflectionHelpers.setField(next, "sensorManager", sensors);
        ReflectionHelpers.setField(next, "accelerometer", mock(Sensor.class));
        try {
            Intent intent = request(startCall("new-session"));
            next.onStartCommand(intent, 0, 2);
            service.onDestroy();
            assertTrue(readStatus().getBool("running"));
            assertEquals(intent.getStringExtra("startRequestId"), readStatus().getString("monitoringId"));
        } finally {
            nextController.destroy();
        }
    }

    @Test public void mismatchedPersistedOwnerCannotReportRunning() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        SharedPreferences state = app.getSharedPreferences("guardian_native_mandown_state", 0);
        state.edit().putString("configSession", "other-session").commit();
        assertFalse(readStatus().getBool("running"));
        assertEquals("native_man_down_state_unknown", readStatus().getString("lastError"));
        assertEquals("other-session", state.getString("configSession", null));
    }

    private String queuedAlert() throws Exception {
        String reference = NativeManDownSecureStore.referenceForSession("session");
        app.getSharedPreferences("guardian_native_mandown_secure_v1", 0).edit()
            .putString(reference, "encrypted-queued-alert").commit();
        JSONObject event = NativeManDownOutboxCodec.queueEvent("project", "session", reference,
            new JSONObject().put("kind", "impact").put("clientEventId", "queued"), 1L);
        String queue = new JSONArray().put(event).toString();
        app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).edit().putString("queue", queue).commit();
        return queue;
    }

    private void assertQueuedSecretRetained() {
        assertEquals("encrypted-queued-alert", app.getSharedPreferences("guardian_native_mandown_secure_v1", 0)
            .getString(NativeManDownSecureStore.referenceForSession("session"), null));
    }

    @Test public void cancelledStartupPreservesAlreadyQueuedAlertCredentials() throws Exception {
        String queue = queuedAlert();
        doAnswer(invocation -> { plugin.stop(mock(PluginCall.class)); return true; })
            .when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_start_cancelled");
        assertEquals(queue, app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).getString("queue", null));
        assertQueuedSecretRetained();
    }

    @Test public void failedPersistencePreservesAlreadyQueuedAlertCredentials() throws Exception {
        String queue = queuedAlert();
        secure.when(() -> NativeManDownSecureStore.persist(any(), anyString(), anyString(), anyString())).thenReturn(false);
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_config_invalid_or_unpersisted");
        assertEquals(queue, app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).getString("queue", null));
        assertQueuedSecretRetained();
    }

    @Test public void elapsedStartupRetainsCredentialsOfAlertRestoredBeforeFinalAcknowledgment() throws Exception {
        queuedAlert();
        app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).edit().clear().commit();
        SharedPreferences state = app.getSharedPreferences("guardian_native_mandown_state", 0);
        state.edit().putString("configProject", "project").putString("configSession", "session")
            .putString("suspectedPayload", "{\"kind\":\"impact\"}")
            .putLong("suspectedDeadline", System.currentTimeMillis() - 1).commit();
        retry.close();
        retry = mockStatic(NativeManDownRetryWorker.class, CALLS_REAL_METHODS);
        retry.when(() -> NativeManDownRetryWorker.enqueueRetry(any())).thenAnswer(invocation -> null);
        doAnswer(invocation -> {
            org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofSeconds(9));
            return true;
        }).when(sensors).registerListener(any(SensorEventListener.class), any(Sensor.class), anyInt());
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        assertStopped(call, "native_man_down_start_timeout");
        retry.verify(() -> NativeManDownRetryWorker.enqueuePending(any(), anyString(), anyString(), anyString(), anyString(), any(JSONObject.class)));
        assertEquals(1, new JSONArray(app.getSharedPreferences(NativeManDownRetryWorker.PREFS, 0).getString("queue", "[]")).length());
        assertQueuedSecretRetained();
    }
}
