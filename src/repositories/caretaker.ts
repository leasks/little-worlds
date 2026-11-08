import { validateWorld } from '../engine';
import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PostgresWorldRepository } from './postgres';
import { loadQuest,advanceCaretakerQuest } from '../narrative/persistence';
import { ApiError,applyCommand,commandSchema, type Command } from '../caretaker/commands';
export interface Principal {worldId:string;actorId:string;credentialId:string;role:AgentRole;}
export type AgentRole='caretaker'|'narrator'|'operator';
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export class CaretakerRepository extends PostgresWorldRepository {
 async authenticate(token:string,worldId:string,role:AgentRole='caretaker'):Promise<Principal>{
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new ApiError('UNAUTHORIZED',401,'Valid bearer credential required');
  return this.transaction(async db=>{
   const {rows}=await db.query(`SELECT c.*,a.kind FROM little_worlds.agent_credentials c JOIN little_worlds.actors a ON a.world_id=c.world_id AND a.id=c.actor_id
    WHERE c.token_hash=$1 AND c.world_id=$2 AND NOT c.revoked AND c.expires_at>now() AND c.role=$3 AND a.kind=$3 FOR UPDATE OF c`,[tokenHash(token),worldId,role]);
   const c=rows[0];if(!c)throw new ApiError('UNAUTHORIZED',401,'Valid bearer credential required');
   const reset=await db.query(`UPDATE little_worlds.agent_credentials SET requests=CASE WHEN window_start<=now()-interval '1 minute' THEN 1 ELSE requests+1 END,
    window_start=CASE WHEN window_start<=now()-interval '1 minute' THEN now() ELSE window_start END
    WHERE world_id=$1 AND id=$2 AND (requests<60 OR window_start<=now()-interval '1 minute') RETURNING id`,[worldId,c.id]);
   if(!reset.rowCount)throw new ApiError('RATE_LIMITED',429,'Request limit reached; retry in 60 seconds');
   return {worldId:c.world_id,actorId:c.actor_id,credentialId:c.id,role};
  });
 }
 protected async checkPrincipal(db:PoolClient,p:Principal,role:AgentRole='caretaker'){
  if(p.role!==role)throw new ApiError('FORBIDDEN',403,'Credential role is not permitted');
  const r=await db.query(`SELECT c.id FROM little_worlds.agent_credentials c JOIN little_worlds.actors a ON a.world_id=c.world_id AND a.id=c.actor_id
   WHERE c.world_id=$1 AND c.id=$2 AND c.actor_id=$3 AND NOT c.revoked AND c.expires_at>now() AND c.role=$4 AND a.kind=$4 FOR SHARE OF c`,[p.worldId,p.credentialId,p.actorId,role]);
  if(!r.rowCount)throw new ApiError('UNAUTHORIZED',401,'Credential is no longer active');
 }
 async observe(p:Principal){return this.transaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkPrincipalRead(db,p);
  const w=await this.load(db,p.worldId,false);
  const actor=await db.query('SELECT state FROM little_worlds.actors WHERE world_id=$1 AND id=$2',[p.worldId,p.actorId]);
  const places=await db.query('SELECT id,name,actions FROM little_worlds.locations WHERE world_id=$1 ORDER BY id',[p.worldId]);
  // Explicit allowlist: no narrator context, seed, internal receipts or journal payloads.
  return {id:w.id,name:w.name,virtualTime:w.virtualTime,multiplier:w.multiplier,weather:w.weather,locations:places.rows,
   quest:await loadQuest(db,p.worldId),caretaker:{id:p.actorId,state:actor.rows[0].state},creatures:w.creatures.map(c=>c.owner===p.actorId?
   {id:c.id,name:c.name,location:c.location,activity:c.activity,needs:c.needs,traits:c.traits,preferences:c.preferences,relationships:c.relationships,memories:c.memories,inventory:c.inventory}:
   {id:c.id,name:c.name,location:c.location,activity:c.activity})};
 });}
 protected async checkPrincipalRead(db:PoolClient,p:Principal,role:AgentRole='caretaker'){
  if(p.role!==role)throw new ApiError('FORBIDDEN',403,'Credential role is not permitted');
  const r=await db.query(`SELECT c.id FROM little_worlds.agent_credentials c JOIN little_worlds.actors a ON a.world_id=c.world_id AND a.id=c.actor_id
   WHERE c.world_id=$1 AND c.id=$2 AND c.actor_id=$3 AND NOT c.revoked AND c.expires_at>now() AND c.role=$4 AND a.kind=$4`,[p.worldId,p.credentialId,p.actorId,role]);
  if(!r.rowCount)throw new ApiError('UNAUTHORIZED',401,'Credential is no longer active');
 }
 async act(p:Principal,raw:Command){
  const c=commandSchema.parse(raw);
  if(c.actor_id!==p.actorId)throw new ApiError('FORBIDDEN',403,'Actor does not match credential');
  return this.transaction(async db=>{
   await this.checkPrincipal(db,p);
   await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[p.worldId]);
   await this.assertWorldWritable(db,p.worldId);
   const old=await db.query('SELECT command,result FROM little_worlds.action_receipts WHERE world_id=$1 AND actor_id=$2 AND request_id=$3',[p.worldId,p.actorId,c.idempotency_key]);
   if(old.rowCount){
    // Compare normalized, validated commands; PostgreSQL JSON key order is irrelevant.
    if(JSON.stringify(commandSchema.parse(old.rows[0].command))!==JSON.stringify(c))throw new ApiError('IDEMPOTENCY_CONFLICT',409,'Key already used for a different command');
    return {...old.rows[0].result,duplicate:true};
   }
   const world=await this.load(db,p.worldId,false);
   const row=await db.query('SELECT state FROM little_worlds.actors WHERE world_id=$1 AND id=$2 FOR UPDATE',[p.worldId,p.actorId]);
   const quest=await loadQuest(db,p.worldId);
   const result=applyCommand(world,row.rows[0].state,c,p.actorId,quest);
   const questChange=await advanceCaretakerQuest(db,result.world,c);
   validateWorld(result.world);
   const response={request_id:c.idempotency_key,action:c.action,target_id:c.target_id,virtualTime:world.virtualTime,quest:questChange?.after??quest,needs:result.creature.needs,location:result.creature.location,inventory:result.actor.inventory,duplicate:false};
   await db.query('INSERT INTO little_worlds.action_receipts(world_id,actor_id,request_id,command,result) VALUES($1,$2,$3,$4,$5)',[p.worldId,p.actorId,c.idempotency_key,JSON.stringify(c),JSON.stringify(response)]);
   await db.query('UPDATE little_worlds.actors SET state=$3 WHERE world_id=$1 AND id=$2',[p.worldId,p.actorId,JSON.stringify(result.actor)]);
   const target=result.creature;
   await db.query('UPDATE little_worlds.creatures SET location_id=$3,data=$4 WHERE world_id=$1 AND id=$2',[p.worldId,target.id,target.location,JSON.stringify(target)]);
   await db.query(`INSERT INTO little_worlds.event_journal(world_id,id,virtual_time,real_time,source,event_type,actor_id,location_id,payload,effects,correlation_id,action_request_id,initiating_actor_id)
    VALUES($1,$2,$3,$4,'caretaker',$5,$6,$7,$8,$9,$10,$10,$11)`,[p.worldId,randomUUID(),world.virtualTime,Date.now(),c.action,target.id,target.location,JSON.stringify(c),JSON.stringify({before:result.before,after:target,caretakerBefore:result.actorBefore,caretakerAfter:result.actor,questChange}),c.idempotency_key,p.actorId]);
   return response;
  });
 }
}
