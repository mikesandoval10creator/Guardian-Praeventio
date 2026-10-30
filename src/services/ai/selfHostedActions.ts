// Compatibility boundary: shared prompt specs, existing backend collaborators.
import { createActionPromptSpecs } from './actionPromptSpecs.js';
export type { SelfHostedActionSpec } from './actionPromptSpecs.js';

export const SELF_HOSTED_ACTION_SPECS = createActionPromptSpecs({
  retrieveLegalContext: async query => {
    const { retrieveNativeNormative } = await import('../../server/rag/publicLawReader.js');
    const { formatNormativeContext } = await import('../rag/nativeNormativeContext.js');
    return formatNormativeContext(await retrieveNativeNormative(query));
  },
  loadRedactor: async () => {
    const { redactPromptForVertex } = await import('../gemini/_shared.js');
    return redactPromptForVertex;
  },
});

export function hasSelfHostedActionSpec(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(SELF_HOSTED_ACTION_SPECS, action);
}
