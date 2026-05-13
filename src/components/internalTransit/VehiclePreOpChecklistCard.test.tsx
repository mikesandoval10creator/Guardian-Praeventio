// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  VehiclePreOpChecklistCard,
  UncontrolledVehiclePreOpChecklist,
} from './VehiclePreOpChecklistCard.js';
import type { PreOpResponse } from '../../services/internalTransit/internalTransitService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<VehiclePreOpChecklistCard />', () => {
  it('renderiza checklist según vehicleKind', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[]}
        onChangeResponse={() => undefined}
      />,
    );
    // camioneta tiene: frenos, luces, cinturon, kit_emergencia, neumaticos
    expect(screen.getByTestId('preop-item-frenos')).toBeInTheDocument();
    expect(screen.getByTestId('preop-item-luces')).toBeInTheDocument();
    expect(screen.getByTestId('preop-item-cinturon')).toBeInTheDocument();
    expect(screen.getByTestId('preop-item-kit_emergencia')).toBeInTheDocument();
    expect(screen.getByTestId('preop-item-neumaticos')).toBeInTheDocument();
  });

  it('grua_movil muestra items específicos (anemómetro)', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="grua_movil"
        responses={[]}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-item-anemometro')).toBeInTheDocument();
    expect(screen.getByTestId('preop-item-tabla_cargas')).toBeInTheDocument();
  });

  it('item sin respuesta → state pending', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[]}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-item-frenos')).toHaveAttribute('data-state', 'pending');
  });

  it('click pass dispara onChangeResponse con passed=true', () => {
    const onChange = vi.fn();
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[]}
        onChangeResponse={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('preop-item-frenos-pass'));
    expect(onChange).toHaveBeenCalledWith({ itemId: 'frenos', passed: true });
  });

  it('click fail dispara onChangeResponse con passed=false', () => {
    const onChange = vi.fn();
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[]}
        onChangeResponse={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('preop-item-frenos-fail'));
    expect(onChange).toHaveBeenCalledWith({ itemId: 'frenos', passed: false });
  });

  it('item con respuesta passed → data-state="pass"', () => {
    const responses: PreOpResponse[] = [{ itemId: 'frenos', passed: true }];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={responses}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-item-frenos')).toHaveAttribute('data-state', 'pass');
  });

  it('item con respuesta failed → data-state="fail"', () => {
    const responses: PreOpResponse[] = [{ itemId: 'frenos', passed: false }];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={responses}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-item-frenos')).toHaveAttribute('data-state', 'fail');
  });

  it('live status: bloqueante fallido → badge "blocked"', () => {
    const responses: PreOpResponse[] = [{ itemId: 'frenos', passed: false }];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={responses}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-live-status')).toHaveAttribute('data-state', 'blocked');
  });

  it('live status: solo no-bloqueante fallido → badge "warning"', () => {
    // camioneta tiene kit_emergencia como NON-blocking.
    const allItems = [
      { itemId: 'frenos', passed: true },
      { itemId: 'luces', passed: true },
      { itemId: 'cinturon', passed: true },
      { itemId: 'neumaticos', passed: true },
      { itemId: 'kit_emergencia', passed: false }, // no bloqueante
    ];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={allItems}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-live-status')).toHaveAttribute('data-state', 'warning');
  });

  it('todos pasan → badge "pass"', () => {
    const allItems = [
      { itemId: 'frenos', passed: true },
      { itemId: 'luces', passed: true },
      { itemId: 'cinturon', passed: true },
      { itemId: 'neumaticos', passed: true },
      { itemId: 'kit_emergencia', passed: true },
    ];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={allItems}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-live-status')).toHaveAttribute('data-state', 'pass');
  });

  it('submit button disabled si quedan items pendientes', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[{ itemId: 'frenos', passed: true }]}
        onChangeResponse={() => undefined}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('preop-submit')).toBeDisabled();
    expect(screen.getByTestId('preop-pending-count')).toHaveTextContent('4');
  });

  it('submit dispara con result + responses cuando todo OK', () => {
    const onSubmit = vi.fn();
    const allItems = [
      { itemId: 'frenos', passed: true },
      { itemId: 'luces', passed: true },
      { itemId: 'cinturon', passed: true },
      { itemId: 'neumaticos', passed: true },
      { itemId: 'kit_emergencia', passed: true },
    ];
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={allItems}
        onChangeResponse={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('preop-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [result, resps] = onSubmit.mock.calls[0];
    expect(result.passed).toBe(true);
    expect(result.blockingFailures).toEqual([]);
    expect(resps).toHaveLength(5);
  });

  it('readOnly: no botones pass/fail/submit', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[{ itemId: 'frenos', passed: true }]}
        onChangeResponse={() => undefined}
        onSubmit={vi.fn()}
        readOnly
      />,
    );
    expect(screen.queryByTestId('preop-item-frenos-pass')).toBeNull();
    expect(screen.queryByTestId('preop-item-frenos-fail')).toBeNull();
    expect(screen.queryByTestId('preop-submit')).toBeNull();
  });

  it('item bloqueante muestra marcador visible', () => {
    render(
      <VehiclePreOpChecklistCard
        vehicleKind="camioneta"
        responses={[]}
        onChangeResponse={() => undefined}
      />,
    );
    expect(screen.getByTestId('preop-item-frenos-blocking')).toBeInTheDocument();
    // kit_emergencia es no-bloqueante
    expect(screen.queryByTestId('preop-item-kit_emergencia-blocking')).toBeNull();
  });
});

describe('<UncontrolledVehiclePreOpChecklist />', () => {
  it('actualiza estado interno al click pass/fail', () => {
    const onSubmit = vi.fn();
    render(<UncontrolledVehiclePreOpChecklist vehicleKind="camioneta" onSubmit={onSubmit} />);
    // Marca todos los items como pass
    fireEvent.click(screen.getByTestId('preop-item-frenos-pass'));
    fireEvent.click(screen.getByTestId('preop-item-luces-pass'));
    fireEvent.click(screen.getByTestId('preop-item-cinturon-pass'));
    fireEvent.click(screen.getByTestId('preop-item-neumaticos-pass'));
    fireEvent.click(screen.getByTestId('preop-item-kit_emergencia-pass'));
    // Ahora el submit button está enabled
    expect(screen.getByTestId('preop-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('preop-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1]).toHaveLength(5);
  });

  it('cambiar la misma respuesta no agrega duplicados', () => {
    render(<UncontrolledVehiclePreOpChecklist vehicleKind="camioneta" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('preop-item-frenos-pass'));
    fireEvent.click(screen.getByTestId('preop-item-frenos-fail'));
    // El último click queda registrado
    expect(screen.getByTestId('preop-item-frenos')).toHaveAttribute('data-state', 'fail');
  });
});
