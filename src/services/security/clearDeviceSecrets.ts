/**
 * Olvida todo lo que este dispositivo sabe del usuario que cierra sesión.
 *
 * `encryptedKvStore` y `deviceKek` ya documentaban que el logout debe borrar
 * el store Y la KEK (encryptedKvStore.ts §Threat model: "deleteDeviceKek en
 * logout vacía la KEK haciendo el ciphertext irrecuperable"), pero hasta
 * 2026-07 nadie lo llamaba: `logOut()` dejaba ambos intactos. En un equipo
 * compartido de faena eso deja vivo el material cripto del usuario anterior
 * para el siguiente.
 *
 * El store se borra ANTES que la KEK: al revés quedarían blobs en disco sin
 * forma de descifrarlos — basura indescifrable que nadie puede limpiar.
 */

import { clearEncryptedStore } from './encryptedKvStore';
import { deleteDeviceKek } from './deviceKek';

export interface ClearDeviceSecretsResult {
  storeCleared: boolean;
  kekDeleted: boolean;
}

/**
 * Nunca lanza — cerrar sesión debe funcionar aunque IndexedDB esté caído
 * (modo privado, cuota llena). Un logout bloqueado es peor que un borrado
 * fallido: dejaría al usuario con la sesión abierta. El caller decide si
 * loguea el resultado parcial.
 *
 * ⚠️ Borra TODO el `encryptedKvStore`, no solo el enrolamiento MFA. Hoy el
 * único escritor del store es el TOTP de SecurityShield, así que el costo es
 * re-enrolar MFA tras cerrar sesión. Si algún día se cablea el outbox cifrado
 * (`createEncryptedOutboxAdapter`, hoy sin callers de producción), esto
 * empezaría a descartar writes offline pendientes — posiblemente incidentes —
 * de forma silenciosa. Ese día: flush del outbox antes de llamar acá, o
 * borrado acotado por namespace.
 */
export async function clearDeviceSecrets(): Promise<ClearDeviceSecretsResult> {
  const result: ClearDeviceSecretsResult = {
    storeCleared: false,
    kekDeleted: false,
  };

  try {
    await clearEncryptedStore();
    result.storeCleared = true;
  } catch {
    /* best-effort: reported via the result, never thrown */
  }

  try {
    await deleteDeviceKek();
    result.kekDeleted = true;
  } catch {
    /* best-effort: reported via the result, never thrown */
  }

  return result;
}
