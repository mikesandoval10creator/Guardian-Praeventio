import { describe, it, expect } from 'vitest';
import {
  buildNormalizationRadar,
  summarizeRadar,
  hasUrgentPattern,
} from './deviationNormalizationRadar.js';
import type { ExceptionRecord, ExceptionDomain } from '../exceptions/exceptionEngine.js';

function ex(
  id: string,
  over: {
    domain?: ExceptionDomain;
    workerUid?: string;
    approverUid?: string;
    daysAgo?: number;
  } = {},
): ExceptionRecord {
  const daysAgo = over.daysAgo ?? 0;
  const approvedAt = new Date(Date.parse('2026-05-11T10:00:00Z') - daysAgo * 86_400_000).toISOString();
  return {
    id,
    domain: over.domain ?? 'training_gap',
    subjectRef: { kind: 'WORKER', id: over.workerUid ?? 'w1' },
    reason: 'razón mínima para test radar (más de 20 chars).',
    alternativeMitigation: 'mitigación alternativa razonable para test (más de 20).',
    approvedByUid: over.approverUid ?? 'sup1',
    approvedByRole: 'supervisor',
    approvedAt,
    validUntil: new Date(Date.parse(approvedAt) + 86_400_000).toISOString(),
    status: 'active',
  };
}

const NOW = '2026-05-11T10:00:00Z';

describe('buildNormalizationRadar', () => {
  it('lista vacía → no detecciones', () => {
    expect(buildNormalizationRadar({ exceptions: [], now: NOW })).toEqual([]);
  });

  it('§285: mismo subject > 3 veces en 7d → escalar', () => {
    const exs = [1, 2, 3, 4].map((n) => ex(`e${n}`, { workerUid: 'w-repeat', daysAgo: n }));
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    const sameSubject = patterns.find((p) => p.kind === 'same_subject_repeated');
    expect(sameSubject).toBeDefined();
    expect(sameSubject!.escalateToManagement).toBe(true);
    expect(sameSubject!.severity).toBe('critical');
  });

  it('§286: mismo dominio > 10 en 30d → revisar procedimiento', () => {
    const exs = Array.from({ length: 11 }, (_, i) =>
      ex(`e${i}`, { domain: 'training_gap', workerUid: `w${i}`, daysAgo: i * 2 }),
    );
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    const procPattern = patterns.find((p) => p.kind === 'same_procedure_overruled');
    expect(procPattern).toBeDefined();
    expect(procPattern!.subjectKey).toBe('training_gap');
  });

  it('mismo trabajador chronic en 14d → warning', () => {
    const exs = [1, 2, 3, 4, 5, 6].map((n) =>
      ex(`e${n}`, { workerUid: 'w-chronic', daysAgo: n * 2, domain: n % 2 ? 'epp_expired' : 'training_gap' }),
    );
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    const chronic = patterns.find((p) => p.kind === 'same_worker_chronic');
    expect(chronic).toBeDefined();
    expect(chronic!.severity).toBe('warning');
  });

  it('approver-streak > 15 firmas en 7d → escalar', () => {
    const exs = Array.from({ length: 17 }, (_, i) =>
      ex(`e${i}`, { approverUid: 'sup-fast', workerUid: `w${i}`, daysAgo: 1 }),
    );
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    const streak = patterns.find((p) => p.kind === 'approver_signing_streak');
    expect(streak).toBeDefined();
    expect(streak!.escalateToManagement).toBe(true);
  });

  it('category drift: tendencia ascendente esta semana', () => {
    // 8 excepciones en últimos 7d, vs total 30d = 12 → avg 3/semana, esta=8 > 3*1.5
    const recent = Array.from({ length: 8 }, (_, i) =>
      ex(`r${i}`, { domain: 'document_expired', workerUid: `w${i}`, daysAgo: i }),
    );
    const older = Array.from({ length: 4 }, (_, i) =>
      ex(`o${i}`, { domain: 'document_expired', workerUid: `w${i + 10}`, daysAgo: 14 + i * 3 }),
    );
    const patterns = buildNormalizationRadar({ exceptions: [...recent, ...older], now: NOW });
    expect(patterns.some((p) => p.kind === 'category_drift')).toBe(true);
  });

  it('patrones ordenados: critical primero', () => {
    const exs = [
      ...[1, 2, 3, 4, 5].map((n) => ex(`s${n}`, { workerUid: 'w-rep', daysAgo: n })), // critical
      ...Array.from({ length: 11 }, (_, i) =>
        ex(`p${i}`, { domain: 'epp_expired', workerUid: `w${i}`, daysAgo: i * 2 }),
      ), // warning
    ];
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    expect(patterns[0].severity).toBe('critical');
  });
});

describe('summarizeRadar', () => {
  it('cuenta por kind + severity + pendientes escalamiento', () => {
    const exs = [1, 2, 3, 4].map((n) => ex(`e${n}`, { workerUid: 'w-rep', daysAgo: n }));
    const patterns = buildNormalizationRadar({ exceptions: exs, now: NOW });
    const summary = summarizeRadar(patterns);
    expect(summary.totalPatterns).toBeGreaterThan(0);
    expect(summary.bySeverity.critical).toBeGreaterThan(0);
    expect(summary.pendingEscalations).toBeGreaterThan(0);
  });
});

describe('hasUrgentPattern', () => {
  it('true si hay escalateToManagement=true', () => {
    const exs = [1, 2, 3, 4].map((n) => ex(`e${n}`, { workerUid: 'w-rep', daysAgo: n }));
    expect(hasUrgentPattern(buildNormalizationRadar({ exceptions: exs, now: NOW }))).toBe(true);
  });

  it('false con lista vacía', () => {
    expect(hasUrgentPattern([])).toBe(false);
  });
});
