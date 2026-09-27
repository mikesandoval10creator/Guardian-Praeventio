package com.praeventio.mandown;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Builds the durable outbox without copying authentication material into it. */
final class NativeManDownOutboxCodec {
    private NativeManDownOutboxCodec() { }

    static boolean isSensitiveField(String field) {
        return "secretRef".equals(field)
            || "capability".equals(field)
            || "apiBaseUrl".equals(field);
    }

    static Set<String> scrubFieldNames(Set<String> fieldNames) {
        Set<String> safe = new HashSet<>();
        for (String field : fieldNames) {
            if (!isSensitiveField(field)) safe.add(field);
        }
        return safe;
    }

    static JSONObject queueEvent(
        String projectId,
        String sessionId,
        String secretRef,
        JSONObject payload,
        long capturedAt
    ) throws JSONException {
        JSONObject event = new JSONObject();
        event.put("clientEventId", payload.optString("clientEventId", ""));
        event.put("projectId", projectId);
        event.put("sessionId", sessionId);
        event.put("secretRef", secretRef);
        event.put("payload", sanitizePayload(payload));
        event.put("capturedAt", capturedAt);
        return event;
    }

    static JSONObject scrubForDeadLetter(
        JSONObject rawEvent,
        String reason,
        long deadLetteredAt
    ) throws JSONException {
        JSONObject event = new JSONObject(rawEvent.toString());
        removeSensitiveFields(event);
        JSONObject payload = event.optJSONObject("payload");
        if (payload != null) removeSensitiveFields(payload);
        event.put("deadLetterReason", reason);
        event.put("deadLetteredAt", deadLetteredAt);
        return event;
    }

    private static JSONObject sanitizePayload(JSONObject payload) throws JSONException {
        JSONObject safePayload = new JSONObject(payload.toString());
        removeSensitiveFields(safePayload);
        return safePayload;
    }

    private static void removeSensitiveFields(JSONObject value) {
        value.remove("secretRef");
        value.remove("capability");
        value.remove("apiBaseUrl");
    }
}
