// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EquipmentStatusCard } from './EquipmentStatusCard.js';
import type { Equipment } from '../../services/equipment/equipmentQrService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function eq(over: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq1',
    code: 'GH-014',
    type: 'gruahorquilla',
    brand: 'Toyota',
    model: '8FBE15',
    status: 'operativo',
    criticality: 'high',
    riskCategories: ['izaje', 'transporte'],
    requiresPreUseChecklist: true,
    ...over,
  };
}

describe('<EquipmentStatusCard />', () => {
  it('renderiza estado operativo y criticidad', () => {
    render(<EquipmentStatusCard equipment={eq()} />);
    expect(screen.getByTestId('equipment-card-eq1')).toBeInTheDocument();
    expect(screen.getByTestId('equipment-status-eq1').textContent).toBe('OPERATIVO');
    expect(screen.getByTestId('equipment-criticality-eq1').textContent).toBe('high');
  });

  it('muestra prompt pre-uso si operativo + required', () => {
    render(<EquipmentStatusCard equipment={eq()} />);
    expect(screen.getByTestId('equipment-preuse-required-eq1')).toBeInTheDocument();
  });

  it('oculta pre-uso si fuera de servicio', () => {
    render(<EquipmentStatusCard equipment={eq({ status: 'fuera_servicio' })} />);
    expect(screen.queryByTestId('equipment-preuse-required-eq1')).toBeNull();
  });

  it('dispara onScanQr', () => {
    const onScan = vi.fn();
    render(<EquipmentStatusCard equipment={eq()} onScanQr={onScan} />);
    fireEvent.click(screen.getByTestId('equipment-scan-eq1'));
    expect(onScan).toHaveBeenCalled();
  });
});
