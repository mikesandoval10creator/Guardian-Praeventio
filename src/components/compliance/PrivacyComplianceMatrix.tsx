// Praeventio Guard — Sprint 31 Bucket MM.
//
// Renders the {right × regime[]} compliance matrix for the tenant. Pure
// presentational: takes the active regimes and shows which rights they
// each support, with deadline and citation. Cells are ✓ + deadline /
// ✗ / partial.

import React from 'react';
import {
  complianceMatrix,
  getActiveRegimes,
} from '../../services/privacy/registry';
import type {
  PrivacyRegimeSpec,
  PrivacyRight,
} from '../../services/privacy/types';

const RIGHT_LABELS: Record<PrivacyRight, string> = {
  access: 'Acceso',
  portability: 'Portabilidad',
  rectification: 'Rectificación',
  erasure: 'Supresión',
  objection: 'Oposición',
  restriction: 'Limitación',
  no_automated_decision: 'No decisión automatizada',
  opt_out_sale: 'Opt-out venta',
  consent_withdrawal: 'Revocar consentimiento',
};

export interface PrivacyComplianceMatrixProps {
  /** ISO alpha-2 country of the data subject. */
  country?: string;
  /** Where data is processed (when different). */
  dataResidency?: string;
  /** Override resolution and pass regimes directly. */
  regimes?: PrivacyRegimeSpec[];
}

export const PrivacyComplianceMatrix: React.FC<PrivacyComplianceMatrixProps> = ({
  country,
  dataResidency,
  regimes,
}) => {
  const active =
    regimes ?? getActiveRegimes({ country, dataResidency });
  const matrix = complianceMatrix(active);

  if (active.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs">
        No se detectaron regímenes de privacidad activos para el país
        configurado. Revisa el código de país en el perfil del tenant.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/10 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <th className="text-left px-3 py-2 font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-widest">
              Derecho
            </th>
            {active.map((r) => (
              <th
                key={r.code}
                className="text-left px-3 py-2 font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-widest"
                title={r.citation}
              >
                {r.code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr
              key={row.right}
              className="border-t border-zinc-200 dark:border-white/10"
            >
              <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-white">
                {RIGHT_LABELS[row.right]}
              </td>
              {active.map((regime) => {
                const support = row.supportedBy.find(
                  (s) => s.code === regime.code,
                );
                if (!support) {
                  return (
                    <td
                      key={regime.code}
                      className="px-3 py-2 text-rose-500"
                      aria-label="No soportado"
                    >
                      ✗
                    </td>
                  );
                }
                return (
                  <td
                    key={regime.code}
                    className="px-3 py-2 text-emerald-600 dark:text-emerald-400"
                    title={support.citation}
                  >
                    <span aria-label={`Soportado, plazo ${support.deadlineDays} días`}>
                      ✓
                    </span>
                    <span className="ml-1 text-zinc-600 dark:text-zinc-400 text-[10px]">
                      {support.deadlineDays}d
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 text-[10px] text-zinc-600 dark:text-zinc-400 border-t border-zinc-200 dark:border-white/10">
        Plazos en días corridos. El endpoint de solicitudes aplica el
        mínimo entre regímenes activos.
      </div>
    </div>
  );
};

export default PrivacyComplianceMatrix;
