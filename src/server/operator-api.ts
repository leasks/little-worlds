import { z } from 'zod';
import { ApiError } from '../caretaker/commands';
import { body } from './caretaker-api';
import { controlSchema,journalFiltersSchema } from '../operator/contracts';
import type { OperatorRepository } from '../repositories/operator';
export const sessionCookie='lw_operator';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===429?{'Retry-After':'60'}:{})}});
export function localToolsEnabled(){
 try{return process.env.LOCAL_TEST_TOOLS_ENABLED==='true'&&['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL??'').hostname);}catch{return false;}
}
export function checkOrigin(req:Request){
 const expected=process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).origin:new URL(req.url).origin;
 if(req.headers.get('origin')!==expected)throw new ApiError('ORIGIN_REJECTED',403,'This request must come from the village website');
}
export function readSessionCookie(req:Request){return req.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length+1)??'';}
function cookie(req:Request,token:string){
 const url=new URL(req.url);const secure=url.protocol==='https:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 return `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?28800:0}${secure?'; Secure':''}`;
}
export async function operatorApi(req:Request,kind:'login'|'logout'|'snapshot'|'journal'|'control'|'review',getRepository:()=>OperatorRepository){
 try{
  if(req.method!=='GET')checkOrigin(req);
  if(kind==='login'){
   const parsed=z.strictObject({world_id:z.uuid(),token:z.string().min(32).max(256)}).safeParse(await body(req));if(!parsed.success)throw new ApiError('INVALID_LOGIN',400,'Enter a village ID and operator key');
   const token=await getRepository().login(parsed.data.token,parsed.data.world_id);const response=json({ok:true});response.headers.set('Set-Cookie',cookie(req,token));return response;
  }
  const token=readSessionCookie(req);if(!token)throw new ApiError('UNAUTHORIZED',401,'Sign in to continue');const repo=getRepository();
  if(kind==='logout'){await repo.logout(token);const response=json({ok:true});response.headers.set('Set-Cookie',cookie(req,''));return response;}
  const session=await repo.session(token),p=session.principal;
  if(kind==='snapshot')return json({ok:true,result:{...await repo.snapshot(p),localTools:localToolsEnabled(),aiConfigured:Boolean(process.env.GROQ_API_KEY&&process.env.GROQ_MODEL)}});
  if(kind==='journal'){
   const query=journalFiltersSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new ApiError('INVALID_FILTER',400,'Invalid journal filter');return json({ok:true,result:await repo.journal(p,query.data)});
  }
  const raw=await body(req);
  if(kind==='review'){
   const command=z.strictObject({proposal_id:z.uuid(),approve:z.boolean()}).safeParse(raw);if(!command.success)throw new ApiError('INVALID_REVIEW',400,'Choose a proposal and approval decision');
   return json({ok:true,result:await repo.review(p,command.data.proposal_id,command.data.approve)});
  }
  const command=z.strictObject({world_id:z.uuid(),command:controlSchema}).safeParse(raw);if(!command.success)throw new ApiError('INVALID_CONTROL',400,'Invalid operator control');
  if(command.data.world_id.toLowerCase()!==p.worldId)throw new ApiError('WORLD_CHANGED',409,'The active village has changed. Refresh before trying another operation.');
  const result=await repo.control(p,command.data.command,localToolsEnabled());
  const {newCredentialId:_,...visible}=result;const response=json({ok:true,result:visible});if(result.newWorldId)response.headers.set('Set-Cookie',cookie(req,await repo.resetSession(session,result)));return response;
 }catch(error){
  if(error instanceof ApiError)return json({ok:false,code:error.code,message:error.message},error.status);
  return json({ok:false,code:'SERVICE_UNAVAILABLE',message:'The village could not be reached. Please try again.'},503);
 }
}
