// Praeventio Guard — location permission disclosure gate (pure service).
//
// Play Console (política "location in the background permissions") exige una
// DIVULGACIÓN PROMINENTE in-app ANTES de solicitar permisos sensibles de
// ubicación (ACCESS_BACKGROUND_LOCATION / ACCESS_FINE_LOCATION). El usuario
// debe ver — antes del diálogo del sistema — qué hace la app con su
// ubicación y que lo hace incluso con la app cerrada.
//
// Este módulo es puro: centraliza la frase obligatoria (verificada por la
// tarea Notion `[P1][store] Paquete de submission Play`) y el consentimiento
// persistente, y expone el candado que los consumidores de permisos
// consultan antes de llamar a `requestPermissions()`.
//
// Reglas:
//  - Web (navegador): NO aplica el requisito Play → nunca bloquea.
//  - Nativo (Android/iOS): el primer request de ubicación queda bloqueado
//    hasta que el usuario acepta la divulgación (persistente entre sesiones).

/** Clave de storage donde se persiste el consentimiento de la divulgación. */
export const LOCATION_DISCLOSURE_STORAGE_KEY =
  'guardian.locationDisclosureAcknowledged.v1';

/**
 * Frase de divulgación prominente, adaptada del texto que Play Console
 * solicita para permisos de ubicación en background. Verificable con:
 *   grep -rniE 'even when the app is closed|recolecta datos de ubicaci' src/
 */
export const LOCATION_DISCLOSURE_MESSAGE =
  'Esta app recolecta datos de ubicación para habilitar SOS, hombre caído, evacuación y trabajador solitario incluso cuando la app está cerrada o sin uso.';

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(LOCATION_DISCLOSURE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(LOCATION_DISCLOSURE_STORAGE_KEY, value);
  } catch {
    // Storage no disponible (modo privado, SSR): el bloqueo aplica igual.
  }
}

/** True si el usuario ya aceptó la divulgación prominente de ubicación. */
export function isLocationDisclosureAcknowledged(): boolean {
  return readStorage() === 'true';
}

/** Persiste la aceptación del usuario (una sola vez; sobrevive reinicios). */
export function acknowledgeLocationDisclosure(): void {
  writeStorage('true');
}

/**
 * Candado para los consumidores de permisos: devuelve true cuando es seguro
 * llamar a `Geolocation.requestPermissions()`.
 *
 * @param isNativePlatform - `Capacitor.isNativePlatform()` (Android/iOS).
 *   En web el requisito Play no aplica y el candado nunca bloquea.
 */
export function canRequestLocationPermission(isNativePlatform: boolean): boolean {
  if (!isNativePlatform) return true;
  return isLocationDisclosureAcknowledged();
}
