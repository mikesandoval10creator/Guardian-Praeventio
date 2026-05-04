// SPDX-License-Identifier: MIT
//
// NormativaWarningsBanner — surfaces compliance violations from the
// `runComplianceCheck` engine to the user in real time as they place
// objects on the Digital Twin.

import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import type { RuleViolation, Severity } from '../../services/digitalTwin/objectPlacement/normativaRules';

const SEVERITY_STYLE: Record<Severity, { bg: string; border: string; text: string; Icon: typeof AlertCircle }> = {
  error: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/40',
    text: 'text-rose-300',
    Icon: AlertCircle,
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    text: 'text-amber-300',
    Icon: AlertTriangle,
  },
  info: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/40',
    text: 'text-cyan-300',
    Icon: Info,
  },
};

export interface NormativaWarningsBannerProps {
  violations: RuleViolation[];
  compact?: boolean;
}

export function NormativaWarningsBanner({ violations, compact }: NormativaWarningsBannerProps) {
  if (violations.length === 0) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
        <Info className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
        <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">
          Sin observaciones normativas
        </span>
      </div>
    );
  }

  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  for (const v of violations) counts[v.severity]++;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {(['error', 'warning', 'info'] as Severity[]).map((sev) => {
          if (counts[sev] === 0) return null;
          const s = SEVERITY_STYLE[sev];
          return (
            <span
              key={sev}
              className={`px-2 py-1 rounded-lg border ${s.bg} ${s.border} ${s.text} text-[10px] font-black uppercase tracking-widest flex items-center gap-1`}
            >
              <s.Icon className="w-3 h-3" aria-hidden="true" />
              {counts[sev]} {sev}
            </span>
          );
        })}
      </div>

      {!compact && (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {violations.map((v, idx) => {
            const s = SEVERITY_STYLE[v.severity];
            return (
              <li
                key={`${v.ruleId}-${idx}`}
                className={`px-3 py-2 rounded-lg border ${s.bg} ${s.border}`}
              >
                <div className="flex items-start gap-2">
                  <s.Icon className={`w-3.5 h-3.5 ${s.text} shrink-0 mt-0.5`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className={`text-[11px] font-bold ${s.text}`}>{v.message}</p>
                    <p className="text-[9px] text-zinc-500 mt-0.5 font-mono uppercase tracking-wider">
                      {v.citation}
                    </p>
                    {v.suggestion && (
                      <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                        {v.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
