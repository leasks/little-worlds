import { randomBytes,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { NarratorRepository,canonical } from './narrator';
import { tokenHash,type Principal } from './caretaker';
import { ApiError } from '../caretaker/commands';
import { controlSchema,journalFiltersSchema,type Control,type JournalEntry } from '../operator/contracts';
import { seedWorld } from '../engine';
import { loadQuest } from '../narrative/persistence';
export interface OperatorSession {principal:Principal;rootWorldId:string;rootCredentialId:string;}
export class OperatorRepository extends NarratorRepository{
 async login(token:string,worldId:string){
  // Commit the attempt count independently, including bad-token requests.
  const attempt=await this.pool.query(`INSERT INTO little_worlds.operator_login_limits(world_id,attempts) SELECT world_id,1 FROM little_worlds.worlds WHERE world_id=$1
   ON CONFLICT(world_id) DO UPDATE SET attempts=CASE WHEN operator_login_limits.window_start<now()-interval '1 minute' THEN 1 ELSE operator_login_limits.attempts+1 END,
   window_start=CASE WHEN operator_login_limits.window_start<now()-interval '1 minute' THEN now() ELSE operator_login_limits.window_start END
   WHERE operator_login_limits.attempts<30 OR operator_login_limits.window_start<now()-interval '1 minute' RETURNING world_id`,[worldId]);
  if(!attempt.rowCount)throw new ApiError('LOGIN_UNAVAILABLE',429,'Sign-in is unavailable. Wait a minute and try again.');
  const p=await this.authenticate(token,worldId,'operator');
  return this.transaction(async db=>{await this.checkPrincipal(db,p,'operator');await this.audit(db,p,'login',{});return this.issueSession(db,p,p.worldId,p.credentialId);});
 }
 private async issueSession(db:PoolClient,p:Principal,rootWorld:string,rootCredential:string){
  const token=randomBytes(32).toString('hex');
  const result=await db.query(`INSERT INTO little_worlds.operator_sessions(world_id,token_hash,credential_id,root_world_id,root_credential_id,expires_at)
   SELECT $1,$2,$3,$4,$5,LEAST(c.expires_at,r.expires_at,now()+interval '8 hours') FROM little_worlds.agent_credentials c,little_worlds.agent_credentials r
   WHERE c.world_id=$1 AND c.id=$3 AND r.world_id=$4 AND r.id=$5 AND NOT c.revoked AND NOT r.revoked AND c.expires_at>now() AND r.expires_at>now() AND c.role='operator' AND r.role='operator' RETURNING world_id`,[p.worldId,tokenHash(token),p.credentialId,rootWorld,rootCredential]);
  if(!result.rowCount)throw new ApiError('UNAUTHORIZED',401,'Operator access expired');return token;
 }
 async session(token:string):Promise<OperatorSession>{
  if(!/^[0-9a-f]{64}$/.test(token))throw new ApiError('UNAUTHORIZED',401,'Sign in to continue');
  const {rows}=await this.pool.query(`SELECT s.*,c.actor_id FROM little_worlds.operator_sessions s
   JOIN little_worlds.agent_credentials c ON c.world_id=s.world_id AND c.id=s.credential_id
   JOIN little_worlds.agent_credentials r ON r.world_id=s.root_world_id AND r.id=s.root_credential_id
   JOIN little_worlds.actors a ON a.world_id=c.world_id AND a.id=c.actor_id
   WHERE s.token_hash=$1 AND NOT s.revoked AND s.expires_at>now() AND NOT c.revoked AND c.expires_at>now() AND c.role='operator' AND a.kind='operator' AND NOT r.revoked AND r.expires_at>now() AND r.role='operator'`,[tokenHash(token)]);
  const s=rows[0];if(!s)throw new ApiError('UNAUTHORIZED',401,'Your session has expired. Sign in again.');
  const rate=await this.pool.query(`UPDATE little_worlds.agent_credentials SET requests=CASE WHEN window_start<=now()-interval '1 minute' THEN 1 ELSE requests+1 END,window_start=CASE WHEN window_start<=now()-interval '1 minute' THEN now() ELSE window_start END
   WHERE world_id=$1 AND id=$2 AND (requests<60 OR window_start<=now()-interval '1 minute') RETURNING id`,[s.world_id,s.credential_id]);
  if(!rate.rowCount)throw new ApiError('RATE_LIMITED',429,'Too many requests. Wait a minute and try again.');
  return {principal:{worldId:s.world_id,actorId:s.actor_id,credentialId:s.credential_id,role:'operator'},rootWorldId:s.root_world_id,rootCredentialId:s.root_credential_id};
 }
 async logout(token:string){return this.transaction(async db=>{
  const r=await db.query('UPDATE little_worlds.operator_sessions SET revoked=true WHERE token_hash=$1 AND NOT revoked RETURNING world_id,credential_id',[tokenHash(token)]);
  if(r.rowCount){const actor=await db.query('SELECT actor_id FROM little_worlds.agent_credentials WHERE world_id=$1 AND id=$2',[r.rows[0].world_id,r.rows[0].credential_id]);await this.audit(db,{worldId:r.rows[0].world_id,actorId:actor.rows[0].actor_id},'logout',{});}
 });}
 private async audit(db:PoolClient,p:Pick<Principal,'worldId'|'actorId'>,action:string,details:unknown){await db.query('INSERT INTO little_worlds.operator_audit(world_id,actor_id,action,details) VALUES($1,$2,$3,$4)',[p.worldId,p.actorId,action,JSON.stringify(details)]);}
 private async entries(db:PoolClient,id:string,raw:unknown){
  const f=journalFiltersSchema.parse(raw);const values:unknown[]=[id];let where='world_id=$1';
  for(const [column,value] of [['actor_id',f.creature],['location_id',f.location],['source',f.source],['event_type',f.type]])if(value){values.push(value);where+=` AND ${column}=$${values.length}`;}
  values.push(f.offset);const rows=await db.query(`SELECT * FROM little_worlds.event_journal WHERE ${where} ORDER BY virtual_time DESC,recorded_at DESC,id DESC LIMIT 51 OFFSET $${values.length}`,values);
  const entries:JournalEntry[]=rows.rows.slice(0,50).map(e=>({id:e.id,virtualTime:e.virtual_time,source:e.source,type:e.event_type,actor:e.actor_id,location:e.location_id,payload:e.payload,effects:e.effects}));
  return {entries,hasMore:rows.rows.length>50};
 }
 async journal(p:Principal,filters:unknown){return this.transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkPrincipalRead(db,p,'operator');return this.entries(db,p.worldId,filters);});}
 async snapshot(p:Principal){return this.transaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkPrincipalRead(db,p,'operator');
  const w=await this.load(db,p.worldId,false);const settings=await db.query('SELECT * FROM little_worlds.world_settings WHERE world_id=$1',[p.worldId]);const places=await db.query('SELECT id,name,actions FROM little_worlds.locations WHERE world_id=$1 ORDER BY name',[p.worldId]);
  const proposals=await db.query('SELECT id,input,status,code,message,created_at FROM little_worlds.event_proposals WHERE world_id=$1 ORDER BY created_at DESC LIMIT 30',[p.worldId]);
  const usage=await db.query('SELECT model,status,reserved_tokens,actual_tokens,error_code,created_at FROM little_worlds.ai_usage WHERE world_id=$1 ORDER BY created_at DESC LIMIT 30',[p.worldId]);
  const daily=await db.query("SELECT requests,reserved_tokens FROM little_worlds.ai_daily_usage WHERE world_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[p.worldId]);
  const scheduled=await db.query('SELECT request_id,status,attempts,last_attempt_at,finished_at,result,error_code FROM little_worlds.scheduler_runs WHERE world_id=$1 ORDER BY last_attempt_at DESC LIMIT 8',[p.worldId]);
  const config=await this.narrative(db,w);const audit=await db.query('SELECT action,details,recorded_at FROM little_worlds.operator_audit WHERE world_id=$1 ORDER BY recorded_at DESC LIMIT 10',[p.worldId]);
  return {scheduled:scheduled.rows as {request_id:string;status:string;attempts:number;last_attempt_at:string;finished_at:string|null;result:{steps?:number;backlogSteps?:number}|null;error_code:string|null}[],world:{id:w.id,name:w.name,virtualTime:w.virtualTime,multiplier:w.multiplier,weather:w.weather,tick:w.tick,lastRealTime:w.lastRealTime,paused:Boolean(settings.rows[0].paused),isTest:Boolean(settings.rows[0].is_test),archived:Boolean(settings.rows[0].archived)},creatures:w.creatures,locations:places.rows as {id:string;name:string;actions:string[]}[],quest:await loadQuest(db,w.id),thread:config.state.thread,narrativeSettings:config.settings,journal:await this.entries(db,w.id,{}),proposals:proposals.rows as {id:string;input:unknown;status:string;code:string|null;message:string|null;created_at:string}[],usage:usage.rows as {model:string;status:string;reserved_tokens:number;actual_tokens:number|null;error_code:string|null;created_at:string}[],daily:daily.rows[0] as {requests:number;reserved_tokens:number}|undefined,audit:audit.rows as {action:string;details:Record<string,unknown>;recorded_at:string}[]};
 });}
 async control(p:Principal,raw:Control,localTools:boolean){const command=controlSchema.parse(raw);return this.transaction(async db=>{
  await this.checkPrincipal(db,p,'operator');await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[p.worldId]);
  const old=await db.query('SELECT command,result FROM little_worlds.operator_commands WHERE world_id=$1 AND actor_id=$2 AND request_id=$3',[p.worldId,p.actorId,command.request_id]);
  if(old.rowCount){if(canonical(old.rows[0].command)!==canonical(command))throw new ApiError('IDEMPOTENCY_CONFLICT',409,'Operation key already used');return {...old.rows[0].result,duplicate:true} as ControlResult;}
  const s=(await db.query('SELECT * FROM little_worlds.world_settings WHERE world_id=$1',[p.worldId])).rows[0];if(s.archived)throw new ApiError('ARCHIVED',409,'This village is preserved as a read-only archive');
  if((command.action==='advance_test'||command.action==='reset_test')&&(!localTools||!s.is_test))throw new ApiError('TEST_ONLY',403,'This control is available only in a marked local test village');
  let result:ControlResult={action:command.action,duplicate:false};
  if(command.action==='pause'&&!s.paused)await db.query('UPDATE little_worlds.world_settings SET paused=true,paused_at_ms=$2 WHERE world_id=$1',[p.worldId,Date.now()]);
  if(command.action==='resume'&&s.paused){await db.query('UPDATE little_worlds.simulation_state SET last_real_time=last_real_time+$2 WHERE world_id=$1',[p.worldId,Math.max(0,Date.now()-s.paused_at_ms)]);await db.query('UPDATE little_worlds.world_settings SET paused=false,paused_at_ms=NULL WHERE world_id=$1',[p.worldId]);}
  if(command.action==='run_tick'||command.action==='advance_test'){
   const w=await this.load(db,p.worldId,false);const count=command.action==='advance_test'?command.count:1;const now=s.is_test&&localTools?w.lastRealTime+w.intervalMs*count:Date.now();
   const tick=await this.tickInTransaction(db,p.worldId,`op:${tokenHash(canonical([p.actorId,command.request_id]))}`,now,count);result={...result,tick:tick.tick,advanced:tick.tick-w.tick};
  }
  if(command.action==='reset_test'){
   const id=randomUUID(),w=seedWorld(42,Date.now());w.id=id;w.creatures.forEach(c=>c.world_id=id);await this.seedInTransaction(db,w);await db.query('UPDATE little_worlds.world_settings SET is_test=true WHERE world_id=$1',[id]);
   const issued=await db.query('SELECT little_worlds.derive_test_operator($1,$2,$3,$4) AS id',[p.worldId,p.credentialId,id,tokenHash(randomBytes(32).toString('hex'))]);
   await db.query('UPDATE little_worlds.world_settings SET archived=true,paused=true,paused_at_ms=COALESCE(paused_at_ms,$2) WHERE world_id=$1',[p.worldId,Date.now()]);
   result={...result,newWorldId:id,newCredentialId:issued.rows[0].id};
  }
  await db.query('INSERT INTO little_worlds.operator_commands VALUES($1,$2,$3,$4,$5,now())',[p.worldId,p.actorId,command.request_id,JSON.stringify(command),JSON.stringify(result)]);await this.audit(db,p,command.action,{...command,result});return result;
 });}
 async resetSession(session:OperatorSession,result:ControlResult){
  if(!result.newWorldId||!result.newCredentialId)throw Error('Missing reset target');
  return this.transaction(async db=>{await this.checkPrincipal(db,session.principal,'operator');return this.issueSession(db,{worldId:result.newWorldId!,credentialId:result.newCredentialId!,actorId:'local-operator',role:'operator'},session.rootWorldId,session.rootCredentialId);});
 }
}
export interface ControlResult {action:Control['action'];duplicate:boolean;tick?:number;advanced?:number;newWorldId?:string;newCredentialId?:string;}
export type OperatorSnapshot=Awaited<ReturnType<OperatorRepository['snapshot']>>;
