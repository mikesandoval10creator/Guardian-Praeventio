package com.praeventio.loneworker;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Real producer/JSON; inject Android's memory-before-disk commit failure. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public final class NativeLoneWorkerEnqueueCommitTest {
    private Context context;
    private SharedPreferences memory;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        memory = context.getSharedPreferences(NativeLoneWorkerOutbox.PREFS, Context.MODE_PRIVATE);
        memory.edit().clear().commit();
    }

    private void seed(int size) throws Exception {
        JSONArray queue = new JSONArray();
        for (int i = 0; i < size; i++) {
            queue.put(new JSONObject()
                .put("clientEventId", new UUID(0L, i + 1).toString())
                .put("sessionId", "existing-session")
                .put("capability", "old-secret")
                .put("apiBaseUrl", "https://app.praeventio.net"));
        }
        memory.edit().putString("queue", queue.toString())
            .putString("deadLetters", "[{\"clientEventId\":\"previous-letter\"}]").commit();
    }

    private boolean enqueue(Context target, JSONObject payload) {
        return NativeLoneWorkerOutbox.enqueue(target, "project", "new-session",
            "a".repeat(32), "https://app.praeventio.net", payload);
    }

    @Test public void failedCommitRestoresTheOriginalQueueBeforeReturningFalse() throws Exception {
        verifyFailedWrite(false, false);
    }

    @Test public void throwingCommitRestoresTheOriginalQueueBeforeReturningFalse() throws Exception {
        verifyFailedWrite(false, true);
    }

    @Test public void failedCapacityReplacementDoesNotLoseTheDurableOldestEvent() throws Exception {
        verifyFailedWrite(true, false);
    }

    @Test public void throwingCapacityReplacementDoesNotLoseTheDurableOldestEvent() throws Exception {
        verifyFailedWrite(true, true);
    }

    private void verifyFailedWrite(boolean full, boolean throwsAfterMemory) throws Exception {
        seed(full ? 10_000 : 1);
        String oldQueue = memory.getString("queue", "[]");
        String oldLetters = memory.getString("deadLetters", "[]");
        // At capacity, let a separate eviction commit succeed. Reject only the
        // write containing the incoming event to expose partial transactions.
        Writes writes = new Writes(throwsAfterMemory, full);
        writes.writable.set(false);
        JSONObject incoming = new JSONObject().put("kind", "incoming");
        assertFalse(enqueue(writes.target, incoming));
        assertEquals(oldQueue, memory.getString("queue", "[]"));
        assertEquals(oldLetters, memory.getString("deadLetters", "[]"));

        writes.writable.set(true);
        assertTrue(enqueue(writes.target, incoming));
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(context);
        assertEquals(full ? 10_000 : 2, queue.length());
        JSONObject saved = queue.getJSONObject(queue.length() - 1);
        assertEquals(incoming.getString("clientEventId"), saved.getString("clientEventId"));
        assertEquals(saved.getString("clientEventId"), saved.getJSONObject("payload").getString("clientEventId"));
        assertEquals(full ? 2 : 1, new JSONArray(memory.getString("deadLetters", "[]")).length());
    }

    @Test public void successfulCapacityReplacementCommitsBothArraysOnce() throws Exception {
        seed(10_000);
        Writes writes = new Writes(false, false);
        JSONObject incoming = new JSONObject().put("kind", "incoming");
        assertTrue(enqueue(writes.target, incoming));
        assertEquals("eviction and append must be one disk transaction", 1, writes.commits.get());
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(context);
        assertEquals(10_000, queue.length());
        assertEquals(new UUID(0L, 2).toString(), queue.getJSONObject(0).getString("clientEventId"));
        JSONArray letters = new JSONArray(memory.getString("deadLetters", "[]"));
        assertEquals(2, letters.length());
        assertEquals("previous-letter", letters.getJSONObject(0).getString("clientEventId"));
        JSONObject evicted = letters.getJSONObject(1);
        assertEquals(new UUID(0L, 1).toString(), evicted.getString("clientEventId"));
        assertEquals("queue_capacity", evicted.getString("deadLetterReason"));
        assertFalse(evicted.has("capability"));
        assertFalse(evicted.has("apiBaseUrl"));
    }

    @Test public void invalidPayloadAtCapacityDoesNotEvictAnExistingEvent() throws Exception {
        seed(10_000);
        String oldQueue = memory.getString("queue", "[]");
        String oldLetters = memory.getString("deadLetters", "[]");
        Writes writes = new Writes(false, false);
        assertFalse(enqueue(writes.target, null));
        assertEquals(oldQueue, memory.getString("queue", "[]"));
        assertEquals(oldLetters, memory.getString("deadLetters", "[]"));
        assertEquals(0, writes.commits.get());
    }

    @Test public void normalEnqueuePreservesExistingRecordsAndMatchingEventIds() throws Exception {
        seed(1);
        String oldLetters = memory.getString("deadLetters", "[]");
        JSONObject incoming = new JSONObject().put("kind", "incoming");
        assertTrue(enqueue(context, incoming));
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(context);
        assertEquals(2, queue.length());
        assertEquals(new UUID(0L, 1).toString(), queue.getJSONObject(0).getString("clientEventId"));
        JSONObject saved = queue.getJSONObject(1);
        assertEquals(incoming.getString("clientEventId"), saved.getString("clientEventId"));
        assertEquals(incoming.toString(), saved.getJSONObject("payload").toString());
        assertEquals(oldLetters, memory.getString("deadLetters", "[]"));
    }

    @Test public void concurrentProducersPreserveBothEvents() throws Exception {
        seed(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Runnable producer = () -> {
            try { assertTrue(enqueue(context, new JSONObject())); }
            catch (Throwable error) { failure.set(error); }
        };
        Thread first = new Thread(producer);
        Thread second = new Thread(producer);
        first.start();
        second.start();
        first.join(5_000);
        second.join(5_000);
        assertFalse(first.isAlive());
        assertFalse(second.isAlive());
        if (failure.get() != null) throw new AssertionError(failure.get());
        JSONArray queue = NativeLoneWorkerOutbox.readQueue(context);
        assertEquals(3, queue.length());
        assertNotEquals(queue.getJSONObject(1).getString("clientEventId"), queue.getJSONObject(2).getString("clientEventId"));
    }

    private final class Writes {
        final AtomicBoolean writable = new AtomicBoolean(true);
        final AtomicInteger commits = new AtomicInteger();
        final Context target;

        Writes(boolean throwsAfterMemory, boolean onlyIncoming) {
            SharedPreferences preferences = mock(SharedPreferences.class);
            when(preferences.getString(anyString(), anyString())).thenAnswer(call ->
                memory.getString(call.getArgument(0), call.getArgument(1)));
            when(preferences.edit()).thenAnswer(call -> {
                Map<String, String> changes = new HashMap<>();
                SharedPreferences.Editor edit = mock(SharedPreferences.Editor.class, RETURNS_SELF);
                when(edit.putString(anyString(), anyString())).thenAnswer(put -> {
                    changes.put(put.getArgument(0), put.getArgument(1));
                    return edit;
                });
                when(edit.commit()).thenAnswer(commit -> {
                    commits.incrementAndGet();
                    SharedPreferences.Editor updatedMemory = memory.edit();
                    changes.forEach(updatedMemory::putString);
                    updatedMemory.commit();
                    boolean failed = !writable.get() && (!onlyIncoming
                        || changes.getOrDefault("queue", "").contains("\"incoming\""));
                    if (failed && throwsAfterMemory) throw new IllegalStateException("disk_failure");
                    return !failed;
                });
                return edit;
            });
            target = new ContextWrapper(context) {
                @Override public Context getApplicationContext() { return this; }
                @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                    return NativeLoneWorkerOutbox.PREFS.equals(name) ? preferences : super.getSharedPreferences(name, mode);
                }
            };
        }
    }
}
