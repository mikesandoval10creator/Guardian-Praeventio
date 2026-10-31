// @vitest-environment jsdom
import React from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor,act} from '@testing-library/react';
const auth=vi.hoisted(()=>vi.fn(async()=>'Bearer fixture'));
vi.mock('../../lib/apiAuth',()=>({apiAuthHeader:auth}));
import {McpProjectPanel} from './McpProjectPanel';
import {APP_MCP_PROMPTS} from '../../services/mcp/appBridgeContract';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();auth.mockReset().mockResolvedValue('Bearer fixture');});
const reply=(action:string,result:unknown,status=200)=>new Response(JSON.stringify({protocol:'mcp-sdk',mode:'internal-read-only',action,result,auditRecorded:true}),{status,headers:{'Content-Type':'application/json'}});
const catalog={tools:[{name:'zk.listNodes'},{name:'zk.listEdges'},{name:'legal.searchNormative'}],prompts:APP_MCP_PROMPTS.map(name=>({name}))};
const guided:Array<{name:typeof APP_MCP_PROMPTS[number];fields:Array<[string,string]>;args:unknown[]}>= [
 {name:'guardian.getChatResponse',fields:[['Mensaje para el chat','Consulta sintética'],['Nivel de detalle','2'],['Dominio de consulta','sst']],args:['Consulta sintética','',[],2,'sst']},
 {name:'guardian.getSafetyAdvice',fields:[['Temperatura medida (°C)','0'],['Índice UV medido','0']],args:[{temp:0,uv:0}]},
 {name:'guardian.calculateStructuralLoad',fields:[['Elemento estructural','Elemento sintético'],['Especificaciones y condiciones','Datos por revisar']],args:['Elemento sintético','Datos por revisar']},
 {name:'guardian.designHazmatStorage',fields:[['Tipo de almacenamiento y unidad declarada','Bodega litros'],['Cantidad declarada','2.5'],['Clase de sustancia (NCh382)','Clase por revisar']],args:['Bodega litros',2.5,'Clase por revisar']},
 {name:'guardian.evaluateMinsalCompliance',fields:[['Protocolo MINSAL a revisar','Protocolo sintético'],['Observaciones del proyecto','Datos sintéticos'],['Sector o industria','Sector declarado']],args:['Protocolo sintético','Datos sintéticos','Sector declarado']},
 ];
describe('application MCP panel',()=>{
 it('blocks canonical JSON that exceeds the real UTF-8 request budget before fetch',async()=>{
  const fetcher=vi.fn(async()=>reply('catalog',catalog));vi.stubGlobal('fetch',fetcher);render(<McpProjectPanel projectId="p1" online/>);
  fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);fireEvent.change(screen.getByLabelText('Acción MCP'),{target:{value:'guardian.getChatResponse'}});fireEvent.click(screen.getByRole('button',{name:'Editar JSON avanzado'}));
  const input=JSON.stringify(['字'.repeat(3000),'字'.repeat(4000),[{role:'user',content:'字'.repeat(3000)},{role:'assistant',content:'字'.repeat(3000)}],1,'general']);
  expect(input.length).toBeLessThan(16000);expect(new TextEncoder().encode(JSON.stringify({projectId:'p1',action:'preparePrompt',name:'guardian.getChatResponse',input,contextApproved:true})).byteLength).toBeGreaterThan(32*1024);
  fireEvent.change(screen.getByLabelText('Argumentos JSON del prompt'),{target:{value:input}});fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));
  expect((screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}));expect(fetcher).toHaveBeenCalledOnce();
 });
 it('preserves advanced chat arguments and clears explicit approval/drafts when changing action',async()=>{
  const fetcher=vi.fn(async(_url:string,opts:RequestInit)=>JSON.parse(opts.body as string).action==='catalog'?reply('catalog',catalog):reply('preparePrompt',{messages:[{content:{type:'text',text:'SOLO CONSULTIVO avanzado'}}]}));vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);fireEvent.change(screen.getByLabelText('Acción MCP'),{target:{value:'guardian.getChatResponse'}});fireEvent.click(screen.getByRole('button',{name:'Editar JSON avanzado'}));
  const input=JSON.stringify(['Pregunta revisada','contexto ignorado por servidor',[{role:'user',content:'Historial explícito'}],2,'sst']);
  fireEvent.change(screen.getByLabelText('Argumentos JSON del prompt'),{target:{value:input}});fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));fireEvent.click(screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string).input).toBe(input);fireEvent.change(screen.getByLabelText('Acción MCP'),{target:{value:'guardian.queryBCN'}});
  expect(screen.queryByLabelText('Argumentos JSON del prompt')).toBeNull();expect((screen.getByLabelText('Pregunta normativa') as HTMLTextAreaElement).value).toBe('');expect((screen.getByLabelText(/Confirmo que quiero preparar/) as HTMLInputElement).checked).toBe(false);expect(screen.queryByLabelText('Resultado MCP')).toBeNull();
 });
 it.each(guided)('submits canonical arguments from human fields for $name',async({name,fields,args})=>{
  const fetcher=vi.fn(async(_url:string,opts:RequestInit)=>{const b=JSON.parse(opts.body as string);return b.action==='catalog'?reply('catalog',catalog):reply('preparePrompt',{messages:[{content:{type:'text',text:'SOLO CONSULTIVO fixture'}}]});});vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);
  fireEvent.change(screen.getByLabelText('Acción MCP'),{target:{value:name}});
  for(const [label,value] of fields)fireEvent.change(screen.getByLabelText(label),{target:{value}});
  expect(fetcher).toHaveBeenCalledOnce();expect((screen.getByLabelText('Argumentos que se enviarán') as HTMLTextAreaElement).value).toBe(JSON.stringify(args));
  fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));fireEvent.click(screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({name,input:JSON.stringify(args),contextApproved:true});
 });
 it('prepares BCN from a guided question, previews exact arguments and resets context approval on edits',async()=>{
  const fetcher=vi.fn(async(_url:string,opts:RequestInit)=>{const b=JSON.parse(opts.body as string);return b.action==='catalog'?reply('catalog',catalog):reply('preparePrompt',{messages:[{content:{type:'text',text:'SOLO CONSULTIVO pregunta preparada'}}]});});vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);expect(fetcher).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);
  expect(screen.queryByLabelText('Argumentos JSON del prompt')).toBeNull();
  fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));expect((screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Pregunta normativa'),{target:{value:'DS 44 y ruido'}});expect((screen.getByLabelText(/Confirmo que quiero preparar/) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Argumentos que se enviarán') as HTMLTextAreaElement).value).toBe('["DS 44 y ruido"]');
  fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));fireEvent.click(screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}));await waitFor(()=>expect((screen.getByLabelText('Resultado MCP') as HTMLTextAreaElement).value).toContain('pregunta preparada'));
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({name:'guardian.queryBCN',input:'["DS 44 y ruido"]',contextApproved:true});
 });
 it('releases a stalled authentication deadline and keeps the old finalizer from owning a new request',async()=>{
  vi.useFakeTimers();let release:(s:string)=>void=()=>undefined;auth.mockImplementationOnce(()=>new Promise<string>(r=>{release=r;}));
  const fetcher=vi.fn(async()=>reply('catalog',catalog));vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));
  await vi.waitFor(()=>expect(auth).toHaveBeenCalledOnce());await act(()=>vi.advanceTimersByTimeAsync(20_001));
  expect((screen.getByRole('button',{name:'Conectar MCP del proyecto'}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));
  await act(async()=>{release('Bearer late');});await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
  expect(screen.getByText(/MCP listo/)).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
 });
 it('cleans its timer and ignores pending authentication when unmounted',async()=>{
  vi.useFakeTimers();let release:(s:string)=>void=()=>undefined;auth.mockImplementationOnce(()=>new Promise<string>(r=>{release=r;}));const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const view=render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));
  await vi.waitFor(()=>expect(auth).toHaveBeenCalledOnce());view.unmount();expect(vi.getTimerCount()).toBe(0);
  await act(async()=>{release('Bearer late');});expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not send on mount; connects and runs normative MCP tool with visible result',async()=>{
  const fetcher=vi.fn(async(_url:string,opts:RequestInit)=>{const body=JSON.parse(opts.body as string);return body.action==='catalog'?reply('catalog',catalog):reply('searchNormative',{method:'lexical',matches:[{id:'law-fixture',excerpt:'Extracto sintético'}],scanLimited:false});});vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);
  fireEvent.change(screen.getByLabelText('Consulta MCP normativa'),{target:{value:'DS 44'}});fireEvent.click(screen.getByRole('button',{name:'Consultar normativa por MCP'}));
  await waitFor(()=>expect((screen.getByLabelText('Resultado MCP') as HTMLTextAreaElement).value).toContain('Extracto sintético'));
  expect(fetcher).toHaveBeenLastCalledWith('/api/mcp/project',expect.objectContaining({body:JSON.stringify({projectId:'p1',action:'searchNormative',query:'DS 44'})}));
 });
 it('requires explicit context review for prompt preparation and never asks for keys',async()=>{
  const fetcher=vi.fn(async(_url:string,opts:RequestInit)=>{const b=JSON.parse(opts.body as string);return b.action==='catalog'?reply('catalog',catalog):reply('preparePrompt',{messages:[{role:'user',content:{type:'text',text:'SOLO CONSULTIVO fixture preparado'}}]});});vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await screen.findByText(/MCP listo/);
  fireEvent.change(screen.getByLabelText('Pregunta normativa'),{target:{value:'DS 44'}});
  expect((screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Confirmo que quiero preparar/));fireEvent.click(screen.getByRole('button',{name:'Preparar mensaje mediante MCP'}));
  await waitFor(()=>expect((screen.getByLabelText('Resultado MCP') as HTMLTextAreaElement).value).toContain('SOLO CONSULTIVO'));
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({action:'preparePrompt',contextApproved:true});expect(screen.queryByLabelText(/API key/i)).toBeNull();
 });
 it('clears session/results on project switch and discards old replies',async()=>{
  let resolve!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);
  const view=render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
  view.rerender(<McpProjectPanel projectId="p2" online/>);resolve(reply('catalog',catalog));await new Promise(r=>setTimeout(r,0));expect(screen.queryByText(/MCP listo/)).toBeNull();expect(screen.queryByLabelText('Resultado MCP')).toBeNull();
 });
 it('displays a safe error without falling back when the API refuses',async()=>{
  const fetcher=vi.fn(async()=>new Response('{"error":"private-path-token"}',{status:403}));vi.stubGlobal('fetch',fetcher);
  render(<McpProjectPanel projectId="p1" online/>);fireEvent.click(screen.getByRole('button',{name:'Conectar MCP del proyecto'}));const alert=await screen.findByRole('alert');expect(alert.textContent).not.toContain('private-path-token');expect(fetcher).toHaveBeenCalledOnce();
 });
 it('requires a selected project and connectivity',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const view=render(<McpProjectPanel online/>);expect((screen.getByRole('button',{name:'Conectar MCP del proyecto'}) as HTMLButtonElement).disabled).toBe(true);view.rerender(<McpProjectPanel projectId="p1" online={false}/>);expect((screen.getByRole('button',{name:'Conectar MCP del proyecto'}) as HTMLButtonElement).disabled).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 });
});
