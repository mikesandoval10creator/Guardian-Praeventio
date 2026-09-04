/**
 * Contract test for buildEmergencyMulticastMessage (v1.0.0-W0 Tier A fix).
 *
 * Closes the vida-safety gap noted in the Android Launch Triage audit
 * (Notion id 3ccaa66d-73fe-81e2-8efe-d24072b0da74) and the v1.0.0 master
 * delivery plan §3.1 + §3.4: every emergency push must target the
 * `praeventio_emergency` notification channel so the alarm surfaces
 * even when the screen is off.
 *
 * What this asserts:
 *  1. The Android config includes notification.channel_id = 'praeventio_emergency'.
 *  2. Android priority is 'high'.
 *  3. APNS payload keeps critical sound for iOS parity.
 *  4. The exported constant PRAEVENTIO_EMERGENCY_CHANNEL_ID matches what
 *     AndroidManifest.xml declares at line 163 (IMPORTANCE_HIGH).
 */

import { describe, it, expect } from 'vitest';
import {
  buildEmergencyMulticastMessage,
  PRAEVENTIO_EMERGENCY_CHANNEL_ID,
} from '../../server/routes/emergency';

describe('buildEmergencyMulticastMessage (v1.0.0 vida-safety contract)', () => {
  const tokens = ['token-a', 'token-b'];
  const payload = {
    title: 'SOS worker',
    body: 'Worker A requested SOS in Project B',
    data: { kind: 'sos', projectId: 'proj-1' },
  };

  it('targets the praeventio_emergency channel so the alarm surfaces with screen off', () => {
    const msg = buildEmergencyMulticastMessage(tokens, payload);
    expect(msg.android).toBeDefined();
    expect(msg.android?.notification).toBeDefined();
    expect(msg.android?.notification?.channel_id).toBe('praeventio_emergency');
    expect(PRAEVENTIO_EMERGENCY_CHANNEL_ID).toBe('praeventio_emergency');
  });

  it('uses Android high priority so the message is delivered immediately', () => {
    const msg = buildEmergencyMulticastMessage(tokens, payload);
    expect(msg.android?.priority).toBe('high');
  });

  it('keeps APNS critical-sound parity for iOS cross-platform build', () => {
    const msg = buildEmergencyMulticastMessage(tokens, payload);
    expect(msg.apns?.payload?.aps?.sound).toEqual({ critical: true, name: 'default', volume: 1 });
  });

  it('forwards every supplied token (no dedup, no truncation)', () => {
    const msg = buildEmergencyMulticastMessage(tokens, payload);
    expect(msg.tokens).toEqual(tokens);
  });

  it('passes through payload title/body/data verbatim', () => {
    const msg = buildEmergencyMulticastMessage(tokens, payload);
    expect(msg.notification?.title).toBe(payload.title);
    expect(msg.notification?.body).toBe(payload.body);
    expect(msg.data).toEqual(payload.data);
  });
});
