#!/usr/bin/env node
/**
 * render-well-known.mjs — H8/H18 anti-placeholder
 *
 * Genera los artefactos en public/.well-known/ desde env vars de build.
 * Si detecta placeholders falsos (REPLACE_WITH_*, TEAMID), aborta build.
 *
 * Variables esperadas en CI/build (Cloud Build, GitHub Actions, local):
 *   - ANDROID_CERT_SHA256   (SHA-256 del keystore Play; 32 bytes hex con ':').
 *                            REQUERIDA y fail-closed: si falta o tiene formato
 *                            inválido, este script lanza y aborta el build. NO
 *                            existe fallback hardcodeado — un fingerprint de
 *                            firma equivocado rompe Android App Links (o, peor,
 *                            valida la app contra un cert ajeno).
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
 * FAIL-CLOSED: there is intentionally NO hardcoded fallback. A missing,
 * placeholder, or malformed value throws — the build aborts rather than
 * silently shipping an assetlinks.json that validates App Links against the
 * wrong certificate.
 *
 * @param {string | undefined} rawSha  Typically process.env.ANDROID_CERT_SHA256.
 * @returns {string} The cleaned, upper-cased, colon-hex fingerprint.
 * @throws {Error} If the value is absent, a placeholder, or not 32-byte colon-hex.
 */
export function resolveAndroidSha(rawSha) {
  if (rawSha == null || String(rawSha).trim() === '') {
    throw new Error(
      '[render-well-known] ANDROID_CERT_SHA256 no está definido. '
        + 'Es REQUERIDA (fail-closed): exporta el SHA-256 real del keystore de '
        + 'firma Play (32 bytes hex separados por ":", ej. 3D:AC:D9:...) antes '
        + 'de `vite build` / `docker build`. No hay fallback hardcodeado.',
    );
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
 * Build the assetlinks.json payload (Android App Links / Digital Asset Links)
 * for a validated SHA-256 fingerprint. Pure — returns the object, no I/O.
 */
export function buildAssetlinks(cleanedSha) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.praeventio.guard',
        sha256_cert_fingerprints: [cleanedSha],
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

  // ── Android (fail-closed) ──────────────────────────────────────────
  const cleanedSha = resolveAndroidSha(env.ANDROID_CERT_SHA256);
  await fsImpl.writeFile(
    path.join(WELL_KNOWN_DIR, 'assetlinks.json'),
    JSON.stringify(buildAssetlinks(cleanedSha), null, 2) + '\n',
  );
  log('[render-well-known] assetlinks.json rendered (SHA-256 real).');

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
