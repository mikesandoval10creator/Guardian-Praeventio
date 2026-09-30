// ARCHIVED AUDIT — PASS may reproduce an unfixed defect. NOT a release gate.
import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderHook,act,waitFor,cleanup} from '@testing-library/react';
import {useActiveVisitors} from '@guardian-audit/src/hooks/useActiveVisitors';
import {useCorrectiveActions} from '@guardian-audit/src/hooks/useCorrectiveActions';
vi.mock('@guardian-audit/src/lib/apiAuth',()=>({apiAuthHeader:async()=> 'Bearer test-only'}));
vi.mock('@guardian-audit/src/services/firebase',()=>({auth:{currentUser:{uid:'test-only'}}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
for(const [name,useHook,payload] of [
 ['visitors',useActiveVisitors,{ok:true,visitors:[{id:'A-only'}]}],
 ['corrective actions',useCorrectiveActions,{actions:[{id:'A-only'}],systemic:[]}]
] as const){
 describe(name,()=>{
  it('retains A data while B pending, but rejects aborted A response',async()=>{
   const queue:Array<(v:any)=>void>=[];const requests:any[]=[];
   const fetchMock=vi.fn((url,init)=>{requests.push({url,signal:init.signal});return new Promise(resolve=>queue.push(resolve));});vi.stubGlobal('fetch',fetchMock);
   const view=renderHook(({pid})=>useHook(pid),{initialProps:{pid:'A'}});
   await waitFor(()=>expect(queue.length).toBe(1));
   await act(async()=>queue[0]({ok:true,json:async()=>payload}));
   await waitFor(()=>expect(view.result.current.data).toEqual(payload));
   view.rerender({pid:'B'});await waitFor(()=>expect(queue.length).toBe(2));
   expect(requests[0].signal.aborted).toBe(true);
   expect(view.result.current.loading).toBe(true);expect(view.result.current.data).toEqual(payload);
   const replacement=name==='visitors'?{ok:true,visitors:[]}:{actions:[],systemic:[]};
   await act(async()=>queue[1]({ok:true,json:async()=>replacement}));
   await waitFor(()=>expect(view.result.current.data).toEqual(replacement));
  });
  it('ignores actual late A response after switching to B',async()=>{
   const queue:Array<(v:any)=>void>=[];vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>queue.push(resolve))));
   const view=renderHook(({pid})=>useHook(pid),{initialProps:{pid:'A'}});await waitFor(()=>expect(queue.length).toBe(1));
   view.rerender({pid:'B'});await waitFor(()=>expect(queue.length).toBe(2));
   await act(async()=>queue[0]({ok:true,json:async()=>payload}));expect(view.result.current.data).toBeNull();
  });
 });
}
