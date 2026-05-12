// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WasteInventoryPanel } from './WasteInventoryPanel.js';
import type {
  WasteRecord,
  WasteManifest,
  EnvironmentalPermit,
} from '../../services/environmental/environmentalCompliance.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function waste(over: Partial<WasteRecord> & { id: string }): WasteRecord {
  return {
    id: over.id,
    kind: over.kind ?? 'hazardous',
    description: 'd',
    quantityKg: 10,
    generatedAt: '2026-05-11T10:00:00Z',
    storageLocation: 'b1',
    manifestId: over.manifestId,
  };
}

describe('<WasteInventoryPanel />', () => {
  it('renderiza inventario por tipo', () => {
    render(
      <WasteInventoryPanel
        wastes={[
          waste({ id: 'w1', kind: 'hazardous' }),
          waste({ id: 'w2', kind: 'recyclable' }),
        ]}
        pendingManifests={[]}
        permits={[]}
      />,
    );
    expect(screen.getByTestId('waste-kind-hazardous')).toBeInTheDocument();
    expect(screen.getByTestId('waste-kind-recyclable')).toBeInTheDocument();
  });

  it('muestra manifests pendientes', () => {
    const m: WasteManifest = {
      id: 'M-1',
      wasteIds: ['w1'],
      transporterId: 'T',
      receiverId: 'R',
      dispatchedAt: '2026-05-10T10:00:00Z',
      hasDiscrepancy: false,
    };
    render(
      <WasteInventoryPanel wastes={[]} pendingManifests={[m]} permits={[]} />,
    );
    expect(screen.getByTestId('waste-pending-manifests')).toBeInTheDocument();
  });

  it('muestra permisos próximos a vencer', () => {
    const p: EnvironmentalPermit = {
      id: 'p1',
      kind: 'RCA',
      issuedAt: '2024-01-01',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      reference: 'r1',
    };
    render(
      <WasteInventoryPanel wastes={[]} pendingManifests={[]} permits={[p]} />,
    );
    expect(screen.getByTestId('waste-expiring-permits')).toBeInTheDocument();
    expect(screen.getByTestId('waste-permit-p1')).toBeInTheDocument();
  });

  it('panel sin alertas si todo OK', () => {
    render(<WasteInventoryPanel wastes={[]} pendingManifests={[]} permits={[]} />);
    expect(screen.queryByTestId('waste-pending-manifests')).toBeNull();
    expect(screen.queryByTestId('waste-expiring-permits')).toBeNull();
  });
});
