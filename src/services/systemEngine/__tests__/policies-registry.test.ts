import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetRegistryForTests,
  listPolicies,
  policiesFor,
  registerPolicy,
  unregisterPolicy,
} from '../policies';
import type { Policy } from '../policies/policy.types';

const noop: Policy<'fall_detected'> = {
  id: 'noop.fall',
  description: 'noop fall',
  priority: 'P2',
  trigger: ['fall_detected'],
  evaluate: () => [],
};

afterEach(() => {
  __resetRegistryForTests();
});

describe('policy registry', () => {
  it('register + listPolicies round-trips', () => {
    registerPolicy(noop);
    const all = listPolicies();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('noop.fall');
  });

  it('refuses duplicate ids', () => {
    registerPolicy(noop);
    expect(() => registerPolicy(noop)).toThrow(/collision/);
  });

  it('policiesFor only returns policies whose trigger matches', () => {
    registerPolicy(noop);
    expect(policiesFor('fall_detected')).toHaveLength(1);
    expect(policiesFor('weather_alert')).toHaveLength(0);
  });

  it('unregisterPolicy removes the policy', () => {
    registerPolicy(noop);
    expect(unregisterPolicy('noop.fall')).toBe(true);
    expect(listPolicies()).toHaveLength(0);
  });
});
