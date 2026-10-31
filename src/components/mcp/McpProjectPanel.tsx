import React,{useEffect,useId,useRef,useState} from 'react';
import {z} from 'zod';

import {humanErrorMessage} from '../../lib/humanError';
import {APP_MCP_PROMPTS,type AppMcpRequest} from '../../services/mcp/appBridgeContract';
const envelope=z.object({protocol:z.literal('mcp-sdk'),mode:z.literal('internal-read-only'),action:z.string(),result:z.unknown(),auditRecorded:z.boolean()});
const catalogSchema=z.object({tools:z.array(z.object({name:z.string()})).max(3),prompts:z.array(z.object({name:z.enum(APP_MCP_PROMPTS)})).max(6)});
const labels:Record<typeof APP_MCP_PROMPTS[number],string>={
 'guardian.getChatResponse':'Chat del proyecto', 'guardian.queryBCN':'Consulta normativa BCN',
 'guardian.getSafetyAdvice':'Asesoría ambiental consultiva', 'guardian.calculateStructuralLoad':'Análisis estructural consultivo',
 'guardian.designHazmatStorage':'Almacenamiento de materiales peligrosos', 'guardian.evaluateMinsalCompliance':'Revisión MINSAL consultiva',
};
const signatures:Record<typeof APP_MCP_PROMPTS[number],string>={
 'guardian.getChatResponse':'["pregunta"]', 'guardian.queryBCN':'["consulta normativa"]',
 'guardian.getSafetyAdvice':'[{"temp": valor, "uv": valor}] (campos opcionales; sin mediciones usa [{}])',
 'guardian.calculateStructuralLoad':'["material", "geometría y condiciones"]',
 'guardian.designHazmatStorage':'["material", cantidad_numérica, "condiciones"]',
 'guardian.evaluateMinsalCompliance':'["situación a revisar"]',
};
export function McpProjectPanel(props:{projectId?:string;online:boolean}){
 return <McpSession key={props.projectId??'no-project'} {...props}/>;
}
function McpSession({projectId,online}:{projectId?:string;online:boolean}){
 const id=useId();const [catalog,setCatalog]=useState<z.infer<typeof catalogSchema>|null>(null);
 const [query,setQuery]=useState('');const [prompt,setPrompt]=useState<typeof APP_MCP_PROMPTS[number]>('guardian.queryBCN');
 const [input,setInput]=useState('["DS 44"]');const [approved,setApproved]=useState(false);
 const [result,setResult]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [auditWarning,setAuditWarning]=useState(false);
 const current=useRef<AbortController|null>(null);
 const deadline=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancel=()=>{if(deadline.current!==null)clearTimeout(deadline.current);deadline.current=null;current.current?.abort();current.current=null;setBusy(false);setResult('');setError('');setAuditWarning(false);};
 useEffect(()=>()=>{if(deadline.current!==null)clearTimeout(deadline.current);deadline.current=null;current.current?.abort();current.current=null;},[]);
 useEffect(()=>{if(!online){if(deadline.current!==null)clearTimeout(deadline.current);deadline.current=null;current.current?.abort();current.current=null;setBusy(false);setCatalog(null);setResult('');setApproved(false);}},[online]);
 let validInput=false;try{validInput=input.length<=16000&&Array.isArray(JSON.parse(input));}catch{/* User edits an incomplete JSON array. */}
 const enabled=Boolean(projectId&&online&&!busy);const ready=enabled&&Boolean(catalog);
 async function run(payload:AppMcpRequest){
  if(!enabled)return;
  current.current?.abort();const operation=new AbortController();current.current=operation;
  setBusy(true);setError('');setResult('');setAuditWarning(false);
  let message='No pudimos completar la consulta MCP. No se usó otro proveedor.';
  const timer=setTimeout(()=>{operation.abort();if(current.current===operation){setBusy(false);setError('MCP tardó demasiado. Puedes intentarlo nuevamente.');}},20_000);
  deadline.current=timer;
  try{
   const {apiAuthHeader}=await import('../../lib/apiAuth');
   if(operation.signal.aborted)return;
   const auth=await apiAuthHeader();if(operation.signal.aborted)return;
   if(!auth){message='Inicia sesión nuevamente para usar MCP.';setCatalog(null);throw new Error('unauthorized');}
   const response=await fetch('/api/mcp/project',{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(payload),signal:operation.signal});
   if(!response.ok){
    await response.body?.cancel();
    message=response.status===403?'No tienes acceso al proyecto solicitado.':response.status===401?'Tu sesión expiró. Inicia sesión nuevamente.':response.status===409?'El proyecto no tiene un tenant válido configurado.':response.status===429?'MCP está ocupado o alcanzaste el límite. Espera un minuto.':response.status===400?'Revisa los argumentos de la consulta o del prompt.':'MCP no está disponible en este servidor. No se usó otro proveedor.';
    throw new Error('request_failed');
   }
   const checked=envelope.safeParse(await response.json());
   if(!checked.success||checked.data.action!==payload.action){message='La respuesta MCP no tiene un formato válido.';throw new Error('invalid_response');}
   if(operation.signal.aborted||current.current!==operation)return;
   const data=checked.data;
   if(payload.action==='catalog'){
    const parsed=catalogSchema.safeParse(data.result);if(!parsed.success){message='El catálogo MCP recibido no es válido.';throw new Error('invalid_catalog');}setCatalog(parsed.data);
   }else if(payload.action==='preparePrompt'){
    const parsed=z.object({messages:z.array(z.object({content:z.object({type:z.literal('text'),text:z.string().max(100000)})})).max(5)}).safeParse(data.result);
    if(!parsed.success){message='El mensaje preparado no tiene un formato válido.';throw new Error('invalid_prompt');}
    setResult(parsed.data.messages.map(m=>m.content.text).join('\n\n'));
   }else setResult(JSON.stringify(data.result,null,2));
   setAuditWarning(!data.auditRecorded);
  }catch{
   if(current.current===operation&&!operation.signal.aborted)setError(message);
  }finally{clearTimeout(timer);if(deadline.current===timer)deadline.current=null;if(current.current===operation){setBusy(false);current.current=null;}}
 }
 return <section aria-label="MCP del proyecto" className="my-6 rounded-xl border border-emerald-500/40 bg-surface p-5 space-y-3 text-primary-token">
  <h2 className="text-xl font-bold">MCP desde la aplicación</h2>
  <p>Puente interno autenticado al servidor MCP de Guardian. Solo lectura: no conecta URLs externas, no pide claves ni ejecuta modelos.</p>
  {!projectId&&<p>Selecciona un proyecto para usar MCP.</p>}{!online&&<p>Necesitas conexión. La biblioteca local sigue disponible.</p>}
  <button type="button" disabled={!enabled} onClick={()=>projectId&&run({projectId,action:'catalog'})} className="rounded border px-4 py-2 disabled:opacity-50">Conectar MCP del proyecto</button>
  {catalog&&<p role="status">MCP listo: {catalog.tools.length} herramientas y {catalog.prompts.length} prompts disponibles. Cada consulta verifica tus permisos y abre su propia sesión SDK.</p>}
  <div className="flex flex-wrap gap-2">
   <button type="button" disabled={!ready} onClick={()=>projectId&&run({projectId,action:'listRecords'})} className="rounded border p-2 disabled:opacity-50">Ver registros por MCP</button>
   <button type="button" disabled={!ready} onClick={()=>projectId&&run({projectId,action:'listRelations'})} className="rounded border p-2 disabled:opacity-50">Ver relaciones por MCP</button>
  </div>
  <label htmlFor={`${id}-query`}>Consulta MCP normativa</label>
  <input id={`${id}-query`} value={query} maxLength={2000} onChange={e=>{cancel();setQuery(e.target.value);}} className="block w-full rounded border p-2 bg-surface" placeholder="Por ejemplo: DS 44"/>
  <button type="button" disabled={!ready||query.trim().length<4} onClick={()=>projectId&&run({projectId,action:'searchNormative',query:query.trim()})} className="rounded border p-2 disabled:opacity-50">Consultar normativa por MCP</button>
  <details><summary>Preparar mensajes con contexto del proyecto</summary>
   <p>Esto prepara un mensaje; no genera una respuesta del modelo. Revisa el contexto antes de copiarlo manualmente a tu host/modelo. Puede incluir registros e identificadores sensibles. La minimización no anonimiza.</p>
   <label htmlFor={`${id}-prompt`}>Acción MCP</label>
   <select id={`${id}-prompt`} value={prompt} onChange={e=>{const value=z.enum(APP_MCP_PROMPTS).parse(e.target.value);cancel();setPrompt(value);setApproved(false);setInput(value==='guardian.queryBCN'?'["DS 44"]':value==='guardian.getChatResponse'?'["Resume los registros disponibles"]':'[]');}} className="block rounded border p-2 bg-surface">
    {(catalog?.prompts??APP_MCP_PROMPTS.map(name=>({name}))).map(p=><option key={p.name} value={p.name}>{labels[p.name]}</option>)}
   </select>
   <p>Formato: {signatures[prompt]}. Los ejemplos son editables; completa tus datos antes de preparar.</p>
   <label htmlFor={`${id}-input`}>Argumentos JSON del prompt</label>
   <textarea id={`${id}-input`} value={input} maxLength={16000} rows={4} onChange={e=>{cancel();setInput(e.target.value);setApproved(false);}} className="block w-full rounded border p-2 bg-surface"/>
   <label className="block"><input type="checkbox" checked={approved} onChange={e=>{cancel();setApproved(e.target.checked);}}/> Confirmo que quiero preparar y revisar el contexto de este proyecto; no enviarlo automáticamente a un modelo.</label>
   <button type="button" disabled={!ready||!approved||!validInput} onClick={()=>projectId&&run({projectId,action:'preparePrompt',name:prompt,input,contextApproved:true})} className="rounded border p-2 disabled:opacity-50">Preparar mensaje mediante MCP</button>
  </details>
  {busy&&<p role="status">Consultando MCP…</p>}{error&&<p role="alert">{humanErrorMessage(error)}</p>}
  {auditWarning&&<p role="status">La consulta respondió, pero no se confirmó su registro de auditoría.</p>}
  {result&&<div><p>Resultado MCP recibido. Lectura acotada; las referencias normativas no acreditan procedencia/vigencia y las relaciones no certifican seguridad. Un mensaje preparado no es inferencia ejecutada.</p><textarea aria-label="Resultado MCP" readOnly value={result} rows={12} className="block w-full rounded border p-2 bg-surface"/></div>}
 </section>;
}
