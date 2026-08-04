// @vitest-environment jsdom
// Praeventio Guard — location permission disclosure gate (pure service).
//
// Play Console exige divulgación prominente in-app ANTES de solicitar
// permisos sensibles de ubicación (ACCESS_BACKGROUND_LOCATION). Este módulo
// centraliza la frase obligatoria y el consentimiento persistente, y expone
// el candado que los consumidores de permisos (useGeolocationTracking,
// geofence) consultan antes de llamar a requestPermissions().

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LOCATION_DISCLOSURE_MESSAGE,
  LOCATION_DISCLOSURE_STORAGE_KEY,
  isLocationDisclosureAcknowledged,
  acknowledgeLocationDisclosure,
  canRequestLocationPermission,
} from './locationPermissionRequest';

describe('locationPermissionRequest', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('contiene la frase requerida por Play (ubicación en background)', () => {
    expect(LOCATION_DISCLOSURE_MESSAGE).toMatch(/recolecta datos de ubicaci/i);
    expect(LOCATION_DISCLOSURE_MESSAGE).toMatch(/SOS/i);
    expect(LOCATION_DISCLOSURE_MESSAGE).toMatch(
      /cuando la app está cerrada o sin uso/i,
    );
  });

  it('no está reconocida hasta que el usuario acepta', () => {
    expect(isLocationDisclosureAcknowledged()).toBe(false);
  });

  it('persiste el consentimiento tras aceptar (sobrevive remounts)', () => {
    acknowledgeLocationDisclosure();
    expect(isLocationDisclosureAcknowledged()).toBe(true);
    // Simula un nuevo "montaje": la lectura vuelve a leer storage.
    expect(localStorage.getItem(LOCATION_DISCLOSURE_STORAGE_KEY)).toBe('true');
  });

  it('bloquea el request nativo mientras no hay divulgación aceptada', () => {
    // Plataforma nativa (Android/iOS): el candado aplica.
    expect(canRequestLocationPermission(true)).toBe(false);
    acknowledgeLocationDisclosure();
    expect(canRequestLocationPermission(true)).toBe(true);
  });

  it('nunca bloquea en web (no aplica requisito Play)', () => {
    expect(canRequestLocationPermission(false)).toBe(true);
  });
});
