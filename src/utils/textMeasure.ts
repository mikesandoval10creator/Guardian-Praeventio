import { prepare, layout } from '@chenglou/pretext';

/**
 * Mide altura/líneas de texto SIN reflow del DOM usando pretext.
 * pretext requiere Canvas 2D + Intl.Segmenter; si no están (jsdom/SSR),
 * retorna null para que el caller aplique su propio fallback (CSS normal).
 */
export function measureTextHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
): { height: number; lineCount: number } | null {
  if (typeof document === 'undefined' || typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    return null;
  }
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || typeof ctx.measureText !== 'function') return null;
    // sondeo: jsdom devuelve width 0 siempre → tratamos como no-soportado
    ctx.font = font;
    if (ctx.measureText('x').width === 0 && text.length > 0) return null;
    const prepared = prepare(text, font);
    return layout(prepared, maxWidth, lineHeight);
  } catch {
    return null;
  }
}
