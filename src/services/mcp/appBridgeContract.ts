import {z} from 'zod';
const projectId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const APP_MCP_PROMPTS=['guardian.getChatResponse','guardian.queryBCN','guardian.getSafetyAdvice','guardian.calculateStructuralLoad','guardian.designHazmatStorage','guardian.evaluateMinsalCompliance'] as const;
export const appMcpRequest=z.discriminatedUnion('action',[
 z.object({projectId,action:z.literal('catalog')}).strict(),
 z.object({projectId,action:z.literal('listRecords')}).strict(),
 z.object({projectId,action:z.literal('listRelations')}).strict(),
 z.object({projectId,action:z.literal('searchNormative'),query:z.string().max(2000).trim().min(4)}).strict(),
 z.object({projectId,action:z.literal('preparePrompt'),name:z.enum(APP_MCP_PROMPTS),input:z.string().min(2).max(16000),contextApproved:z.literal(true)}).strict(),
]);
export type AppMcpRequest=z.infer<typeof appMcpRequest>;
