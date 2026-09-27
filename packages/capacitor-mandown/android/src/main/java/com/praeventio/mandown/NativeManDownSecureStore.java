package com.praeventio.mandown;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keystore-backed storage for the short-lived capability used by retries. */
final class NativeManDownSecureStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "guardian_native_mandown_key_v1";
    private static final String PREFS = "guardian_native_mandown_secure_v1";
    private static final String REF_PREFIX = "session-";
    private static final int IV_BYTES = 12;
    private static final SecureRandom RANDOM = new SecureRandom();

    private NativeManDownSecureStore() { }

    static String referenceForSession(String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty()) return null;
        return REF_PREFIX + sha256(sessionId);
    }

    static boolean persist(
        Context context,
        String sessionId,
        String capability,
        String apiBaseUrl
    ) {
        String reference = referenceForSession(sessionId);
        String canonicalApiBaseUrl = NativeManDownEndpoint.canonicalize(apiBaseUrl);
        if (reference == null || blank(capability) || canonicalApiBaseUrl == null) return false;
        try {
            JSONObject secret = new JSONObject()
                .put("capability", capability)
                .put("apiBaseUrl", canonicalApiBaseUrl);
            String encrypted = encrypt(secret.toString());
            return prefs(context).edit().putString(reference, encrypted).commit();
        } catch (Exception ignored) {
            return false;
        }
    }

    static Secrets load(Context context, String reference) {
        if (!validReference(reference)) return null;
        String encrypted = prefs(context).getString(reference, null);
        if (encrypted == null) return null;
        try {
            JSONObject secret = new JSONObject(decrypt(encrypted));
            String capability = secret.optString("capability", null);
            String apiBaseUrl = NativeManDownEndpoint.canonicalize(
                secret.optString("apiBaseUrl", null)
            );
            if (blank(capability) || apiBaseUrl == null) return null;
            return new Secrets(capability, apiBaseUrl);
        } catch (Exception ignored) {
            return null;
        }
    }

    static boolean clear(Context context, String sessionId) {
        String reference = referenceForSession(sessionId);
        return reference != null && clearReference(context, reference);
    }

    static boolean clearReference(Context context, String reference) {
        if (!validReference(reference)) return false;
        return prefs(context).edit().remove(reference).commit();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean validReference(String reference) {
        return reference != null && reference.matches("session-[a-f0-9]{64}");
    }

    private static String encrypt(String raw) throws Exception {
        byte[] iv = new byte[IV_BYTES];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        byte[] ciphertext = cipher.doFinal(raw.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private static String decrypt(String encoded) throws Exception {
        byte[] combined = Base64.decode(encoded, Base64.DEFAULT);
        if (combined.length <= IV_BYTES) throw new IllegalArgumentException("encrypted secret is too short");
        byte[] iv = new byte[IV_BYTES];
        byte[] ciphertext = new byte[combined.length - IV_BYTES];
        System.arraycopy(combined, 0, iv, 0, iv.length);
        System.arraycopy(combined, iv.length, ciphertext, 0, ciphertext.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
            generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    private static String sha256(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte value : digest) out.append(String.format("%02x", value));
            return out.toString();
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private static boolean blank(String value) {
        return value == null || value.trim().isEmpty();
    }

    static final class Secrets {
        final String capability;
        final String apiBaseUrl;

        Secrets(String capability, String apiBaseUrl) {
            this.capability = capability;
            this.apiBaseUrl = apiBaseUrl;
        }
    }
}
