import { z } from 'zod';
import { OperatorRepository } from './operator';
export function schedulerErrorCode(error:unknown){
 const code=(error as {code?:string})?.code;
 if(code==='55P03'||code==='57014')return 'DATABASE_TIMEOUT';
 if(code==='40P01'||code==='40001')return 'TRANSACTION_RETRY';
 return 'TICK_FAILED';
}
export interface ScheduledResult {requestId:string;status:'advanced'|'not_due'|'paused'|'archived'|'test_world';tick:number;virtualTime:number;steps:number;backlogSteps:number;duplicate:boolean;}
export class SchedulerRepository extends OperatorRepository{
 async scheduledTick(worldId:string,request:string|null,now=Date.now(),maxSteps=96):Promise<ScheduledResult>{
  worldId=z.uuid().parse(worldId).toLowerCase();z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(now);z.number().int().min(1).max(96).parse(maxSteps);
  const settings=await this.pool.query('SELECT interval_ms FROM little_worlds.world_settings WHERE world_id=$1',[worldId]);if(!settings.rowCount)throw Error('WORLD_NOT_FOUND');
  const id=request===null?`cron:${settings.rows[0].interval_ms}:${Math.floor(now/settings.rows[0].interval_ms)}`:`worker:${z.string().min(1).max(100).parse(request)}`;
  await this.pool.query(`INSERT INTO little_worlds.scheduler_runs(world_id,request_id,status) VALUES($1,$2,'started') ON CONFLICT(world_id,request_id) DO UPDATE
   SET attempts=scheduler_runs.attempts+1,last_attempt_at=now(),status=CASE WHEN scheduler_runs.status='succeeded' THEN 'succeeded' ELSE 'started' END`,[worldId,id]);
  try{return await this.transaction(async db=>{
   await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[worldId]);
   const run=await db.query('SELECT status,result FROM little_worlds.scheduler_runs WHERE world_id=$1 AND request_id=$2 FOR UPDATE',[worldId,id]);
   if(run.rows[0].status==='succeeded')return {...run.rows[0].result,duplicate:true} as ScheduledResult;
   const state=(await db.query('SELECT s.*,v.interval_ms,v.paused,v.archived,v.is_test FROM little_worlds.simulation_state s JOIN little_worlds.world_settings v USING(world_id) WHERE world_id=$1',[worldId])).rows[0];
   let result:ScheduledResult={requestId:id,status:state.archived?'archived':state.paused?'paused':state.is_test?'test_world':'not_due',tick:Number(state.tick),virtualTime:state.virtual_time,steps:0,backlogSteps:Math.max(0,Math.floor((now-state.last_real_time)/state.interval_ms)),duplicate:false};
   if(!state.archived&&!state.paused&&!state.is_test){
    const tick=await this.tickInTransaction(db,worldId,id,now,maxSteps);
    const after=(await db.query('SELECT last_real_time FROM little_worlds.simulation_state WHERE world_id=$1',[worldId])).rows[0];
    result={...result,status:tick.tick>result.tick?'advanced':'not_due',tick:tick.tick,virtualTime:tick.virtualTime,steps:tick.tick-result.tick,backlogSteps:Math.max(0,Math.floor((now-after.last_real_time)/state.interval_ms))};
   }
   await db.query("UPDATE little_worlds.scheduler_runs SET status='succeeded',result=$3,error_code=NULL,finished_at=now() WHERE world_id=$1 AND request_id=$2",[worldId,id,JSON.stringify(result)]);return result;
  });}catch(error){
   try{await this.pool.query("UPDATE little_worlds.scheduler_runs SET status='failed',error_code=$3,finished_at=now() WHERE world_id=$1 AND request_id=$2 AND status<>'succeeded'",[worldId,id,schedulerErrorCode(error)]);}catch{/* A retained started row signals interrupted/unknown work when storage is unavailable. */}
   throw error;
  }
 }
 async schedulingHealth(worldId:string,now=Date.now(),expectedInterval=300000){
  return this.transaction(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const row=(await db.query('SELECT s.*,w.interval_ms,w.paused,w.archived,w.is_test FROM little_worlds.simulation_state s JOIN little_worlds.world_settings w USING(world_id) WHERE world_id=$1',[worldId])).rows[0];if(!row)throw Error('WORLD_NOT_FOUND');
   const last=(await db.query('SELECT status,last_attempt_at,finished_at,error_code,result FROM little_worlds.scheduler_runs WHERE world_id=$1 ORDER BY last_attempt_at DESC LIMIT 1',[worldId])).rows[0];
   const backlogSteps=Math.max(0,Math.floor((now-row.last_real_time)/row.interval_ms));
   const status=row.archived?'archived':row.is_test?'test_world':row.paused?'paused':!last?'not_started':last.status==='failed'?'error':now-new Date(last.last_attempt_at).getTime()>2*Math.max(row.interval_ms,expectedInterval)?'stale':backlogSteps>Math.ceil(2*Math.max(row.interval_ms,expectedInterval)/row.interval_ms)?'behind':'ok';
   return {status,healthy:status==='ok'||status==='paused',tick:Number(row.tick),virtualTime:row.virtual_time,backlogSteps,lastRun:last?{status:last.status,attemptedAt:last.last_attempt_at,finishedAt:last.finished_at,errorCode:last.error_code}:null};
  });
 }
}
