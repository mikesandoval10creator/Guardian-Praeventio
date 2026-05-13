// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// r3f Canvas requiere WebGL — mock para jsdom.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas-mock">{children}</div>
  ),
}));

// Rapier carga WASM al inicializar — mock para jsdom.
vi.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-physics-mock">{children}</div>
  ),
  RigidBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-rigidbody-mock">{children}</div>
  ),
}));

import { TwinPhysicsScene, type PhysicalObject } from './TwinPhysicsScene.js';

const SAMPLE: PhysicalObject[] = [
  { id: 'box-1', position: [0, 5, 0], color: '#14b8a6' },
  { id: 'box-2', position: [2, 8, 0], color: '#0ea5e9' },
];

describe('TwinPhysicsScene', () => {
  it('renderiza el container con scene testid', () => {
    render(<TwinPhysicsScene objects={SAMPLE} />);
    expect(screen.getByTestId('twin-physics.scene')).toBeInTheDocument();
  });

  it('activa Physics cuando physicsEnabled=true', () => {
    render(<TwinPhysicsScene objects={SAMPLE} physicsEnabled />);
    expect(screen.getByTestId('rapier-physics-mock')).toBeInTheDocument();
  });

  it('skip Physics cuando physicsEnabled=false', () => {
    render(<TwinPhysicsScene objects={SAMPLE} physicsEnabled={false} />);
    expect(screen.queryByTestId('rapier-physics-mock')).not.toBeInTheDocument();
  });

  it('lista vacía no rompe render', () => {
    render(<TwinPhysicsScene objects={[]} />);
    expect(screen.getByTestId('twin-physics.scene')).toBeInTheDocument();
  });

  it('appearance dark cambia className', () => {
    render(<TwinPhysicsScene objects={SAMPLE} appearance="dark" />);
    const scene = screen.getByTestId('twin-physics.scene');
    expect(scene.className).toMatch(/border-slate-700/);
  });
});
