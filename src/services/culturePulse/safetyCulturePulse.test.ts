import { describe, it, expect } from 'vitest';
import {
  computePulseIndex,
  buildAreaPulses,
  buildPulseTrend,
  type PulseSurveyResponse,
} from './safetyCulturePulse.js';

function response(over: Partial<PulseSurveyResponse> & { responderHash: string }): PulseSurveyResponse {
  return {
    responderHash: over.responderHash,
    workerRole: 'worker',
    area: over.area ?? 'A',
    answers: over.answers ?? {
      felt_safe_today: 4,
      manager_listens: 4,
      free_to_stop: 4,
      reported_incident_safely: 4,
      has_resources_to_be_safe: 4,
    },
    submittedAt: over.submittedAt ?? '2026-05-11T10:00:00Z',
  };
}

describe('computePulseIndex', () => {
  it('vacío → level low', () => {
    const r = computePulseIndex([]);
    expect(r.level).toBe('low');
    expect(r.cultureIndex).toBe(0);
  });

  it('todas las respuestas en 5 → strong', () => {
    const responses = [1, 2, 3].map((i) =>
      response({
        responderHash: `h${i}`,
        answers: {
          felt_safe_today: 5,
          manager_listens: 5,
          free_to_stop: 5,
          reported_incident_safely: 5,
          has_resources_to_be_safe: 5,
        },
      }),
    );
    const r = computePulseIndex(responses);
    expect(r.cultureIndex).toBe(100);
    expect(r.level).toBe('strong');
  });

  it('todas las respuestas en 1 → low', () => {
    const responses = [1, 2, 3].map((i) =>
      response({
        responderHash: `h${i}`,
        answers: {
          felt_safe_today: 1,
          manager_listens: 1,
          free_to_stop: 1,
          reported_incident_safely: 1,
          has_resources_to_be_safe: 1,
        },
      }),
    );
    const r = computePulseIndex(responses);
    expect(r.cultureIndex).toBe(0);
    expect(r.level).toBe('low');
  });

  it('free_to_stop bajo → punitive flag', () => {
    const responses = [1, 2, 3].map((i) =>
      response({
        responderHash: `h${i}`,
        answers: {
          felt_safe_today: 4,
          manager_listens: 4,
          free_to_stop: 1, // bajo
          reported_incident_safely: 4,
          has_resources_to_be_safe: 4,
        },
      }),
    );
    const r = computePulseIndex(responses);
    expect(r.punitiveCulturedFlagged).toBe(true);
  });
});

describe('buildAreaPulses', () => {
  it('agrupa por área y ordena de peor a mejor', () => {
    const responses = [
      response({
        responderHash: 'h1',
        area: 'A',
        answers: {
          felt_safe_today: 5,
          manager_listens: 5,
          free_to_stop: 5,
          reported_incident_safely: 5,
          has_resources_to_be_safe: 5,
        },
      }),
      response({
        responderHash: 'h2',
        area: 'B',
        answers: {
          felt_safe_today: 1,
          manager_listens: 1,
          free_to_stop: 1,
          reported_incident_safely: 1,
          has_resources_to_be_safe: 1,
        },
      }),
    ];
    const pulses = buildAreaPulses(responses);
    expect(pulses[0].area).toBe('B'); // peor primero (cultureIndex menor)
    expect(pulses[1].area).toBe('A');
  });
});

describe('buildPulseTrend', () => {
  it('agrupa por periodo (default mensual)', () => {
    const r = buildPulseTrend([
      response({ responderHash: 'h1', submittedAt: '2026-03-15T10:00:00Z' }),
      response({ responderHash: 'h2', submittedAt: '2026-04-10T10:00:00Z' }),
      response({ responderHash: 'h3', submittedAt: '2026-04-20T10:00:00Z' }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].periodLabel).toBe('2026-03');
    expect(r[1].periodLabel).toBe('2026-04');
    expect(r[1].responses).toBe(2);
  });
});
