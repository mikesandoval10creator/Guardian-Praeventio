// AutoFitText — texto que se ajusta SOLO a su caja.
//
// Usa @chenglou/pretext (medición de texto sin DOM / sin reflow) para encontrar,
// por búsqueda binaria, el mayor tamaño de fuente con el que el texto entra en
// `maxLines` líneas dentro del ancho disponible. Resultado: las etiquetas dejan de
// cortarse ("Permisos act...") o desbordar — se acomodan al espacio.
//
// Degradación segura: si pretext no está instalado, no hay canvas/Intl.Segmenter,
// o el ancho aún no se conoce, cae a `maxPx` (comportamiento normal). Carga pretext
// con import dinámico para no romper el build si el paquete no está presente.

import { useEffect, useRef, useState } from 'react';

type PretextMod = {
  prepare: (text: string, font: string) => unknown;
  layout: (prepared: unknown, maxWidth: number, lineHeight: number) => { lineCount: number; height: number };
};

// undefined = sin intentar; null = no disponible; obj = cargado
let cached: PretextMod | null | undefined;

async function loadPretext(): Promise<PretextMod | null> {
  if (cached !== undefined) return cached;
  try {
    const m = await import('@chenglou/pretext');
    cached = typeof m?.prepare === 'function' && typeof m?.layout === 'function' ? (m as unknown as PretextMod) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export interface AutoFitTextProps {
  children: string;
  /** Tamaño máximo (px). Default 16. */
  maxPx?: number;
  /** Tamaño mínimo (px) al que puede encoger. Default 9. */
  minPx?: number;
  /** Líneas permitidas antes de encoger. Default 1. */
  maxLines?: number;
  /** Familia tipográfica (debe ser una fuente nombrada, no system-ui). Default Inter. */
  fontFamily?: string;
  /** Peso CSS para medir con precisión (ej. '600'). Default '500'. */
  weight?: string;
  className?: string;
  title?: string;
}

export function AutoFitText({
  children,
  maxPx = 16,
  minPx = 9,
  maxLines = 1,
  fontFamily = 'Inter',
  weight = '500',
  className = '',
  title,
}: AutoFitTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(maxPx);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return undefined;

    const fit = async () => {
      const px = await loadPretext();
      const width = el.clientWidth || el.getBoundingClientRect().width;
      if (cancelled) return;
      if (!px || !width) {
        setSize(maxPx); // fallback: sin pretext o sin ancho aún
        return;
      }
      // Búsqueda binaria del mayor tamaño que entra en maxLines.
      let lo = minPx;
      let hi = maxPx;
      let best = minPx;
      for (let i = 0; i < 12 && lo <= hi; i++) {
        const mid = Math.round(((lo + hi) / 2) * 2) / 2; // pasos de 0.5px
        try {
          const prepared = px.prepare(children, `${weight} ${mid}px ${fontFamily}`);
          const { lineCount } = px.layout(prepared, width, mid * 1.25);
          if (lineCount <= maxLines) {
            best = mid;
            lo = mid + 0.5;
          } else {
            hi = mid - 0.5;
          }
        } catch {
          best = maxPx;
          break;
        }
      }
      if (!cancelled) setSize(best);
    };

    void fit();
    const ro = new ResizeObserver(() => void fit());
    ro.observe(el);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [children, maxPx, minPx, maxLines, fontFamily, weight]);

  return (
    <span
      ref={ref}
      title={title}
      className={`block w-full ${className}`}
      style={{
        fontSize: `${size}px`,
        lineHeight: 1.15,
        whiteSpace: maxLines === 1 ? 'nowrap' : 'normal',
        overflow: 'hidden',
      }}
    >
      {children}
    </span>
  );
}
