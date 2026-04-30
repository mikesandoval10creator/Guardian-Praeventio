import { Capacitor } from '@capacitor/core';

// Ad unit IDs come exclusively from env vars — no test-ID fallback in production builds.
// Required vars: VITE_ADMOB_ANDROID_INTERSTITIAL, VITE_ADMOB_IOS_INTERSTITIAL
// Optional (web PWA): VITE_ADSENSE_CLIENT, VITE_ADSENSE_SLOT
export const AD_CONFIG = {
  adsenseClient: import.meta.env.VITE_ADSENSE_CLIENT ?? '',
  adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT ?? '',
  androidInterstitialId: import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL ?? '',
  iosInterstitialId: import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL ?? '',
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
  const adId = Capacitor.getPlatform() === 'android'
    ? AD_CONFIG.androidInterstitialId
    : AD_CONFIG.iosInterstitialId;
  if (!adId) return; // no unit ID configured — skip silently
  try {
    const { AdMob, InterstitialAdPluginEvents } = await import('@capacitor-community/admob');
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

// Round 22 — audit fix DT-10: en Capacitor nativo `localStorage` no
// está disponible (puede crashear o silently devolver null) — usar
// `@capacitor/preferences`. Web sigue usando localStorage. Los métodos
// son async ahora; callers que esperaban sync deben await o aceptar
// promise.

function isNativeRuntime(): boolean {
  try {
    // @ts-ignore - Capacitor global may not exist in pure web
    return typeof (globalThis as any).Capacitor?.isNativePlatform === 'function'
      && (globalThis as any).Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function getLastAdTs(): Promise<number> {
  if (isNativeRuntime()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: AD_LAST_SHOWN_KEY });
      return Number(value ?? 0);
    } catch {
      return 0;
    }
  }
  if (typeof localStorage === 'undefined') return 0;
  return Number(localStorage.getItem(AD_LAST_SHOWN_KEY) ?? 0);
}

async function setLastAdTs(): Promise<void> {
  const now = String(Date.now());
  if (isNativeRuntime()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: AD_LAST_SHOWN_KEY, value: now });
    } catch {
      /* silent — ad cooldown is best-effort UX, not security */
    }
    return;
  }
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AD_LAST_SHOWN_KEY, now);
}

export async function canShowAd(): Promise<boolean> {
  const last = await getLastAdTs();
  return Date.now() - last > AD_COOLDOWN_MS;
}

export async function recordAdShown(): Promise<void> {
  await setLastAdTs();
}
