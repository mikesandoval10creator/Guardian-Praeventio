import { auth } from './firebase';
import { logger } from '../utils/logger';
import { apiAuthHeader } from '../lib/apiAuth';

export interface PurchaseResult {
  success: boolean;
  data?: any;
  error?: string;
}

export const verifyGooglePlayPurchase = async (
  purchaseToken: string,
  productId: string,
  type: 'subscription' | 'one_time' = 'subscription'
): Promise<PurchaseResult> => {
  try {
    // §2.20 (2026-05-23) — apiAuthHeader unified.
    const authHeader = await apiAuthHeader();
    if (!authHeader) throw new Error("No authenticated user");

    const response = await fetch('/api/billing/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({ purchaseToken, productId, type })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Verification failed');
    }

    const data = await response.json();
    return { success: true, data: data.data };
  } catch (error: any) {
    logger.error("Billing Service Error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Helper to check if running inside Capacitor
 */
export const isNative = (): boolean => {
  return !!(window as Window & { Capacitor?: unknown }).Capacitor;
};
