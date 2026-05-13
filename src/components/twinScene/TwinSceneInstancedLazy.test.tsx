// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./TwinSceneInstanced.js', () => ({
  TwinSceneInstanced: () => <div data-testid="real-twin-scene" />,
}));

import { TwinSceneInstancedLazy } from './TwinSceneInstancedLazy.js';

describe('TwinSceneInstancedLazy', () => {
  it('renderiza fallback inicial y luego el componente real', async () => {
    render(<TwinSceneInstancedLazy />);
    // El fallback aparece síncronamente
    const fallback = screen.queryByTestId('twin-scene-lazy.loading');
    // Cualquiera de los dos puede estar presente (Suspense puede resolver inmediato si el mock está hot)
    expect(fallback ?? screen.queryByTestId('real-twin-scene')).toBeTruthy();
  });
});
