// Contract test — Fase B.3 del plan integrado (verificación 2026-05-21).
//
// Origen: hallazgo H5 del plan + directiva usuario 2026-05-17:
//   "contacto@praeventio.net es el correo que tiene la empresa, ningún
//    otro, para todos los efectos ese correo contacto@praeventio.net
//    debe aparecer en donde se requiera"
//
// Este test bloquea regresiones — si alguien re-introduce
// soporte@/privacidad@/ventas@/security@/founder@/dev@ en archivos
// críticos, el build falla.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CRITICAL_FILES = [
  'src/pages/PrivacyPolicy.tsx',
  'src/pages/Pricing.tsx',
  'src/pages/Help.tsx',
  'src/pages/PricingCalculator.tsx',
  'src/services/openapi/specGenerator.ts',
  'src/services/legal/termsContent.ts',
  'src/i18n/locales/es/common.json',
  'src/i18n/locales/en/common.json',
  'src/i18n/locales/pt-BR/common.json',
  'MARKETPLACE_SUBMISSION.md',
  'README.md',
  'SECURITY.md',
  'public/.well-known/security.txt',
  'public/.well-known/pgp-key.asc',
];

// Patrones prohibidos en archivos de cara al usuario.
// `\b` para evitar matches a `developer@`, `developer_email`, etc.
const PROHIBITED_PATTERNS = [
  /\bsoporte@praeventio\.(net|cl|guard)\b/i,
  /\bprivacidad@praeventio\.(net|cl|guard)\b/i,
  /\bventas@praeventio\.(net|cl|guard)\b/i,
  /\bsecurity@praeventio\.(net|cl|guard)\b/i,
  /\bfounder@praeventio\.(net|cl|guard)\b/i,
  /\bdev@praeventio\.(net|cl|guard)\b/i,
];

// Patrones permitidos como excepción explícita.
const ALLOWED_NONCANONICAL = [
  /noreply@praeventio\.net/, // SMTP from técnico
  /marketplace-demo@praeventio\.net/, // cuenta test marketplace
  /user@praeventio\.net/, // placeholder usuario WebAuthn (MFASetupModal)
  /dahosandoval@gmail\.com/, // fallback personal desarrollador
];

describe('correo único contacto@praeventio.net — directiva 2026-05-17 (H5)', () => {
  describe.each(CRITICAL_FILES)('archivo %s', (relPath) => {
    const abs = resolve(process.cwd(), relPath);
    if (!existsSync(abs)) {
      it.skip(`(no existe localmente; skipped)`, () => {});
      return;
    }
    const content = readFileSync(abs, 'utf8');

    it.each(PROHIBITED_PATTERNS)(
      'no contiene patrón prohibido %s',
      (pattern) => {
        expect(content).not.toMatch(pattern);
      },
    );

    it('si menciona @praeventio.*, son canónicos o excepciones permitidas', () => {
      // Capturar todas las menciones del dominio.
      const all = content.match(/[a-z0-9._%+-]+@praeventio\.[a-z]+/gi) ?? [];
      const invalid = all.filter((m) => {
        if (m === 'contacto@praeventio.net') return false;
        return !ALLOWED_NONCANONICAL.some((p) => p.test(m));
      });
      expect(invalid).toEqual([]);
    });
  });
});
