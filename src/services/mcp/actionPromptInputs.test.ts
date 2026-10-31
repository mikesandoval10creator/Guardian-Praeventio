import {describe,it,expect} from 'vitest';
import {parseActionPromptInput,MCP_PROMPT_INPUT_MAX_CHARS} from './actionPromptInputs';
import {withinAppMcpBudget,APP_MCP_MAX_REQUEST_BYTES} from './appBridgeContract';
describe('pure shared MCP input validation',()=>{
 it.each(['guardian.__proto__','guardian.constructor','guardian.toString','queryBCN','guardian.unknown'])('rejects unknown registry keys %s',name=>{expect(parseActionPromptInput(name,'["DS 44"]')).toBeNull();});
 it.each(['','{}','null','[null]','["a"]','["DS 44","extra"]'])('rejects invalid query tuple %s',input=>{expect(parseActionPromptInput('guardian.queryBCN',input)).toBeNull();});
 it('keeps optional legacy chat arguments and rejects null holes',()=>{
  expect(parseActionPromptInput('guardian.getChatResponse','["Pregunta"]')).toEqual(['Pregunta']);
  expect(parseActionPromptInput('guardian.getChatResponse','["Pregunta",null,[],2]')).toBeNull();
  expect(parseActionPromptInput('guardian.getChatResponse','["Pregunta","",[{"role":"model","content":"Historial"}],2,"sst"]')).not.toBeNull();
 });
 it('keeps safety input strict and rejects oversized numeric values',()=>{
  expect(parseActionPromptInput('guardian.getSafetyAdvice','[{"temp":0,"uv":0}]')).toEqual([{temp:0,uv:0}]);
  expect(parseActionPromptInput('guardian.getSafetyAdvice','[{"temp":0,"hidden":"instruction"}]')).toBeNull();
  expect(parseActionPromptInput('guardian.getSafetyAdvice','[{"uv":1e309}]')).toBeNull();
 });
 it('enforces serialized input char limit, not just schema field lengths',()=>{
  const validButTooLong='["DS 44"]'+' '.repeat(MCP_PROMPT_INPUT_MAX_CHARS);
  expect(JSON.parse(validButTooLong)).toEqual(['DS 44']);expect(parseActionPromptInput('guardian.queryBCN',validButTooLong)).toBeNull();
 });
 it('measures full nested UTF-8 JSON and rejects cyclic/nonserializable values',()=>{
  expect(withinAppMcpBudget({text:'plain'})).toBe(true);
  expect(withinAppMcpBudget({text:'字'.repeat(APP_MCP_MAX_REQUEST_BYTES)})).toBe(false);
  const circular:Record<string,unknown>={};circular.self=circular;expect(withinAppMcpBudget(circular)).toBe(false);expect(withinAppMcpBudget(undefined)).toBe(false);
 });
});
