// Praeventio Guard — Contract test #2: correo único empresa
// `contacto@praeventio.net` en todos los puntos públicos.
//
// Cierra directiva usuario 2026-05-17: "contacto@praeventio.net es el
// correo que tiene la empresa, ningún otro, para todos los efectos ese
// correo contacto@praeventio.net debe aparecer en donde se requiera".
//
// Excepciones técnicas permitidas:
//  - `noreply@praeventio.net` (SMTP from técnico)
//  - `marketplace-demo@praeventio.net` (cuenta de test marketplace)
//  - `dahosandoval@gmail.com` (fallback personal del usuario)

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const FILES_TO_CHECK = [
  'SECURITY.md',
  'README.md',
  'MONITORING.md',
  'CONTRIBUTING.md',
  'DR_RUNBOOK.md',
  'MARKETPLACE_SUBMISSION.md',
  'src/services/legal/termsContent.ts',
  'public/.well-known/security.txt',
];

const PROHIBITED_EMAILS = [
  'security@praeventio.net',
  'soporte@praeventio.net',
  'privacidad@praeventio.net',
  'ventas@praeventio.net',
  'dev@praeventio.net',
  'founder@praeventio.net',
];

const ALLOWED_PRAEVENTIO_EMAILS = new Set([
  'contacto@praeventio.net',
  'noreply@praeventio.net',
  'marketplace-demo@praeventio.net',
]);

describe('correo único empresa contacto@praeventio.net', () => {
  for (const rel of FILES_TO_CHECK) {
    it(`${rel} no usa correos proíhibidos`, () => {
      const path = resolve(REPO_ROOT, rel);
      if (!existsSync(path)) return; // archivo opcional
      const content = readFileSync(path, 'utf8').toLowerCase();
      for (const bad of PROHIBITED_EMAILS) {
        expect(
          content,
          `${rel} still contains ${bad}`,
        ).not.toContain(bad.toLowerCase());
      }
    });

    it(`${rel} todo @praeventio.net es canonical (excepciones permitidas)`, () => {
      const path = resolve(REPO_ROOT, rel);
      if (!existsSync(path)) return;
      const content = readFileSync(path, 'utf8');
      const mentions = content.match(/[a-z0-9._-]+@praeventio\.net/gi) ?? [];
      const invalid = mentions
        .map((m) => m.toLowerCase())
        .filter((m) => !ALLOWED_PRAEVENTIO_EMAILS.has(m));
      expect(invalid, `${rel} has non-canonical @praeventio.net emails`).toEqual([]);
    });
  }
});
