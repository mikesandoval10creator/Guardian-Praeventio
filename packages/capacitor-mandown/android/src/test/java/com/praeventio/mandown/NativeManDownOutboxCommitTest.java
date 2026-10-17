package com.praeventio.mandown;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeManDownOutboxCommitTest {
    @Test public void acceptedDeliveryRetriesWhenAcknowledgementCannotBeCommitted() throws Exception {
        verifyFailedCommit(NativeManDownForegroundService.DELIVERY_ACCEPTED);
    }

    @Test public void revokedDeliveryRetainsSecretsUntilDeadLetterCommitSucceeds() throws Exception {
        verifyFailedCommit(NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE);
    }

    @Test public void failedCommitRestoresMemoryUntilTheNextAcceptedDeliveryIsDurable() throws Exception {
        verifyMemoryFirstFailure(NativeManDownForegroundService.DELIVERY_ACCEPTED);
    }

    @Test public void failedCommitRestoresMemoryUntilTheDeadLetterIsDurable() throws Exception {
        verifyMemoryFirstFailure(NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE);
    }

    private void verifyMemoryFirstFailure(int outcome) throws Exception {
        Context app = RuntimeEnvironment.getApplication();
        SharedPreferences disk = app.getSharedPreferences(NativeManDownRetryWorker.PREFS, Context.MODE_PRIVATE);
        JSONObject event = NativeManDownOutboxCodec.queueEvent("project", "session", "secret-ref",
            new JSONObject().put("clientEventId", "first").put("kind", "man_down"), 1L);
        disk.edit().clear().putString("queue", new JSONArray().put(event).toString()).commit();
        java.util.concurrent.atomic.AtomicBoolean writable = new java.util.concurrent.atomic.AtomicBoolean(false);
        SharedPreferences failing = mock(SharedPreferences.class);
        when(failing.getString(anyString(), anyString())).thenAnswer(call ->
            disk.getString(call.getArgument(0), call.getArgument(1)));
        when(failing.edit()).thenAnswer(call -> {
            java.util.Map<String, String> changes = new java.util.HashMap<>();
            SharedPreferences.Editor edit = mock(SharedPreferences.Editor.class, RETURNS_SELF);
            when(edit.putString(anyString(), anyString())).thenAnswer(put -> {
                changes.put(put.getArgument(0), put.getArgument(1));
                return edit;
            });
            when(edit.commit()).thenAnswer(commit -> {
                // Android updates memory even when the subsequent disk write fails.
                SharedPreferences.Editor memory = disk.edit();
                changes.forEach(memory::putString);
                memory.commit();
                return writable.get();
            });
            return edit;
        });
        Context context = new ContextWrapper(app) {
            @Override public Context getApplicationContext() { return this; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return NativeManDownRetryWorker.PREFS.equals(name) ? failing : super.getSharedPreferences(name, mode);
            }
        };
        try (MockedStatic<NativeManDownSecureStore> secure = mockStatic(NativeManDownSecureStore.class);
             MockedStatic<NativeManDownForegroundService> http = mockStatic(NativeManDownForegroundService.class)) {
            secure.when(() -> NativeManDownSecureStore.load(context, "secret-ref"))
                .thenReturn(new NativeManDownSecureStore.Secrets("a".repeat(32), "https://app.praeventio.net"));
            http.when(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class))).thenReturn(outcome);
            assertEquals(Worker.Result.retry(),
                new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork());
            assertEquals(1, new JSONArray(disk.getString("queue", "[]")).length());
            assertEquals("[]", disk.getString("deadLetters", "[]"));
            secure.verify(() -> NativeManDownSecureStore.clearReference(context, "secret-ref"), never());
            writable.set(true);
            assertEquals(Worker.Result.success(),
                new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork());
            assertEquals("[]", disk.getString("queue", "[]"));
            assertEquals(outcome == NativeManDownForegroundService.DELIVERY_AUTHORITY_GONE ? 1 : 0,
                new JSONArray(disk.getString("deadLetters", "[]")).length());
            http.verify(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class)), times(2));
        }
    }

    private void verifyFailedCommit(int outcome) throws Exception {
        Context app = RuntimeEnvironment.getApplication();
        SharedPreferences disk = app.getSharedPreferences(NativeManDownRetryWorker.PREFS, Context.MODE_PRIVATE);
        JSONObject event = NativeManDownOutboxCodec.queueEvent("project", "session", "secret-ref",
            new JSONObject().put("clientEventId", "first").put("kind", "man_down"), 1L);
        disk.edit().clear().putString("queue", new JSONArray().put(event).toString()).commit();
        SharedPreferences failing = mock(SharedPreferences.class);
        when(failing.getString(anyString(), anyString())).thenAnswer(call ->
            disk.getString(call.getArgument(0), call.getArgument(1)));
        SharedPreferences.Editor editor = mock(SharedPreferences.Editor.class, RETURNS_SELF);
        when(editor.commit()).thenReturn(false);
        when(failing.edit()).thenReturn(editor);
        Context context = new ContextWrapper(app) {
            @Override public Context getApplicationContext() { return this; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return NativeManDownRetryWorker.PREFS.equals(name) ? failing : super.getSharedPreferences(name, mode);
            }
        };
        try (MockedStatic<NativeManDownSecureStore> secure = mockStatic(NativeManDownSecureStore.class);
             MockedStatic<NativeManDownForegroundService> http = mockStatic(NativeManDownForegroundService.class)) {
            secure.when(() -> NativeManDownSecureStore.load(context, "secret-ref"))
                .thenReturn(new NativeManDownSecureStore.Secrets("a".repeat(32), "https://app.praeventio.net"));
            http.when(() -> NativeManDownForegroundService.postPersistedEvent(anyString(), anyString(),
                anyString(), anyString(), any(JSONObject.class))).thenReturn(outcome);
            Worker.Result result = new NativeManDownRetryWorker(context, mock(WorkerParameters.class)).doWork();
            assertEquals(Worker.Result.retry(), result);
            assertEquals("first", new JSONArray(disk.getString("queue", "[]"))
                .getJSONObject(0).getString("clientEventId"));
            assertEquals("[]", disk.getString("deadLetters", "[]"));
            secure.verify(() -> NativeManDownSecureStore.clearReference(context, "secret-ref"), never());
        }
    }
}
