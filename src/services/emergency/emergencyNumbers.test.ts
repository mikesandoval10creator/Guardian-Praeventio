import { describe, it, expect } from 'vitest';
import {
  getEmergencyNumbersByCoords,
  getEmergencyNumbersByRegion,
  listSupportedCountries,
  toTelUri,
} from './emergencyNumbers.js';

describe('emergencyNumbers', () => {
  describe('getEmergencyNumbersByCoords', () => {
    it('Santiago de Chile → CL (131/132/133)', () => {
      const e = getEmergencyNumbersByCoords({ lat: -33.45, lng: -70.66 });
      expect(e.regionCode).toBe('CL');
      expect(e.medical).toBe('131');
      expect(e.fire).toBe('132');
      expect(e.police).toBe('133');
    });

    it('Buenos Aires → AR (107/100/911)', () => {
      const e = getEmergencyNumbersByCoords({ lat: -34.6, lng: -58.4 });
      expect(e.regionCode).toBe('AR');
      expect(e.medical).toBe('107');
    });

    it('Lima → PE (106/116/105)', () => {
      const e = getEmergencyNumbersByCoords({ lat: -12.05, lng: -77.05 });
      expect(e.regionCode).toBe('PE');
      expect(e.medical).toBe('106');
    });

    it('Madrid → ES (061 médico, 112 universal)', () => {
      const e = getEmergencyNumbersByCoords({ lat: 40.4, lng: -3.7 });
      expect(e.regionCode).toBe('ES');
      expect(e.medical).toBe('061');
      expect(e.universal).toBe('112');
    });

    it('Londres → GB (999/112)', () => {
      const e = getEmergencyNumbersByCoords({ lat: 51.5, lng: -0.12 });
      expect(e.regionCode).toBe('GB');
      expect(e.medical).toBe('999');
      expect(e.universal).toBe('112');
    });

    it('Berlín → EU (112)', () => {
      const e = getEmergencyNumbersByCoords({ lat: 52.5, lng: 13.4 });
      expect(e.regionCode).toBe('EU');
      expect(e.medical).toBe('112');
    });

    it('Mar abierto Pacífico Sur → fallback Chile', () => {
      const e = getEmergencyNumbersByCoords({ lat: -40, lng: -120 });
      expect(e.regionCode).toBe('CL');
    });

    it('Antártida → fallback Chile', () => {
      const e = getEmergencyNumbersByCoords({ lat: -85, lng: 0 });
      expect(e.regionCode).toBe('CL');
    });
  });

  describe('getEmergencyNumbersByRegion', () => {
    it('CL devuelve Chile', () => {
      expect(getEmergencyNumbersByRegion('CL').medical).toBe('131');
    });

    it('case-insensitive: cl funciona igual que CL', () => {
      expect(getEmergencyNumbersByRegion('cl').medical).toBe('131');
    });

    it('código desconocido → fallback Chile', () => {
      expect(getEmergencyNumbersByRegion('ZZ').regionCode).toBe('CL');
    });
  });

  describe('listSupportedCountries', () => {
    it('devuelve lista no vacía sin bbox', () => {
      const list = listSupportedCountries();
      expect(list.length).toBeGreaterThanOrEqual(10);
      expect((list[0] as any).bbox).toBeUndefined();
    });
  });

  describe('toTelUri', () => {
    it('filtra caracteres inseguros (anti tel-injection)', () => {
      expect(toTelUri('131')).toBe('tel:131');
      expect(toTelUri('+56 9 1234 5678')).toBe('tel:+56912345678');
      expect(toTelUri("131; rm -rf /")).toBe('tel:131'); // injection blocked
    });

    it('preserva *, # y +', () => {
      expect(toTelUri('*123#')).toBe('tel:*123#');
    });
  });
});
