// Sprint 29 Bucket EE — RegulatoryCitation.
//
// Componente UI agnóstico que resuelve un `controlId` ISO 45001 contra
// el registry regulatorio (Sprint 28 B1 + Sprint 29 EE: UK/CA/AU) y
// renderiza chips inline con cada cita. El color base es el teal
// favorito del producto (#4db6ac).
//
// Wire en 3 lugares de alta visibilidad:
//   - HazmatStorageDesigner (módulo de ingeniería)
//   - SusesoReports (Sprint 28 B6)
//   - CphsModule (reemplaza CphsRegulatoryHeader hardcoded)

import React, { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  cite,
  getActiveJurisdictions,
  type TenantRegulatoryContext,
} from '../../services/regulatory/registry';

export interface RegulatoryCitationProps {
  /** ID simbólico ISO 45001 (ej. 'OPERATIONAL_CONTROL'). */
  controlId: string;
  /** Código de país del tenant (alpha-2 preferido). Se resuelve a la
   *  jurisdicción correspondiente; ISO 45001 siempre se incluye. */
  tenantCountry?: string;
  /** Override directo cuando el llamador ya tiene contexto resuelto. */
  context?: TenantRegulatoryContext;
  /** Etiqueta corta que precede a las chips ("Normativa", "Cita", …). */
  label?: string;
  /** Cuando true, oculta el icono (uso compacto inline). */
  hideIcon?: boolean;
  /** Formato: 'short' = 'DS-54 (Chile)', 'long' = 'DS-54 — DS 54 art... (Chile)'. */
  format?: 'short' | 'long';
  className?: string;
}

const TEAL = '#4db6ac';

/**
 * Render-only. Si no hay citas resueltas, devuelve null.
 */
export function RegulatoryCitation({
  controlId,
  tenantCountry,
  context,
  label = 'Normativa',
  hideIcon = false,
  format = 'short',
  className = '',
}: RegulatoryCitationProps): React.ReactElement | null {
  const citations = useMemo(() => {
    const ctx: TenantRegulatoryContext = context ?? { country: tenantCountry };
    const jurisdictions = getActiveJurisdictions(ctx);
    return cite(controlId, { jurisdictions, format });
  }, [controlId, tenantCountry, context, format]);

  if (citations.length === 0) return null;

  return (
    <div
      data-testid="regulatory-citation"
      data-control-id={controlId}
      className={`flex flex-wrap items-center gap-2 ${className}`.trim()}
    >
      {!hideIcon && (
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-md"
          style={{ backgroundColor: `${TEAL}1A` /* 10% alpha */ }}
          aria-hidden="true"
        >
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: TEAL }} />
        </span>
      )}
      {label && (
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
          {label}
        </span>
      )}
      <ul
        className="flex flex-wrap items-center gap-1.5"
        aria-label={`Citas normativas para ${controlId}`}
      >
        {citations.map((c, i) => (
          <li key={`${controlId}-${i}-${c}`}>
            <span
              className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border"
              style={{
                color: TEAL,
                borderColor: `${TEAL}66`,
                backgroundColor: `${TEAL}14`,
              }}
            >
              {c}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RegulatoryCitation;
