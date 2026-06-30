import { useMemo } from 'react';
import { measureTextHeight } from '../utils/textMeasure';

/**
 * ¿El texto cabe en UNA línea al ancho dado? Usa pretext (sin reflow del DOM).
 * fits=false → la UI debe poner title/tooltip o envolver, NUNCA cortar en silencio
 * (directiva: no omitir información). Sin Canvas → fits=true (no truncar por falso negativo).
 */
export function useTextFits(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight = 20,
): { fits: boolean; lineCount: number | null } {
  return useMemo(() => {
    if (!text || maxWidth <= 0) return { fits: true, lineCount: null };
    const m = measureTextHeight(text, font, maxWidth, lineHeight);
    if (m === null) return { fits: true, lineCount: null };
    return { fits: m.lineCount <= 1, lineCount: m.lineCount };
  }, [text, font, maxWidth, lineHeight]);
}
