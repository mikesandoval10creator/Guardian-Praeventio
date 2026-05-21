// Contract test — §2.26 (UX anonymous browsing 2026-05-21).
//
// Verifica las colecciones que deben permitir LECTURA ANÓNIMA (sin login)
// porque son referencia pública (normativa SST, glosario terminología,
// templates IPER/PTS). Si alguien las gating accidentalmente con
// `isEmailVerified()` o un check de auth, este test fail-bloquea el merge.
//
// Filosofía declarada por el usuario 2026-05-21:
// "Como Instagram que te dejan ver perfiles/publicaciones públicas...
//  datos privados de empresas y personas con estándares de banco."
//
// Banking-grade preserved: writes siguen gated (verificable en
// firestore.rules.test.ts via @firebase/rules-unit-testing).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const rulesContent = readFileSync(resolve(repoRoot, 'firestore.rules'), 'utf8');

/**
 * Extracts the body of a rule block `match /<collection>/{<id>} { ... }`.
 * Returns just the body text between braces — caller asserts on
 * specific patterns inside.
 */
function extractRuleBody(collection: string): string | null {
  const re = new RegExp(
    `match\\s*/${collection}/\\{[A-Za-z_][A-Za-z0-9_]*\\}\\s*\\{([\\s\\S]*?)\\}\\s*\\n\\s*(?:\\}|match)`,
    'm',
  );
  const m = rulesContent.match(re);
  return m ? m[1] : null;
}

describe('§2.26 — public read collections (UX anonymous browsing)', () => {
  it('normatives: allow read: if true (regulación pública)', () => {
    const body = extractRuleBody('normatives');
    expect(body, 'normatives rule must exist').not.toBeNull();
    // Permitimos comentarios en la rule; chequeamos el patrón `allow read: if true`
    // (con o sin punto y coma) que es el contrato del fix.
    expect(body).toMatch(/allow\s+read\s*:\s*if\s+true\s*;/);
  });

  it('normatives: write sigue gated a isAdmin()', () => {
    const body = extractRuleBody('normatives');
    expect(body).toMatch(/allow\s+write\s*:\s*if\s+isAdmin\(\)/);
  });

  it('community_glossary: allow read: if true (terminología pública)', () => {
    const body = extractRuleBody('community_glossary');
    expect(body, 'community_glossary rule must exist').not.toBeNull();
    expect(body).toMatch(/allow\s+read\s*:\s*if\s+true\s*;/);
  });

  it('community_glossary: write sigue gated a admin/supervisor', () => {
    const body = extractRuleBody('community_glossary');
    expect(body).toMatch(/allow\s+write\s*:\s*if\s+isAdmin\(\)\s*\|\|\s*isSupervisor\(\)/);
  });

  it('global_templates: allow read: if true (templates públicos)', () => {
    const body = extractRuleBody('global_templates');
    expect(body, 'global_templates rule must exist').not.toBeNull();
    expect(body).toMatch(/allow\s+read\s*:\s*if\s+true\s*;/);
  });

  it('global_templates: write sigue gated a isAdmin()', () => {
    const body = extractRuleBody('global_templates');
    expect(body).toMatch(/allow\s+write\s*:\s*if\s+isAdmin\(\)/);
  });
});

describe('§2.26 — private collections NO leakable (banking-grade)', () => {
  it('audit_logs: create false (Admin SDK only — immutable trail)', () => {
    const body = extractRuleBody('audit_logs');
    expect(body, 'audit_logs rule must exist').not.toBeNull();
    expect(body).toMatch(/allow\s+create\s*:\s*if\s+false/);
    expect(body).toMatch(/allow\s+update\s*,\s*delete\s*:\s*if\s+false/);
  });

  it('audit_logs: read gated a isAdmin()', () => {
    const body = extractRuleBody('audit_logs');
    expect(body).toMatch(/allow\s+read\s*:\s*if\s+isAdmin\(\)/);
  });

  it('oauth_tokens: read/write false (server-only Admin SDK)', () => {
    const body = extractRuleBody('oauth_tokens');
    expect(body, 'oauth_tokens rule must exist').not.toBeNull();
    expect(body).toMatch(/allow\s+read\s*,\s*write\s*:\s*if\s+false/);
  });

  it('projects: read gated a isProjectMember (no anonymous leak)', () => {
    const body = extractRuleBody('projects');
    expect(body, 'projects rule must exist').not.toBeNull();
    // El gate exacto puede variar; lo crítico es que NO sea `if true`.
    expect(body).not.toMatch(/allow\s+read\s*:\s*if\s+true\s*;/);
  });
});

describe('§2.26 — default-deny no relajado', () => {
  it('firestore.rules:17 mantiene default `match /{document=**} { ... }`', () => {
    // El bloque catch-all debe seguir presente — defensa de banco.
    expect(rulesContent).toMatch(/match\s+\/\{document=\*\*\}\s*\{/);
  });

  it('isEmailVerified helper sigue defined (no se removió por error)', () => {
    expect(rulesContent).toMatch(/function\s+isEmailVerified\(\)\s*\{/);
  });

  it('isSignedIn helper sigue defined', () => {
    expect(rulesContent).toMatch(/function\s+isSignedIn\(\)\s*\{/);
  });
});
