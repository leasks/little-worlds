import { createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SchedulerRepository } from '../repositories/scheduler';
import { ApiError } from '../caretaker/commands';
import { body } from './caretaker-api';
export const cronConfigSchema=z.object({secret:z.string().min(32).max(256),worldId:z.uuid(),maxSteps:z.coerce.number().int().min(1).max(96).default(96),expectedInterval:z.coerce.number().int().min(1000).max(86400000).default(300000)});
export type CronConfig=z.infer<typeof cronConfigSchema>;
const hash=(value:string)=>createHash('sha256').update(value).digest();
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function cronApi(req:Request,kind:'tick'|'health',getRepository:()=>SchedulerRepository,rawConfig:unknown={secret:process.env.CRON_SECRET,worldId:process.env.CRON_WORLD_ID,maxSteps:process.env.CRON_MAX_STEPS??96,expectedInterval:process.env.CRON_EXPECTED_INTERVAL_MS??300000},now=Date.now()){
 const config=cronConfigSchema.safeParse(rawConfig);if(!config.success)return json({ok:false,code:'SCHEDULER_NOT_CONFIGURED'},503);
 const bearer=req.headers.get('authorization')??'';
 if(bearer.length>300||!timingSafeEqual(hash(bearer),hash(`Bearer ${config.data.secret}`)))return json({ok:false,code:'UNAUTHORIZED'},401);
 try{
  if(new URL(req.url).search)throw new ApiError('INVALID_REQUEST',400,'Query parameters are not accepted');
  const repo=getRepository();
  if(kind==='health'){const result=await repo.schedulingHealth(config.data.worldId,now,config.data.expectedInterval);return json({ok:result.healthy,result},result.healthy?200:503);}
  let requestId:string|null=null;
  if(req.method==='POST'){const parsed=z.strictObject({request_id:z.string().min(1).max(100)}).safeParse(await body(req));if(!parsed.success)throw new ApiError('INVALID_REQUEST',400,'Use only request_id');requestId=parsed.data.request_id;}
  const result=await repo.scheduledTick(config.data.worldId,requestId,now,config.data.maxSteps);return json({ok:true,result});
 }catch(error){if(error instanceof ApiError)return json({ok:false,code:error.code},error.status);return json({ok:false,code:'SCHEDULER_FAILED'},503);}
}
