// Contrato de entrega de Android App Links en artefactos de release.
//
// El bug que cierra este test es doble y silencioso:
//   1. `server.ts` sirve `/.well-known/assetlinks.json` desde `public/`, pero
//      la imagen de runtime de `Dockerfile.api` solo copiaba `dist/` → el
//      endpoint respondía 404 en producción.
//   2. `npm run build` regenera `assetlinks.json` desde
//      `ANDROID_CERT_SHA256`; si el build de release no define la variable, el
//      archivo queda con `sha256_cert_fingerprints: []` y App Links nunca
//      verifica.
//
// Este test ancla las dos mitades: el archivo generado debe llegar al runtime,
// y el build debe fallar cerrado cuando falta la huella.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('Android App Links delivery in release artifacts', () => {
  it('Dockerfile.api generates the association file fail-closed before building dist', () => {
    const dockerfile = read('Dockerfile.api');
    const argIndex = dockerfile.indexOf('ARG ANDROID_CERT_SHA256');
    const buildIndex = dockerfile.indexOf('RUN npm run build');

    expect(argIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(argIndex);
    expect(dockerfile).toMatch(/ARG REQUIRE_ANDROID_CERT=1/);
    expect(dockerfile).toMatch(/ENV ANDROID_CERT_SHA256=/);
  });

  it('Dockerfile.api copies public/ because server.ts serves .well-known from there', () => {
    const server = read('server.ts');
    // Si el handler cambia de directorio, la copia del Dockerfile debe cambiar
    // con él. Sin esta pareja, el archivo existe en dist/ pero el handler 404.
    expect(server).toContain("public/.well-known/assetlinks.json");
    expect(server).toContain("public/.well-known/apple-app-site-association");
    expect(server).toContain("public/robots.txt");
    expect(server).toContain("public/sitemap.xml");

    const dockerfile = read('Dockerfile.api');
    expect(dockerfile).toMatch(/COPY --from=build \/app\/public\/\.well-known \.\/public\/\.well-known/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/public\/robots\.txt \.\/public\/robots\.txt/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/public\/sitemap\.xml \.\/public\/sitemap\.xml/);
    // The runtime image must not duplicate the 500+ MB public/models tree.
    expect(dockerfile).not.toMatch(/COPY --from=build \/app\/public \.\/public$/m);
  });

  it('every image that runs npm run build accepts the fingerprint and fails closed', () => {
    for (const file of ['Dockerfile', 'Dockerfile.api', 'Dockerfile.frontend']) {
      const dockerfile = read(file);
      expect(dockerfile, file).toContain('ARG ANDROID_CERT_SHA256');
      expect(dockerfile, file).toContain('ARG REQUIRE_ANDROID_CERT=1');

      const argIndex = dockerfile.indexOf('ARG ANDROID_CERT_SHA256');
      const buildIndex = dockerfile.indexOf('RUN npm run build');
      expect(argIndex, file).toBeGreaterThan(-1);
      expect(buildIndex, file).toBeGreaterThan(argIndex);
    }
  });

  it('deploy.yml requires the secret and passes it to the API image build', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain(
      'ANDROID_CERT_SHA256: ${{ secrets.ANDROID_CERT_SHA256 }}',
    );
    expect(deploy).toContain(
      '--build-arg ANDROID_CERT_SHA256="${ANDROID_CERT_SHA256}"',
    );
    expect(deploy).toContain('--build-arg REQUIRE_ANDROID_CERT=1');
    expect(deploy).toMatch(/Require Android App Links signing fingerprint/);
  });

  it('mobile-release.yml uses the Play App Signing fingerprint for the AAB web bundle', () => {
    const release = read('.github/workflows/mobile-release.yml');
    // El preflight exige la huella antes de declarar android_ready=true.
    expect(release).toMatch(
      /for variable in [^\n]*ANDROID_CERT_SHA256/,
    );

    const androidRelease = release.slice(
      release.indexOf('android-release:'),
      release.indexOf('android-internal-upload:'),
    );
    expect(androidRelease).toContain(
      'ANDROID_CERT_SHA256: ${{ secrets.ANDROID_CERT_SHA256 }}',
    );
    expect(androidRelease).toContain("REQUIRE_ANDROID_CERT: '1'");
  });

  it('Cloud Build alternative passes the same build args', () => {
    const cloudbuild = read('cloudbuild.yaml');
    expect(cloudbuild).toContain('_ANDROID_CERT_SHA256');
    expect(cloudbuild).toContain(
      '--build-arg=ANDROID_CERT_SHA256=${_ANDROID_CERT_SHA256}',
    );
    expect(cloudbuild).toContain('--build-arg=REQUIRE_ANDROID_CERT=1');
  });

  it('signing-placeholder check rejects an empty fingerprint array', () => {
    const check = read('.github/workflows/check-mobile-signing.yml');
    expect(check).toContain('sha256_cert_fingerprints');
    expect(check).toMatch(/FP_COUNT/);
    expect(check).toMatch(/BAD_FP/);
  });
});
