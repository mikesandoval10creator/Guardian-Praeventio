import { describe, it, expect, beforeEach } from 'vitest';
import { useDensityStore } from './densityStore';

describe('densityStore', () => {
  beforeEach(() => {
    useDensityStore.setState({ density: 'comfortable' });
  });
  it('default es comfortable', () => {
    expect(useDensityStore.getState().density).toBe('comfortable');
  });
  it('toggle alterna comfortable <-> compact', () => {
    useDensityStore.getState().toggle();
    expect(useDensityStore.getState().density).toBe('compact');
    useDensityStore.getState().toggle();
    expect(useDensityStore.getState().density).toBe('comfortable');
  });
  it('setDensity fija el valor', () => {
    useDensityStore.getState().setDensity('compact');
    expect(useDensityStore.getState().density).toBe('compact');
  });
});
