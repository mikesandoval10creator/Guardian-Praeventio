// @vitest-environment jsdom
//
// ArViewLink tests — Sprint 30 Bucket JJ.
//
// Cubre:
//  1. iOS UA → renderiza ArQuickLookButton con href `.usdz` correcto.
//  2. Android UA → renderiza `<a>` Scene Viewer intent://.
//  3. Desktop UA → null + invoca onUnsupported.
//  4. Click handler en Android no rompe (intent:// navega nativamente).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ArViewLink, buildSceneViewerHref, isIosUserAgent } from './ArViewLink';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/119.0';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0';

beforeEach(() => {
  // The iOS branch delegates to ArQuickLookButton which does a HEAD probe.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));

  // Force ArQuickLookButton to think it supports AR (jsdom relList.supports
  // returns false by default).
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'relList', {
        configurable: true,
        get() {
          return {
            supports: (token: string) => token === 'ar',
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ArViewLink', () => {
  it('renders ArQuickLookButton (.usdz) when UA is iPhone', async () => {
    const { container } = render(
      <ArViewLink kind="extinguisher_pqs" userAgentOverride={IOS_UA} />,
    );
    const a = await waitFor(() => {
      const el = container.querySelector('a[rel="ar"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(a?.getAttribute('href')).toBe('/models/ar/extinguisher_pqs.usdz');
  });

  it('also matches iPad UA (universal apple regex)', async () => {
    expect(isIosUserAgent(IPAD_UA)).toBe(true);
    const { container } = render(
      <ArViewLink kind="aed" userAgentOverride={IPAD_UA} />,
    );
    await waitFor(() => {
      expect(container.querySelector('a[rel="ar"]')).not.toBeNull();
    });
  });

  it('renders Scene Viewer intent:// link on Android', () => {
    const { container } = render(
      <ArViewLink kind="hydrant" userAgentOverride={ANDROID_UA} />,
    );
    const a = container.querySelector('a[data-ar-scene-viewer]');
    expect(a).not.toBeNull();
    const href = a?.getAttribute('href') ?? '';
    expect(href.startsWith('intent://arvr.google.com/scene-viewer/1.0')).toBe(true);
    // .glb encoded into the intent
    expect(href).toContain('hydrant.glb');
    expect(href).toContain('mode=ar_only');
    expect(href).toContain('S.browser_fallback_url=');
  });

  it('returns null and fires onUnsupported on desktop', () => {
    const onUnsupported = vi.fn();
    const { container } = render(
      <ArViewLink
        kind="first_aid_kit"
        userAgentOverride={DESKTOP_UA}
        onUnsupported={onUnsupported}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(onUnsupported).toHaveBeenCalledTimes(1);
  });

  it('Android link is clickable (no internal handler that throws)', () => {
    const { container } = render(
      <ArViewLink kind="extinguisher_co2" userAgentOverride={ANDROID_UA} />,
    );
    const a = container.querySelector('a[data-ar-scene-viewer]') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    // jsdom won't navigate, but the click should not throw and the default
    // is preventable just like a normal anchor.
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(a, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('buildSceneViewerHref encodes the .glb URL inside the intent', () => {
    const href = buildSceneViewerHref('aed', 'https://praeventio.app');
    expect(href).toContain(encodeURIComponent('https://praeventio.app/models/aed.glb'));
    expect(href).toContain('package=com.google.android.googlequicksearchbox');
  });
});
