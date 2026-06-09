#!/usr/bin/env node
/**
 * render-well-known.mjs — H8/H18 anti-placeholder
 *
 * Genera los artefactos en public/.well-known/ desde env vars de build.
 * Si detecta placeholders falsos (REPLACE_WITH_*, TEAMID), aborta build.
 *
 * Variables esperadas en CI/build (Cloud Build, GitHub Actions, local):
 *   - ANDROID_CERT_SHA256   (SHA-256 del keystore Play; 32 bytes hex con ':').
 *                            NO existe fallback hardcodeado. Un valor PRESENTE
 *                            pero placeholder/malformado SIEMPRE aborta el build
 *                            (un cert equivocado rompe App Links o valida contra
 *                            un cert ajeno). AUSENTE: assetlinks.json queda con
 *                            fingerprints vacíos (honesto, App Links no valida)
 *                            + warning — para web/dev/CI builds. En un release,
 *                            set REQUIRE_ANDROID_CERT=1 y ausente aborta (fail-
 *                            closed) para no publicar sin el cert real.
 *   - REQUIRE_ANDROID_CERT  ('1'/'true' en release/deploy → fail-closed si falta
 *                            ANDROID_CERT_SHA256; opcional, default no-required)
 *   - APPLE_TEAM_ID         (10 chars Apple Developer Team ID; opcional)
 *   - SECURITY_CONTACT_EMAIL (default: contacto@praeventio.net)
 *
 * Si APPLE_TEAM_ID no está definido, deja apple-app-site-association con
 * el placeholder honesto "TEAMID" y emite warning (no aborta — iOS deploy
 * está bloqueado por Apple Developer Account independientemente).
 *
 * Uso: `node scripts/render-well-known.mjs` (corre via `prebuild` script
 * en package.json, o manualmente antes de `vite build` / `docker build`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WELL_KNOWN_DIR = 'public/.well-known';

const PLACEHOLDER_PATTERNS = [
  /REPLACE_WITH_/i,
  /YOUR_/i,
  /PLACEHOLDER/i,
];

// A valid Android signing-cert SHA-256 fingerprint is exactly 32 bytes:
// 32 upper-case hex pairs joined by ':' (95 chars total). Matches the
// canonical regex used by scripts/fill-android-assetlinks.mjs.
const SHA256_FINGERPRINT_REGEX = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * Resolve + validate the Android signing-cert SHA-256 from the environment.
 *
 * There is intentionally NO hardcoded fallback (the old code baked a literal
 * prod fingerprint that silently went stale). The contract:
 *   - A value that IS present but is a placeholder or malformed ALWAYS throws —
 *     a provided-but-wrong cert is an error in every context, never written.
 *   - An ABSENT value returns `null` so the caller can write an HONEST
 *     "unconfigured" assetlinks (empty fingerprints) for web/dev/CI builds —
 *     mirrors how an absent APPLE_TEAM_ID leaves the honest `TEAMID` placeholder.
 *   - When `opts.required` is set (release/deploy via REQUIRE_ANDROID_CERT=1),
 *     an absent value ALSO throws — fail-closed so a real release can never ship
 *     without the real cert.
 *
 * @param {string | undefined} rawSha  Typically process.env.ANDROID_CERT_SHA256.
 * @param {{ required?: boolean }} [opts]  required→absent throws (release builds).
 * @returns {string | null} The cleaned colon-hex fingerprint, or null when absent
 *                          and not required.
 * @throws {Error} If the value is a placeholder, malformed, or absent-and-required.
 */
export function resolveAndroidSha(rawSha, opts = {}) {
  if (rawSha == null || String(rawSha).trim() === '') {
    if (opts.required) {
      throw new Error(
        '[render-well-known] ANDROID_CERT_SHA256 no está definido y '
          + 'REQUIRE_ANDROID_CERT está activo (release fail-closed): exporta el '
          + 'SHA-256 real del keystore de firma Play (32 bytes hex separados por '
          + '":", ej. 3D:AC:D9:...) antes de `vite build` / `docker build`. '
          + 'No hay fallback hardcodeado.',
      );
    }
    return null;
  }
  const cleaned = String(rawSha).trim().toUpperCase();
  if (PLACEHOLDER_PATTERNS.some((rx) => rx.test(cleaned))) {
    throw new Error(
      `[render-well-known] ANDROID_CERT_SHA256 es un placeholder ("${cleaned}"). `
        + 'Define la env var con el SHA-256 real del keystore (32 bytes hex con ":").',
    );
  }
  if (!SHA256_FINGERPRINT_REGEX.test(cleaned)) {
    throw new Error(
      `[render-well-known] ANDROID_CERT_SHA256 formato inválido: "${cleaned}". `
        + 'Esperado: exactamente 32 bytes hex separados por ":" '
        + '(ej. 3D:AC:D9:BC:...:A0).',
    );
  }
  return cleaned;
}

/**
 * Build the assetlinks.json payload (Android App Links / Digital Asset Links).
 * Pure — returns the object, no I/O. A `null` fingerprint yields an HONEST
 * empty `sha256_cert_fingerprints: []` (the app is declared but no cert is
 * claimed → App Links simply will not validate until the real cert is set);
 * this is never a fabricated/placeholder fingerprint.
 */
export function buildAssetlinks(cleanedSha) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.praeventio.guard',
        sha256_cert_fingerprints: cleanedSha ? [cleanedSha] : [],
      },
    },
  ];
}

/**
 * Build the RFC 9116 security.txt body for a contact email. Pure.
 */
export function buildSecurityTxt(securityEmail) {
  return `Contact: mailto:${securityEmail}
Contact: https://praeventio.net/security
Expires: 2027-04-28T00:00:00.000Z
# Encryption: TODO when PGP key published at /.well-known/pgp-key.asc
Acknowledgments: https://github.com/mikesandoval10creator/Guardian-Praeventio/blob/main/SECURITY.md#hall-of-fame
Preferred-Languages: es, en
Canonical: https://praeventio.net/.well-known/security.txt
Policy: https://github.com/mikesandoval10creator/Guardian-Praeventio/blob/main/SECURITY.md
`;
}

/**
 * End-to-end render of public/.well-known/*. Exposed (with injectable deps and
 * env) so tests can drive it with an in-memory fs and a synthetic environment —
 * no real keystore, no disk writes during the unit suite.
 *
 * @param {object} deps
 * @param {NodeJS.ProcessEnv} [deps.env]   defaults to process.env
 * @param {{ writeFile: (p: string, data: string) => Promise<unknown>,
 *           readFile: (p: string, enc: string) => Promise<string> }} [deps.fsImpl]
 *           defaults to node:fs/promises (only writeFile/readFile are used)
 * @param {(...args: unknown[]) => void} [deps.log]
 * @param {(...args: unknown[]) => void} [deps.warn]
 * @returns {Promise<{ androidSha: string, appleTeamId: string | null }>}
 */
export async function render(deps = {}) {
  const {
    env = process.env,
    fsImpl = fs,
    log = console.log,
    warn = console.warn,
  } = deps;

  // ── Android (honest-placeholder by default, fail-closed on release) ──
  // A provided-but-wrong cert always throws (resolveAndroidSha). An absent
  // cert is allowed for web/dev/CI builds (honest empty fingerprints + warn)
  // but fails closed for a release that sets REQUIRE_ANDROID_CERT=1, so a
  // shipped app store build can never serve assetlinks without the real cert.
  const requireAndroidCert =
    env.REQUIRE_ANDROID_CERT === '1' || env.REQUIRE_ANDROID_CERT === 'true';
  const cleanedSha = resolveAndroidSha(env.ANDROID_CERT_SHA256, {
    required: requireAndroidCert,
  });
  await fsImpl.writeFile(
    path.join(WELL_KNOWN_DIR, 'assetlinks.json'),
    JSON.stringify(buildAssetlinks(cleanedSha), null, 2) + '\n',
  );
  if (cleanedSha) {
    log('[render-well-known] assetlinks.json rendered (SHA-256 real).');
  } else {
    warn(
      '[render-well-known] ANDROID_CERT_SHA256 no definido — assetlinks.json '
        + 'queda SIN fingerprint (App Links NO validará hasta proveer el cert '
        + 'real). Para un release, set REQUIRE_ANDROID_CERT=1 para fail-closed.',
    );
  }

  // ── apple-app-site-association (iOS Universal Links) ─────────────────
  const appleTeamId = env.APPLE_TEAM_ID;
  let renderedTeamId = null;
  if (appleTeamId && appleTeamId !== 'TEAMID' && /^[A-Z0-9]{10}$/i.test(appleTeamId)) {
    const aasaPath = path.join(WELL_KNOWN_DIR, 'apple-app-site-association');
    const aasaRaw = await fsImpl.readFile(aasaPath, 'utf8').catch(() => null);
    if (aasaRaw) {
      const aasa = JSON.parse(aasaRaw);
      const fullAppId = `${appleTeamId.toUpperCase()}.com.praeventio.guard`;
      if (aasa.applinks?.details?.[0]) {
        aasa.applinks.details[0].appID = fullAppId;
      }
      if (Array.isArray(aasa.webcredentials?.apps)) {
        aasa.webcredentials.apps = aasa.webcredentials.apps.map((appId) =>
          appId === 'TEAMID.com.praeventio.guard' ? fullAppId : appId,
        );
      }
      await fsImpl.writeFile(aasaPath, JSON.stringify(aasa, null, 2) + '\n');
      renderedTeamId = appleTeamId.toUpperCase();
      log(
        `[render-well-known] apple-app-site-association rendered (TEAM_ID=${renderedTeamId}).`,
      );
    }
  } else {
    warn(
      '[render-well-known] APPLE_TEAM_ID no definido o placeholder — '
        + 'apple-app-site-association queda con TEAMID hasta tener Apple Developer Account real.',
    );
  }

  // ── security.txt (RFC 9116) ──────────────────────────────────────────
  const securityEmail = env.SECURITY_CONTACT_EMAIL ?? 'contacto@praeventio.net';
  await fsImpl.writeFile(
    path.join(WELL_KNOWN_DIR, 'security.txt'),
    buildSecurityTxt(securityEmail),
  );
  log(`[render-well-known] security.txt rendered (contact: ${securityEmail}).`);

  log('[render-well-known] DONE.');
  return { androidSha: cleanedSha, appleTeamId: renderedTeamId };
}

// Only run render() if invoked directly (not when imported by tests).
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectInvocation) {
  render().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
