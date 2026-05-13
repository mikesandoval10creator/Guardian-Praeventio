import { describe, it, expect } from 'vitest';
import {
  buildAdminBurdenReport,
  listAdminTaskKinds,
  AdminBurdenValidationError,
  type AdminTaskTimeEntry,
} from './adminBurdenTracker.js';
import {
  suggestAutomations,
  totalSavedMinutesPerWeek,
} from './automationSuggester.js';

const W = '2026-W19';
const W2 = '2026-W20';

function entry(
  kind: AdminTaskTimeEntry['taskKind'],
  workerUid: string,
  minutes: number,
  week: string = W,
  automatable = true,
): AdminTaskTimeEntry {
  return { taskKind: kind, workerUid, timeSpentMinutes: minutes, periodWeek: week, automatable };
}

describe('adminBurdenTracker — buildAdminBurdenReport', () => {
  it('retorna reporte cero cuando entries vacío', () => {
    const r = buildAdminBurdenReport([]);
    expect(r.totalMinutesPerWeek).toBe(0);
    expect(r.totalHoursPerMonth).toBe(0);
    expect(r.pctOfWorkWeek).toBe(0);
    expect(r.byKind).toEqual([]);
    expect(r.workerRanking).toEqual([]);
    expect(r.automatableMinutesPerWeek).toBe(0);
    expect(r.verdict).toBe('healthy');
  });

  it('promedia por semanas distintas observadas, no por entries totales', () => {
    const entries = [
      entry('data_entry', 'w1', 120, W),
      entry('data_entry', 'w1', 120, W2),
    ];
    const r = buildAdminBurdenReport(entries);
    // 240 min totales / 2 semanas = 120 min/sem
    expect(r.totalMinutesPerWeek).toBe(120);
  });

  it('calcula totalHoursPerMonth con factor 4.33 semanas', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 600, W)]);
    // 600 min/sem * 4.33 / 60 = 43.3 h/mes
    expect(r.totalHoursPerMonth).toBe(43.3);
  });

  it('calcula pctOfWorkWeek sobre base 2400 min', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 600, W)]);
    // 600 / 2400 = 25%
    expect(r.pctOfWorkWeek).toBe(25);
  });

  it('byKind ordenado desc por minutos y suma 100% (≈)', () => {
    const entries = [
      entry('data_entry', 'w1', 200, W),
      entry('manual_report', 'w1', 100, W),
      entry('signature_collection', 'w1', 50, W),
    ];
    const r = buildAdminBurdenReport(entries);
    expect(r.byKind[0].kind).toBe('data_entry');
    expect(r.byKind[r.byKind.length - 1].kind).toBe('signature_collection');
    const sumPct = r.byKind.reduce((s, x) => s + x.pct, 0);
    expect(sumPct).toBeGreaterThanOrEqual(99.5);
    expect(sumPct).toBeLessThanOrEqual(100.5);
  });

  it('agrega minutos del mismo kind aunque sean workers/semanas distintos', () => {
    const entries = [
      entry('data_entry', 'w1', 60, W),
      entry('data_entry', 'w2', 60, W),
      entry('data_entry', 'w1', 60, W2),
    ];
    const r = buildAdminBurdenReport(entries);
    // 180 min / 2 semanas = 90 min/sem
    const dataEntry = r.byKind.find((x) => x.kind === 'data_entry');
    expect(dataEntry?.minutes).toBe(90);
  });

  it('automatableMinutesPerWeek sólo cuenta entries marcados automatable', () => {
    const entries = [
      entry('data_entry', 'w1', 100, W, true),
      entry('phone_followup', 'w1', 100, W, false),
    ];
    const r = buildAdminBurdenReport(entries);
    expect(r.automatableMinutesPerWeek).toBe(100);
  });

  it('workerRanking ordenado desc por minutos/semana', () => {
    const entries = [
      entry('data_entry', 'w_low', 30, W),
      entry('data_entry', 'w_high', 600, W),
      entry('data_entry', 'w_mid', 200, W),
    ];
    const r = buildAdminBurdenReport(entries);
    expect(r.workerRanking.map((x) => x.workerUid)).toEqual(['w_high', 'w_mid', 'w_low']);
  });

  it('verdict healthy cuando peor worker <20%', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 200, W)]);
    // 200/2400 = 8.3%
    expect(r.verdict).toBe('healthy');
  });

  it('verdict concerning para peor worker 20-40%', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 600, W)]);
    // 25%
    expect(r.verdict).toBe('concerning');
  });

  it('verdict critical para peor worker 40-60%', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 1200, W)]);
    // 50%
    expect(r.verdict).toBe('critical');
  });

  it('verdict extreme para peor worker >=60%', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 1500, W)]);
    // 62.5%
    expect(r.verdict).toBe('extreme');
  });

  it('verdict se basa en el peor worker (no se diluye con promedio)', () => {
    const entries = [
      entry('data_entry', 'overloaded', 1500, W), // 62.5% solo
      entry('data_entry', 'healthy1', 60, W),
      entry('data_entry', 'healthy2', 60, W),
    ];
    const r = buildAdminBurdenReport(entries);
    expect(r.verdict).toBe('extreme');
  });

  it('lanza AdminBurdenValidationError ante periodWeek inválido', () => {
    expect(() =>
      buildAdminBurdenReport([
        { taskKind: 'data_entry', workerUid: 'w1', timeSpentMinutes: 10, periodWeek: '2026-19', automatable: true },
      ]),
    ).toThrow(AdminBurdenValidationError);
  });

  it('lanza error ante timeSpentMinutes negativo', () => {
    expect(() =>
      buildAdminBurdenReport([
        { taskKind: 'data_entry', workerUid: 'w1', timeSpentMinutes: -5, periodWeek: W, automatable: true },
      ]),
    ).toThrow(AdminBurdenValidationError);
  });

  it('lanza error ante taskKind inválido', () => {
    expect(() =>
      buildAdminBurdenReport([
        // @ts-expect-error invalid
        { taskKind: 'foo', workerUid: 'w1', timeSpentMinutes: 10, periodWeek: W, automatable: true },
      ]),
    ).toThrow(AdminBurdenValidationError);
  });

  it('listAdminTaskKinds expone 8 tipos canónicos', () => {
    const kinds = listAdminTaskKinds();
    expect(kinds.length).toBe(8);
    expect(kinds).toContain('data_entry');
    expect(kinds).toContain('inbox_triage');
  });
});

describe('automationSuggester — suggestAutomations', () => {
  it('sugiere automatización para cada kind presente en el reporte', () => {
    const r = buildAdminBurdenReport([
      entry('data_entry', 'w1', 200, W),
      entry('signature_collection', 'w1', 100, W),
    ]);
    const s = suggestAutomations(r);
    const kinds = s.map((x) => x.forKind);
    expect(kinds).toContain('data_entry');
    expect(kinds).toContain('signature_collection');
  });

  it('mapea data_entry → Importador Excel + validador (config, 0.9)', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 200, W)]);
    const s = suggestAutomations(r);
    const dataEntry = s.find((x) => x.forKind === 'data_entry');
    expect(dataEntry?.replacementFeature).toBe('Importador Excel + validador');
    expect(dataEntry?.implementationEffort).toBe('config');
    expect(dataEntry?.confidence).toBe(0.9);
  });

  it('mapea signature_collection → QR Ack (training, 0.95)', () => {
    const r = buildAdminBurdenReport([entry('signature_collection', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    expect(s[0].replacementFeature).toBe('QR Acknowledgement Sessions');
    expect(s[0].implementationEffort).toBe('training');
    expect(s[0].confidence).toBe(0.95);
  });

  it('mapea manual_pdf_export → Auditoría Express Bundle', () => {
    const r = buildAdminBurdenReport([entry('manual_pdf_export', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    expect(s[0].replacementFeature).toBe('Auditoría Express Bundle');
  });

  it('mapea duplicate_filing → Document Versioning (conf 0.85)', () => {
    const r = buildAdminBurdenReport([entry('duplicate_filing', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    expect(s[0].replacementFeature).toBe('Document Versioning');
    expect(s[0].confidence).toBe(0.85);
  });

  it('mapea phone_followup → Inbox Prevencionista (training, conf 0.7)', () => {
    const r = buildAdminBurdenReport([entry('phone_followup', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    expect(s[0].replacementFeature).toBe('Inbox Prevencionista + FCM notif');
    expect(s[0].confidence).toBe(0.7);
  });

  it('mapea manual_report → Monthly Client Report auto', () => {
    const r = buildAdminBurdenReport([entry('manual_report', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    expect(s[0].replacementFeature).toBe('Monthly Client Report auto');
    expect(s[0].confidence).toBe(0.85);
  });

  it('savedMinutesPerWeek es ratio del tiempo manual (no 100%)', () => {
    const r = buildAdminBurdenReport([entry('data_entry', 'w1', 100, W)]);
    const s = suggestAutomations(r);
    // ratio 0.85 → 85 min
    expect(s[0].savedMinutesPerWeek).toBe(85);
  });

  it('ordena desc por minutos ahorrados', () => {
    const r = buildAdminBurdenReport([
      entry('data_entry', 'w1', 400, W),
      entry('phone_followup', 'w1', 50, W),
    ]);
    const s = suggestAutomations(r);
    expect(s[0].forKind).toBe('data_entry');
    expect(s[s.length - 1].forKind).toBe('phone_followup');
  });

  it('totalSavedMinutesPerWeek suma todas las sugerencias', () => {
    const r = buildAdminBurdenReport([
      entry('data_entry', 'w1', 100, W),
      entry('signature_collection', 'w1', 100, W),
    ]);
    const s = suggestAutomations(r);
    const total = totalSavedMinutesPerWeek(s);
    // 85 + 90 = 175
    expect(total).toBe(175);
  });

  it('reporte vacío produce sugerencias vacías', () => {
    const r = buildAdminBurdenReport([]);
    expect(suggestAutomations(r)).toEqual([]);
    expect(totalSavedMinutesPerWeek([])).toBe(0);
  });
});
