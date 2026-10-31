// @vitest-environment jsdom
import React from 'react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
import {MemoryRouter,useNavigate} from 'react-router-dom';
const H=vi.hoisted(()=>({
 chat:vi.fn(async(..._args:[string,string,unknown[]?,number?,string?,{signal?:AbortSignal}?])=>'fixture-response'),
 search:vi.fn(async(..._args:[string,unknown[],number?,string?,{signal?:AbortSignal}?]):Promise<unknown[]>=>[]),
 audio:vi.fn(),plan:vi.fn(),addNode:vi.fn(),error:vi.fn(),start:vi.fn(),stop:vi.fn(),offline:vi.fn(()=> 'respuesta-local'),save:vi.fn(async(_query:string)=>undefined),project:'project-a',uid:'user-a',online:true,
}));
vi.mock('../../services/geminiService',()=>({getChatResponse:H.chat,semanticSearch:H.search,detectAsesorDomain:()=> 'sst',processAudioWithAI:H.audio,generateActionPlan:H.plan}));
vi.mock('../../hooks/useRiskEngine',()=>({useRiskEngine:()=>({nodes:[],addNode:H.addNode,addConnection:vi.fn()})}));
vi.mock('../../hooks/useAmbientNoise',()=>({useAmbientNoise:()=>({noiseLevel:30,startListening:H.start,stopListening:H.stop})}));
vi.mock('../../contexts/ProjectContext',()=>({useProject:()=>({selectedProject:{id:H.project}})}));
vi.mock('../../contexts/FirebaseContext',()=>({useFirebase:()=>({user:{uid:H.uid}})}));
vi.mock('../../utils/pwa-offline',()=>({isOnline:()=>H.online}));
vi.mock('../../utils/offlineKnowledge',()=>({getOfflineResponse:H.offline,savePendingOfflineQuery:H.save,getPendingOfflineQueries:async()=>[],clearPendingOfflineQueries:async()=>undefined}));
vi.mock('../../utils/logger',()=>({logger:{error:H.error}}));
vi.mock('framer-motion',()=>({
 motion:{div:({initial:_i,animate:_a,exit:_e,...props}:React.HTMLAttributes<HTMLDivElement>&{initial?:unknown;animate?:unknown;exit?:unknown})=><div {...props}/>,button:({whileHover:_h,whileTap:_t,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{whileHover?:unknown;whileTap?:unknown})=><button {...props}/>},
 AnimatePresence:({children}:{children:React.ReactNode})=><>{children}</>,
}));
import {GuardianVoiceAssistant} from './GuardianVoiceAssistant';
function NavigationProbe(){const navigate=useNavigate();return <button onClick={()=>navigate('/medicine')}>cambiar-ruta-fixture</button>;}
const ui=()=> <MemoryRouter initialEntries={['/risks']}><NavigationProbe/><GuardianVoiceAssistant/></MemoryRouter>;
function open(view:ReturnType<typeof render>){const button=view.container.querySelector('.fixed > button');if(!button)throw new Error('Missing assistant trigger');fireEvent.click(button);}
function send(query='consulta-fixture'){const input=screen.getByPlaceholderText('O escribe tu consulta aquí...');fireEvent.change(input,{target:{value:query}});fireEvent.keyDown(input,{key:'Enter',code:'Enter'});}
beforeEach(()=>{vi.clearAllMocks();H.chat.mockReset().mockResolvedValue('fixture-response');H.search.mockReset().mockResolvedValue([]);H.audio.mockReset();H.save.mockReset().mockResolvedValue(undefined);H.offline.mockReset().mockReturnValue('respuesta-local');H.project='project-a';H.uid='user-a';H.online=true;});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe('owned text-query UI lifecycle (not voice processing)',()=>{
 it.each(['project','close','unmount'])('does not let a stale microphone grant after %s retire the new text owner',async(boundary)=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');const trackStop=vi.fn(),stream={getTracks:()=>[{stop:trackStop}]};let grant:(value:typeof stream)=>void=()=>undefined;const permission=new Promise<typeof stream>(resolve=>{grant=resolve;});Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>permission}});const recorders:RecorderFixture[]=[];class RecorderFixture{stream=stream;state='inactive';onstop?:()=>void;constructor(){recorders.push(this);}start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';this.onstop?.();}}vi.stubGlobal('MediaRecorder',RecorderFixture);H.audio.mockResolvedValue({text:'cleanup-audio'});
  let release:(value:string)=>void=()=>undefined;const text=new Promise<string>(resolve=>{release=resolve;});H.chat.mockReturnValueOnce(text);let view=render(ui());open(view);const mic=view.container.querySelector('svg.lucide-mic')?.closest('button');if(!mic)throw new Error('Missing mic control');fireEvent.mouseDown(mic);
  try{if(boundary==='project'){H.project='project-b';view.rerender(ui());}else if(boundary==='unmount'){view.unmount();view=render(ui());open(view);}else{const close=view.container.querySelector('svg.lucide-x')?.closest('button');if(!close)throw new Error('Missing close');fireEvent.click(close);open(view);}send('new-owner');await waitFor(()=>expect(H.chat).toHaveBeenCalledOnce());await act(async()=>{grant(stream);await permission;});expect(H.chat.mock.calls[0]?.[5]?.signal?.aborted).toBe(false);expect(trackStop).toHaveBeenCalledOnce();expect(recorders).toHaveLength(0);expect(H.audio).not.toHaveBeenCalled();await act(async()=>{release('fresh-owner');await text;});expect(screen.getByText('fresh-owner')).toBeTruthy();}
  finally{try{await act(async()=>{grant(stream);await permission;recorders.at(-1)?.stop();release('cleanup');await text;});if(recorders.length)await waitFor(()=>expect(H.audio).toHaveBeenCalledOnce());}finally{if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor);else Reflect.deleteProperty(navigator,'mediaDevices');vi.unstubAllGlobals();}}
 });
 it.each(['resolve','reject'])('keeps a new query owned when the old canceled promise later %ss',async(outcome)=>{
  let aResolve:(value:string)=>void=()=>undefined,aReject:(reason:Error)=>void=()=>undefined,bResolve:(value:string)=>void=()=>undefined;const a=new Promise<string>((resolve,reject)=>{aResolve=resolve;aReject=reject;}),b=new Promise<string>(resolve=>{bResolve=resolve;});H.chat.mockReturnValueOnce(a).mockReturnValueOnce(b);const view=render(ui());open(view);send('query-a');
  try{await waitFor(()=>expect(H.chat).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'Detener espera'}));send('query-b');await waitFor(()=>expect(H.chat).toHaveBeenCalledTimes(2));await act(async()=>{if(outcome==='reject')aReject(new Error('private_late_failure'));else aResolve('late-a');await a.catch(()=>undefined);});expect(screen.getByText('Analizando tu consulta...')).toBeTruthy();expect(screen.queryByText('late-a')).toBeNull();expect(H.error).not.toHaveBeenCalled();await act(async()=>{bResolve('fresh-b');await b;});expect(screen.getByText('fresh-b')).toBeTruthy();}
  finally{await act(async()=>{aResolve('cleanup');bResolve('cleanup');await Promise.allSettled([a,b]);});}
 });
 it('retains the normal local response and pending-query persistence',async()=>{
  vi.useFakeTimers();H.online=false;const view=render(ui());open(view);send('offline-normal');await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect(screen.getByText('respuesta-local')).toBeTruthy();expect(H.save).toHaveBeenCalledWith('offline-normal');expect(H.chat).not.toHaveBeenCalled();expect(H.search).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('clears a completed text response when the identity context changes',async()=>{
  const view=render(ui());open(view);send();await screen.findByText('fixture-response');H.uid='user-b';view.rerender(ui());expect(screen.queryByText('fixture-response')).toBeNull();expect(screen.getByPlaceholderText('O escribe tu consulta aquí...')).toBeTruthy();
 });
 it('retires text on microphone grant without letting its finalizer release an active audio operation',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');const stream={getTracks:()=>[{stop:vi.fn()}]};let grant:(value:typeof stream)=>void=()=>undefined;const permission=new Promise<typeof stream>(resolve=>{grant=resolve;});Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>permission}});
  const recorders:RecorderFixture[]=[];class RecorderFixture{stream=stream;state='inactive';onstop?:()=>void;constructor(){recorders.push(this);}start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';this.onstop?.();}}vi.stubGlobal('MediaRecorder',RecorderFixture);
  let releaseText:(value:string)=>void=()=>undefined,releaseAudio:(value:{text:string})=>void=()=>undefined;const text=new Promise<string>(resolve=>{releaseText=resolve;}),audio=new Promise<{text:string}>(resolve=>{releaseAudio=resolve;});H.chat.mockReturnValueOnce(text);H.audio.mockReturnValueOnce(audio);const view=render(ui());open(view);const mic=view.container.querySelector('svg.lucide-mic')?.closest('button');if(!mic)throw new Error('Missing mic fixture control');fireEvent.mouseDown(mic);send();
  try{await waitFor(()=>expect(H.chat).toHaveBeenCalledOnce());await act(async()=>{grant(stream);await permission;});expect(H.chat.mock.calls[0]?.[5]?.signal?.aborted).toBe(true);const stop=view.container.querySelector('svg.lucide-mic-off')?.closest('button');if(!stop)throw new Error('Missing recording stop');fireEvent.mouseUp(stop);await waitFor(()=>expect(H.audio).toHaveBeenCalledOnce());await act(async()=>{releaseText('late-text');await text;});expect(screen.getByText('Analizando tu consulta...')).toBeTruthy();expect(screen.queryByRole('button',{name:'Detener espera'})).toBeNull();await act(async()=>{releaseAudio({text:'respuesta-audio-fixture'});await audio;});expect(screen.getByText('respuesta-audio-fixture')).toBeTruthy();}
  finally{await act(async()=>{grant(stream);await permission;});await act(async()=>{recorders.at(-1)?.stop();releaseText('cleanup');releaseAudio({text:'cleanup-audio'});await Promise.all([text,audio]);});await waitFor(()=>expect(H.audio).toHaveBeenCalledOnce());if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor);else Reflect.deleteProperty(navigator,'mediaDevices');vi.unstubAllGlobals();}
 });
 it('preserves local advice and reports persistence failure without leaking its reason',async()=>{
  vi.useFakeTimers();H.online=false;H.save.mockRejectedValueOnce(new Error('private_storage_reason'));const view=render(ui());open(view);send();await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect(screen.getByText('respuesta-local')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('no se pudo guardar');expect(H.error).toHaveBeenCalledWith('assistant_text_offline_failed');expect(JSON.stringify(H.error.mock.calls)).not.toContain('private_storage_reason');expect(vi.getTimerCount()).toBe(0);
 });
 it('keeps computed local advice if pending persistence outlives the UI budget',async()=>{
  vi.useFakeTimers();H.online=false;let release:()=>void=()=>undefined;const pending=new Promise<undefined>(resolve=>{release=()=>resolve(undefined);});H.save.mockReturnValueOnce(pending);const view=render(ui());open(view);send();
  try{await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect(H.save).toHaveBeenCalledOnce();await act(async()=>{await vi.advanceTimersByTimeAsync(45000-800);});expect(screen.getByText('respuesta-local')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('guardado');expect(screen.queryByText('Analizando tu consulta...')).toBeNull();expect(H.chat).not.toHaveBeenCalled();}
  finally{await act(async()=>{release();await pending;});}
 });
 it('does not run or queue a canceled offline query after its delay',async()=>{
  vi.useFakeTimers();H.online=false;const view=render(ui());open(view);send();const close=view.container.querySelector('svg.lucide-x')?.closest('button');if(!close)throw new Error('Missing header close');fireEvent.click(close);await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect(H.offline).not.toHaveBeenCalled();expect(H.save).not.toHaveBeenCalled();expect(H.chat).not.toHaveBeenCalled();
 });
 it('expires the UI deadline while the first RPC is still pending and never starts the next',async()=>{
  vi.useFakeTimers();let release:(value:unknown[])=>void=()=>undefined;const pending=new Promise<unknown[]>(resolve=>{release=resolve;});H.search.mockReturnValueOnce(pending);const view=render(ui());open(view);send();
  try{await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(H.search).toHaveBeenCalledOnce();await act(async()=>{await vi.advanceTimersByTimeAsync(45000);});expect(H.search.mock.calls[0]?.[4]?.signal?.aborted).toBe(true);expect(screen.getByPlaceholderText('O escribe tu consulta aquí...')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('Tiempo de espera agotado');await act(async()=>{release([]);await pending;});expect(H.chat).not.toHaveBeenCalled();expect(H.error).not.toHaveBeenCalled();}
  finally{await act(async()=>{release([]);await pending;});}
 });
 it.each(['project','user','path','unmount'])('retires a pending text request on %s change',async(change)=>{
  let release:(value:string)=>void=()=>undefined;const pending=new Promise<string>(resolve=>{release=resolve;});H.chat.mockReturnValueOnce(pending);const view=render(ui());open(view);send();
  try{await waitFor(()=>expect(H.chat).toHaveBeenCalledOnce());const signal=H.chat.mock.calls[0]?.[5]?.signal;if(change==='unmount')view.unmount();else if(change==='path')fireEvent.click(screen.getByText('cambiar-ruta-fixture'));else{if(change==='project')H.project='project-b';else H.uid='user-b';view.rerender(ui());}expect(signal?.aborted).toBe(true);await act(async()=>{release('late-old-scope');await pending;});expect(screen.queryByText('late-old-scope')).toBeNull();if(change!=='unmount')expect(screen.getByPlaceholderText('O escribe tu consulta aquí...')).toBeTruthy();}
  finally{await act(async()=>{release('cleanup');await pending;});}
 });
 it.each(['header','launcher'])('cancels on the %s close control and reopens usable',async(control)=>{
  let release:(value:string)=>void=()=>undefined;const pending=new Promise<string>(resolve=>{release=resolve;});H.chat.mockReturnValueOnce(pending);const view=render(ui());open(view);send();
  try{await waitFor(()=>expect(H.chat).toHaveBeenCalledOnce());const close=control==='header'?view.container.querySelector('svg.lucide-x')?.closest('button'):view.container.querySelector('.fixed > button');if(!close)throw new Error('Missing close control');fireEvent.click(close);expect(H.chat.mock.calls[0]?.[5]?.signal?.aborted).toBe(true);open(view);expect(screen.getByPlaceholderText('O escribe tu consulta aquí...')).toBeTruthy();await act(async()=>{release('late-closed');await pending;});expect(screen.queryByText('late-closed')).toBeNull();}
  finally{await act(async()=>{release('cleanup');await pending;});}
 });
 it('stops waiting, aborts transport and ignores a late text response',async()=>{
  let release:(value:string)=>void=()=>undefined;const pending=new Promise<string>(resolve=>{release=resolve;});H.chat.mockReturnValueOnce(pending);const view=render(ui());open(view);send();
  try{await waitFor(()=>expect(H.chat).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'Detener espera'}));const signal=H.chat.mock.calls[0]?.[5]?.signal;expect(signal?.aborted).toBe(true);expect(H.search.mock.calls[0]?.[4]?.signal).toBe(signal);expect(screen.getByPlaceholderText('O escribe tu consulta aquí...')).toBeTruthy();
  await act(async()=>{release('respuesta-tardia');await pending;});expect(screen.queryByText('respuesta-tardia')).toBeNull();expect(H.error).not.toHaveBeenCalled();expect(H.audio).not.toHaveBeenCalled();expect(H.addNode).not.toHaveBeenCalled();}
  finally{await act(async()=>{release('fixture-cleanup');await pending;});}
 });
});
