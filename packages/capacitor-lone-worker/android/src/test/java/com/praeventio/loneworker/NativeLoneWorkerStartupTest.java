package com.praeventio.loneworker;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.Manifest;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
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
import java.time.Duration;

/** Real plugin/service lifecycle; do not launch workers or contact a real backend. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public final class NativeLoneWorkerStartupTest {
    private Context context;
    private NativeLoneWorkerPlugin plugin;
    private ServiceController<NativeLoneWorkerForegroundService> controller;
    private NativeLoneWorkerForegroundService service;
    private MockedStatic<NativeLoneWorkerRetryWorker> retry;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        context.getSharedPreferences("guardian_native_lone_worker_state", Context.MODE_PRIVATE).edit().clear().commit();
        context.getSharedPreferences(NativeLoneWorkerOutbox.PREFS, Context.MODE_PRIVATE).edit().clear().commit();
        retry = mockStatic(NativeLoneWorkerRetryWorker.class);
        plugin = spy(new NativeLoneWorkerPlugin());
        doReturn(context).when(plugin).getContext();
        controller = Robolectric.buildService(NativeLoneWorkerForegroundService.class).create();
        service = spy(controller.get());
    }

    @After public void cleanup() {
        plugin.stop(mock(PluginCall.class));
        service.onDestroy();
        controller.destroy();
        retry.close();
    }

    private PluginCall startCall(String session) {
        PluginCall call = mock(PluginCall.class);
        when(call.getString("projectId")).thenReturn("project");
        when(call.getString("sessionId")).thenReturn(session);
        when(call.getString("capability")).thenReturn("a".repeat(32));
        when(call.getString("apiBaseUrl")).thenReturn("https://app.praeventio.net");
        when(call.getString("capabilityExpiresAt")).thenReturn("2099-01-01T00:00:00Z");
        return call;
    }

    private Intent request(PluginCall call) {
        plugin.start(call);
        return Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService();
    }

    private void assertRunning(PluginCall call) {
        ArgumentCaptor<JSObject> result = ArgumentCaptor.forClass(JSObject.class);
        verify(call, times(1)).resolve(result.capture());
        assertTrue(result.getValue().getBool("running"));
        verify(call, never()).reject(anyString());
        assertTrue(NativeLoneWorkerForegroundService.isRunning());
    }

    @Test public void acknowledgesOnlyAfterTheServiceActuallyStarts() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        verify(call, never()).resolve(any(JSObject.class));
        assertNotNull(intent);
        assertEquals(Service.START_STICKY, service.onStartCommand(intent, 0, 1));
        assertRunning(call);
        // Replayed Android delivery cannot settle a call or initialize a loop twice.
        service.onStartCommand(intent, 0, 1);
        verify(call, times(1)).resolve(any(JSObject.class));
        verify(service, times(1)).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void invalidConfigIsRejectedByTheService() {
        PluginCall call = startCall("session");
        when(call.getString("capability")).thenReturn("invalid");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("capability_expired_or_invalid");
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
    }

    @Test public void timeoutPreventsDelayedIntentFromStartingMonitoring() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(7_999));
        verify(call, never()).resolve(any(JSObject.class));
        verify(call, never()).reject(anyString());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1));
        verify(call).reject("native_lone_worker_start_timeout");
        service.onStartCommand(intent, 0, 1);
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
        verify(call, never()).resolve(any(JSObject.class));
    }

    @Test public void stopCancelsAnUndeliveredStart() {
        PluginCall call = startCall("session");
        Intent intent = request(call);
        plugin.stop(mock(PluginCall.class));
        service.onStartCommand(intent, 0, 1);
        verify(call).reject("native_lone_worker_start_cancelled");
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
    }

    @Test public void rejectsAnOverlappingAttemptWithoutReplacingTheFirst() {
        PluginCall first = startCall("first");
        Intent intent = request(first);
        PluginCall second = startCall("second");
        plugin.start(second);
        verify(second).reject("native_lone_worker_start_in_progress");
        assertNull(Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService());
        service.onStartCommand(intent, 0, 1);
        assertRunning(first);
        verify(second, never()).resolve(any(JSObject.class));
    }

    @Test public void staleCancelledIntentCannotReplaceANewerRunningSession() {
        PluginCall old = startCall("old");
        Intent stale = request(old);
        plugin.stop(mock(PluginCall.class));
        PluginCall newer = startCall("new");
        service.onStartCommand(request(newer), 0, 2);
        assertRunning(newer);
        service.onStartCommand(stale, 0, 1);
        assertTrue(NativeLoneWorkerForegroundService.isRunning());
        assertEquals("new", context.getSharedPreferences("guardian_native_lone_worker_state", 0)
            .getString("sessionId", null));
        verify(newer, times(1)).resolve(any(JSObject.class));
        verify(old, never()).resolve(any(JSObject.class));
    }

    @Test public void invalidRequestDoesNotStopAnExistingOwner() {
        PluginCall first = startCall("first");
        service.onStartCommand(request(first), 0, 1);
        PluginCall invalid = startCall("second");
        when(invalid.getString("capability")).thenReturn("invalid");
        service.onStartCommand(request(invalid), 0, 2);
        verify(invalid).reject("native_lone_worker_already_running");
        verify(invalid, never()).resolve(any(JSObject.class));
        assertTrue(NativeLoneWorkerForegroundService.isRunning());
        assertEquals("first", context.getSharedPreferences("guardian_native_lone_worker_state", 0)
            .getString("sessionId", null));
    }

    @Test public void matchingRunningSessionIsIdempotent() {
        service.onStartCommand(request(startCall("session")), 0, 1);
        PluginCall again = startCall("session");
        service.onStartCommand(request(again), 0, 2);
        assertRunning(again);
        verify(service, times(1)).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void foregroundRefusalRejectsAndClearsNewConfig() {
        doThrow(new SecurityException("denied")).when(service).startForeground(anyInt(), any(Notification.class));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("native_start_failed");
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        assertNull(context.getSharedPreferences("guardian_native_lone_worker_state", 0).getString("sessionId", null));
    }

    @Test public void stopDuringForegroundStartupCannotBeReportedAsRunning() {
        doAnswer(invocation -> { plugin.stop(mock(PluginCall.class)); return null; })
            .when(service).startForeground(anyInt(), any(Notification.class));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("native_lone_worker_start_cancelled");
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        assertNull(context.getSharedPreferences("guardian_native_lone_worker_state", 0).getString("sessionId", null));
    }

    @Test public void failedConfigPersistenceCannotAcknowledgeProtection() {
        SharedPreferences failing = mock(SharedPreferences.class);
        SharedPreferences.Editor editor = mock(SharedPreferences.Editor.class, RETURNS_SELF);
        when(failing.edit()).thenReturn(editor);
        when(editor.commit()).thenReturn(false);
        doReturn(failing).when(service).getSharedPreferences("guardian_native_lone_worker_state", Context.MODE_PRIVATE);
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("native_lone_worker_config_persist_failed");
        verify(call, never()).resolve(any(JSObject.class));
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
    }

    @Test public void missingLocationPermissionRejectsWithoutDispatchingAService() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION);
        PluginCall call = startCall("session");
        assertNull(request(call));
        verify(call).reject("location_permission_required");
        verify(call, never()).resolve(any(JSObject.class));
    }

    @Test public void dispatchFailureRejectsExactlyOnceAndCancelsItsTimer() {
        Context denied = spy(context);
        doThrow(new SecurityException("denied")).when(denied).startForegroundService(any(Intent.class));
        doReturn(denied).when(plugin).getContext();
        PluginCall call = startCall("session");
        plugin.start(call);
        verify(call).reject("native_lone_worker_start_failed: denied");
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(9));
        verify(call, times(1)).reject(anyString());
        verify(call, never()).resolve(any(JSObject.class));
    }

    @Test public void startupFailureDoesNotRevokeAlreadyQueuedEvents() throws Exception {
        assertTrue(NativeLoneWorkerOutbox.enqueue(context, "project", "session", "a".repeat(32),
            "https://app.praeventio.net", new JSONObject().put("kind", "heartbeat")));
        doThrow(new SecurityException("denied")).when(service).startForeground(anyInt(), any(Notification.class));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("native_start_failed");
        assertEquals("startup failure is not server authority revocation", 1,
            NativeLoneWorkerOutbox.readQueue(context).length());
    }

    @Test public void elapsedDeadlineDuringInitializationRejectsEvenBeforeTimerDispatch() {
        doAnswer(invocation -> {
            org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofSeconds(9));
            return null;
        }).when(service).startForeground(anyInt(), any(Notification.class));
        PluginCall call = startCall("session");
        service.onStartCommand(request(call), 0, 1);
        verify(call).reject("native_lone_worker_start_timeout");
        verify(call, never()).resolve(any(JSObject.class));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        assertNull(context.getSharedPreferences("guardian_native_lone_worker_state", 0).getString("sessionId", null));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        verify(call, times(1)).reject(anyString());
    }

    private void persistedConfig(long expiry) {
        context.getSharedPreferences("guardian_native_lone_worker_state", 0).edit()
            .putString("projectId", "project").putString("sessionId", "session")
            .putString("capability", "a".repeat(32)).putString("apiBaseUrl", "https://app.praeventio.net")
            .putLong("capabilityExpiresAt", expiry).putLong("heartbeatIntervalMs", 30_000L).commit();
    }

    @Test public void nullIntentRestoresStillAuthorizedPersistedMonitoring() {
        persistedConfig(java.time.Instant.parse("2099-01-01T00:00:00Z").toEpochMilli());
        assertEquals(Service.START_STICKY, service.onStartCommand(null, 0, 1));
        assertTrue(NativeLoneWorkerForegroundService.isRunning());
        verify(service).startForeground(anyInt(), any(Notification.class));
    }

    @Test public void nullIntentCannotReviveExpiredPersistedMonitoring() {
        persistedConfig(1L);
        assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1));
        assertFalse(NativeLoneWorkerForegroundService.isRunning());
        verify(service, never()).startForeground(anyInt(), any(Notification.class));
    }
}
