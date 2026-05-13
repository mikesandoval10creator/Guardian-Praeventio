import { describe, it, expect } from 'vitest';
import {
  decideAiMode,
  shouldUseRulesOnly,
  type AiCapabilitySnapshot,
} from './aiModeController';

function snap(over: Partial<AiCapabilitySnapshot> = {}): AiCapabilitySnapshot {
  return {
    networkClass: 'wifi',
    batteryClass: 'plenty',
    userPref: 'auto',
    localModelLoaded: false,
    tenantBudgetExceeded: false,
    ...over,
  };
}

describe('decideAiMode', () => {
  it('userPref=off → rules_only sin marcar degradación', () => {
    const d = decideAiMode(snap({ userPref: 'off' }));
    expect(d.mode).toBe('rules_only');
    expect(d.useRulesOnly).toBe(true);
    expect(d.informUserOfDegradation).toBe(false);
    expect(d.reason).toBe('user_pref_off');
  });

  it('tenant budget exceeded → rules_only + informa al usuario', () => {
    const d = decideAiMode(snap({ tenantBudgetExceeded: true }));
    expect(d.mode).toBe('rules_only');
    expect(d.useRulesOnly).toBe(true);
    expect(d.informUserOfDegradation).toBe(true);
  });

  it('budget exceeded gana sobre red buena', () => {
    const d = decideAiMode(
      snap({ tenantBudgetExceeded: true, networkClass: 'wifi', userPref: 'cloud' }),
    );
    expect(d.mode).toBe('rules_only');
  });

  it('offline + modelo local cargado → local_only', () => {
    const d = decideAiMode(
      snap({ networkClass: 'offline', localModelLoaded: true }),
    );
    expect(d.mode).toBe('local_only');
    expect(d.useRulesOnly).toBe(false);
    expect(d.informUserOfDegradation).toBe(true);
  });

  it('offline + sin modelo local → rules_only', () => {
    const d = decideAiMode(
      snap({ networkClass: 'offline', localModelLoaded: false }),
    );
    expect(d.mode).toBe('rules_only');
    expect(d.useRulesOnly).toBe(true);
  });

  it('userPref=local + modelo cargado → local_only sin advertencia', () => {
    const d = decideAiMode(
      snap({ userPref: 'local', localModelLoaded: true }),
    );
    expect(d.mode).toBe('local_only');
    expect(d.informUserOfDegradation).toBe(false);
  });

  it('userPref=local sin modelo → rules_only con advertencia', () => {
    const d = decideAiMode(
      snap({ userPref: 'local', localModelLoaded: false }),
    );
    expect(d.mode).toBe('rules_only');
    expect(d.informUserOfDegradation).toBe(true);
  });

  it('userPref=cloud + wifi → full_cloud', () => {
    const d = decideAiMode(snap({ userPref: 'cloud', networkClass: 'wifi' }));
    expect(d.mode).toBe('full_cloud');
    expect(d.useRulesOnly).toBe(false);
  });

  it('userPref=cloud + 4G → full_cloud', () => {
    const d = decideAiMode(
      snap({ userPref: 'cloud', networkClass: 'cellular_4g' }),
    );
    expect(d.mode).toBe('full_cloud');
  });

  it('userPref=cloud + 3G → cae a hybrid (red insuficiente)', () => {
    const d = decideAiMode(
      snap({ userPref: 'cloud', networkClass: 'cellular_3g' }),
    );
    expect(d.mode).toBe('cloud_with_local_fallback');
    expect(d.reason).toBe('poor_network_hybrid');
  });

  it('batería crítica con red buena → hybrid', () => {
    const d = decideAiMode(snap({ batteryClass: 'critical' }));
    expect(d.mode).toBe('cloud_with_local_fallback');
    expect(d.reason).toBe('battery_critical_hybrid');
    expect(d.informUserOfDegradation).toBe(true);
  });

  it('red pobre cellular_3g auto → hybrid', () => {
    const d = decideAiMode(snap({ networkClass: 'cellular_3g' }));
    expect(d.mode).toBe('cloud_with_local_fallback');
  });

  it('red edge_or_worse → hybrid (cliente intentará cloud, fallback al SLM)', () => {
    const d = decideAiMode(snap({ networkClass: 'edge_or_worse' }));
    expect(d.mode).toBe('cloud_with_local_fallback');
    expect(d.reason).toBe('poor_network_hybrid');
  });

  it('auto + wifi + batería plena → full_cloud', () => {
    const d = decideAiMode(snap({}));
    expect(d.mode).toBe('full_cloud');
    expect(d.reason).toBe('auto_good_network');
  });

  it('orden de prioridad: off gana sobre todo', () => {
    const d = decideAiMode(
      snap({
        userPref: 'off',
        networkClass: 'wifi',
        batteryClass: 'plenty',
        localModelLoaded: true,
      }),
    );
    expect(d.mode).toBe('rules_only');
  });

  it('default (auto + red OK pero batería low) → full_cloud (low no es critical)', () => {
    const d = decideAiMode(snap({ batteryClass: 'low' }));
    expect(d.mode).toBe('full_cloud');
  });

  it('default fallback genérico es híbrido', () => {
    // userPref=auto, network=cellular_4g, batería sufficient → full_cloud
    const d = decideAiMode(
      snap({ batteryClass: 'sufficient', networkClass: 'cellular_4g' }),
    );
    expect(d.mode).toBe('full_cloud');
  });

  it('shouldUseRulesOnly helper coincide con decisión', () => {
    expect(shouldUseRulesOnly(snap({ userPref: 'off' }))).toBe(true);
    expect(shouldUseRulesOnly(snap({ tenantBudgetExceeded: true }))).toBe(true);
    expect(shouldUseRulesOnly(snap({}))).toBe(false);
    expect(
      shouldUseRulesOnly(snap({ networkClass: 'offline', localModelLoaded: true })),
    ).toBe(false);
    expect(
      shouldUseRulesOnly(snap({ networkClass: 'offline', localModelLoaded: false })),
    ).toBe(true);
  });
});
