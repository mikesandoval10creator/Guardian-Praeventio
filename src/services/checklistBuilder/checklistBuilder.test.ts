import { describe, it, expect } from 'vitest';
import {
  validateResponse,
  rectifyField,
  applySignature,
  lockResponse,
  RectificationError,
  type ChecklistTemplate,
  type ChecklistResponse,
} from './checklistBuilder.js';

const NOW = new Date('2026-05-13T10:00:00Z');

const TEMPLATE: ChecklistTemplate = {
  id: 'inspection-altura-v1',
  version: '1.0.0',
  category: 'inspection',
  title: 'Inspección trabajo altura',
  sections: [
    {
      id: 'epp',
      title: 'EPP',
      fields: [
        {
          id: 'arnes_present',
          kind: 'boolean',
          label: 'Arnés presente',
          required: true,
        },
        {
          id: 'arnes_serial',
          kind: 'text',
          label: 'Serial arnés',
          required: true,
          conditionalOn: { fieldId: 'arnes_present', requiredValues: ['true'] },
        },
        {
          id: 'wind_speed',
          kind: 'number',
          label: 'Velocidad viento (km/h)',
          required: true,
          minValue: 0,
          maxValue: 80,
        },
        {
          id: 'risk_factors',
          kind: 'multi_choice',
          label: 'Factores de riesgo',
          required: false,
          options: [
            { value: 'rain', label: 'Lluvia', riskWeight: 5 },
            { value: 'ice', label: 'Hielo', riskWeight: 10 },
            { value: 'fatigue', label: 'Fatiga', riskWeight: 8 },
          ],
        },
      ],
    },
  ],
  requiredSignatures: [
    { role: 'supervisor', attestationText: 'Confirmo la inspección.' },
    { role: 'worker', attestationText: 'Confirmo haber recibido EPP.' },
  ],
};

function baseResponse(over: Partial<ChecklistResponse> = {}): ChecklistResponse {
  return {
    templateId: 'inspection-altura-v1',
    templateVersion: '1.0.0',
    responseId: 'resp-1',
    startedAt: NOW.toISOString(),
    responses: [],
    locked: false,
    ...over,
  };
}

describe('validateResponse — required fields', () => {
  it('faltan required → missing_required_field findings', () => {
    const r = validateResponse(TEMPLATE, baseResponse());
    expect(r.valid).toBe(false);
    expect(r.findings.some((f) => f.kind === 'missing_required_field' && f.fieldId === 'arnes_present')).toBe(true);
    expect(r.findings.some((f) => f.kind === 'missing_required_field' && f.fieldId === 'wind_speed')).toBe(true);
  });

  it('todos los required completos → valid', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: true },
          { fieldId: 'arnes_serial', value: 'ARN-123' },
          { fieldId: 'wind_speed', value: 12 },
        ],
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.completionScore).toBe(100);
  });
});

describe('validateResponse — conditional fields', () => {
  it('arnes_present=false → arnes_serial NO se exige', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 10 },
        ],
      }),
    );
    expect(r.findings.some((f) => f.fieldId === 'arnes_serial')).toBe(false);
  });

  it('arnes_present=true → arnes_serial se exige', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: true },
          { fieldId: 'wind_speed', value: 10 },
        ],
      }),
    );
    expect(r.findings.some((f) => f.fieldId === 'arnes_serial')).toBe(true);
  });
});

describe('validateResponse — range checks', () => {
  it('wind_speed fuera de rango → value_out_of_range', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 200 },
        ],
      }),
    );
    expect(r.findings.some((f) => f.kind === 'value_out_of_range')).toBe(true);
  });
});

describe('validateResponse — multi_choice + riskScore', () => {
  it('suma riskWeight de opciones seleccionadas', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 10 },
          { fieldId: 'risk_factors', value: ['rain', 'fatigue'] },
        ],
      }),
    );
    expect(r.riskScore).toBe(13); // 5 + 8
  });

  it('choice inválida → invalid_choice_value', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 10 },
          { fieldId: 'risk_factors', value: ['fake_option'] },
        ],
      }),
    );
    expect(r.findings.some((f) => f.kind === 'invalid_choice_value')).toBe(true);
  });
});

describe('validateResponse — signatures', () => {
  it('locked response sin firmas requeridas → missing_signature_role', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        locked: true,
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 10 },
        ],
      }),
    );
    expect(r.findings.filter((f) => f.kind === 'missing_signature_role')).toHaveLength(2);
  });

  it('locked response con ambas firmas → valid', () => {
    const r = validateResponse(
      TEMPLATE,
      baseResponse({
        locked: true,
        responses: [
          { fieldId: 'arnes_present', value: false },
          { fieldId: 'wind_speed', value: 10 },
          {
            fieldId: 'signature:supervisor',
            value: 'iVBORw0KGgo=',
            signatureMeta: { role: 'supervisor', signedAt: NOW.toISOString(), signedByUid: 'sup-1' },
          },
          {
            fieldId: 'signature:worker',
            value: 'iVBORw0KGgo=',
            signatureMeta: { role: 'worker', signedAt: NOW.toISOString(), signedByUid: 'w-1' },
          },
        ],
      }),
    );
    expect(r.findings.filter((f) => f.kind === 'missing_signature_role')).toHaveLength(0);
  });
});

describe('rectifyField', () => {
  it('rechaza si NO está locked', () => {
    const r = baseResponse({ responses: [{ fieldId: 'wind_speed', value: 10 }] });
    expect(() =>
      rectifyField({
        response: r,
        fieldId: 'wind_speed',
        newValue: 15,
        reason: 'Lectura corregida',
        rectifiedByUid: 'sup-1',
        now: NOW,
      }),
    ).toThrowError(RectificationError);
  });

  it('rechaza reason demasiado corto', () => {
    const r = baseResponse({ locked: true, responses: [{ fieldId: 'wind_speed', value: 10 }] });
    expect(() =>
      rectifyField({
        response: r,
        fieldId: 'wind_speed',
        newValue: 15,
        reason: 'err',
        rectifiedByUid: 'sup-1',
        now: NOW,
      }),
    ).toThrowError(/reason_too_short/);
  });

  it('aplica rectificación con audit trail', () => {
    const r = baseResponse({ locked: true, responses: [{ fieldId: 'wind_speed', value: 10 }] });
    const updated = rectifyField({
      response: r,
      fieldId: 'wind_speed',
      newValue: 15,
      reason: 'Lectura corregida por instrumento nuevo',
      rectifiedByUid: 'sup-1',
      now: NOW,
    });
    const field = updated.responses.find((x) => x.fieldId === 'wind_speed')!;
    expect(field.value).toBe(15);
    expect(field.rectifiedFrom?.previousValue).toBe(10);
    expect(field.rectifiedFrom?.rectifiedByUid).toBe('sup-1');
  });
});

describe('applySignature + lockResponse', () => {
  it('applySignature agrega field signature:{role}', () => {
    const r = baseResponse();
    const signed = applySignature({
      response: r,
      role: 'supervisor',
      signedByUid: 'sup-1',
      signaturePng: 'iVBORw0KGgo=',
      now: NOW,
    });
    const sig = signed.responses.find((x) => x.fieldId === 'signature:supervisor');
    expect(sig).toBeDefined();
    expect(sig?.signatureMeta?.role).toBe('supervisor');
  });

  it('applySignature reemplaza firma previa del mismo rol', () => {
    const r1 = applySignature({
      response: baseResponse(),
      role: 'supervisor',
      signedByUid: 'sup-1',
      signaturePng: 'old',
      now: NOW,
    });
    const r2 = applySignature({
      response: r1,
      role: 'supervisor',
      signedByUid: 'sup-2',
      signaturePng: 'new',
      now: NOW,
    });
    const sigs = r2.responses.filter((x) => x.fieldId === 'signature:supervisor');
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.signatureMeta?.signedByUid).toBe('sup-2');
  });

  it('lockResponse marca completedAt + locked', () => {
    const r = lockResponse(baseResponse(), NOW);
    expect(r.locked).toBe(true);
    expect(r.completedAt).toBe(NOW.toISOString());
  });

  it('lockResponse en respuesta ya locked → noop', () => {
    const initial = lockResponse(baseResponse(), NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const re = lockResponse(initial, later);
    expect(re.completedAt).toBe(initial.completedAt); // no cambia
  });
});
