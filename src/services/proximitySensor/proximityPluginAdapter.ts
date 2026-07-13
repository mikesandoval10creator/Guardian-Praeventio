// Production boundary between the device-mode engine and the first-party,
// auditable Capacitor proximity plugin. Web and unsupported devices retain the
// neutral mode; native setup errors never escape into the fall-detection flow.

import { Capacitor } from '@capacitor/core';
import { logger } from '../../utils/logger';
import type { ProximityPluginContract } from './proximityModeDetector';

/** Resolve real native proximity hardware without fabricating web evidence. */
export async function loadProximityPlugin(): Promise<ProximityPluginContract | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { CapacitorProximity } = await import('@praeventio/capacitor-proximity');
    const status = await CapacitorProximity.getStatus();
    logger.info('proximityPluginAdapter: native sensor status', {
      available: status.available,
      enabled: status.enabled,
      platform: status.platform,
    });
    return status.available ? CapacitorProximity : null;
  } catch (err) {
    logger.warn('proximityPluginAdapter: proximity plugin unavailable', { err });
    return null;
  }
}
