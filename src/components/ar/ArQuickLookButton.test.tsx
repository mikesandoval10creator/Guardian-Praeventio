// @vitest-environment jsdom
//
// ArQuickLookButton tests — Sprint 21 Ola 4 Bucket M.6 + P1 ticket
// 39baa66d-73fe-8125-aca4-eeb2e33e5f8a (verify USDZ magic bytes).
//
// Verifies:
//  • relList.supports('ar') === true + magic bytes match → renders <a rel="ar">
//  • relList.supports('ar') === true + magic bytes NOT match (text/empty) →
//    returns null. This is the safety ratchet: text "REPLACE WITH REAL .usdz"
//    placeholders must NOT trigger AR Quick Look on iOS.
//  • relList.supports('ar') === false → returns null (no DOM)
//  • onAvailable callback receives the detected boolean
//  • modelPath threadea correctamente al href
//  • <img> hijo siempre presente (Apple requirement)

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ArQuickLookButton } from './ArQuickLookButton';

beforeEach(() => {
  // Bucket EE.7: el componente hace GET con Range para verificar que el
  // archivo sea un USDZ válido (magic bytes PK\x03\x04). Mock por defecto:
  // 200 OK con body vacío — el componente debe rechazar el archivo y NO
  // renderizar el botón.
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

// USDZ files are ZIP archives containing USD — magic bytes PK\x03\x04.
const VALID_USDZ_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/** Helper para construir un Response con bytes USDZ válidos o texto placeholder. */
function usdzResponse(body: Uint8Array | string, status = 200): Response {
  const init: ResponseInit = { status, headers: { 'Content-Type': 'application/octet-stream' } };
  if (status === 204) {
    // 204 No Content → fetch treats as success but body is null.
    return new Response(null, init);
  }
  if (typeof body === 'string') {
    return new Response(body, init);
  }
  return new Response(body, init);
}

describe('ArQuickLookButton', () => {
  it('renders an <a rel="ar"> when relList.supports("ar") === true AND magic bytes match', async () => {
    mockArSupport(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => usdzResponse(VALID_USDZ_MAGIC)),
    );
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/extinguisher_pqs.usdz" />,
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => usdzResponse(VALID_USDZ_MAGIC)),
    );
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

  it('returns null when the .usdz probe fails (Bucket EE.7 fallback)', async () => {
    mockArSupport(true);
    // Override the default fetch mock with a 404.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const { container } = render(
      <ArQuickLookButton modelPath="/models/ar/missing_kind.usdz" />,
    );
    // Esperamos a que la promesa resuelva — sigue siendo null porque el GET falló.
    await waitFor(() => {
      // The component uses microtask state; confirm render is stable as null.
      expect(container.querySelector('a[rel="ar"]')).toBeNull();
    });
    expect(container.firstChild).toBeNull();
  });

  // P1 ticket 39baa66d-73fe-8125-aca4-eeb2e33e5f8a:
  // "La experiencia AR de iOS anuncia modelos que son archivos de texto
  // (.usdz placeholder)". El placeholder devuelve 200 OK con body de texto
  // "REPLACE WITH REAL .usdz". Antes del fix, el botón confiaba solo en el
  // status code y mostraba "Ver en AR" → iOS abría un archivo inválido.
  // Después del fix, el botón valida magic bytes ZIP (PK\x03\x04) y oculta
  // el affordance cuando el archivo no es un paquete USDZ real.
  describe('USDZ magic-bytes safety ratchet (P1 ticket)', () => {
    it('does NOT render the button when the response body is text (placeholder)', async () => {
      mockArSupport(true);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            '# REPLACE WITH REAL .usdz — Sprint 30 Bucket JJ placeholder.',
            { status: 200, headers: { 'Content-Type': 'text/plain' } },
          ),
        ),
      );
      const { container } = render(
        <ArQuickLookButton modelPath="/models/ar/aed.usdz" />,
      );
      await waitFor(() => {
        expect(container.querySelector('a[rel="ar"]')).toBeNull();
      });
      expect(container.firstChild).toBeNull();
    });

    it('does NOT render the button when the response body is empty (204 No Content)', async () => {
      mockArSupport(true);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 204 })),
      );
      const { container } = render(
        <ArQuickLookButton modelPath="/models/ar/aed.usdz" />,
      );
      await waitFor(() => {
        expect(container.querySelector('a[rel="ar"]')).toBeNull();
      });
      expect(container.firstChild).toBeNull();
    });

    it('does NOT render when magic bytes match a different format (e.g. PNG)', async () => {
      mockArSupport(true);
      // PNG magic bytes: 89 50 4E 47. Notably the first two bytes match
      // ZIP magic accidentally, but the third differs — verifies the full
      // 4-byte check rather than a partial match.
      const pngLike = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => usdzResponse(pngLike)),
      );
      const { container } = render(
        <ArQuickLookButton modelPath="/models/ar/aed.usdz" />,
      );
      await waitFor(() => {
        expect(container.querySelector('a[rel="ar"]')).toBeNull();
      });
    });

    it('does NOT render when only the first 2 bytes match ZIP (PK but no \\x03\\x04)', async () => {
      mockArSupport(true);
      // Only first two bytes (PK) match; third differs. The component must
      // require the full 4-byte magic.
      const partial = new Uint8Array([0x50, 0x4b, 0x00, 0x00]);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => usdzResponse(partial)),
      );
      const { container } = render(
        <ArQuickLookButton modelPath="/models/ar/aed.usdz" />,
      );
      await waitFor(() => {
        expect(container.querySelector('a[rel="ar"]')).toBeNull();
      });
    });

    it('sends a GET with Range 0-3 header (cheap probe, not full download)', async () => {
      mockArSupport(true);
      const fetchMock = vi.fn<typeof fetch>(
        async () => usdzResponse(VALID_USDZ_MAGIC) as unknown as Response,
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<ArQuickLookButton modelPath="/models/ar/aed.usdz" />);
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('/models/ar/aed.usdz');
      // Range header must be present to avoid downloading the full .usdz
      // (which can be tens of MB). Magic bytes are in the first 4 bytes.
      const headers = (calledInit?.headers as Record<string, string>) ?? {};
      expect(headers['Range'] ?? headers['range']).toBe('bytes=0-3');
    });
  });
});
