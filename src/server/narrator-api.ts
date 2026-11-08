import { z } from 'zod';
import { ApiError } from '../caretaker/commands';
import { body } from './caretaker-api';
import type { NarratorRepository } from '../repositories/narrator';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===429?{'Retry-After':'60'}:{})}});
export async function narratorApi(req:Request,worldId:string,kind:'context'|'submit'|'inspect'|'review',getRepository:()=>NarratorRepository,proposalId?:string){
 try{
  const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.get('authorization')??'');if(!match)throw new ApiError('UNAUTHORIZED',401,'Valid bearer credential required');
  if(!z.uuid().safeParse(worldId).success)throw new ApiError('INVALID_WORLD',400,'World ID must be a UUID');
  const repo=getRepository();const principal=await repo.authenticate(match[1]!,worldId,kind==='inspect'||kind==='review'?'operator':'narrator');
  if(kind==='context')return json({ok:true,result:await repo.context(principal)});
  if(kind==='inspect')return json({ok:true,result:await repo.inspect(principal)});
  const raw=await body(req);
  if(kind==='review'){
   const review=z.strictObject({approve:z.boolean()}).safeParse(raw);
   if(!review.success||!z.uuid().safeParse(proposalId).success)throw new ApiError('INVALID_REVIEW',400,'Use a proposal UUID and boolean approve');
   return json({ok:true,result:await repo.review(principal,proposalId!,review.data.approve)});
  }
  // Validate only transport envelope here; repository audits malformed proposal content.
  const envelope=z.strictObject({request_id:z.string().min(1).max(128),proposal:z.unknown().refine(x=>x!==undefined)}).safeParse(raw);
  if(!envelope.success)throw new ApiError('INVALID_REQUEST',400,'Use request_id and proposal');
  const result=await repo.submit(principal,envelope.data.request_id,envelope.data.proposal);
  return json({ok:result.status!=='rejected',result,...(result.status==='rejected'?{code:result.code,message:'Proposal rejected by narrative rules'}:{})},result.status==='rejected'?422:result.status==='pending'?202:200);
 }catch(error){if(error instanceof ApiError)return json({ok:false,code:error.code,message:error.message},error.status);return json({ok:false,code:'SERVICE_UNAVAILABLE',message:'Narrative service is temporarily unavailable'},503);}
}
