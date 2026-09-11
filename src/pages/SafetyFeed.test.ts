import { describe, expect, it } from 'vitest';
import { getSafetyFeedPrompt } from './SafetyFeed';

describe('getSafetyFeedPrompt', () => {
  it('uses the first display-name token when available', () => {
    expect(getSafetyFeedPrompt('Daniel Sandoval', true)).toBe(
      '¿Qué momento de seguridad quieres compartir hoy, Daniel?',
    );
  });

  it('uses a human fallback instead of rendering undefined', () => {
    expect(getSafetyFeedPrompt(undefined, true)).toBe(
      '¿Qué momento de seguridad quieres compartir hoy, Guardián?',
    );
    expect(getSafetyFeedPrompt('   ', true)).not.toContain('undefined');
  });

  it('reports the offline state before addressing the user', () => {
    expect(getSafetyFeedPrompt(undefined, false)).toBe('Conexión requerida para publicar');
  });
});
