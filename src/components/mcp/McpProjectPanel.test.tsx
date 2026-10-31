// @vitest-environment jsdom
import React from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor,act} from '@testing-library/react';
const auth=vi.hoisted(()=>vi.fn(async()=>'Bearer fixture'));
vi.mock('../../lib/apiAuth',()=>({apiAuthHeader:auth}));
import {McpProjectPanel} from './McpProjectPanel';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();auth.mockReset().mockResolvedValue('Bearer fixture');});
const reply=(action:string,result:unknown,status=200)=>new Response(JSON.stringify({protocol:'mcp-sdk',mode:'internal-read-only',action,result,auditRecorded:true}),{status,headers:{'Content-Type':'application/json'}});
const catalog={tools:[{name:'zk.listNodes'},{name:'zk.listEdges'},{name:'legal.searchNormative'}],prompts:[{name:'guardian.queryBCN'},{name:'guardian.getChatResponse'}]};
describe('application MCP panel',()=>{
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
