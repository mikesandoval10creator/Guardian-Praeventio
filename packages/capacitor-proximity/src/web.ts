import { WebPlugin } from '@capacitor/core';

import type {
  CapacitorProximityPlugin,
  PluginVersionResult,
  ProximityReadingResult,
  ProximityStatusResult,
} from './definitions';

export class CapacitorProximityWeb
  extends WebPlugin
  implements CapacitorProximityPlugin
{
  async enable(): Promise<void> {
    throw this.unavailable('Proximity hardware is not available on web.');
  }

  async disable(): Promise<void> {
    // Idempotent symmetry with native cleanup; web never enables hardware.
    return;
  }

  async getStatus(): Promise<ProximityStatusResult> {
    return { available: false, enabled: false, platform: 'web' };
  }

  async getCurrent(): Promise<ProximityReadingResult> {
    throw this.unavailable('Proximity hardware is not available on web.');
  }

  async getPluginVersion(): Promise<PluginVersionResult> {
    return { version: '0.1.0' };
  }
}
