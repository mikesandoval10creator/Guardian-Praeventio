package com.praeventio.loneworker;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Real outbox and worker; replace only HTTP and disk-write failure injection. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeLoneWorkerOutboxDeliveryTest {
    private Context context;
    private SharedPreferences prefs;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        prefs = context.getSharedPreferences(NativeLoneWorkerOutbox.PREFS, Context.MODE_PRIVATE);
        prefs.edit().clear().commit();
        context.getSharedPreferences("guardian_native_lone_worker_state", Context.MODE_PRIVATE)
            .edit().clear().commit();
    }

    private JSONObject enqueue(Context target, String session) throws Exception {
        JSONObject payload = new JSONObject().put("kind", "heartbeat");
        assertTrue(NativeLoneWorkerOutbox.enqueue(target, "project", session,
            "a".repeat(32), "https://app.praeventio.net", payload));
        return payload;
    }

    private Worker.Result deliver(Context target) {
        return new NativeLoneWorkerRetryWorker(target, mock(WorkerParameters.class)).doWork();
    }

    private JSONArray letters() throws Exception {
        return new JSONArray(prefs.getString("deadLetters", "[]"));
    }

    @Test public void lateSuccessDoesNotDeleteTheNextSessionsEvent() throws Exception {
        verifyReplacedHead(NativeLoneWorkerTransport.ACCEPTED);
    }

    @Test public void lateRevocationDoesNotDeadLetterTheNextSessionsEvent() throws Exception {
        verifyReplacedHead(NativeLoneWorkerTransport.AUTHORITY_GONE);
    }

    @Test public void lateMalformedResponseDoesNotDeadLetterTheNextSessionsEvent() throws Exception {
        verifyReplacedHead(NativeLoneWorkerTransport.MALFORMED);
    }

    private void verifyReplacedHead(int outcome) throws Exception {
        JSONObject original = enqueue(context, "old-session");
        JSONObject[] arrival = new JSONObject[1];
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class))).thenAnswer(call -> {
                assertEquals(original.getString("clientEventId"),
                    ((JSONObject) call.getArgument(0)).getString("clientEventId"));
                NativeLoneWorkerOutbox.deadLetterSession(context, "project", "old-session", "explicit_stop");
                arrival[0] = enqueue(context, "new-session");
                return outcome;
            });
            assertEquals(Worker.Result.retry(), deliver(context));
            JSONArray queue = NativeLoneWorkerOutbox.readQueue(context);
            assertEquals(1, queue.length());
            assertEquals(arrival[0].getString("clientEventId"), queue.getJSONObject(0).getString("clientEventId"));
            assertEquals(1, letters().length());
            assertEquals("explicit_stop", letters().getJSONObject(0).getString("deadLetterReason"));
        }
    }

    @Test public void acceptedDeliveryPreservesConcurrentAppendFromAnotherThread() throws Exception {
        enqueue(context, "old-session");
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class))).thenAnswer(call -> {
                AtomicBoolean queued = new AtomicBoolean();
                Thread producer = new Thread(() -> queued.set(NativeLoneWorkerOutbox.enqueue(context,
                    "project", "new-session", "b".repeat(32), "https://app.praeventio.net", new JSONObject())));
                producer.start();
                producer.join(2_000);
                assertFalse("network I/O must not hold the queue lock", producer.isAlive());
                assertTrue(queued.get());
                return NativeLoneWorkerTransport.ACCEPTED;
            });
            assertEquals(Worker.Result.retry(), deliver(context));
            assertEquals("new-session", NativeLoneWorkerOutbox.first(context).getString("sessionId"));
            assertEquals(0, letters().length());
        }
    }

    @Test public void currentMalformedEventIsScrubbedWithoutTouchingAnotherSession() throws Exception {
        JSONObject first = enqueue(context, "old-session");
        enqueue(context, "new-session");
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenReturn(NativeLoneWorkerTransport.MALFORMED);
            assertEquals(Worker.Result.retry(), deliver(context));
            assertEquals("new-session", NativeLoneWorkerOutbox.first(context).getString("sessionId"));
            JSONObject letter = letters().getJSONObject(0);
            assertEquals(first.getString("clientEventId"), letter.getString("clientEventId"));
            assertEquals("malformed_payload", letter.getString("deadLetterReason"));
            assertFalse(letter.has("capability"));
            assertFalse(letter.has("apiBaseUrl"));
        }
    }

    @Test public void retryableResponseKeepsTheSameEventId() throws Exception {
        JSONObject first = enqueue(context, "session");
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenReturn(NativeLoneWorkerTransport.RETRYABLE);
            assertEquals(Worker.Result.retry(), deliver(context));
            assertEquals(first.getString("clientEventId"), NativeLoneWorkerOutbox.first(context).getString("clientEventId"));
            assertEquals(0, letters().length());
        }
    }

    @Test public void missingEventIdIsQuarantinedWithoutBlockingTheNextHeartbeat() throws Exception {
        enqueue(context, "session");
        JSONObject event = NativeLoneWorkerOutbox.first(context);
        event.remove("clientEventId");
        prefs.edit().putString("queue", new JSONArray().put(event).toString()).commit();
        JSONObject next = enqueue(context, "next-session");
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)))
                .thenReturn(NativeLoneWorkerTransport.ACCEPTED);
            assertEquals(Worker.Result.retry(), deliver(context));
            assertEquals(1, NativeLoneWorkerOutbox.readQueue(context).length());
            assertEquals(next.getString("clientEventId"), NativeLoneWorkerOutbox.first(context).getString("clientEventId"));
            assertEquals("missing_client_event_id", letters().getJSONObject(0).getString("deadLetterReason"));
            assertFalse(letters().getJSONObject(0).has("capability"));
            http.verifyNoInteractions();
        }
    }

    @Test public void acceptedCommitFailureRestoresMemoryAndRetries() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.ACCEPTED, false);
    }

    @Test public void staleUnidentifiedSnapshotCannotQuarantineItsReplacement() throws Exception {
        enqueue(context, "old-session");
        JSONObject unidentified = NativeLoneWorkerOutbox.first(context);
        unidentified.remove("clientEventId");
        prefs.edit().putString("queue", new JSONArray().put(unidentified).toString()).commit();
        String snapshot = unidentified.toString();
        NativeLoneWorkerOutbox.deadLetterSession(context, "project", "old-session", "explicit_stop");
        JSONObject replacement = enqueue(context, "new-session");
        assertEquals(1, NativeLoneWorkerOutbox.quarantineUnidentifiedHead(context, snapshot));
        assertEquals(replacement.getString("clientEventId"), NativeLoneWorkerOutbox.first(context).getString("clientEventId"));
        assertEquals(1, letters().length());
    }

    @Test public void changedUnidentifiedHeadMustBeObservedAgainBeforeQuarantine() throws Exception {
        enqueue(context, "session");
        JSONObject unidentified = NativeLoneWorkerOutbox.first(context);
        unidentified.remove("clientEventId");
        String snapshot = unidentified.toString();
        unidentified.put("queuedAt", 42L);
        prefs.edit().putString("queue", new JSONArray().put(unidentified).toString()).commit();
        assertEquals(1, NativeLoneWorkerOutbox.quarantineUnidentifiedHead(context, snapshot));
        assertEquals(0, letters().length());
        assertEquals(42L, NativeLoneWorkerOutbox.first(context).getLong("queuedAt"));
        assertEquals(0, NativeLoneWorkerOutbox.quarantineUnidentifiedHead(context, unidentified.toString()));
        assertEquals(1, letters().length());
    }

    @Test public void unidentifiedQuarantineCommitFailureRestoresMemoryAndRetries() throws Exception {
        verifyFailedCommit(0, false);
    }

    @Test public void unidentifiedQuarantineCommitExceptionRestoresMemoryAndRetries() throws Exception {
        verifyFailedCommit(0, true);
    }

    @Test public void malformedCommitFailureRestoresBothArraysAndRetries() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.MALFORMED, false);
    }

    @Test public void revokedCommitFailureDoesNotStopAuthorityBeforePersistence() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.AUTHORITY_GONE, false);
    }

    @Test public void acceptedCommitExceptionRestoresMemoryAndRetries() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.ACCEPTED, true);
    }

    @Test public void malformedCommitExceptionRestoresBothArraysAndRetries() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.MALFORMED, true);
    }

    @Test public void revokedCommitExceptionDoesNotStopAuthorityBeforePersistence() throws Exception {
        verifyFailedCommit(NativeLoneWorkerTransport.AUTHORITY_GONE, true);
    }

    private void verifyFailedCommit(int outcome, boolean throwsAfterMemory) throws Exception {
        JSONObject original = enqueue(context, "session");
        if (outcome == 0) {
            JSONObject unidentified = NativeLoneWorkerOutbox.first(context);
            unidentified.remove("clientEventId");
            prefs.edit().putString("queue", new JSONArray().put(unidentified).toString()).commit();
        }
        AtomicBoolean writable = new AtomicBoolean(false);
        SharedPreferences failing = mock(SharedPreferences.class);
        when(failing.getString(anyString(), anyString())).thenAnswer(call ->
            prefs.getString(call.getArgument(0), call.getArgument(1)));
        when(failing.edit()).thenAnswer(call -> {
            Map<String, String> changes = new HashMap<>();
            SharedPreferences.Editor edit = mock(SharedPreferences.Editor.class, RETURNS_SELF);
            when(edit.putString(anyString(), anyString())).thenAnswer(put -> {
                changes.put(put.getArgument(0), put.getArgument(1));
                return edit;
            });
            when(edit.commit()).thenAnswer(commit -> {
                // Android mutates memory before the disk result is available.
                SharedPreferences.Editor memory = prefs.edit();
                changes.forEach(memory::putString);
                memory.commit();
                if (!writable.get() && throwsAfterMemory) throw new IllegalStateException("disk_failure");
                return writable.get();
            });
            return edit;
        });
        Context target = new ContextWrapper(context) {
            @Override public Context getApplicationContext() { return this; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return NativeLoneWorkerOutbox.PREFS.equals(name) ? failing : super.getSharedPreferences(name, mode);
            }
        };
        try (MockedStatic<NativeLoneWorkerTransport> http = mockStatic(NativeLoneWorkerTransport.class);
             MockedStatic<NativeLoneWorkerForegroundService> service = mockStatic(NativeLoneWorkerForegroundService.class)) {
            http.when(() -> NativeLoneWorkerTransport.post(any(JSONObject.class))).thenReturn(outcome);
            assertEquals(Worker.Result.retry(), deliver(target));
            assertEquals(original.getString("clientEventId"), NativeLoneWorkerOutbox.first(context)
                .getJSONObject("payload").getString("clientEventId"));
            assertEquals(0, letters().length());
            service.verifyNoInteractions();
            writable.set(true);
            assertEquals(Worker.Result.success(), deliver(target));
            assertEquals(0, NativeLoneWorkerOutbox.readQueue(context).length());
            assertEquals(outcome == NativeLoneWorkerTransport.ACCEPTED ? 0 : 1, letters().length());
            if (outcome == NativeLoneWorkerTransport.AUTHORITY_GONE) {
                service.verify(() -> NativeLoneWorkerForegroundService.authorityGone(target, "project", "session"), times(1));
            }
            http.verify(() -> NativeLoneWorkerTransport.post(any(JSONObject.class)), times(outcome == 0 ? 0 : 2));
        }
    }
}
