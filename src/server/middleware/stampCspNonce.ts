// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan v2 F8 / Audit H16 (P3).
//
// Helper para reemplazar el placeholder `__CSP_NONCE__` por el nonce
// per-request en el HTML del SPA fallback. Existe como módulo separado
// para que el bug F8 sea reproducible en un test unitario en lugar de
// vivir como string literal dentro de `server.ts`.
//
// El bug: `String.prototype.replace(regex, string)` interpreta los
// tokens `$&`, `$$`, `$\``, `$'`, `$<name>`, `$n` dentro del replacement
// string. El nonce viene hoy de `randomBytes(16).toString('base64')`
// (charset A-Z, a-z, 0-9, +, /, =) así que el bug NO se manifiesta —
// pero si alguien cambia el generador para usar otro encoding (base64url
// con `_` y `-`, hex con dígitos, o cualquier formato que pueda contener
// `$`), el HTML servido tendrá un nonce roto y los inline scripts
// fallarán CSP silently. Pasamos el replacement como callback para que
// `$`-tokens nunca se interpreten.

const NONCE_PLACEHOLDER = /__CSP_NONCE__/g;

/**
 * Stampa el nonce per-request sobre el template HTML cacheado.
 *
 * Robust a cualquier carácter en `nonce` (incluyendo `$&`, `$$`,
 * backreferences `$1`-`$9`, etc.). El callback signature evita la
 * interpretación que hace `String.prototype.replace` cuando el segundo
 * argumento es un string literal.
 *
 * @param template — `dist/index.html` precargado al boot.
 * @param nonce — nonce single-use de `res.locals.cspNonce`.
 */
export function stampCspNonce(template: string, nonce: string): string {
  return template.replace(NONCE_PLACEHOLDER, () => nonce);
}
