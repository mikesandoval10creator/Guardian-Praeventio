// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResilienceHealthDashboard } from './ResilienceHealthDashboard';
import type {
  ResilienceHealthReport,
  SubsystemReport,
  SubsystemStatus,
} from '../../services/observability/resilienceHealthMonitor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function sub(
  id: SubsystemReport['id'],
  status: SubsystemStatus,
  over: Partial<SubsystemReport> = {},
): SubsystemReport {
  return {
    id,
    status,
    detail: `${id} ${status}`,
    checkLatencyMs: 10,
    ...over,
  };
}

function report(over: Partial<ResilienceHealthReport> = {}): ResilienceHealthReport {
  return {
    overallStatus: 'healthy',
    subsystems: [
      sub('slm', 'healthy'),
      sub('zettelkasten', 'healthy'),
      sub('firestore', 'healthy'),
      sub('gemini', 'healthy'),
      sub('device_kek', 'healthy'),
      sub('encrypted_kv', 'healthy'),
      sub('network', 'healthy'),
    ],
    recommendations: [],
    generatedAt: '2026-05-14T10:00:00Z',
    totalLatencyMs: 150,
    ...over,
  };
}

describe('<ResilienceHealthDashboard />', () => {
  it('renderiza overall status + 7 subsystems', () => {
    render(<ResilienceHealthDashboard report={report()} />);
    const root = screen.getByTestId('resilience-dashboard');
    expect(root).toHaveAttribute('data-overall-status', 'healthy');
    expect(screen.getByTestId('resilience-overall')).toHaveTextContent(
      'Saludable',
    );
    for (const id of [
      'slm',
      'zettelkasten',
      'firestore',
      'gemini',
      'device_kek',
      'encrypted_kv',
      'network',
    ]) {
      expect(screen.getByTestId(`resilience-subsystem-${id}`)).toBeInTheDocument();
    }
  });

  it('overall data-attr refleja status crítico', () => {
    render(
      <ResilienceHealthDashboard
        report={report({ overallStatus: 'critical' })}
      />,
    );
    expect(screen.getByTestId('resilience-dashboard')).toHaveAttribute(
      'data-overall-status',
      'critical',
    );
  });

  it('sort: critical → degraded → unknown → healthy', () => {
    const r = report({
      subsystems: [
        sub('slm', 'healthy'),
        sub('zettelkasten', 'critical'),
        sub('firestore', 'unknown'),
        sub('gemini', 'degraded'),
        sub('device_kek', 'healthy'),
        sub('encrypted_kv', 'critical'),
        sub('network', 'degraded'),
      ],
    });
    render(<ResilienceHealthDashboard report={r} />);
    const list = screen.getByTestId('resilience-subsystems');
    const items = list.querySelectorAll('li');
    expect(items[0]).toHaveAttribute('data-status', 'critical');
    expect(items[1]).toHaveAttribute('data-status', 'critical');
    expect(items[2]).toHaveAttribute('data-status', 'degraded');
    expect(items[3]).toHaveAttribute('data-status', 'degraded');
    expect(items[4]).toHaveAttribute('data-status', 'unknown');
    expect(items[5]).toHaveAttribute('data-status', 'healthy');
    expect(items[6]).toHaveAttribute('data-status', 'healthy');
  });

  it('sin recomendaciones: mensaje "todo en orden"', () => {
    render(<ResilienceHealthDashboard report={report()} />);
    expect(screen.getByTestId('resilience-no-recommendations')).toBeInTheDocument();
    expect(screen.queryByTestId('resilience-recommendations')).toBeNull();
  });

  it('con recomendaciones: lista con severity attrs', () => {
    const r = report({
      recommendations: [
        {
          severity: 'critical',
          subsystem: 'slm',
          action: 'Re-descargar el modelo',
        },
        {
          severity: 'warn',
          subsystem: 'device_kek',
          action: 'Considera rotar KEK',
        },
        {
          severity: 'info',
          subsystem: 'gemini',
          action: 'Verificar config',
        },
      ],
    });
    render(<ResilienceHealthDashboard report={r} />);
    const recs = screen.getByTestId('resilience-recommendations');
    expect(recs).toBeInTheDocument();
    expect(screen.getByTestId('resilience-rec-slm-0')).toHaveAttribute(
      'data-severity',
      'critical',
    );
    expect(screen.getByTestId('resilience-rec-device_kek-1')).toHaveAttribute(
      'data-severity',
      'warn',
    );
    expect(screen.getByTestId('resilience-rec-gemini-2')).toHaveAttribute(
      'data-severity',
      'info',
    );
  });

  it('onRefresh: botón visible y dispara callback', () => {
    const onRefresh = vi.fn();
    render(<ResilienceHealthDashboard report={report()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId('resilience-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshing=true: botón disabled', () => {
    const onRefresh = vi.fn();
    render(
      <ResilienceHealthDashboard
        report={report()}
        onRefresh={onRefresh}
        refreshing
      />,
    );
    expect(screen.getByTestId('resilience-refresh')).toBeDisabled();
  });

  it('sin onRefresh: botón oculto', () => {
    render(<ResilienceHealthDashboard report={report()} />);
    expect(screen.queryByTestId('resilience-refresh')).toBeNull();
  });

  it('onRecommendationAction: click dispara con subsystem id', () => {
    const onAction = vi.fn();
    const r = report({
      recommendations: [
        {
          severity: 'critical',
          subsystem: 'slm',
          action: 'Re-descargar modelo',
        },
      ],
    });
    render(
      <ResilienceHealthDashboard
        report={r}
        onRecommendationAction={onAction}
      />,
    );
    const rec = screen.getByTestId('resilience-rec-slm-0');
    fireEvent.click(rec.querySelector('button')!);
    expect(onAction).toHaveBeenCalledWith('slm');
  });

  it('sin onRecommendationAction: botón disabled (no clickable)', () => {
    const r = report({
      recommendations: [
        { severity: 'warn', subsystem: 'firestore', action: 'Revisar config' },
      ],
    });
    render(<ResilienceHealthDashboard report={r} />);
    const btn = screen
      .getByTestId('resilience-rec-firestore-0')
      .querySelector('button');
    expect(btn).toBeDisabled();
  });

  it('hideTechnicalDetails: oculta footer + latencies + errors', () => {
    const r = report({
      subsystems: [
        sub('slm', 'unknown', { error: 'timeout', checkLatencyMs: 50 }),
        ...report().subsystems.slice(1),
      ],
    });
    render(
      <ResilienceHealthDashboard report={r} hideTechnicalDetails />,
    );
    expect(screen.queryByTestId('resilience-footer')).toBeNull();
    expect(screen.queryByTestId('resilience-subsystem-slm-latency')).toBeNull();
    expect(screen.queryByTestId('resilience-subsystem-slm-error')).toBeNull();
  });

  it('default: footer visible con generatedAt + totalLatencyMs', () => {
    render(
      <ResilienceHealthDashboard
        report={report({ generatedAt: '2026-05-14T15:30:45Z', totalLatencyMs: 423 })}
      />,
    );
    const footer = screen.getByTestId('resilience-footer');
    expect(footer).toHaveTextContent('2026-05-14 15:30:45');
    expect(footer).toHaveTextContent('423 ms');
  });

  it('subsystem detail + checkLatency visibles por defecto', () => {
    const r = report({
      subsystems: [
        sub('slm', 'healthy', {
          detail: 'SLM cacheado (483 MB)',
          checkLatencyMs: 25,
        }),
        ...report().subsystems.slice(1),
      ],
    });
    render(<ResilienceHealthDashboard report={r} />);
    const card = screen.getByTestId('resilience-subsystem-slm');
    expect(card).toHaveTextContent('SLM cacheado (483 MB)');
    expect(screen.getByTestId('resilience-subsystem-slm-latency')).toHaveTextContent(
      '25 ms',
    );
  });

  it('subsystem error visible solo cuando hideTechnical=false', () => {
    // Reemplazar el gemini default en lugar de duplicarlo.
    const base = report();
    const r = report({
      subsystems: base.subsystems.map((s) =>
        s.id === 'gemini'
          ? sub('gemini', 'unknown', { error: 'fetch failed' })
          : s,
      ),
    });
    render(<ResilienceHealthDashboard report={r} />);
    expect(
      screen.getByTestId('resilience-subsystem-gemini-error'),
    ).toHaveTextContent('fetch failed');
  });
});
