/**
 * Utilidades para Autenticación Biométrica usando WebAuthn.
 * WebAuthn activa FaceID, TouchID o Windows Hello en dispositivos compatibles.
 */

// Función para convertir base64url a Uint8Array
function bufferDecode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

// Función para convertir Uint8Array a base64url
function bufferEncode(value: ArrayBuffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(value) as any))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export const isBiometricSupported = async () => {
  if (!window.PublicKeyCredential) {
    return false;
  }
  return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
};

export const registerBiometric = async (userId: string, userEmail: string): Promise<string> => {
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const userIdBuffer = new TextEncoder().encode(userId);

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: "Praeventio Guard",
    },
    user: {
      id: userIdBuffer,
      name: userEmail,
      displayName: userEmail,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },   // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform", // Fuerza FaceID/TouchID en lugar de llaves USB
      userVerification: "required",
    },
    timeout: 60000,
    attestation: "none"
  };

  try {
    const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
    if (credential) {
      // Devolvemos el ID de la credencial generada para guardarlo localmente o en el backend
      return bufferEncode(credential.rawId);
    }
    throw new Error("No credential returned");
  } catch (error) {
    console.error("Error en registro biométrico:", error);
    throw error;
  }
};

export const verifyBiometric = async (credentialIdBase64: string): Promise<boolean> => {
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const credentialIdBuffer = bufferDecode(credentialIdBase64);

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    allowCredentials: [
      {
        type: "public-key",
        id: credentialIdBuffer,
        transports: ["internal"],
      }
    ],
    userVerification: "required", // Requiere biometría actuañ
    timeout: 60000,
  };

  try {
    const assertion = await navigator.credentials.get({ publicKey });
    if (assertion) {
      return true; // Autenticación biométrica exitosa (localmente)
    }
    return false;
  } catch (error) {
    console.error("Error en verificación biométrica:", error);
    return false; // Cancelado o fallido
  }
};
