import { useState } from 'react';

export const useBiometricAuth = () => {
  const [isSupported, setIsSupported] = useState<boolean>(
    typeof window !== 'undefined' && !!window.PublicKeyCredential
  );

  const authenticate = async (challengeMessage: string = 'Autenticación requerida'): Promise<boolean> => {
    if (!isSupported) {
      console.warn('WebAuthn no está soportado en este dispositivo.');
      return true; // Fallback to true if not supported for MVP
    }

    try {
      // This is a simplified local-only WebAuthn check
      // In a real ISO 27001 environment, the challenge must come from the server
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge,
        rpId: window.location.hostname,
        userVerification: 'required', // This forces biometric/PIN check on the device
      };

      const credential = await navigator.credentials.get({ publicKey });
      return !!credential;
    } catch (error) {
      console.error('Error en autenticación biométrica:', error);
      return false;
    }
  };

  return { isSupported, authenticate };
};
