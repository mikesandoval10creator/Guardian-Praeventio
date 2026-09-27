package com.praeventio.mandown;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public final class NativeManDownEndpointTest {
    @Test
    public void acceptsOnlyTheCanonicalProductionOrigin() {
        assertEquals(
            NativeManDownEndpoint.CANONICAL_ORIGIN,
            NativeManDownEndpoint.canonicalize("https://app.praeventio.net")
        );
        assertEquals(
            NativeManDownEndpoint.CANONICAL_ORIGIN,
            NativeManDownEndpoint.canonicalize(" https://app.praeventio.net/ ")
        );
    }

    @Test
    public void rejectsCleartextAlternateHostsAndOriginConfusion() {
        assertNull(NativeManDownEndpoint.canonicalize("http://app.praeventio.net"));
        assertNull(NativeManDownEndpoint.canonicalize("https://evil.example"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net.evil"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net@evil.example"));
        assertNull(NativeManDownEndpoint.canonicalize("https://user:pass@app.praeventio.net"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net:443"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net/api"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net?redirect=evil"));
        assertNull(NativeManDownEndpoint.canonicalize("https://app.praeventio.net#fragment"));
        assertNull(NativeManDownEndpoint.canonicalize(null));
    }
}
