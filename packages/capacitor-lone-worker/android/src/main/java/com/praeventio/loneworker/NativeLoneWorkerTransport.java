package com.praeventio.loneworker;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** HTTPS-only transport used by WorkManager, never by the WebView. */
final class NativeLoneWorkerTransport {
    static final int ACCEPTED = 1;
    static final int AUTHORITY_GONE = 2;
    static final int MALFORMED = 3;
    static final int RETRYABLE = 4;

    private NativeLoneWorkerTransport() { }

    static int post(JSONObject event) {
        HttpURLConnection connection = null;
        try {
            String apiBaseUrl = event.optString("apiBaseUrl", null);
            String projectId = event.optString("projectId", null);
            String sessionId = event.optString("sessionId", null);
            String capability = event.optString("capability", null);
            JSONObject payload = event.optJSONObject("payload");
            if (!validBase(apiBaseUrl) || !validSegment(projectId)
                || !validSegment(sessionId) || !validCapability(capability)
                || payload == null) {
                return MALFORMED;
            }

            String base = apiBaseUrl.endsWith("/")
                ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1)
                : apiBaseUrl;
            URL url = new URL(
                base + "/api/sprint-k/" + projectId
                    + "/lone-worker/" + sessionId
                    + "/native-lone-worker-heartbeat"
            );
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("X-Lone-Worker-Capability", capability);
            byte[] encoded = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(encoded.length);
            try (OutputStream out = new BufferedOutputStream(connection.getOutputStream())) {
                out.write(encoded);
            }
            int code = connection.getResponseCode();
            drainResponse(connection, code);
            if (code >= 200 && code < 300) return ACCEPTED;
            if (code == HttpURLConnection.HTTP_UNAUTHORIZED
                || code == HttpURLConnection.HTTP_CONFLICT) {
                return AUTHORITY_GONE;
            }
            if (code >= 400 && code < 500) return MALFORMED;
            return RETRYABLE;
        } catch (Exception ignored) {
            return RETRYABLE;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void drainResponse(HttpURLConnection connection, int code) {
        try {
            InputStream in = code >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            if (in == null) return;
            try (InputStream response = in) {
                byte[] buffer = new byte[256];
                while (response.read(buffer) != -1) { /* bounded discard */ }
            }
        } catch (Exception ignored) { }
    }

    private static boolean validBase(String value) {
        return value != null && value.startsWith("https://") && value.length() <= 512;
    }

    private static boolean validSegment(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{1,200}");
    }

    private static boolean validCapability(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{32,256}");
    }
}
