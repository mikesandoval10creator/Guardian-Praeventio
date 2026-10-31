import {parseActionPromptInput} from '../../services/mcp/actionPromptInputs';
import type {APP_MCP_PROMPTS} from '../../services/mcp/appBridgeContract';
export type PromptName=typeof APP_MCP_PROMPTS[number];
export const emptyPromptFields=()=>({question:'',detail:'1',domain:'general',temperature:'',uv:'',airQuality:'',element:'',specs:'',storageType:'',volume:'',materialClass:'',protocol:'',observations:'',industry:''});
export type PromptFields=ReturnType<typeof emptyPromptFields>;
export type CompiledPrompt={ok:true;input:string}|{ok:false;error:string};
function decimal(value:string):number|undefined{
 const text=value.trim();if(!text)return undefined;
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))throw new Error('invalid_decimal');
 const number=Number(text);if(!Number.isFinite(number))throw new Error('invalid_decimal');return number;
}
export function compilePromptForm(name:PromptName,fields:PromptFields):CompiledPrompt{
 const missing={ok:false as const,error:'Completa los campos de esta acción con datos válidos.'};
 const required=(...values:string[])=>values.every(value=>value.trim().length>0);
 let args:unknown[];
 try{
  switch(name){
   case 'guardian.queryBCN':
    if(fields.question.trim().length<4)return missing;args=[fields.question];break;
   case 'guardian.getChatResponse':
    if(!required(fields.question))return missing;
    // No JSON null holes: context is server-owned and history starts empty.
    args=[fields.question,'',[],decimal(fields.detail),fields.domain];break;
   case 'guardian.getSafetyAdvice':
    args=[{temp:decimal(fields.temperature),uv:decimal(fields.uv),...(fields.airQuality.trim()?{airQuality:fields.airQuality}:{})}];break;
   case 'guardian.calculateStructuralLoad':
    if(!required(fields.element,fields.specs))return missing;args=[fields.element,fields.specs];break;
   case 'guardian.designHazmatStorage':
    if(!required(fields.storageType,fields.volume,fields.materialClass))return missing;
    args=[fields.storageType,decimal(fields.volume),fields.materialClass];break;
   case 'guardian.evaluateMinsalCompliance':
    if(!required(fields.protocol))return missing;
    args=fields.industry?[fields.protocol,fields.observations,fields.industry]:fields.observations?[fields.protocol,fields.observations]:[fields.protocol];break;
  }
 }catch{return{ok:false,error:'Usa números decimales finitos con punto, dentro de los rangos indicados.'};}
 const input=JSON.stringify(args);
 return parseActionPromptInput(name,input)?{ok:true,input}:{ok:false,error:'Revisa los rangos, longitud y campos requeridos antes de preparar.'};
}
