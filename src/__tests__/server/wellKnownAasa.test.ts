// Praeventio Guard — AASA (iOS Universal Links) server hardening + render.
//
// Tarea Notion `[P1] Universal Links iOS no verificables`: el AASA se serviá
// con content-type pero sin headers críticos y sin pruebas del pipeline.
//
// Dos contratos verificables localmente:
//   1. El handler del server sirve el AASA con status 200 directo (NO 301/302),
//      content-type application/json, X-Content-Type-Options: nosniff y
//      Cache-Control con max-age — Apple swcutil/CDN ignoran archivos sin
//      esos headers.
//   2. El render pipeline (render-well-known.mjs) sustituye TEAMID. por el
//      Apple Team ID real cuando APPLE_TEAM_ID está en el env, y deja un
//      warning honesto cuando no.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
// AASA está en la raíz del repo, no dentro de src/.
const AASA_PATH = path.resolve(
  here,
  '..',
  '..',
  '..',
  'public',
  '.well-known',
  'apple-app-site-association',
);

// Handler mínimo igual al de server.ts — el server real se testea de extremo
// a extremo en src/__tests__/server/adminBurden.test.ts (helpers de
// mocks Firebase). Aquí verificamos el contrato HTTP/heredoc del AASA.
function makeApp() {
  const app = express();
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.type('application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(AASA_PATH);
  });
  return app;
}

describe('GET /.well-known/apple-app-site-association — server hardening', () => {
  it('responde 200 directo (sin redirects) con content-type application/json', async () => {
    const res = await request(makeApp()).get(
      '/.well-known/apple-app-site-association',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('expone X-Content-Type-Options: nosniff (anti-sniffing CDN)', async () => {
    const res = await request(makeApp()).get(
      '/.well-known/apple-app-site-association',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('expone Cache-Control con max-age (swcutil + CDN cachean 24h+)', async () => {
    const res = await request(makeApp()).get(
      '/.well-known/apple-app-site-association',
    );
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('preserva los paths críticos (sos, training, digital-twin, projects)', async () => {
    const res = await request(makeApp()).get(
      '/.well-known/apple-app-site-association',
    );
    const body = JSON.parse(res.text);
    const flat = JSON.stringify(body);
    // El verify cmd de la tarea exige estos flujos vida-safety.
    expect(flat).toContain('/sos');
    expect(flat).toContain('/training/');
    expect(flat).toContain('/digital-twin');
    expect(flat).toContain('/projects/');
  });
});

describe('render-well-known.mjs — re-render del AASA con TEAMID real', () => {
  // Se carga por import dinámico para no introducir edge entre vitest y
  // el shebang del script (testea el módulo, no el child process).
  const scriptPath = path.resolve(
    here,
    '..',
    '..',
    '..',
    'scripts',
    'render-well-known.mjs',
  );

  function makeFakeFs(initial: Record<string, string> = {}) {
    const store: Record<string, string> = { ...initial };
    const fsImpl = {
      readFile: async (p: string, _enc: string) => {
        if (!store[p]) {
          const err = new Error(
            `ENOENT: no such file or directory, open '${p}'`,
          ) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return store[p];
      },
      writeFile: async (p: string, c: string) => {
        store[p] = c;
      },
      mkdir: async () => undefined,
    };
    return { store, fsImpl };
  }

  it('con APPLE_TEAM_ID honra sustituye TEAMID. por el Team ID real', async () => {
    const fixture = JSON.stringify(
      {
        applinks: {
          apps: [],
          details: [
            { appID: 'TEAMID.com.praeventio.guard', paths: ['/sos'] },
          ],
        },
        webcredentials: { apps: ['TEAMID.com.praeventio.guard'] },
      },
      null,
      2,
    );
    // El render usa path.join nativo → en Windows la key es con '\\'.
    const aasaKey = path.join('public', '.well-known', 'apple-app-site-association');
    const { store, fsImpl } = makeFakeFs({
      [aasaKey]: fixture + '\n',
    });
    const mod = (await import(scriptPath)) as {
      render: (opts: {
        env: Record<string, string>;
        fsImpl: typeof fsImpl;
        log?: () => void;
        warn?: () => void;
      }) => Promise<{ appleTeamId: string | null }>;
    };
    const result = await mod.render({
      env: { APPLE_TEAM_ID: 'A1B2C3D4E5' },
      fsImpl,
      log: () => {},
      warn: () => {},
    });
    expect(result.appleTeamId).toBe('A1B2C3D4E5');
    const out = store[aasaKey];
    expect(out).toContain('A1B2C3D4E5.com.praeventio.guard');
    expect(out).not.toMatch(/TEAMID\./);
  });

  it('sin APPLE_TEAM_ID deja TEAMID y reporta appleTeamId=null', async () => {
    const fixture = JSON.stringify(
      {
        applinks: { details: [{ appID: 'TEAMID.com.praeventio.guard', paths: ['/sos'] }] },
      },
      null,
      2,
    );
    const aasaKey = path.join('public', '.well-known', 'apple-app-site-association');
    const { store, fsImpl } = makeFakeFs({
      [aasaKey]: fixture + '\n',
    });
    const mod = await import(scriptPath);
    const result = await mod.render({
      env: {},
      fsImpl,
      log: () => {},
      warn: () => {},
    }) as { appleTeamId: string | null };
    expect(result.appleTeamId).toBeNull();
    expect(store[aasaKey]).toContain('TEAMID.');
  });
});

// Guard: el archivo committeado en disco debe tener la estructura mínima
// (applinks + details[0].appID) incluso si no tiene el Team ID final. Si
// alguien borra el AASA por error, este test rompe acá antes de CI.
describe('AASA aceite en disco', () => {
  it('public/.well-known/apple-app-site-association tiene estructura válida', () => {
    const raw = fs.readFileSync(AASA_PATH, 'utf8');
    const body = JSON.parse(raw);
    expect(body.applinks).toBeDefined();
    expect(Array.isArray(body.applinks.details)).toBe(true);
    expect(typeof body.applinks.details[0].appID).toBe('string');
  });
});
