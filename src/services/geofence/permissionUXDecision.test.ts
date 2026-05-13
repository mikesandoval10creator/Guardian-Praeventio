import { describe, it, expect } from 'vitest';
import {
  decidePermissionUX,
  PermissionMessages,
  type PermissionUXInput,
} from './permissionUXDecision';

/**
 * Sprint 50 E.5 P2 H27 — tests for geofence permission UX decision engine.
 *
 * Coverage matrix:
 *   - happy path: full grant on iOS + Android
 *   - granted + when_in_use → upgrade message
 *   - granted + background denied → upgrade message
 *   - granted + background not_requested → continue degraded silently
 *   - denied + Android "Don't ask again" → open_system_settings
 *   - denied + iOS (no deny-forever concept) → modal
 *   - denied + inCriticalZone → block_feature
 *   - prompt → request_permission_inline
 *   - restricted (iOS parental controls) → open_system_settings
 *   - unsupported (web-desktop) → block_feature
 *   - unsupported (API missing) → block_feature
 *   - iOS userOptedOutForever ignored (still routes to modal, not settings)
 *   - rationale text differs per platform
 *   - i18n keys are stable + match catalog
 */
describe('decidePermissionUX', () => {
  // ── happy paths ────────────────────────────────────────────────────────
  it('iOS granted + granted_always → full features, continue degraded', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'granted',
      backgroundState: 'granted_always',
    });
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.mustUseFallback).toBe(false);
    expect(d.recommendedAction).toBe('continue_degraded');
    expect(d.userMessage.key).toBe('geofence.permission.granted');
  });

  it('Android granted + granted_always → full features', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'granted',
      backgroundState: 'granted_always',
    });
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.mustUseFallback).toBe(false);
  });

  // ── when_in_use only ───────────────────────────────────────────────────
  it('iOS granted + granted_when_in_use → SOS works but upgrade asked', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'granted',
      backgroundState: 'granted_when_in_use',
    });
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe(
      'geofence.permission.granted_when_in_use_only',
    );
    expect(d.rationaleText).toMatch(/Privacidad|Servicios de Ubicación/i);
  });

  it('Android granted + granted_when_in_use → upgrade rationale is Android-specific', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'granted',
      backgroundState: 'granted_when_in_use',
    });
    expect(d.rationaleText).toMatch(/Aplicaciones.*Guardian.*Permisos/i);
  });

  // ── background not_requested ───────────────────────────────────────────
  it('granted foreground + background not_requested → continue degraded, no nag', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'granted',
      backgroundState: 'not_requested',
    });
    expect(d.canUseGeofence).toBe(true);
    expect(d.recommendedAction).toBe('continue_degraded');
    expect(d.userMessage.key).toBe('geofence.permission.granted');
  });

  it('granted foreground + background denied → upgrade message', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'granted',
      backgroundState: 'denied',
    });
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe(
      'geofence.permission.granted_when_in_use_only',
    );
  });

  // ── denied paths ───────────────────────────────────────────────────────
  it('Android denied + userOptedOutForever → open_system_settings', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: true,
    });
    expect(d.canUseGeofence).toBe(false);
    expect(d.canUseEmergencySOSWithLocation).toBe(false);
    expect(d.mustUseFallback).toBe(true);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe('geofence.permission.denied_forever');
    expect(d.rationaleText).toMatch(/No volver a preguntar/i);
  });

  it('Android denied without forever flag → show_explanation_modal', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: false,
    });
    expect(d.recommendedAction).toBe('show_explanation_modal');
    expect(d.userMessage.key).toBe('geofence.permission.denied_one_time');
  });

  it('iOS denied → always show_explanation_modal (no deny-forever in iOS)', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'denied',
      backgroundState: 'denied',
    });
    expect(d.recommendedAction).toBe('show_explanation_modal');
    expect(d.userMessage.key).toBe('geofence.permission.denied_one_time');
  });

  it('iOS denied + userOptedOutForever=true → still show_explanation_modal (iOS ignores flag)', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: true,
    });
    expect(d.recommendedAction).toBe('show_explanation_modal');
    expect(d.userMessage.key).not.toBe('geofence.permission.denied_forever');
  });

  // ── critical zone ──────────────────────────────────────────────────────
  it('denied + inCriticalZone → block_feature_with_explanation', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      inCriticalZone: true,
    });
    expect(d.canUseGeofence).toBe(false);
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.userMessage.key).toBe(
      'geofence.permission.denied_critical_zone',
    );
    expect(d.mustUseFallback).toBe(true);
  });

  it('denied + inCriticalZone overrides userOptedOutForever routing', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      inCriticalZone: true,
      userOptedOutForever: true,
    });
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.userMessage.key).toBe(
      'geofence.permission.denied_critical_zone',
    );
  });

  // ── prompt ─────────────────────────────────────────────────────────────
  it('prompt → request_permission_inline', () => {
    const d = decidePermissionUX({
      platform: 'android',
      foregroundState: 'prompt',
      backgroundState: 'not_requested',
    });
    expect(d.recommendedAction).toBe('request_permission_inline');
    expect(d.userMessage.key).toBe('geofence.permission.prompt_inline');
    expect(d.canUseGeofence).toBe(false);
  });

  // ── restricted (iOS parental / MDM) ────────────────────────────────────
  it('iOS restricted (parental controls) → open_system_settings with restricted message', () => {
    const d = decidePermissionUX({
      platform: 'ios',
      foregroundState: 'restricted',
      backgroundState: 'not_requested',
    });
    expect(d.canUseGeofence).toBe(false);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe('geofence.permission.restricted_ios');
    expect(d.rationaleText).toMatch(/Tiempo en Pantalla|Restricciones/i);
  });

  // ── unsupported ────────────────────────────────────────────────────────
  it('web-desktop → block_feature_with_explanation regardless of state', () => {
    const d = decidePermissionUX({
      platform: 'web-desktop',
      foregroundState: 'granted',
      backgroundState: 'granted_always',
    });
    expect(d.canUseGeofence).toBe(false);
    expect(d.canUseEmergencySOSWithLocation).toBe(false);
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.userMessage.key).toBe('geofence.permission.unsupported_desktop');
  });

  it('foregroundState=unsupported (old browser) → block_feature', () => {
    const d = decidePermissionUX({
      platform: 'web-mobile',
      foregroundState: 'unsupported',
      backgroundState: 'not_requested',
    });
    expect(d.canUseGeofence).toBe(false);
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.mustUseFallback).toBe(true);
  });

  // ── platform-specific rationale ────────────────────────────────────────
  it('rationale text varies between iOS and Android for same logical state', () => {
    const base: Omit<PermissionUXInput, 'platform'> = {
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: false,
    };
    const ios = decidePermissionUX({ ...base, platform: 'ios' });
    const android = decidePermissionUX({ ...base, platform: 'android' });
    expect(ios.rationaleText).not.toBe(android.rationaleText);
    expect(ios.rationaleText).toMatch(/Privacidad|Servicios de Ubicación/i);
    expect(android.rationaleText).toMatch(/Permitir todo el tiempo|Permitir siempre/i);
  });

  // ── i18n catalog stability ─────────────────────────────────────────────
  it('PermissionMessages catalog exposes all required keys', () => {
    expect(PermissionMessages.granted.key).toBe('geofence.permission.granted');
    expect(PermissionMessages.grantedWhenInUseOnly.key).toBe(
      'geofence.permission.granted_when_in_use_only',
    );
    expect(PermissionMessages.deniedOneTime.key).toBe(
      'geofence.permission.denied_one_time',
    );
    expect(PermissionMessages.deniedForever.key).toBe(
      'geofence.permission.denied_forever',
    );
    expect(PermissionMessages.deniedCriticalZone.key).toBe(
      'geofence.permission.denied_critical_zone',
    );
    expect(PermissionMessages.unsupportedDesktop.key).toBe(
      'geofence.permission.unsupported_desktop',
    );
    // every message must ship with a non-empty Spanish fallback
    for (const msg of Object.values(PermissionMessages)) {
      expect(msg.fallback.length).toBeGreaterThan(10);
    }
  });

  // ── purity / determinism ───────────────────────────────────────────────
  it('is pure — same input yields same output across calls', () => {
    const input: PermissionUXInput = {
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: true,
    };
    const a = decidePermissionUX(input);
    const b = decidePermissionUX(input);
    expect(a).toEqual(b);
  });

  it('does not mutate the input object', () => {
    const input: PermissionUXInput = {
      platform: 'ios',
      foregroundState: 'granted',
      backgroundState: 'granted_when_in_use',
      inCriticalZone: false,
    };
    const snapshot = JSON.stringify(input);
    decidePermissionUX(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
