/**
 * Cumplimiento Ley 20.005 (acoso laboral) y Ley 20.609 (no discriminación):
 * filtros locales para contenido publicado en el Mural Dinámico.
 *
 * Estrategia defense-in-depth:
 * 1. Rechazo en cliente (UX inmediato + fricción para mala fe)
 * 2. Cloud Functions trigger (TODO) puede re-validar y eliminar si pasa
 *
 * Mantener listas en chileno coloquial — los términos en inglés rara vez
 * aparecen y dispararían falsos positivos en contexto técnico.
 */

// Cada patrón usa lookbehind/lookahead de no-letras para emular word boundary
// que respeta tildes y ñ (los \b nativos de JS no funcionan con Unicode).
const NB = '(?<![\\p{L}\\p{N}])';
const NA = '(?![\\p{L}\\p{N}])';
const w = (body: string) => new RegExp(`${NB}(?:${body})${NA}`, 'iu');

const HARASSMENT_TERMS: RegExp[] = [
  // Insultos directos
  w('weon[ae]?|hue[oó]n[ae]?|huevon[ae]?|conchatumadre|ctm|reculiad[oa]|maric[oó]n|maraca|culiad[oa]|pendej[oa]'),
  // Amenazas
  w('te\\s+voy\\s+a\\s+matar|te\\s+mato|te\\s+rompo|te\\s+pego|te\\s+cag[ao]'),
  // Discriminación racial / nacional (usos peyorativos comunes)
  w('indio\\s+culiad|negro\\s+de\\s+mierda|peruan[oa]\\s+culiad|haitiano\\s+culiad'),
  // Acoso sexual explícito
  w('rica[s]?\\s+tetas|culo\\s+rico|te\\s+la\\s+meto|chuparla|mam[aá]rmela'),
];

const SPAM_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s]{3,}/i,           // links externos
  /\b\d{8,}\b/,                       // números largos (teléfonos, RUT sin puntos)
  /(.)\1{6,}/,                        // 7+ caracteres repetidos (aaaaaaa)
];

const MIN_CHARS = 3;
const MAX_CHARS = 1000;

export interface ModerationResult {
  ok: boolean;
  reason?: string;
  code?: 'too_short' | 'too_long' | 'harassment' | 'spam';
}

export function moderatePostContent(content: string): ModerationResult {
  const text = content.trim();

  if (text.length < MIN_CHARS) {
    return { ok: false, code: 'too_short', reason: 'El mensaje es demasiado corto.' };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, code: 'too_long', reason: `El mensaje supera el límite de ${MAX_CHARS} caracteres.` };
  }

  for (const pattern of HARASSMENT_TERMS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        code: 'harassment',
        reason: 'El mensaje contiene lenguaje incompatible con la Ley 20.005 (ambiente laboral libre de acoso). Reescríbelo respetuosamente.',
      };
    }
  }

  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        code: 'spam',
        reason: 'El mensaje parece spam (links externos, números largos o caracteres repetidos). Edita el contenido.',
      };
    }
  }

  return { ok: true };
}
