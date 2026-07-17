// @vitest-environment jsdom
//
// Sprint 21 — Bucket G: deep-link handler bridge tests.
//
// We mock `react-router-dom`'s `useNavigate` so we can assert the spy
// was invoked with the expected path. This avoids needing a full router
// tree (and the location/history plumbing that goes with it) just to
// observe the navigate side effect.
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
}));

import { DeepLinkHandler, DEEP_LINK_EVENT_NAME } from './DeepLinkHandler';

afterEach(() => {
  cleanup();
  navigateSpy.mockReset();
});

function dispatchDeepLink(url: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(DEEP_LINK_EVENT_NAME, { detail: { url } }),
    );
  });
}

describe('DeepLinkHandler', () => {
  it('navigates to a simple slug when a deep-link event fires', () => {
    render(<DeepLinkHandler />);
    dispatchDeepLink('/sos');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/sos');
  });

  it('preserves query parameters from the slug', () => {
    render(<DeepLinkHandler />);
    dispatchDeepLink('/sos?lat=-33.4&lng=-70.6');
    expect(navigateSpy).toHaveBeenCalledWith('/sos?lat=-33.4&lng=-70.6');
  });

  it('strips https origin and navigates to the in-app path only', () => {
    render(<DeepLinkHandler />);
    dispatchDeepLink('https://praeventio.app/projects/abc?ref=email');
    expect(navigateSpy).toHaveBeenCalledWith('/projects/abc?ref=email');
  });

  it('removes the event listener on unmount', () => {
    const { unmount } = render(<DeepLinkHandler />);
    unmount();
    dispatchDeepLink('/sos');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores events with empty or missing url detail', () => {
    render(<DeepLinkHandler />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DEEP_LINK_EVENT_NAME, { detail: { url: '' } }),
      );
      window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT_NAME));
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  describe('service worker message bridge (web push tap)', () => {
    // Give jsdom a minimal `navigator.serviceWorker` EventTarget so the
    // component's message listener can attach and receive dispatches.
    let swTarget: EventTarget;
    let originalSw: PropertyDescriptor | undefined;

    beforeEach(() => {
      swTarget = new EventTarget();
      originalSw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: swTarget,
      });
    });

    afterEach(() => {
      // Unmount components (removing their SW listener from the current
      // swTarget) BEFORE restoring the property, so removal targets the right
      // object.
      cleanup();
      if (originalSw) {
        Object.defineProperty(navigator, 'serviceWorker', originalSw);
      } else {
        delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
      }
    });

    function postFromSw(data: unknown) {
      act(() => {
        swTarget.dispatchEvent(
          Object.assign(new Event('message'), { data }) as MessageEvent,
        );
      });
    }

    it('navigates when the SW posts a deep-link message', () => {
      render(<DeepLinkHandler />);
      postFromSw({ type: DEEP_LINK_EVENT_NAME, url: '/emergency?alertId=a1&source=push' });
      expect(navigateSpy).toHaveBeenCalledWith('/emergency?alertId=a1&source=push');
    });

    it('strips an absolute origin from an SW message url', () => {
      render(<DeepLinkHandler />);
      postFromSw({ type: DEEP_LINK_EVENT_NAME, url: 'https://praeventio.app/notifications' });
      expect(navigateSpy).toHaveBeenCalledWith('/notifications');
    });

    it('ignores SW messages of other types or without a url', () => {
      render(<DeepLinkHandler />);
      postFromSw({ type: 'something-else', url: '/emergency' });
      postFromSw({ type: DEEP_LINK_EVENT_NAME });
      postFromSw(undefined);
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('removes the SW message listener on unmount', () => {
      const { unmount } = render(<DeepLinkHandler />);
      unmount();
      postFromSw({ type: DEEP_LINK_EVENT_NAME, url: '/emergency' });
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
});
