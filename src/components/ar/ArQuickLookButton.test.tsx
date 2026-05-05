// @vitest-environment jsdom
//
// ArQuickLookButton tests — Sprint 21 Ola 4 Bucket M.6.
//
// Verifies:
//  • relList.supports('ar') === true → renders <a rel="ar"> with the model href
//  • relList.supports('ar') === false → returns null (no DOM)
//  • onAvailable callback receives the detected boolean
//  • modelPath threadea correctamente al href
//  • <img> hijo siempre presente (Apple requirement)

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ArQuickLookButton } from './ArQuickLookButton';

beforeEach(() => {
  // Bucket EE.7: el componente hace HEAD al modelPath para verificar
  // existencia del .usdz antes de renderizar. Mock por defecto: 200 OK.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Hace que `document.createElement('a').relList.supports` retorne el
 * `value` deseado. Otros tags (`'div'`, etc.) siguen el comportamiento
 * normal del jsdom.
 */
function mockArSupport(value: boolean) {
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      // jsdom tiene relList pero `supports` no es definitiva; redefinimos.
      Object.defineProperty(el, 'relList', {
        configurable: true,
        get() {
          return {
            supports: (token: string) => token === 'ar' && value,
            add: () => {},
            remove: () => {},
            toggle: () => false,
            contains: () => false,
            length: 0,
            value: '',
            item: () => null,
            replace: () => false,
            [Symbol.iterator]: function* () {},
          } as unknown as DOMTokenList;
        },
      });
    }
    return el;
  });
}

describe('ArQuickLookButton', () => {
  it('renders an <a rel="ar"> when relList.supports("ar") === true', async () => {
    mockArSupport(true);
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/extinguisher_pqs.usdz" />,
    );
    // El HEAD probe es asíncrono — esperamos a que la promesa resuelva.
    const anchor = await waitFor(() => {
      const a = container.querySelector('a[rel="ar"]');
      expect(a).not.toBeNull();
      return a;
    });
    expect(anchor?.getAttribute('href')).toBe('/models/ar/extinguisher_pqs.usdz');
  });

  it('returns null when relList.supports("ar") === false', () => {
    mockArSupport(false);
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/aed.usdz" />,
    );
    expect(container.querySelector('a[rel="ar"]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('invokes onAvailable with the detected capability boolean', () => {
    mockArSupport(true);
    const onAvailable = vi.fn();
    render(
      <ArQuickLookButton modelPath="/models/ar/hydrant.usdz" onAvailable={onAvailable} />,
    );
    expect(onAvailable).toHaveBeenCalledTimes(1);
    expect(onAvailable).toHaveBeenCalledWith(true);
  });

  it('invokes onAvailable(false) when capability missing', () => {
    mockArSupport(false);
    const onAvailable = vi.fn();
    render(
      <ArQuickLookButton modelPath="/models/ar/sign_warning.usdz" onAvailable={onAvailable} />,
    );
    expect(onAvailable).toHaveBeenCalledTimes(1);
    expect(onAvailable).toHaveBeenCalledWith(false);
  });

  it('always includes an <img> child (Apple Quick Look requirement)', async () => {
    mockArSupport(true);
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/aed.usdz" label="Open" />,
    );
    const anchor = await waitFor(() => {
      const a = container.querySelector('a[rel="ar"]');
      expect(a).not.toBeNull();
      return a;
    });
    const img = anchor?.querySelector('img');
    expect(img).not.toBeNull();
    // label visible
    expect(anchor?.textContent).toContain('Open');
  });

  it('returns null when the .usdz HEAD probe fails (Bucket EE.7 fallback)', async () => {
    mockArSupport(true);
    // Override the default fetch mock with a 404.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/missing_kind.usdz" />,
    );
    // Esperamos a que la promesa resuelva — sigue siendo null porque el HEAD falló.
    await waitFor(() => {
      // The component uses microtask state; confirm render is stable as null.
      expect(container.querySelector('a[rel="ar"]')).toBeNull();
    });
    expect(container.firstChild).toBeNull();
  });
});
