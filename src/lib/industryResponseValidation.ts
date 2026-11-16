import { z } from 'zod';

export type IndustryResponseDecoder<T> = (payload: unknown, status: number) => T;

/** A malformed success payload is not an empty safety-requirements list. */
export class IndustryResponseValidationError extends Error {
  readonly code = 'industry_response_invalid';
  constructor(readonly status: number) {
    super('La respuesta de industria está incompleta o no es válida. No se pudieron confirmar los requisitos. Intenta nuevamente.');
    this.name = 'IndustryResponseValidationError';
  }
}

function decoder<T>(schema: z.ZodType<T>): IndustryResponseDecoder<T> {
  return (payload, status) => {
    const result = schema.safeParse(payload);
    if (!result.success) throw new IndustryResponseValidationError(status);
    return result.data;
  };
}
const text = z.string().refine((value) => value.trim().length > 0);
const texts = z.array(text);
export const decodeRequiredEpp = decoder(z.object({ industryPrefix: text, baseEpp: texts }));
export const decodeIndustryList = decoder(z.object({
  presets: z.array(z.object({ prefix: text, label: text })),
}));
export const decodeApplicableNorms = decoder(z.object({
  industryPrefix: text, applicableRegulations: texts, minsalProtocols: texts,
}));
export const decodeTypicalHazards = decoder(z.object({
  industryPrefix: text, label: text, typicalRisks: texts,
  mandatoryDocuments: texts, mandatoryTrainings: texts,
}));
const severity = z.enum(['medium', 'high']);
const preset = z.object({
  industryPrefix: text, label: text, typicalRisks: texts,
  mandatoryDocuments: texts, mandatoryTrainings: texts, baseEpp: texts,
  applicableRegulations: texts, minsalProtocols: texts,
  isFallback: z.boolean().optional(),
  severityOverrides: z.record(z.string(), severity).optional(),
});
const application = z.object({
  projectId: text, industryPrefix: text,
  risksToCreate: z.array(z.object({ riskType: text, severity })),
  documentsToGenerate: texts, trainingsToSchedule: texts, baseEppToAssign: texts,
  regulationsToLink: texts, protocolsToActivate: texts,
});
export const decodeIndustrySelection = decoder(z.object({ application, preset }));
