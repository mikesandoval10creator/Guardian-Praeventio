import { auth } from './firebase';

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
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("No authenticated user");

    const response = await fetch('/api/billing/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
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
    console.error("Billing Service Error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Helper to check if running inside Capacitor
 */
export const isNative = (): boolean => {
  // @ts-ignore
  return !!window.Capacitor;
};
