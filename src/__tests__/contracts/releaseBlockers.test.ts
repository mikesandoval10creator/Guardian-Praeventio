// Contract test — Fase B.3 del plan integrado (verificación 2026-05-21).
//
// Verifica los release blockers que estuvieron pendientes y se cerraron
// en Fase 0 (PR #357) — H1 lockfile, H3 docker, H4 cloudbuild owner,
// H6 LICENSE, H8 assetlinks SHA-256, H16 región, H17 deploy.yml, H24
// README claim. Si alguno regresa, este test falla.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('release blockers — Fase 0 cierre (PR #357)', () => {
  it('H1: lockfile incluye xlsx (Excel Importer PR #351)', () => {
    const lock = read('package-lock.json');
    expect(lock).toContain('"node_modules/xlsx"');
  });

  // H3 corregido (Fase 5, 2026-06): el contrato original era DOC-DRIFT.
  // `firebase-applet-config.json` es la config PÚBLICA de cliente de Firebase
  // (projectId/apiKey/authDomain/firestoreDatabaseId — SIN private_key de SA;
  // el credential admin real es ADC vía applicationDefault()). vite la hornea en
  // el cliente (firebase.ts:6) Y server.ts la lee al arrancar para elegir la BD
  // Firestore no-default — sin ella el server cae en silencio a la BD `(default)`
  // y sirve datos vacíos. Por eso DEBE estar en el contexto + la imagen.
  it('H3: .dockerignore NO excluye firebase-applet-config.json (config pública de cliente)', () => {
    const di = read('.dockerignore');
    expect(di).not.toMatch(/^firebase-applet-config\.json$/m);
  });

  it('H3: Dockerfile.api SÍ copia firebase-applet-config.json en la imagen', () => {
    const df = read('Dockerfile.api');
    expect(df).toMatch(/^COPY .*firebase-applet-config\.json/m);
  });

  it('H4: cloudbuild.yaml etiqueta source con el owner correcto', () => {
    const cb = read('cloudbuild.yaml');
    expect(cb).toContain(
      'org.opencontainers.image.source=https://github.com/mikesandoval10creator/Guardian-Praeventio',
    );
    expect(cb).not.toContain('dahosandoval/Guardian-Praeventio');
  });

  it('H6: LICENSE existe en raíz con MIT', () => {
    expect(existsSync(resolve(repoRoot, 'LICENSE'))).toBe(true);
    const lic = read('LICENSE');
    expect(lic).toContain('MIT License');
  });

  it('H8: assetlinks.json tiene SHA-256 real (no placeholder)', () => {
    const al = read('public/.well-known/assetlinks.json');
    expect(al).not.toContain('REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD');
    // Formato esperado: 32 bytes hex separados por `:` (95 caracteres
    // mayúscula). Verificamos el SHA del keystore Play oficial.
    expect(al).toMatch(
      /3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0/,
    );
  });

  it('H16: cloudbuild.yaml + deploy.yml ambos usan southamerica-west1', () => {
    const cb = read('cloudbuild.yaml');
    const dy = read('.github/workflows/deploy.yml');
    expect(cb).toMatch(/_LOCATION:\s*['"]?southamerica-west1['"]?/);
    expect(dy).toMatch(/REGION:\s*southamerica-west1/);
  });

  it('H17: deploy.yml usa Dockerfile.api (no el legado Dockerfile)', () => {
    const dy = read('.github/workflows/deploy.yml');
    expect(dy).toMatch(/-f Dockerfile\.api/);
  });

  it('H24: README NO declara "99% end-to-end" como estado actual', () => {
    const r = read('README.md');
    // El claim antiguo era "99% end-to-end". Hoy el README puede mencionar
    // "99%" en contexto histórico/rectificado, pero NO como afirmación
    // del estado actual.
    const currentClaim = /^\s*-\s+99% end-to-end/m;
    expect(r).not.toMatch(currentClaim);
  });

  it('Sentry script render-well-known se ejecuta en prebuild', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.prebuild).toContain('render-well-known.mjs');
  });
});
