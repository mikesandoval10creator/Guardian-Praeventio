/**
 * Smoke: country detection → pack load → switch + per-project alerts.
 *
 * Crosses normativa/locationNormativa, normativa/countryPacks, and
 * capacity/normativeAlerts. We pin a few regulatory thresholds (Comité
 * Paritario @ 25 workers, Departamento de Prevención @ 100 workers) so a
 * silent edit of those constants — which would change legal compliance
 * for every Chilean customer — fails CI before merge.
 */
import { describe, expect, it } from 'vitest';

import { evaluateNormativeAlerts } from '../services/capacity/normativeAlerts';
import {
  COUNTRY_PACKS,
  type CountryCode,
  getPackByCode,
} from '../services/normativa/countryPacks';
import { countryFromCoords } from '../services/normativa/locationNormativa';

describe('smoke: normativa flow', () => {
  it('countryFromCoords(-33.45, -70.66) → CL (Santiago)', () => {
    expect(countryFromCoords(-33.45, -70.66)).toBe('CL');
  });

  it('CL pack: comiteRequiredAtWorkers === 25', () => {
    const cl = getPackByCode('CL');
    expect(cl.thresholds.comiteRequiredAtWorkers).toBe(25);
  });

  it('PE pack code is "PE"', () => {
    const pe = getPackByCode('PE');
    expect(pe.code).toBe('PE');
  });

  it('every country pack returns at least 5 regulations', () => {
    const codes: CountryCode[] = ['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO'];
    for (const code of codes) {
      const pack = COUNTRY_PACKS[code];
      expect(
        pack.regulations.length,
        `pack ${code} has too few regulations`,
      ).toBeGreaterThanOrEqual(5);
    }
  });

  it('evaluateNormativeAlerts: 24 workers → no alerts', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 24 }]);
    expect(alerts).toEqual([]);
  });

  it('evaluateNormativeAlerts: 25 workers → 1 alert (comite-paritario-required)', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 25 }]);
    expect(alerts.length).toBe(1);
    expect(alerts[0].rule).toBe('comite-paritario-required');
  });

  it('evaluateNormativeAlerts: 100 workers → 2 alerts (both rules)', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 100 }]);
    expect(alerts.length).toBe(2);
    const rules = alerts.map((a) => a.rule).sort();
    expect(rules).toEqual([
      'comite-paritario-required',
      'departamento-prevencion-required',
    ]);
  });
});
