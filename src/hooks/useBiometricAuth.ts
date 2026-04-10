import { useState, useCallback } from 'react';

export const useBiometricAuth = () => {
  const [isSupported, setIsSupported] = useState<boolean>(
    typeof window !== 'undefined' && !!window.PublicKeyCredential
  );

  const authenticate = useCallback(async (challengeMessage: string = 'Autenticación requerida'): Promise<boolean> => {
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
  }, [isSupported]);

  const register = useCallback(async (username: string): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: 'Praeventio Guard',
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'required',
          requireResidentKey: true,
        },
        timeout: 60000,
        attestation: 'none',
      };

      const credential = await navigator.credentials.create({ publicKey });
      return !!credential;
    } catch (error) {
      console.error('Error en registro biométrico:', error);
      return false;
    }
  }, [isSupported]);

  return { isSupported, authenticate, register };
};
