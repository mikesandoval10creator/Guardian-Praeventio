import { afterEach, expect, it, vi } from 'vitest';
import { investigateIncidentWithAI } from './geminiService';

vi.mock('./firebase', () => ({ auth: {} }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeaders: async () => ({}) }));

afterEach(() => vi.unstubAllGlobals());

const valid = { summary: 'Resumen', immediateCauses: [], rootCauses: [], correctiveActions: [] };

it('forwards the abort signal without changing the incident request body', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ result: valid }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(investigateIncidentWithAI('Incidente', 'Relato', '', { signal: controller.signal })).resolves.toEqual(valid);
  const request = fetchMock.mock.calls[0]?.[1];
  expect(request?.signal).toBe(controller.signal);
  expect(JSON.parse(String(request?.body))).toEqual({ action: 'investigateIncidentWithAI', args: ['Incidente', 'Relato', ''] });
});

function respondWith(result: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result })));
}

it.each([
  { result: null },
  { result: { summary: 'Incompleto' } },
  { result: { ...valid, rootCauses: 'No es una lista' } },
  { result: { ...valid, correctiveActions: [{ action: 'Revisar', priority: 'Otra' }] } },
  { result: { ...valid, globalRiskLesson: { title: 'Sin descripción' } } },
])('rejects a malformed incident analysis', async ({ result }) => {
  respondWith(result);
  await expect(investigateIncidentWithAI('Incidente', 'Relato', '')).rejects.toThrow('invalid_incident_analysis');
});

it.each([valid, {
  ...valid,
  correctiveActions: [{ action: 'Revisar', priority: 'Alta' }],
  globalRiskLesson: { title: 'Lección', description: 'Detalle' },
  legalRequirementNote: 'Nota',
}])('accepts a valid incident analysis', async (result) => {
  respondWith(result);
  await expect(investigateIncidentWithAI('Incidente', 'Relato', '')).resolves.toEqual(result);
});
