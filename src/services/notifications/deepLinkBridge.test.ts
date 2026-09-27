// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDeepLinkBridgeForTests,
  dispatchDeepLink,
  registerDeepLinkListener,
} from './deepLinkBridge';

describe('deep-link bridge cold-start buffer', () => {
  afterEach(() => {
    __resetDeepLinkBridgeForTests();
  });

  it('replays a deep link dispatched before the router handler mounts', () => {
    const listener = vi.fn();
    const detail = { url: '/emergencia-avanzada?alertId=a1', projectId: 'p1' };

    dispatchDeepLink(detail);
    expect(listener).not.toHaveBeenCalled();

    const remove = registerDeepLinkListener(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(detail);
    remove();
  });

  it('delivers events immediately while a router handler is mounted', () => {
    const listener = vi.fn();
    const remove = registerDeepLinkListener(listener);

    dispatchDeepLink({ url: '/notifications?source=push', projectId: null });

    expect(listener).toHaveBeenCalledWith({ url: '/notifications?source=push', projectId: null });
    remove();
  });

  it('bounds pending cold-start events instead of growing without limit', () => {
    for (let index = 0; index < 12; index += 1) {
      dispatchDeepLink({ url: `/notifications?event=${index}` });
    }

    const listener = vi.fn();
    const remove = registerDeepLinkListener(listener);

    expect(listener).toHaveBeenCalledTimes(8);
    expect(listener.mock.calls[0][0]).toEqual({ url: '/notifications?event=4' });
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({ url: '/notifications?event=11' });
    remove();
  });
});
