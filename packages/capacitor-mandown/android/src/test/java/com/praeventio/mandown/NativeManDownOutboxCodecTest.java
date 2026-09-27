package com.praeventio.mandown;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public final class NativeManDownOutboxCodecTest {
    @Test
    public void queueAndDeadLetterFieldSetsNeverRetainBearerOrEndpointMaterial() {
        Set<String> fields = new HashSet<>(Arrays.asList(
            "clientEventId",
            "kind",
            "secretRef",
            "capability",
            "apiBaseUrl"
        ));

        Set<String> safeFields = NativeManDownOutboxCodec.scrubFieldNames(fields);

        assertTrue(safeFields.contains("clientEventId"));
        assertTrue(safeFields.contains("kind"));
        assertFalse(safeFields.contains("secretRef"));
        assertFalse(safeFields.contains("capability"));
        assertFalse(safeFields.contains("apiBaseUrl"));
        assertTrue(NativeManDownOutboxCodec.isSensitiveField("capability"));
        assertTrue(NativeManDownOutboxCodec.isSensitiveField("apiBaseUrl"));
    }
}
