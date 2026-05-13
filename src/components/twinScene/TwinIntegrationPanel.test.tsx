// @vitest-environment jsdom
//
// Sprint 48 E.2 — Test enfocado en READOUT HUD (DOM derivado de cálculos
// matemáticos: COG cargo, thermal steady-state, severidad). El renderer
// r3f real no aporta aquí porque las aserciones son sobre `data-testid`
// del footer plain-React, no sobre Three.js. Mantiene mocks ligeros del
// stack r3f para que el component padre se monte sin WebGL.
//
// El scene graph 3D que ESTE panel genera indirectamente se cubre por
// sceneGraph.r3f.test.tsx (que testea WorkersByStatus + EquipmentRenderer
// con test-renderer real).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
vi.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-physics">{children}</div>
  ),
  RigidBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@react-three/drei', () => ({
  Detailed: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Instances: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Instance: () => <div />,
  OrbitControls: () => <div />,
}));

import { TwinIntegrationPanel } from './TwinIntegrationPanel.js';

describe('TwinIntegrationPanel', () => {
  it('readout default: sin cargo + sin térmico', () => {
    render(<TwinIntegrationPanel />);
    expect(screen.getByTestId('twin-integration.cog')).toHaveTextContent('sin cargo');
    expect(screen.getByTestId('twin-integration.thermal')).toHaveTextContent(
      'sin telemetría térmica',
    );
    expect(screen.getByTestId('twin-integration.physics')).toHaveTextContent('off');
  });

  it('calcula COG cuando hay cargo', () => {
    render(
      <TwinIntegrationPanel
        placedCargo={[
          { item: { id: 'a', dimensions: { x: 2, y: 2, z: 2 }, mass: 100 }, position: { x: 0, y: 0, z: 0 } },
          { item: { id: 'b', dimensions: { x: 2, y: 2, z: 2 }, mass: 100 }, position: { x: 4, y: 0, z: 0 } },
        ]}
      />,
    );
    const cog = screen.getByTestId('twin-integration.cog');
    // Centroide A=(1,1,1) mass 100; B=(5,1,1) mass 100 → cog (3,1,1)
    expect(cog).toHaveTextContent(/COG \(3\.0, 1\.0, 1\.0\)/);
  });

  it('calcula heatField desde HVAC steady-state — temperatura normal sin alerta', () => {
    render(
      <TwinIntegrationPanel
        thermal={{
          zone: { thermalCapacityJperK: 100_000, thermalResistanceKperW: 0.01 },
          driver: { ambientC: 22, internalGainW: 200, hvacW: 0 },
          zoneCenter: [0, 1, 0],
        }}
      />,
    );
    // T_ss = 22 + 0.01 * 200 = 24 → debajo del alert 28
    const t = screen.getByTestId('twin-integration.thermal');
    expect(t).toHaveTextContent(/24\.0°C/);
    expect(t).toHaveTextContent(/sev 0%/);
  });

  it('temperatura crítica produce severidad alta', () => {
    render(
      <TwinIntegrationPanel
        thermal={{
          zone: { thermalCapacityJperK: 100_000, thermalResistanceKperW: 0.02 },
          driver: { ambientC: 30, internalGainW: 300, hvacW: 0 },
          zoneCenter: [0, 1, 0],
          alertThresholdC: 28,
          criticalThresholdC: 35,
        }}
      />,
    );
    // T_ss = 30 + 0.02*300 = 36 → sobre critical → sev 100%
    const t = screen.getByTestId('twin-integration.thermal');
    expect(t).toHaveTextContent(/36\.0°C/);
    expect(t).toHaveTextContent(/sev 100%/);
  });

  it('respeta thresholds custom', () => {
    render(
      <TwinIntegrationPanel
        thermal={{
          zone: { thermalCapacityJperK: 100_000, thermalResistanceKperW: 0.01 },
          driver: { ambientC: 25, internalGainW: 100, hvacW: 0 },
          zoneCenter: [0, 1, 0],
          alertThresholdC: 20,
          criticalThresholdC: 30,
        }}
      />,
    );
    // T_ss = 26 → entre 20 y 30 → severidad parcial
    const t = screen.getByTestId('twin-integration.thermal');
    expect(t).toHaveTextContent(/26\.0°C/);
    // Map: (26-20)/(30-20) * 0.7 + 0.2 = 0.62 → sev 62%
    expect(t).toHaveTextContent(/sev 62%/);
  });

  it('physics on aparece en readout', () => {
    render(<TwinIntegrationPanel physicsEnabled />);
    expect(screen.getByTestId('twin-integration.physics')).toHaveTextContent('on');
  });
});
