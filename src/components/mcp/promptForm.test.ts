import {describe,it,expect} from 'vitest';
import {compilePromptForm,emptyPromptFields,type PromptName,type PromptFields} from './promptForm';
import {parseActionPromptInput} from '../../services/mcp/actionPromptInputs';
const cases:Array<{name:PromptName;fields:Partial<PromptFields>;args:unknown[]}>= [
 {name:'guardian.getChatResponse',fields:{question:'Revisa ergonomía',detail:'3',domain:'ergonomia'},args:['Revisa ergonomía','',[],3,'ergonomia']},
 {name:'guardian.getSafetyAdvice',fields:{temperature:'0',uv:'0',airQuality:'observación sintética'},args:[{temp:0,uv:0,airQuality:'observación sintética'}]},
 {name:'guardian.calculateStructuralLoad',fields:{element:'Elemento sintético',specs:'Especificaciones por revisar'},args:['Elemento sintético','Especificaciones por revisar']},
 {name:'guardian.designHazmatStorage',fields:{storageType:'Bodega sintética, litros',volume:'2.5',materialClass:'Clase por revisar'},args:['Bodega sintética, litros',2.5,'Clase por revisar']},
 {name:'guardian.evaluateMinsalCompliance',fields:{protocol:'Protocolo por revisar',observations:'Observaciones sintéticas',industry:'Sector declarado'},args:['Protocolo por revisar','Observaciones sintéticas','Sector declarado']},
 ];
describe('MCP human fields compile to the canonical positional contract',()=>{
 it.each([
  {observations:'',industry:'',args:['Protocolo']},
  {observations:'Observación',industry:'',args:['Protocolo','Observación']},
  {observations:'',industry:'Sector',args:['Protocolo','','Sector']},
 ])('omits absent trailing MINSAL slots without null holes %j',({observations,industry,args})=>{
  expect(compilePromptForm('guardian.evaluateMinsalCompliance',{...emptyPromptFields(),protocol:'Protocolo',observations,industry})).toEqual({ok:true,input:JSON.stringify(args)});
 });
 it.each(cases)('compiles $name to its real tuple without null holes',({name,fields,args})=>{
  const compiled=compilePromptForm(name,{...emptyPromptFields(),...fields});expect(compiled).toEqual({ok:true,input:JSON.stringify(args)});
  if(compiled.ok)expect(parseActionPromptInput(name,compiled.input)).toEqual(args);
 });
 it('leaves missing environmental measurements missing instead of zero',()=>{
  expect(compilePromptForm('guardian.getSafetyAdvice',emptyPromptFields())).toEqual({ok:true,input:'[{}]'});
 });
 it.each(['NaN','Infinity','-Infinity','0x10','1,5','1foo','31'])('rejects UV invalid numeric text %s',uv=>{
  expect(compilePromptForm('guardian.getSafetyAdvice',{...emptyPromptFields(),uv}).ok).toBe(false);
 });
 it.each(['','0','-1','1e10'])('rejects unavailable/nonpositive/out-of-range quantity %s',volume=>{
  expect(compilePromptForm('guardian.designHazmatStorage',{...emptyPromptFields(),storageType:'Bodega litros',materialClass:'Clase',volume}).ok).toBe(false);
 });
 it.each(['guardian.getChatResponse','guardian.queryBCN','guardian.calculateStructuralLoad','guardian.designHazmatStorage','guardian.evaluateMinsalCompliance'] as const)('does not invent required data for %s',name=>{
  expect(compilePromptForm(name,emptyPromptFields()).ok).toBe(false);
 });
 it('prepares BCN question literally without requiring JSON from the user',()=>{
  expect(compilePromptForm('guardian.queryBCN',{...emptyPromptFields(),question:'  DS 44 y ruido  '})).toEqual({ok:true,input:'["  DS 44 y ruido  "]'});
 });
});
