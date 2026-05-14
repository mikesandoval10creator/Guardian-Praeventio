// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncidentEvidenceBundleCard } from './IncidentEvidenceBundleCard.js';
import type {
  IncidentBundleManifest,
  CompletenessGap,
} from '../../services/incidentBundle/incidentEvidenceBundle.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function manifest(
  over: Partial<IncidentBundleManifest> = {},
): IncidentBundleManifest {
  return {
    bundleId: over.bundleId ?? 'inc-001',
    generatedAt: '2026-05-13T10:00:00Z',
    incident: {
      id: over.incident?.id ?? 'inc-001',
      projectId: 'proj-1',
      occurredAt: '2026-05-12T08:00:00Z',
      severity: over.incident?.severity ?? 'high',
      kind: over.incident?.kind ?? 'fall_from_height',
      ...over.incident,
    },
    affectedWorkers: over.affectedWorkers ?? [],
    evidence: over.evidence ?? [],
    appliedControls: over.appliedControls ?? [],
    requiredEpp: over.requiredEpp ?? [],
    requiredTrainings: over.requiredTrainings ?? [],
    normativeRefs: over.normativeRefs ?? [],
    auditLog: over.auditLog ?? [],
    completenessScore: over.completenessScore ?? 50,
    gaps: over.gaps ?? [],
    recommendations: over.recommendations ?? [],
  };
}

describe('<IncidentEvidenceBundleCard />', () => {
  it('renderiza score + severity + kind', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({ completenessScore: 80 })}
      />,
    );
    expect(screen.getByTestId('incident-bundle-card')).toBeInTheDocument();
    expect(screen.getByTestId('incident-bundle-score')).toHaveTextContent('80/100');
    expect(screen.getByTestId('incident-bundle-severity')).toHaveTextContent('Alto');
  });

  it('barra de score refleja el porcentaje vía width inline', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({ completenessScore: 35 })}
      />,
    );
    const bar = screen.getByTestId('incident-bundle-score-bar');
    expect(bar.style.width).toBe('35%');
  });

  it('inventory tiles muestran counts correctos', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({
          evidence: [
            { id: 'e1', kind: 'photo', uploadedAt: '2026-05-12T09:00:00Z' },
            { id: 'e2', kind: 'video', uploadedAt: '2026-05-12T09:01:00Z' },
          ] as any,
          affectedWorkers: [{ uid: 'w1', injurySeverity: 'minor' }] as any,
          appliedControls: [],
          normativeRefs: [],
          auditLog: [],
          requiredTrainings: [],
        })}
      />,
    );
    expect(screen.getByTestId('incident-bundle-tile-evidence')).toHaveAttribute(
      'data-count',
      '2',
    );
    expect(screen.getByTestId('incident-bundle-tile-workers')).toHaveAttribute(
      'data-count',
      '1',
    );
    expect(screen.getByTestId('incident-bundle-tile-controls')).toHaveAttribute(
      'data-count',
      '0',
    );
  });

  it('tile con count=0 usa estilo rojo (data-count="0")', () => {
    render(<IncidentEvidenceBundleCard manifest={manifest()} />);
    const tile = screen.getByTestId('incident-bundle-tile-evidence');
    expect(tile).toHaveAttribute('data-count', '0');
  });

  it('sin gaps: mensaje "expediente presentable"', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({ gaps: [], completenessScore: 100 })}
      />,
    );
    expect(screen.getByTestId('incident-bundle-no-gaps')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-bundle-gaps')).toBeNull();
  });

  it('con gaps: lista cada uno con label legible + weight', () => {
    const gaps: CompletenessGap[] = [
      { kind: 'no_evidence', detail: 'Falta fotos', weight: 20 },
      { kind: 'no_root_cause_assigned', detail: 'Pendiente', weight: 15 },
    ];
    render(
      <IncidentEvidenceBundleCard manifest={manifest({ gaps })} />,
    );
    expect(screen.getByTestId('incident-bundle-gap-no_evidence')).toHaveTextContent(
      /Sin evidencia/,
    );
    expect(screen.getByTestId('incident-bundle-gap-no_root_cause_assigned')).toHaveTextContent(
      /Causa raíz/,
    );
  });

  it('onResolveGap dispara con gap + manifest', () => {
    const onResolve = vi.fn();
    const gaps: CompletenessGap[] = [
      { kind: 'no_evidence', detail: 'd', weight: 20 },
    ];
    const m = manifest({ gaps });
    render(
      <IncidentEvidenceBundleCard manifest={m} onResolveGap={onResolve} />,
    );
    fireEvent.click(screen.getByTestId('incident-bundle-gap-resolve-no_evidence'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].kind).toBe('no_evidence');
    expect(onResolve.mock.calls[0][1]).toBe(m);
  });

  it('sin onResolveGap: botón resolve no aparece', () => {
    const gaps: CompletenessGap[] = [
      { kind: 'no_evidence', detail: 'd', weight: 20 },
    ];
    render(<IncidentEvidenceBundleCard manifest={manifest({ gaps })} />);
    expect(screen.queryByTestId('incident-bundle-gap-resolve-no_evidence')).toBeNull();
  });

  it('onExport dispara con manifest', () => {
    const onExport = vi.fn();
    const m = manifest();
    render(<IncidentEvidenceBundleCard manifest={m} onExport={onExport} />);
    fireEvent.click(screen.getByTestId('incident-bundle-export'));
    expect(onExport).toHaveBeenCalledWith(m);
  });

  it('recomendaciones se renderizan si están presentes', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({
          recommendations: ['Cargar evidencia fotográfica', 'Asignar causa raíz'],
        })}
      />,
    );
    const rec = screen.getByTestId('incident-bundle-recommendations');
    expect(rec).toHaveTextContent('Cargar evidencia fotográfica');
    expect(rec).toHaveTextContent('Asignar causa raíz');
  });

  it('sin recomendaciones: bloque oculto', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({ recommendations: [] })}
      />,
    );
    expect(screen.queryByTestId('incident-bundle-recommendations')).toBeNull();
  });

  it('severity SIF muestra label correcto', () => {
    render(
      <IncidentEvidenceBundleCard
        manifest={manifest({ incident: { id: 'i', projectId: 'p', occurredAt: '2026-05-12T08:00:00Z', severity: 'sif', kind: 'fall_from_height' } })}
      />,
    );
    expect(screen.getByTestId('incident-bundle-severity')).toHaveTextContent('SIF');
  });
});
