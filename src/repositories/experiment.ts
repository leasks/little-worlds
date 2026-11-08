import { randomUUID,randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { tokenHash,type AgentRole } from './caretaker';
import { SchedulerRepository } from './scheduler';
import { seedWorld,validateWorld } from '../engine';
import { loadQuest } from '../narrative/persistence';
import { defaultSettings,DAY } from '../narrative/engine';
import { actorStateSchema } from '../caretaker/commands';
import { experimentConfigSchema,type ExperimentConfig,type ExperimentData,type DayState,type RecordedInput } from '../experiment/contracts';
export class ExperimentRepository extends SchedulerRepository{
 protected async checkExperiment(db:PoolClient,id:string,active=false){
  const r=await db.query('SELECT e.status,w.is_test FROM little_worlds.experiment_runs e JOIN little_worlds.world_settings w USING(world_id) WHERE world_id=$1',[id]);
  if(!r.rowCount||!r.rows[0].is_test||(active&&r.rows[0].status!=='running'))throw Error('EXPERIMENT_WORLD_REJECTED');
 }
 private async state(db:PoolClient,id:string):Promise<DayState>{
  const world=await this.load(db,id,false);validateWorld(world);
  const actor=await db.query("SELECT state FROM little_worlds.actors WHERE world_id=$1 AND id='local-caretaker'",[id]);
  return {world,quest:await loadQuest(db,id),caretaker:actorStateSchema.parse(actor.rows[0].state)};
 }
 // Setup requires the migration-owner local pool. Game operations use the runtime pool.
 async createExperiment(raw:ExperimentConfig,sourceHash:string){
  const config=experimentConfigSchema.parse(raw),id=randomUUID(),w=seedWorld(config.seed,0);w.id=id;w.creatures.forEach(c=>c.world_id=id);
  if(!/^[0-9a-f]{64}$/.test(sourceHash))throw Error('EXPERIMENT_SOURCE_HASH_REQUIRED');
  await this.transaction(async db=>{
   await this.seedInTransaction(db,w);await db.query('UPDATE little_worlds.world_settings SET is_test=true WHERE world_id=$1',[id]);
   // Enough real-day mock reservations for all five attempts; never alters another world.
   await db.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[id,JSON.stringify({...defaultSettings,dailyRequests:6,dailyTokens:12000})]);
   await db.query("INSERT INTO little_worlds.experiment_runs(world_id,config,source_hash,status,initial_snapshot) VALUES($1,$2,$3,'running',$4)",[id,JSON.stringify(config),sourceHash,JSON.stringify(await this.state(db,id))]);
  });return id;
 }
 async issueExperimentKeys(id:string){return this.transaction(async db=>{
  await this.checkExperiment(db,id,true);const keys={} as Record<AgentRole,string>;
  for(const role of ['caretaker','narrator','operator'] as const){const key=randomBytes(32).toString('hex');keys[role]=key;
   await db.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[id,`local-${role}`,tokenHash(key),role]);
  }return keys;
 });}
 async revokeExperimentKeys(id:string){return this.transaction(async db=>{await this.checkExperiment(db,id);await db.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE world_id=$1',[id]);});}
 async current(id:string){return this.transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkExperiment(db,id);return this.state(db,id);});}
 async recordInput(id:string,entry:Omit<RecordedInput,'outcome'|'status'>){return this.transaction(async db=>{
  await this.checkExperiment(db,id,true);await db.query("INSERT INTO little_worlds.experiment_inputs(world_id,sequence,day,label,kind,input,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",[id,entry.sequence,entry.day,entry.label,entry.kind,JSON.stringify(entry.input)]);
 });}
 async finishInput(id:string,sequence:number,outcome:unknown,failed=false){
  await this.pool.query("UPDATE little_worlds.experiment_inputs SET outcome=$3,status=$4 WHERE world_id=$1 AND sequence=$2 AND status='pending'",[id,sequence,JSON.stringify(outcome),failed?'failed':'completed']);
 }
 async advanceExperiment(id:string,requestId:string,day:number){return this.transaction(async db=>{
  await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[id]);await this.checkExperiment(db,id,true);
  const w=await this.load(db,id,false);if(w.multiplier!==3||w.intervalMs!==300000)throw Error('EXPERIMENT_CLOCK_SETTINGS_CHANGED');
  return this.tickInTransaction(db,id,requestId,day*DAY/3,96);
 });}
 async checkpoint(id:string,day:number){return this.transaction(async db=>{
  await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[id]);await this.checkExperiment(db,id,true);const state=await this.state(db,id);
  if(state.world.virtualTime!==day*DAY||state.world.tick!==day*96)throw Error('EXPERIMENT_CLOCK_INVARIANT');
  await db.query('INSERT INTO little_worlds.experiment_days VALUES($1,$2,$3)',[id,day,JSON.stringify(state)]);
  await db.query('UPDATE little_worlds.experiment_runs SET completed_days=$2 WHERE world_id=$1',[id,day]);return state;
 });}
 async finishExperiment(id:string,report:unknown,hash:string){return this.transaction(async db=>{
  await this.checkExperiment(db,id,true);
  await db.query("UPDATE little_worlds.experiment_runs SET status='completed',report=$2,semantic_hash=$3,finished_at=now() WHERE world_id=$1",[id,JSON.stringify(report),hash]);
  await db.query('UPDATE little_worlds.world_settings SET archived=true,paused=true,paused_at_ms=$2 WHERE world_id=$1',[id,Date.now()]);
 });}
 async failExperiment(id:string){return this.transaction(async db=>{
  const changed=await db.query("UPDATE little_worlds.experiment_runs SET status='failed',failure_code='EXPERIMENT_EXECUTION_FAILED',finished_at=now() WHERE world_id=$1 AND status='running' RETURNING world_id",[id]);
  if(changed.rowCount)await db.query('UPDATE little_worlds.world_settings SET archived=true,paused=true,paused_at_ms=$2 WHERE world_id=$1',[id,Date.now()]);
 });}
 async experimentData(id:string):Promise<ExperimentData>{return this.transaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkExperiment(db,id);
  const r=(await db.query('SELECT * FROM little_worlds.experiment_runs WHERE world_id=$1',[id])).rows[0];
  const days=await db.query('SELECT day,snapshot FROM little_worlds.experiment_days WHERE world_id=$1 ORDER BY day',[id]);
  const inputs=await db.query('SELECT sequence,day,label,kind,input,outcome,status FROM little_worlds.experiment_inputs WHERE world_id=$1 ORDER BY sequence',[id]);
  const proposals=await db.query('SELECT id,actor_id,request_id,input,status,code,applied_virtual_time FROM little_worlds.event_proposals WHERE world_id=$1 ORDER BY request_id',[id]);
  const usage=await db.query('SELECT workflow_id,attempt,model,status,reserved_tokens,actual_tokens,error_code FROM little_worlds.ai_usage WHERE world_id=$1 ORDER BY workflow_id,attempt',[id]);
  const world=await this.load(db,id,true);
  return {worldId:id,config:experimentConfigSchema.parse(r.config),sourceHash:r.source_hash,status:r.status,failureCode:r.failure_code,completedDays:r.completed_days,initial:r.initial_snapshot,final:await this.state(db,id),days:days.rows,inputs:inputs.rows,journal:world.journal,proposals:proposals.rows,usage:usage.rows};
 });}
}
