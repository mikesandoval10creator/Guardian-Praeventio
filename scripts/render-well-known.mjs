#!/usr/bin/env node
/**
 * render-well-known.mjs — H8/H18 anti-placeholder
 *
 * Genera los artefactos en public/.well-known/ desde env vars de build.
 * Si detecta placeholders falsos (REPLACE_WITH_*, TEAMID), aborta build.
 *
 * Variables esperadas en CI/build (Cloud Build, GitHub Actions, local):
 *   - ANDROID_CERT_SHA256   (SHA-256 del keystore Play; 32 bytes hex con ':')
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

const WELL_KNOWN_DIR = 'public/.well-known';
const PLACEHOLDER_PATTERNS = [
  /REPLACE_WITH_/i,
  /YOUR_/i,
  /PLACEHOLDER/i,
];

const androidSha = process.env.ANDROID_CERT_SHA256
  ?? '3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0';
const appleTeamId = process.env.APPLE_TEAM_ID;
const securityEmail = process.env.SECURITY_CONTACT_EMAIL ?? 'contacto@praeventio.net';

// Sanity-check Android SHA-256
if (!androidSha || PLACEHOLDER_PATTERNS.some((rx) => rx.test(androidSha))) {
  throw new Error(
    `[render-well-known] ANDROID_CERT_SHA256 inválido o placeholder ("${androidSha}"). `
      + 'Define la env var con el SHA-256 real del keystore (32 bytes hex con ":").',
  );
}
const cleanedSha = androidSha.trim().toUpperCase();
if (!/^[0-9A-F:]{47,}$/.test(cleanedSha)) {
  throw new Error(
    `[render-well-known] ANDROID_CERT_SHA256 formato inválido: "${cleanedSha}". `
      + 'Esperado: 32 bytes hex separados por ":" (ej. 3D:AC:D9:...).',
  );
}

// ── assetlinks.json (Android App Links) ──────────────────────────────
const assetlinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.praeventio.guard',
      sha256_cert_fingerprints: [cleanedSha],
    },
  },
];
await fs.writeFile(
  path.join(WELL_KNOWN_DIR, 'assetlinks.json'),
  JSON.stringify(assetlinks, null, 2) + '\n',
);
console.log('[render-well-known] assetlinks.json rendered (SHA-256 real).');

// ── apple-app-site-association (iOS Universal Links) ─────────────────
if (appleTeamId && appleTeamId !== 'TEAMID' && /^[A-Z0-9]{10}$/i.test(appleTeamId)) {
  const aasaPath = path.join(WELL_KNOWN_DIR, 'apple-app-site-association');
  const aasaRaw = await fs.readFile(aasaPath, 'utf8').catch(() => null);
  if (aasaRaw) {
    const aasa = JSON.parse(aasaRaw);
    if (aasa.applinks?.details?.[0]) {
      aasa.applinks.details[0].appID = `${appleTeamId.toUpperCase()}.com.praeventio.guard`;
      await fs.writeFile(aasaPath, JSON.stringify(aasa, null, 2) + '\n');
      console.log(`[render-well-known] apple-app-site-association rendered (TEAM_ID=${appleTeamId.toUpperCase()}).`);
    }
  }
} else {
  console.warn(
    '[render-well-known] APPLE_TEAM_ID no definido o placeholder — '
      + 'apple-app-site-association queda con TEAMID hasta tener Apple Developer Account real.',
  );
}

// ── security.txt (RFC 9116) ──────────────────────────────────────────
const securityTxt = `Contact: mailto:${securityEmail}
Contact: https://praeventio.net/security
Expires: 2027-04-28T00:00:00.000Z
# Encryption: TODO when PGP key published at /.well-known/pgp-key.asc
Acknowledgments: https://github.com/mikesandoval10creator/Guardian-Praeventio/blob/main/SECURITY.md#hall-of-fame
Preferred-Languages: es, en
Canonical: https://praeventio.net/.well-known/security.txt
Policy: https://github.com/mikesandoval10creator/Guardian-Praeventio/blob/main/SECURITY.md
`;
await fs.writeFile(path.join(WELL_KNOWN_DIR, 'security.txt'), securityTxt);
console.log(`[render-well-known] security.txt rendered (contact: ${securityEmail}).`);

console.log('[render-well-known] DONE.');
