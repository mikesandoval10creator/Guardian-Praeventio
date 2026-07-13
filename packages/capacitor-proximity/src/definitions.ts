import type { PluginListenerHandle } from '@capacitor/core';

export type ProximityState = 'near' | 'far';

export interface ProximityStatusResult {
  available: boolean;
  enabled: boolean;
  platform: 'ios' | 'android' | 'web';
}

export interface ProximityReadingResult {
  state: ProximityState;
  timestamp: number;
  /** Distance in centimetres when supplied by the native sensor. */
  distance?: number;
}

export interface PluginVersionResult {
  version: string;
}

export interface CapacitorProximityPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
  getStatus(): Promise<ProximityStatusResult>;
  getCurrent(): Promise<ProximityReadingResult>;
  getPluginVersion(): Promise<PluginVersionResult>;
  addListener(
    eventName: 'proximityChanged',
    listener: (reading: ProximityReadingResult) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
