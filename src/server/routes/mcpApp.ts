import {Router,type Request} from 'express';
import rateLimit from 'express-rate-limit';
import {getFirestore} from 'firebase-admin/firestore';
import {verifyAuth} from '../middleware/verifyAuth.js';
import {auditServerEvent} from '../middleware/auditLog.js';
import {ProjectMembershipError} from '../../services/auth/projectMembership.js';
import {appMcpRequest,withinAppMcpBudget} from '../../services/mcp/appBridgeContract.js';
import {retrieveNativeNormative} from '../rag/publicLawReader.js';
import type {NormativeRetriever} from '../../services/rag/nativeNormativeContext.js';
import type {AdminFirestoreLike} from '../mcp/zkFirebaseReadAdapter.js';
import {AppMcpError,authorizeAppMcp,invokeAppMcp} from '../mcp/appMcpBridge.js';

// Process-local resource accounting, not a mutation of business data. Keep it
// separate from the HTTP handler's persistence/audit boundary.
function takeSlot(active:Set<string>,uid:string){
 if(active.has(uid)||active.size>=4)return null;
 active.add(uid);
 return()=>{active.delete(uid);};
}

export function createMcpAppRouter(deps:{getDb:()=>AdminFirestoreLike;retrieveNormative:NormativeRetriever;audit:typeof auditServerEvent}={getDb:()=>getFirestore(),retrieveNormative:retrieveNativeNormative,audit:auditServerEvent}){
 const router=Router();const active=new Set<string>();
 const limiter=rateLimit({windowMs:60_000,limit:6,keyGenerator:req=>req.user?.uid??'invalid',standardHeaders:true,legacyHeaders:false,message:{error:'mcp_rate_limited'}});
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.post('/project',verifyAuth,limiter,async(req,res)=>{
  if(process.env.PRAEVENTIO_MCP_APP_DISABLED==='1')return res.status(503).json({error:'mcp_app_disabled'});
  if(!req.is('application/json'))return res.status(415).json({error:'json_required'});
  const parsed=appMcpRequest.safeParse(req.body);
  if(!parsed.success||!withinAppMcpBudget(req.body))return res.status(400).json({error:'invalid_mcp_request'});
  const uid=req.user?.uid;if(!uid)return res.status(401).json({error:'unauthorized'});
  const release=takeSlot(active,uid);
  if(!release)return res.status(429).json({error:'mcp_busy'});
  const controller=new AbortController();
  const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
  let abortListener:()=>void=()=>undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{abortListener=()=>reject(new AppMcpError('mcp_deadline',503));controller.signal.addEventListener('abort',abortListener,{once:true});});
  const timer=setTimeout(()=>controller.abort(),15_000);
  const work=(async()=>{
   const db=deps.getDb();
   const scope=await authorizeAppMcp(db,uid,parsed.data.projectId,req.user?.tenantId);
   controller.signal.throwIfAborted();
   const result=await invokeAppMcp(parsed.data,scope,db,deps.retrieveNormative,controller.signal);
   controller.signal.throwIfAborted();
   const auditRecorded=await auditRead(deps.audit,req,parsed.data.action,scope.projectId);
   return{...result,auditRecorded};
  })().finally(release);
  try{
   const result=await Promise.race([work,deadline]);
   if(!res.destroyed)return res.json(result);
  }catch(error){
   if(!res.destroyed){
    if(error instanceof ProjectMembershipError)return res.status(403).json({error:'project_access_denied'});
    if(error instanceof AppMcpError)return res.status(error.status).json({error:error.code});
    return res.status(503).json({error:'mcp_unavailable'});
   }
  }finally{clearTimeout(timer);res.off('close',onClose);controller.signal.removeEventListener('abort',abortListener);}
  return undefined;
 });
 return router;
}
async function auditRead(audit:typeof auditServerEvent,req:Request,action:string,projectId:string){
 try{return await audit(req,'mcp.app.read','mcp',{operation:action,mode:'internal-read-only'},{projectId});}catch{return false;}
}
export default createMcpAppRouter();
