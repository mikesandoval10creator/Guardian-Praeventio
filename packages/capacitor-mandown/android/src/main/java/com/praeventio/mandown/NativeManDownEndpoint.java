package com.praeventio.mandown;

import java.net.URI;
import java.net.URISyntaxException;

/** Native-only origin boundary for the capability-bearing ManDown transport. */
final class NativeManDownEndpoint {
    static final String CANONICAL_ORIGIN = "https://app.praeventio.net";
    private static final String CANONICAL_HOST = "app.praeventio.net";

    private NativeManDownEndpoint() { }

    /**
     * Returns one canonical origin or null. Paths, ports, credentials, queries,
     * fragments and alternate hosts are rejected before a bearer can be sent.
     */
    static String canonicalize(String raw) {
        if (raw == null) return null;
        String candidate = raw.trim();
        if (candidate.isEmpty()) return null;
        try {
            URI parsed = new URI(candidate);
            if (!"https".equalsIgnoreCase(parsed.getScheme())) return null;
            if (parsed.getUserInfo() != null) return null;
            if (parsed.getHost() == null || !CANONICAL_HOST.equalsIgnoreCase(parsed.getHost())) {
                return null;
            }
            if (parsed.getPort() != -1 || parsed.getQuery() != null || parsed.getFragment() != null) {
                return null;
            }
            String path = parsed.getPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) return null;
            return CANONICAL_ORIGIN;
        } catch (URISyntaxException ignored) {
            return null;
        }
    }
}
