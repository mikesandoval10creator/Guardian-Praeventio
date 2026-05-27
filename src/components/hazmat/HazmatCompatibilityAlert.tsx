// Praeventio Guard — <HazmatCompatibilityAlert />.
//
// Banner rojo (incompatibles) / ámbar (cautions) que aparece sobre el
// inventario cuando hay sustancias incompatibles co-ubicadas. Mostramos:
//   • lista de pares con la razón
//   • recomendación de re-localización (la directiva NO-BLOQUEAR: solo
//     recomendamos, nunca apagamos / cerramos / vetamos la maquinaria/sitio)
//
// Marca DS 43/2016 + NCh 2245 como base normativa (footer pequeño).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, ArrowRight } from 'lucide-react';
import type {
  CompatibilityIssue,
  HazmatItem,
} from '../../services/hazmat/hazmatInventory.js';

interface HazmatCompatibilityAlertProps {
  issues: CompatibilityIssue[];
  /** Lista completa de items — para sugerir ubicación alternativa. */
  items?: HazmatItem[];
}

/**
 * Selecciona una ubicación alternativa: cualquier locationId del inventario
 * distinto del actual. Si solo hay una ubicación registrada, devolvemos
 * `null` y la recomendación queda genérica.
 */
function suggestRelocation(
  current: string,
  items: HazmatItem[] | undefined,
): string | null {
  if (!items || items.length === 0) return null;
  const alternatives = Array.from(new Set(items.map((it) => it.locationId))).filter(
    (loc) => loc !== current,
  );
  return alternatives[0] ?? null;
}

export function HazmatCompatibilityAlert({
  issues,
  items,
}: HazmatCompatibilityAlertProps) {
  const { t } = useTranslation();

  const incompatibles = useMemo(
    () => issues.filter((i) => i.level === 'incompatible'),
    [issues],
  );
  const cautions = useMemo(() => issues.filter((i) => i.level === 'caution'), [issues]);

  if (issues.length === 0) return null;

  const hasCritical = incompatibles.length > 0;
  const toneClass = hasCritical
    ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  const Icon = hasCritical ? AlertOctagon : AlertTriangle;

  return (
    <aside
      role="alert"
      aria-live="polite"
      data-testid="hazmat-compat-alert"
      data-severity={hasCritical ? 'incompatible' : 'caution'}
      className={`rounded-2xl border ${toneClass} p-3 space-y-2`}
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <p className="text-xs font-black uppercase tracking-wide" data-testid="hazmat-compat-title">
          {hasCritical
            ? t(
                'hazmat.alert.criticalTitle',
                `${incompatibles.length} par(es) incompatibles co-ubicadas`,
              )
            : t(
                'hazmat.alert.cautionTitle',
                `${cautions.length} par(es) requieren precaución`,
              )}
        </p>
      </header>

      <ul className="space-y-1.5" data-testid="hazmat-compat-pairs">
        {issues.slice(0, 6).map((iss, i) => {
          const alt = suggestRelocation(iss.itemA.locationId, items);
          return (
            <li
              key={`${iss.itemA.id}-${iss.itemB.id}-${i}`}
              data-testid={`hazmat-compat-pair-${i}`}
              className="text-[11px] leading-snug"
            >
              <span className="font-bold">
                {iss.itemA.name} ↔ {iss.itemB.name}
              </span>
              <span className="opacity-80"> — {iss.reason}</span>
              {iss.level === 'incompatible' && (
                <span className="block opacity-90 mt-0.5 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  {alt
                    ? t(
                        'hazmat.alert.relocateTo',
                        `Recomendación: trasladar uno de los items a "${alt}".`,
                      )
                    : t(
                        'hazmat.alert.relocateGeneric',
                        'Recomendación: trasladar uno de los items a una ubicación separada por barrera o sector.',
                      )}
                </span>
              )}
              {iss.level === 'caution' && (
                <span className="block opacity-90 mt-0.5 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  {t(
                    'hazmat.alert.cautionTip',
                    'Mantener distancia mínima 3 m y ventilación adecuada.',
                  )}
                </span>
              )}
            </li>
          );
        })}
        {issues.length > 6 && (
          <li
            className="text-[10px] italic opacity-80"
            data-testid="hazmat-compat-overflow"
          >
            {t('hazmat.alert.more', `+ ${issues.length - 6} pares adicionales`)}
          </li>
        )}
      </ul>

      <footer className="text-[9px] opacity-70 border-t border-current/20 pt-1 mt-1">
        {t(
          'hazmat.alert.footer',
          'Base normativa: DS 43/2016 (Almacenamiento Sustancias Peligrosas) + NCh 2245.',
        )}
      </footer>
    </aside>
  );
}
