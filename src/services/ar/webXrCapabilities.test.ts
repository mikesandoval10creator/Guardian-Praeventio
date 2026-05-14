import { describe, it, expect } from 'vitest';
import {
  detectArCapabilities,
  buildSessionRequest,
  type ArCapabilities,
} from './webXrCapabilities.js';

function mockGlobalWithNav(navOverrides: Record<string, any>): typeof globalThis {
  return { navigator: navOverrides } as unknown as typeof globalThis;
}

describe('detectArCapabilities', () => {
  it('sin navigator: todo false + strategy=none', async () => {
    const caps = await detectArCapabilities({} as typeof globalThis);
    expect(caps.hasWebXr).toBe(false);
    expect(caps.supportsImmersiveAr).toBe(false);
    expect(caps.recommendedStrategy).toBe('none');
  });

  it('navigator sin xr: strategy=none (no iOS)', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({ userAgent: 'Mozilla/5.0 (X11; Linux)' }),
    );
    expect(caps.hasWebXr).toBe(false);
    expect(caps.recommendedStrategy).toBe('none');
  });

  it('iOS Safari sin xr: strategy=ios-quick-look', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
      }),
    );
    expect(caps.hasWebXr).toBe(false);
    expect(caps.isLikelyIosSafari).toBe(true);
    expect(caps.recommendedStrategy).toBe('ios-quick-look');
  });

  it('iPad en iOS 17 (MacIntel platform): detectado como iOS Safari', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    );
    expect(caps.isLikelyIosSafari).toBe(true);
  });

  it('Chrome iOS NO se considera iOS Safari (Quick Look no aplica)', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
      }),
    );
    // UA dice CriOS → NO es Safari → no Quick Look
    expect(caps.isLikelyIosSafari).toBe(false);
  });

  it('Android Chrome con WebXR + immersive-ar soportado: strategy=webxr-full', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
        xr: {
          isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        },
      }),
    );
    expect(caps.hasWebXr).toBe(true);
    expect(caps.supportsImmersiveAr).toBe(true);
    expect(caps.supportsHitTest).toBe(true);
    expect(caps.recommendedStrategy).toBe('webxr-full');
  });

  it('WebXR sin immersive-ar (solo VR): strategy=none', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        xr: {
          isSessionSupported: async (mode: string) => mode === 'immersive-vr',
        },
      }),
    );
    expect(caps.hasWebXr).toBe(true);
    expect(caps.supportsImmersiveAr).toBe(false);
    expect(caps.recommendedStrategy).toBe('none');
  });

  it('xr.isSessionSupported lanza: tratar como NO soportado', async () => {
    const caps = await detectArCapabilities(
      mockGlobalWithNav({
        userAgent: 'whatever',
        xr: {
          isSessionSupported: async () => {
            throw new Error('mode not understood');
          },
        },
      }),
    );
    expect(caps.supportsImmersiveAr).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildSessionRequest
// ────────────────────────────────────────────────────────────────────────

const fullCaps: ArCapabilities = {
  hasWebXr: true,
  supportsImmersiveAr: true,
  supportsHitTest: true,
  supportsAnchors: true,
  supportsDomOverlay: true,
  supportsLightEstimation: true,
  isLikelyIosSafari: false,
  recommendedStrategy: 'webxr-full',
};

describe('buildSessionRequest', () => {
  it('full caps + sin extras: hit-test required + dom-overlay optional', () => {
    const req = buildSessionRequest({ caps: fullCaps });
    expect(req.mode).toBe('immersive-ar');
    expect(req.requiredFeatures).toContain('hit-test');
    expect(req.optionalFeatures).toContain('dom-overlay');
    expect(req.optionalFeatures).toContain('local-floor');
  });

  it('full caps + domOverlayRoot: dom-overlay sube a required', () => {
    const dummyEl = { tagName: 'DIV' } as unknown as HTMLElement;
    const req = buildSessionRequest({
      caps: fullCaps,
      domOverlayRoot: dummyEl,
    });
    expect(req.requiredFeatures).toContain('dom-overlay');
    expect(req.domOverlayRoot).toBe(dummyEl);
  });

  it('needsAnchors=true: anchors va a required', () => {
    const req = buildSessionRequest({ caps: fullCaps, needsAnchors: true });
    expect(req.requiredFeatures).toContain('anchors');
  });

  it('needsLightEstimation=true: queda en optional (nunca required)', () => {
    const req = buildSessionRequest({
      caps: fullCaps,
      needsLightEstimation: true,
    });
    expect(req.requiredFeatures).not.toContain('light-estimation');
    expect(req.optionalFeatures).toContain('light-estimation');
  });

  it('caps sin hit-test: hit-test cae a optional, NO required', () => {
    const req = buildSessionRequest({
      caps: { ...fullCaps, supportsHitTest: false },
    });
    expect(req.requiredFeatures).not.toContain('hit-test');
    expect(req.optionalFeatures).toContain('hit-test');
  });

  it('caps sin anchors + needsAnchors=true: anchors cae a optional (no rompe el request)', () => {
    const req = buildSessionRequest({
      caps: { ...fullCaps, supportsAnchors: false },
      needsAnchors: true,
    });
    expect(req.requiredFeatures).not.toContain('anchors');
    expect(req.optionalFeatures).toContain('anchors');
  });
});
