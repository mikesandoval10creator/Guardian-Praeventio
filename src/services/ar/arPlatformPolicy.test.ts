import { describe, it, expect } from 'vitest';
import {
  decideArMode,
  parsePlatformFromUserAgent,
  type ArPlatformCapabilities,
} from './arPlatformPolicy.js';

function caps(over: Partial<ArPlatformCapabilities> = {}): ArPlatformCapabilities {
  return {
    isIos: false,
    isAndroid: false,
    hasXrApi: false,
    supportsImmersiveAr: false,
    hasHitTest: false,
    hasCamera: true,
    isMobile: true,
    ...over,
  };
}

describe('decideArMode', () => {
  it('iOS → arkit_quick_look siempre', () => {
    const d = decideArMode(caps({ isIos: true, hasXrApi: false }));
    expect(d.mode).toBe('arkit_quick_look');
    expect(d.features.hitTest).toBe(true);
    expect(d.features.persistentAnchors).toBe(false);
  });

  it('iOS aún con WebXR mock NO usa WebXR (Apple promueve Quick Look)', () => {
    const d = decideArMode(
      caps({ isIos: true, hasXrApi: true, supportsImmersiveAr: true }),
    );
    expect(d.mode).toBe('arkit_quick_look');
  });

  it('Android con WebXR → webxr_immersive_ar', () => {
    const d = decideArMode(
      caps({
        isAndroid: true,
        hasXrApi: true,
        supportsImmersiveAr: true,
        hasHitTest: true,
      }),
    );
    expect(d.mode).toBe('webxr_immersive_ar');
    expect(d.features.hitTest).toBe(true);
    expect(d.features.anchors).toBe(true);
    expect(d.features.persistentAnchors).toBe(true);
  });

  it('Android sin WebXR pero con cámara → fallback_2d', () => {
    const d = decideArMode(caps({ isAndroid: true, hasCamera: true, isMobile: true }));
    expect(d.mode).toBe('fallback_2d');
    expect(d.features.persistentAnchors).toBe(false);
  });

  it('Desktop sin cámara → unsupported', () => {
    const d = decideArMode(caps({ isMobile: false, hasCamera: false }));
    expect(d.mode).toBe('unsupported');
  });

  it('rationale incluido en todas las decisiones', () => {
    const modes = [
      decideArMode(caps({ isIos: true })),
      decideArMode(caps({ isAndroid: true, hasXrApi: true, supportsImmersiveAr: true })),
      decideArMode(caps({ isMobile: false, hasCamera: false })),
    ];
    for (const d of modes) {
      expect(d.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe('parsePlatformFromUserAgent', () => {
  it('detecta iPhone Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const p = parsePlatformFromUserAgent(ua);
    expect(p.isIos).toBe(true);
    expect(p.isAndroid).toBe(false);
    expect(p.isMobile).toBe(true);
  });

  it('detecta Android Chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    const p = parsePlatformFromUserAgent(ua);
    expect(p.isAndroid).toBe(true);
    expect(p.isIos).toBe(false);
    expect(p.isMobile).toBe(true);
  });

  it('detecta desktop Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const p = parsePlatformFromUserAgent(ua);
    expect(p.isAndroid).toBe(false);
    expect(p.isIos).toBe(false);
    expect(p.isMobile).toBe(false);
  });

  it('detecta tablet Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-T970) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Tablet';
    const p = parsePlatformFromUserAgent(ua);
    expect(p.isAndroid).toBe(true);
    expect(p.isMobile).toBe(true);
  });
});
