import { describe, it, expect } from 'vitest';
import { vehicleDocStatus, vehicleDocStateLabel } from './vehicleDocStatus';

const NOW = new Date('2026-06-29T12:00:00Z');

describe('vehicleDocStatus', () => {
  it('returns sin_dato when no date is provided', () => {
    expect(vehicleDocStatus(undefined, NOW)).toEqual({ state: 'sin_dato', daysLeft: null });
    expect(vehicleDocStatus(null, NOW)).toEqual({ state: 'sin_dato', daysLeft: null });
    expect(vehicleDocStatus('', NOW)).toEqual({ state: 'sin_dato', daysLeft: null });
  });

  it('returns sin_dato for an unparseable date', () => {
    expect(vehicleDocStatus('not-a-date', NOW)).toEqual({ state: 'sin_dato', daysLeft: null });
  });

  it('flags a past date as vencido with negative daysLeft', () => {
    const r = vehicleDocStatus('2026-06-01', NOW);
    expect(r.state).toBe('vencido');
    expect(r.daysLeft).toBe(-28);
  });

  it('treats expiry today as vigente boundary (por_vencer, 0 days)', () => {
    const r = vehicleDocStatus('2026-06-29', NOW);
    expect(r.state).toBe('por_vencer');
    expect(r.daysLeft).toBe(0);
  });

  it('flags a date within 30 days as por_vencer', () => {
    const r = vehicleDocStatus('2026-07-20', NOW); // 21 days
    expect(r.state).toBe('por_vencer');
    expect(r.daysLeft).toBe(21);
  });

  it('flags a date beyond 30 days as vigente', () => {
    const r = vehicleDocStatus('2026-09-01', NOW); // 64 days
    expect(r.state).toBe('vigente');
    expect(r.daysLeft).toBe(64);
  });

  it('respects a custom warning window', () => {
    expect(vehicleDocStatus('2026-07-20', NOW, 10).state).toBe('vigente');
    expect(vehicleDocStatus('2026-07-05', NOW, 10).state).toBe('por_vencer');
  });
});

describe('vehicleDocStateLabel', () => {
  it('maps each state to its es-CL label', () => {
    expect(vehicleDocStateLabel('vigente')).toBe('Vigente');
    expect(vehicleDocStateLabel('por_vencer')).toBe('Por vencer');
    expect(vehicleDocStateLabel('vencido')).toBe('Vencido');
    expect(vehicleDocStateLabel('sin_dato')).toBe('Sin registrar');
  });
});
