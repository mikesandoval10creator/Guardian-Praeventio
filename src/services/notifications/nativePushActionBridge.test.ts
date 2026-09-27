// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNative = vi.hoisted(() => ({ value: true }));
const callbacks = vi.hoisted(() => new Map<string, (value: unknown) => void>());
const remove = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockNative.value,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, callback: (value: unknown) => void) => {
      callbacks.set(event, callback);
      return { remove };
    }),
  },
}));

import { DEEP_LINK_EVENT_NAME } from '../../components/shared/DeepLinkHandler';
import {
  __resetNativePushActionBridgeForTests,
  installNativePushActionBridge,
} from './nativePushActionBridge';

describe('native push action bridge', () => {
  beforeEach(() => {
    mockNative.value = true;
    callbacks.clear();
    remove.mockClear();
  });

  afterEach(async () => {
    await __resetNativePushActionBridgeForTests();
  });

  it('installs before React mounts and dispatches a cold-start push action', async () => {
    const listener = vi.fn();
    window.addEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);

    await installNativePushActionBridge();
    const callback = callbacks.get('pushNotificationActionPerformed');
    expect(callback).toBeDefined();

    callback?.({
      notification: {
        data: { type: 'sos', projectId: 'p1', alertId: 'a1' },
      },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      url: '/emergencia-avanzada?alertId=a1&projectId=p1&source=push',
      projectId: 'p1',
    });
    window.removeEventListener(DEEP_LINK_EVENT_NAME, listener as EventListener);
  });

  it('does not register a native listener on web', async () => {
    mockNative.value = false;

    await installNativePushActionBridge();

    expect(callbacks.size).toBe(0);
  });
});
