import { describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ verifiedChain: false }));

vi.mock('./appleSignedDataVerifier.js', () => ({
  verifyAppleNotification: vi.fn(async () => ({
    notification: {
      notificationUUID: 'provenance-test',
      notificationType: 'SUBSCRIBED',
    },
    verifiedChain: H.verifiedChain,
  })),
}));

import { verifyAndDecodeAppleSsn } from './appleSsn.js';

describe('Apple SSN verification provenance', () => {
  it('propagates the boundary result instead of reasserting verified=true', async () => {
    const result = await verifyAndDecodeAppleSsn('boundary-controlled-payload');

    expect(result.verifiedChain).toBe(false);
    expect(result.payload.notificationUUID).toBe('provenance-test');
  });
});
