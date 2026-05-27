// @vitest-environment jsdom
//
// Sprint 39 wire #3.4 — refactor: ZoneEntryGate ya no "bloquea". Es un
// modal informativo que SIEMPRE deja al worker proceder; el sistema sólo
// recomienda + logea. Tests verifican exactamente esa propiedad.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneEntryGate } from './ZoneEntryGate';
import type {
  RestrictedZone,
  ZoneEntryCheckInput,
} from '../../services/zones/restrictedZonesEngine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T10:00:00Z');

const zone: RestrictedZone = {
  id: 'z1',
  kind: 'confined',
  name: 'Estanque B',
  activeFrom: '2026-05-12T00:00:00Z',
  rules: {
    requiredEpp: ['arnés', 'mascara_aire'],
    requiredTrainings: ['confined_space'],
    requiresPermit: true,
    responsibleUid: 'sup1',
  },
};

function input(over: Partial<ZoneEntryCheckInput> = {}): ZoneEntryCheckInput {
  return {
    workerUid: 'w1',
    workerEppLabels: [],
    workerTrainings: [],
    workerActivePermitKinds: [],
    zone,
    now: NOW,
    ...over,
  };
}

describe('<ZoneEntryGate /> — informed-entry modal (founder directive: never block)', () => {
  it('no se renderiza cuando open=false', () => {
    render(
      <ZoneEntryGate open={false} input={input()} onAcknowledge={() => undefined} />,
    );
    expect(screen.queryByTestId('zone-gate-z1')).not.toBeInTheDocument();
  });

  it('muestra requisitos pendientes cuando faltan EPP/training/permit', () => {
    render(
      <ZoneEntryGate open input={input()} onAcknowledge={() => undefined} />,
    );
    expect(screen.getByTestId('zone-gate-z1')).toBeInTheDocument();
    expect(
      screen.getByTestId('zone-gate-status-z1').textContent,
    ).toContain('pendientes');
    expect(screen.getByTestId('zone-gate-missing-z1')).toBeInTheDocument();
  });

  it('muestra estado "Cumple requisitos" cuando se satisfacen todos', () => {
    render(
      <ZoneEntryGate
        open
        input={input({
          workerEppLabels: ['arnés', 'mascara_aire'],
          workerTrainings: ['confined_space'],
          workerActivePermitKinds: ['confinado'],
        })}
        onAcknowledge={() => undefined}
      />,
    );
    expect(
      screen.getByTestId('zone-gate-status-z1').textContent,
    ).toContain('Cumple');
  });

  it('el botón "Comprendo el riesgo y entro" SIEMPRE está habilitado, incluso con requisitos faltantes', () => {
    render(
      <ZoneEntryGate open input={input()} onAcknowledge={() => undefined} />,
    );
    const btn = screen.getByTestId('zone-gate-ack');
    // Directiva no-bloqueo: nunca disabled.
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toContain('Comprendo el riesgo');
  });

  it('al confirmar, dispara onAcknowledge con el resultado del motor (incluye missing)', () => {
    const onAck = vi.fn();
    render(
      <ZoneEntryGate open input={input()} onAcknowledge={onAck} />,
    );
    fireEvent.click(screen.getByTestId('zone-gate-ack'));
    expect(onAck).toHaveBeenCalledTimes(1);
    const arg = onAck.mock.calls[0]![0];
    expect(arg.allowed).toBe(false);
    expect(arg.missing.length).toBeGreaterThan(0);
  });

  it('onCancel se dispara al hacer click en "Volver" o en backdrop', () => {
    const onCancel = vi.fn();
    render(
      <ZoneEntryGate
        open
        input={input()}
        onAcknowledge={() => undefined}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('zone-gate-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
