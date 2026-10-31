import {z} from 'zod';
import {MCP_PROMPT_INPUT_MAX_CHARS} from './actionPromptInputs.js';
export const APP_MCP_MAX_REQUEST_BYTES=32*1024;
export function withinAppMcpBudget(value:unknown):boolean{
 try{const json=JSON.stringify(value);return typeof json==='string'&&new TextEncoder().encode(json).byteLength<=APP_MCP_MAX_REQUEST_BYTES;}catch{return false;}
}
const projectId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const APP_MCP_PROMPTS=['guardian.getChatResponse','guardian.queryBCN','guardian.getSafetyAdvice','guardian.calculateStructuralLoad','guardian.designHazmatStorage','guardian.evaluateMinsalCompliance'] as const;
export const appMcpRequest=z.discriminatedUnion('action',[
 z.object({projectId,action:z.literal('catalog')}).strict(),
 z.object({projectId,action:z.literal('listRecords')}).strict(),
 z.object({projectId,action:z.literal('listRelations')}).strict(),
 z.object({projectId,action:z.literal('searchNormative'),query:z.string().max(2000).trim().min(4)}).strict(),
 z.object({projectId,action:z.literal('preparePrompt'),name:z.enum(APP_MCP_PROMPTS),input:z.string().min(2).max(MCP_PROMPT_INPUT_MAX_CHARS),contextApproved:z.literal(true)}).strict(),
]);
export type AppMcpRequest=z.infer<typeof appMcpRequest>;
