// Pure input contracts, shared by MCP server and browser forms. No SDK,
// provider, auth, storage or network imports. Shapes preserved from actionPrompts.
import {z} from 'zod';
export const MCP_PROMPT_INPUT_MAX_CHARS=16000;
const text = z.string().min(1).max(3000);
const optionalText = z.string().max(4000).optional();
export const actionPromptInputSchemas = {
  getChatResponse: z.tuple([text, optionalText,
    z.array(z.object({ role: z.enum(['user', 'assistant', 'model']), content: text }).strict()).max(8).optional(),
    z.number().int().min(1).max(3).optional(), z.enum(['general', 'sst', 'ergonomia', 'medicina', 'emergencias']).optional()]),
  queryBCN: z.tuple([z.string().min(4).max(2000)]),
  getSafetyAdvice: z.tuple([z.object({ temp: z.number().min(-100).max(100).optional(),
    uv: z.number().min(0).max(30).optional(),
    airQuality: z.union([z.number().min(0).max(1000), z.string().max(100)]).optional() }).strict()]),
  calculateStructuralLoad: z.tuple([text, text]),
  designHazmatStorage: z.tuple([text, z.number().positive().max(1e9), text]),
  evaluateMinsalCompliance: z.tuple([text, optionalText, z.string().max(300).optional()]),
};
export function parseActionPromptInput(name:string,input:string):unknown[]|null{
 const action=name.startsWith('guardian.')?name.slice('guardian.'.length):'';
 if(!Object.prototype.hasOwnProperty.call(actionPromptInputSchemas,action)||input.length>MCP_PROMPT_INPUT_MAX_CHARS)return null;
 try{return actionPromptInputSchemas[action as keyof typeof actionPromptInputSchemas].parse(JSON.parse(input));}catch{return null;}
}
