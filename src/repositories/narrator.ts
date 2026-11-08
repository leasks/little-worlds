import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { CaretakerRepository,type Principal } from './caretaker';
import { ApiError } from '../caretaker/commands';
import { applyProposal,proposalSchema,settingsSchema,NarrativeError,DAY,questId,type NarrativeState,type Proposal } from '../narrative/engine';
import { loadQuest } from '../narrative/persistence';
import type { World } from '../engine';
// Stable canonical JSON, including nested objects, for retry and semantic deduplication.
export function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value)??'null';
}
export class NarratorRepository extends CaretakerRepository {
 protected async narrative(db:PoolClient,w:World){
  const s=await db.query('SELECT settings FROM little_worlds.narrative_settings WHERE world_id=$1',[w.id]);
  const history=await db.query("SELECT max(applied_virtual_time) AS last,max(applied_virtual_time) FILTER(WHERE input->>'event_type' IN ('discovery','quest_introduction','item_discovery')) AS rare, count(*) FILTER(WHERE applied_virtual_time >= $2 AND applied_virtual_time < $3)::int AS today FROM little_worlds.event_proposals WHERE world_id=$1 AND status='accepted'",[w.id,Math.floor(w.virtualTime/DAY)*DAY,(Math.floor(w.virtualTime/DAY)+1)*DAY]);
  const t=await db.query('SELECT status FROM little_worlds.story_threads WHERE world_id=$1 AND quest_id=$2',[w.id,questId]);
  const state:NarrativeState={quest:await loadQuest(db,w.id),lastEvent:history.rows[0].last,eventsToday:history.rows[0].today,lastRareEvent:history.rows[0].rare,thread:t.rows[0]?.status??null};
  return {settings:settingsSchema.parse(s.rows[0].settings),state};
 }
 async context(p:Principal){return this.transaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkPrincipalRead(db,p,'narrator');
  const w=await this.load(db,p.worldId,false);const n=await this.narrative(db,w);
  const recent=await db.query("SELECT event_type,virtual_time,location_id FROM little_worlds.event_journal WHERE world_id=$1 AND source<>'simulation' ORDER BY recorded_at DESC LIMIT 6",[w.id]);
  const pending=await db.query("SELECT id FROM little_worlds.event_proposals WHERE world_id=$1 AND status='pending'",[w.id]);
  return {world:{id:w.id,virtualTime:w.virtualTime,weather:w.weather},creatures:w.creatures.map(c=>({id:c.id,location:c.location,relationships:c.relationships,memories:c.memories.slice(-2),inventory:c.inventory})),recent:recent.rows,
   quest:n.state.quest,thread:n.state.thread,allowed:{items:['berries','seeds','glowing_seed'],quest:questId,effects:['give_item','adjust_relationship','unlock_quest','adjust_mood','set_weather'],categories:proposalSchema.shape.event_type.options},pacing:{...n.settings,lastEvent:n.state.lastEvent,lastRareEvent:n.state.lastRareEvent,eventsToday:n.state.eventsToday,pending:pending.rowCount!>0}};
 });}
 private async evaluate(db:PoolClient,w:World,raw:unknown){
  const n=await this.narrative(db,w);const result=applyProposal(w,n.state,raw,n.settings);
  for(const effect of result.proposal.effects){
   if(effect.type==='give_item'&&!(await db.query('SELECT id FROM little_worlds.items WHERE world_id=$1 AND id=$2',[w.id,effect.item_id])).rowCount)throw new NarrativeError('UNKNOWN_REFERENCE','Unregistered item');
   if(effect.type==='unlock_quest'&&!(await db.query('SELECT id FROM little_worlds.quests WHERE world_id=$1 AND id=$2',[w.id,effect.quest_id])).rowCount)throw new NarrativeError('UNKNOWN_REFERENCE','Unregistered quest');
  }
  return { ...result, settings:n.settings };
 }
 private semantic(p:Proposal){return canonical({event_type:p.event_type,location_id:p.location_id,participants:[...p.participants].sort(),effects:p.effects.map(canonical).sort()});}
 private async apply(db:PoolClient,w:World,result:Awaited<ReturnType<NarratorRepository['evaluate']>>,proposalId:string,actor:string){
  const after=result.world;
  if(result.started){
   const q=result.quest!;
   await db.query("INSERT INTO little_worlds.quest_instances(world_id,id,owner_id,stage,status,clues,started_at) VALUES($1,$2,$3,0,'active','[]',$4)",[w.id,q.id,q.owner,w.virtualTime]);
   await db.query("INSERT INTO little_worlds.story_threads VALUES($1,$2,'unresolved')",[w.id,q.id]);
  }
  await db.query('UPDATE little_worlds.simulation_state SET weather=$2 WHERE world_id=$1',[w.id,after.weather]);
  for(const c of after.creatures)await db.query('UPDATE little_worlds.creatures SET data=$3 WHERE world_id=$1 AND id=$2',[w.id,c.id,JSON.stringify(c)]);
  await db.query(`INSERT INTO little_worlds.event_journal(world_id,id,virtual_time,real_time,source,event_type,actor_id,location_id,payload,effects,correlation_id,initiating_actor_id,proposal_id)
   VALUES($1,$2,$3,$4,'narrator',$5,$6,$7,$8,$9,$10::text,$11,$10::text::uuid)`,[w.id,randomUUID(),w.virtualTime,Date.now(),result.proposal.event_type,result.proposal.participants[0],result.proposal.location_id,JSON.stringify(result.proposal),JSON.stringify({effects:result.proposal.effects,quest:result.quest}),proposalId,actor]);
 }
 private async decision(db:PoolClient,worldId:string,id:string,actor:string,status:'accepted'|'rejected',code:string|null,message:string|null,time:number|null){
  await db.query('UPDATE little_worlds.event_proposals SET status=$3,code=$4,message=$5,decided_at=now(),reviewed_by=$6,applied_virtual_time=$7 WHERE world_id=$1 AND id=$2',[worldId,id,status,code,message,actor,time]);
  await db.query('INSERT INTO little_worlds.proposal_decisions(world_id,proposal_id,actor_id,status,code) VALUES($1,$2,$3,$4,$5)',[worldId,id,actor,status,code]);
 }
 async submit(p:Principal,requestId:string,raw:unknown){
  z.string().min(1).max(128).parse(requestId);
  const serialized=canonical(raw);if(Buffer.byteLength(serialized)>8192)throw new ApiError('BODY_TOO_LARGE',413,'Proposal is too large');
  return this.transaction(async db=>{
   await this.checkPrincipal(db,p,'narrator');await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[p.worldId]);
   await this.assertWorldWritable(db,p.worldId);
   const old=await db.query('SELECT * FROM little_worlds.event_proposals WHERE world_id=$1 AND actor_id=$2 AND request_id=$3',[p.worldId,p.actorId,requestId]);
   if(old.rowCount){if(canonical(old.rows[0].input)!==serialized)throw new ApiError('IDEMPOTENCY_CONFLICT',409,'Proposal key already used');return {id:old.rows[0].id,status:old.rows[0].status,code:old.rows[0].code,duplicate:true};}
   const parsed=proposalSchema.safeParse(raw);const fingerprint=createHash('sha256').update(parsed.success?this.semantic(parsed.data):serialized).digest('hex');
   const id=randomUUID();const w=await this.load(db,p.worldId,false);
   let result:Awaited<ReturnType<NarratorRepository['evaluate']>>|null=null;let error:NarrativeError|null=null;
   try{
    if((await db.query("SELECT id FROM little_worlds.event_proposals WHERE world_id=$1 AND fingerprint=$2 AND status IN ('accepted','pending')",[p.worldId,fingerprint])).rowCount)throw new NarrativeError('DUPLICATE_PROPOSAL','Equivalent event already proposed');
    if((await db.query("SELECT id FROM little_worlds.event_proposals WHERE world_id=$1 AND status='pending'",[p.worldId])).rowCount)throw new NarrativeError('MANUAL_PENDING','Review the existing proposal first');
    result=await this.evaluate(db,w,raw);
   }catch(e){if(!(e instanceof NarrativeError))throw e;error=e;}
   if(error){
    await db.query("INSERT INTO little_worlds.event_proposals(world_id,id,actor_id,request_id,fingerprint,input,status,code,message,decided_at,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,'rejected',$7,$8,now(),$3)",[p.worldId,id,p.actorId,requestId,fingerprint,serialized,error.code,error.message]);
    await db.query("INSERT INTO little_worlds.proposal_decisions(world_id,proposal_id,actor_id,status,code) VALUES($1,$2,$3,'rejected',$4)",[p.worldId,id,p.actorId,error.code]);
    return {id,status:'rejected',code:error.code,duplicate:false};
   }
   await db.query("INSERT INTO little_worlds.event_proposals(world_id,id,actor_id,request_id,fingerprint,input,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",[p.worldId,id,p.actorId,requestId,fingerprint,serialized]);
   if(result!.settings.manualApproval)return {id,status:'pending',code:null,duplicate:false};
   await this.apply(db,w,result!,id,p.actorId);await this.decision(db,p.worldId,id,p.actorId,'accepted',null,null,w.virtualTime);
   return {id,status:'accepted',code:null,duplicate:false};
  });
 }
 async review(p:Principal,id:string,approve:boolean){
  z.uuid().parse(id);return this.transaction(async db=>{
   await this.checkPrincipal(db,p,'operator');await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[p.worldId]);
   await this.assertWorldWritable(db,p.worldId);
   const {rows}=await db.query('SELECT * FROM little_worlds.event_proposals WHERE world_id=$1 AND id=$2 FOR UPDATE',[p.worldId,id]);
   const proposal=rows[0];if(!proposal)throw new ApiError('NOT_FOUND',404,'Proposal not found');
   if(proposal.status!=='pending')return {id,status:proposal.status,code:proposal.code,duplicate:true};
   const w=await this.load(db,p.worldId,false);
   let result:Awaited<ReturnType<NarratorRepository['evaluate']>>|null=null;let error:NarrativeError|null=null;
   try{if(!approve)throw new NarrativeError('OPERATOR_REJECTED','Operator rejected proposal');result=await this.evaluate(db,w,proposal.input);}
   catch(e){if(!(e instanceof NarrativeError))throw e;error=e;}
   if(error){await this.decision(db,p.worldId,id,p.actorId,'rejected',error.code,error.message,null);return {id,status:'rejected',code:error.code,duplicate:false};}
   await this.apply(db,w,result!,id,proposal.actor_id);await this.decision(db,p.worldId,id,p.actorId,'accepted',null,null,w.virtualTime);return {id,status:'accepted',code:null,duplicate:false};
  });
 }
 async inspect(p:Principal){return this.transaction(async db=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await this.checkPrincipalRead(db,p,'operator');
  const proposals=await db.query('SELECT id,actor_id,input,status,code,message,created_at,reviewed_by FROM little_worlds.event_proposals WHERE world_id=$1 ORDER BY created_at DESC LIMIT 30',[p.worldId]);
  const usage=await db.query('SELECT workflow_id,attempt,model,status,reserved_tokens,actual_tokens,error_code,created_at FROM little_worlds.ai_usage WHERE world_id=$1 ORDER BY created_at DESC LIMIT 30',[p.worldId]);
  return {proposals:proposals.rows,usage:usage.rows};
 });}
 async reserveAi(p:Principal,workflow:string,attempt:number,model:string,tokens:number){
  z.string().min(1).max(100).parse(workflow);z.number().int().min(0).max(1).parse(attempt);z.string().min(1).max(120).parse(model);z.number().int().min(1).max(20000).parse(tokens);
  return this.transaction(async db=>{
   await this.checkPrincipal(db,p,'narrator');
   const settingsRow=await db.query('SELECT settings FROM little_worlds.narrative_settings WHERE world_id=$1',[p.worldId]);const settings=settingsSchema.parse(settingsRow.rows[0].settings);
   await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[p.worldId]);
   await this.assertWorldWritable(db,p.worldId);
   const prior=await db.query('SELECT id FROM little_worlds.ai_usage WHERE world_id=$1 AND workflow_id=$2 AND attempt=$3',[p.worldId,workflow,attempt]);
   if(prior.rowCount)throw new ApiError('AI_ATTEMPT_EXISTS',409,'This outbound attempt was already reserved');
   await db.query("INSERT INTO little_worlds.ai_daily_usage VALUES($1,(now() AT TIME ZONE 'UTC')::date,0,0) ON CONFLICT DO NOTHING",[p.worldId]);
   const budget=await db.query("UPDATE little_worlds.ai_daily_usage SET requests=requests+1,reserved_tokens=reserved_tokens+$2 WHERE world_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date AND requests<$3 AND reserved_tokens+$2<=$4 RETURNING day",[p.worldId,tokens,settings.dailyRequests,settings.dailyTokens]);
   if(!budget.rowCount)throw new ApiError('AI_BUDGET_EXHAUSTED',429,'Daily AI budget exhausted');
   const usage=await db.query("INSERT INTO little_worlds.ai_usage(world_id,workflow_id,attempt,model,status,reserved_tokens) VALUES($1,$2,$3,$4,'reserved',$5) RETURNING id",[p.worldId,workflow,attempt,model,tokens]);return usage.rows[0].id as string;
  });
 }
 async finishAi(p:Principal,id:string,tokens:number|null,errorCode:string|null){
  if(tokens!==null)z.number().int().min(0).max(2000000).parse(tokens);
  if(errorCode!==null)z.string().max(80).regex(/^[A-Z_]+$/).parse(errorCode);
  await this.transaction(async db=>{
   await this.checkPrincipal(db,p,'narrator');
   const r=await db.query("SELECT reserved_tokens,created_at FROM little_worlds.ai_usage WHERE world_id=$1 AND id=$2 AND status='reserved' FOR UPDATE",[p.worldId,id]);if(!r.rowCount)return;
   if(tokens!==null&&tokens>r.rows[0].reserved_tokens){
    errorCode='BUDGET_ESTIMATE_EXCEEDED';await db.query("UPDATE little_worlds.ai_daily_usage SET reserved_tokens=reserved_tokens+$2 WHERE world_id=$1 AND day=($3::timestamptz AT TIME ZONE 'UTC')::date",[p.worldId,tokens-r.rows[0].reserved_tokens,r.rows[0].created_at]);
   }
   await db.query('UPDATE little_worlds.ai_usage SET status=$3,actual_tokens=$4,error_code=$5 WHERE world_id=$1 AND id=$2',[p.worldId,id,errorCode?'error':'ok',tokens,errorCode]);
  });
 }

}
