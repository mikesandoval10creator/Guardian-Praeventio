// Contract test — Ticket 39aaa66d-73fe-81d9-b82d-c1a3c40658dc [P1].
//
// Deep links moviles desalineados: Android declaraba `praeventio.app`
// (AndroidManifest.xml:34), pero el backend desplegado sirve en
// `app.praeventio.net` (deploy.yml APP_URL / WEBAUTHN_RP_ID). Si el host del
// intent-filter no coincide con el dominio que sirve assetlinks.json, App
// Links NO se verifican y el tap abre el navegador (o falla).
//
// Invariante: UN SOLO dominio canónico para deep links, alineado entre
// AndroidManifest (host App Links), deploy.yml (APP_URL/WEBAUTHN_RP_ID) y
// capacitor.config.ts (documentación de la configuración manual).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

const CANONICAL_DOMAIN = 'app.praeventio.net';

describe('deep-link domain alignment (P1 39aaa66d-81d9)', () => {
  it('AndroidManifest App Links host apunta al dominio canónico (no a praeventio.app)', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    // El intent-filter autoVerify de App Links declara el host; debe ser el
    // mismo dominio que sirve /.well-known/assetlinks.json en producción.
    expect(manifest).toMatch(
      new RegExp(`android:host="${CANONICAL_DOMAIN}"`),
    );
    expect(manifest).not.toMatch(/android:host="praeventio\.app"/);
  });

  it('deploy.yml APP_URL y WEBAUTHN_RP_ID usan el mismo dominio canónico', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain(`APP_BASE_URL=https://${CANONICAL_DOMAIN}`);
    expect(deploy).toContain(`APP_URL=https://${CANONICAL_DOMAIN}`);
    expect(deploy).toContain(`WEBAUTHN_RP_ID=${CANONICAL_DOMAIN}`);
  });

  it('capacitor.config.ts documenta el host del dominio canónico (App Links + Universal Links)', () => {
    const cap = read('capacitor.config.ts');
    // La doc del intent-filter manual (Android) y del entitlement (iOS) debe
    // referenciar el mismo dominio; si vuelve a divergir, el test falla.
    expect(cap).toContain(CANONICAL_DOMAIN);
    expect(cap).not.toContain('android:host="praeventio.app"');
  });
});
