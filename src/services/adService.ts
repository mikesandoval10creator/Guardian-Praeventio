import { Capacitor } from '@capacitor/core';

/**
 * Ad unit IDs:
 * - Web: set VITE_ADSENSE_CLIENT and VITE_ADSENSE_SLOT in .env
 * - Android: set VITE_ADMOB_ANDROID_INTERSTITIAL in .env
 * - iOS: set VITE_ADMOB_IOS_INTERSTITIAL in .env
 *
 * For testing, Google's official test IDs are used as fallback.
 * Replace with real unit IDs from AdMob console before production.
 */
export const AD_CONFIG = {
  adsenseClient: import.meta.env.VITE_ADSENSE_CLIENT ?? '',
  adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT ?? '',
  androidInterstitialId: import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL
    ?? 'ca-app-pub-3940256099942544/1033173712', // Google test ID
  iosInterstitialId: import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL
    ?? 'ca-app-pub-3940256099942544/4411468910', // Google test ID
};

export const isNative = () => Capacitor.isNativePlatform();

export async function initAdMob(): Promise<void> {
  if (!isNative()) return;
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.initialize({ testingDevices: [], initializeForTesting: false });
  } catch (err) {
    console.warn('[AdService] initialize failed:', err);
  }
}

export async function prepareInterstitial(): Promise<void> {
  if (!isNative()) return;
  try {
    const { AdMob, InterstitialAdPluginEvents } = await import('@capacitor-community/admob');
    const adId = Capacitor.getPlatform() === 'android'
      ? AD_CONFIG.androidInterstitialId
      : AD_CONFIG.iosInterstitialId;
    await AdMob.prepareInterstitial({ adId });
  } catch (err) {
    console.warn('[AdService] prepareInterstitial failed:', err);
  }
}

export async function showInterstitial(): Promise<void> {
  if (!isNative()) return;
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.showInterstitial();
  } catch (err) {
    console.warn('[AdService] showInterstitial failed:', err);
  }
}

let adSenseLoaded = false;

export function loadAdSenseScript(): Promise<void> {
  if (isNative() || !AD_CONFIG.adsenseClient) return Promise.resolve();
  if (adSenseLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    adSenseLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CONFIG.adsenseClient}`;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => resolve(); // silencioso si falla
    document.head.appendChild(script);
  });
}

const AD_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora
const AD_LAST_SHOWN_KEY = 'pg_last_ad_ts';

export function canShowAd(): boolean {
  const last = Number(localStorage.getItem(AD_LAST_SHOWN_KEY) ?? 0);
  return Date.now() - last > AD_COOLDOWN_MS;
}

export function recordAdShown(): void {
  localStorage.setItem(AD_LAST_SHOWN_KEY, String(Date.now()));
}
