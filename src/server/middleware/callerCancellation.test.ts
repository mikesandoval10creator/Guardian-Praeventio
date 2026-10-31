import {EventEmitter} from 'node:events';
import {describe,it,expect} from 'vitest';
import {bindCallerCancellation} from './callerCancellation';
class RequestFixture extends EventEmitter {aborted=false;}
class ResponseFixture extends EventEmitter {writableEnded=false;destroyed=false;}
describe('HTTP caller cancellation ownership',()=>{
 it.each(['request','destroyed','finished'])('notices an already closed caller: %s',state=>{
  const req=new RequestFixture(),res=new ResponseFixture();req.aborted=state==='request';res.destroyed=state==='destroyed';res.writableEnded=state==='finished';const owner=bindCallerCancellation(req,res);expect(owner.signal.aborted).toBe(true);owner.dispose();
 });
 it('makes disposal idempotent and ignores late transport events after owner cleanup',()=>{
  const req=new RequestFixture(),res=new ResponseFixture();const owner=bindCallerCancellation(req,res);owner.dispose();owner.dispose();req.emit('aborted');res.emit('close');expect(owner.signal.aborted).toBe(false);
 });
 it('ignores normal incoming-body close and a successfully finished response',()=>{
  const req=new RequestFixture(),res=new ResponseFixture();const owner=bindCallerCancellation(req,res);
  req.emit('close');expect(owner.signal.aborted).toBe(false);res.writableEnded=true;res.emit('close');expect(owner.signal.aborted).toBe(false);owner.dispose();expect(req.listenerCount('aborted')).toBe(0);expect(res.listenerCount('close')).toBe(0);
 });
 it('aborts on a premature response close and releases its listeners',()=>{
  const req=new RequestFixture(),res=new ResponseFixture();const owner=bindCallerCancellation(req,res);res.emit('close');expect(owner.signal.aborted).toBe(true);owner.dispose();expect(req.listenerCount('aborted')).toBe(0);expect(res.listenerCount('close')).toBe(0);
 });
});
