import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { NarratorRepository } from '../src/repositories/narrator';
import { tokenHash,type AgentRole } from '../src/repositories/caretaker';
import { defaultSettings } from '../src/narrative/engine';
import type { Command } from '../src/caretaker/commands';
import { narratorApi } from '../src/server/narrator-api';
import { caretakerApi } from '../src/server/caretaker-api';
import { runNarrator } from '../src/ai/narrate';
import { ProviderError,type LlmProvider } from '../src/ai/provider';
import { seedProposal } from './fixtures/narrative';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Disposable local database required');
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'});const repo=new NarratorRepository(pool);
afterAll(async()=>{await pool.end();await admin.end();});
async function fixture(manualApproval=false){
 const id=await repo.seed(undefined,0);
 await admin.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[id,JSON.stringify({...defaultSettings,manualApproval,minGap:0,rareMinGap:0,earliestDiscovery:0,maxPerDay:5})]);
 async function credential(role:AgentRole){const token=randomBytes(32).toString('hex');await admin.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[id,`local-${role}`,tokenHash(token),role]);return {token,p:await repo.authenticate(token,id,role)};}
 const caretaker=await credential('caretaker'),narrator=await credential('narrator'),operator=await credential('operator');
 const act=async(action:Command['action'],parameters:unknown={},target_id='pip')=>repo.act(caretaker.p,{actor_id:caretaker.p.actorId,idempotency_key:randomUUID(),target_id,action,parameters} as Command);
 await act('visit_location',{location_id:'garden'});await act('visit_location',{location_id:'garden'},'moss');
 return {id,caretaker,narrator,operator,act};
}
const req=(token:string,raw?:unknown)=>new Request('http://test',{method:raw?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:raw?JSON.stringify(raw):undefined});
describe.skipIf(!url)('narrator and quests in PostgreSQL',()=>{
 it('applies registered effects atomically and rejects semantic duplicate events',async()=>{
  const f=await fixture();const outcomes=await Promise.all([repo.submit(f.narrator.p,'one',seedProposal),repo.submit(f.narrator.p,'two',{...seedProposal,title:'Reworded title'})]);
  expect(outcomes.map(o=>o.status).sort()).toEqual(['accepted','rejected']);expect(outcomes.find(o=>o.status==='rejected')?.code).toBe('DUPLICATE_PROPOSAL');
  const w=await repo.read(f.id);expect(w.creatures[0]!.inventory.glowing_seed).toBe(1);expect(w.journal.filter(e=>e.source==='narrator')).toHaveLength(1);
  const key=outcomes[0]!.status==='accepted'?'one':'two';const input=key==='one'?seedProposal:{...seedProposal,title:'Reworded title'};
  expect((await repo.submit(f.narrator.p,key,input)).duplicate).toBe(true);
  await expect(repo.submit(f.narrator.p,key,{})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 });
 it('audits malformed, contradictory, unknown and unauthorized proposals without world mutation',async()=>{
  const f=await fixture(),before=await repo.read(f.id);
  for(const input of [{schema_version:99},{...seedProposal,effects:[{type:'execute_sql',code:'anything'}]},{...seedProposal,participants:['nim']},{...seedProposal,effects:[seedProposal.effects[0]]}]){
   expect((await repo.submit(f.narrator.p,randomUUID(),input)).status).toBe('rejected');expect(await repo.read(f.id)).toEqual(before);
  }
  expect((await repo.inspect(f.operator.p)).proposals).toHaveLength(4);
  await expect(repo.submit(f.caretaker.p,'unauthorized',seedProposal)).rejects.toMatchObject({status:403});
 });
 it('holds manual proposals, enforces operator approval and revalidates stale state',async()=>{
  const f=await fixture(true),before=await repo.read(f.id);
  const pending=await repo.submit(f.narrator.p,'manual',seedProposal);expect(pending.status).toBe('pending');expect(await repo.read(f.id)).toEqual(before);
  const duplicate=await repo.submit(f.narrator.p,'duplicate',seedProposal);expect(duplicate.code).toBe('DUPLICATE_PROPOSAL');
  const busy=await repo.submit(f.narrator.p,'other',{...seedProposal,event_type:'social_interaction',effects:[{type:'adjust_mood',target_id:'pip',delta:1}]});expect(busy.code).toBe('MANUAL_PENDING');
  await expect(repo.review(f.narrator.p,pending.id,true)).rejects.toMatchObject({status:403});
  await f.act('visit_location',{location_id:'forest'},'moss');const stale=await repo.read(f.id);
  expect((await repo.review(f.operator.p,pending.id,true)).status).toBe('rejected');expect(await repo.read(f.id)).toEqual(stale);
  expect((await repo.review(f.operator.p,pending.id,true)).duplicate).toBe(true);
 });
 it('completes the multi-stage seed quest through real caretaker commands with one reward',async()=>{
  const f=await fixture(true);const p=await repo.submit(f.narrator.p,'seed',seedProposal);expect((await repo.review(f.operator.p,p.id,true)).status).toBe('accepted');
  await f.act('investigate_discovery',{discovery_id:'glowing_seed'});
  expect((await repo.observe(f.caretaker.p)).quest?.stage).toBe(1);
  await f.act('visit_location',{location_id:'pond'});expect((await repo.observe(f.caretaker.p)).quest?.stage).toBe(2);
  await f.act('visit_location',{location_id:'garden'});await f.act('plant_crop');expect((await repo.observe(f.caretaker.p)).quest?.stage).toBe(3);
  const command:Command={actor_id:'local-caretaker',target_id:'pip',idempotency_key:'complete-once',action:'tend_crop',parameters:{}};
  await repo.act(f.caretaker.p,command);await repo.act(f.caretaker.p,command);
  const q=(await repo.observe(f.caretaker.p)).quest;expect(q?.status).toBe('completed');expect(q?.clues).toHaveLength(4);
  const w=await repo.read(f.id);expect(w.creatures[0]!.inventory.seed_charm).toBe(1);expect(w.creatures[0]!.inventory.glowing_seed).toBe(0);
  expect((await admin.query('SELECT status FROM little_worlds.story_threads WHERE world_id=$1',[f.id])).rows[0].status).toBe('resolved');
  const repeat=await repo.submit(f.narrator.p,'new-mystery',{...seedProposal,participants:['pip'],effects:[{type:'give_item',target_id:'pip',item_id:'glowing_seed',quantity:1},{type:'unlock_quest',quest_id:'mystery_of_the_seed'}]});expect(repeat.code).toBe('QUEST_CONFLICT');
 });
 it('rolls back all accepted effects, quest, thread and proposal on a late database failure',async()=>{
  const f=await fixture(),before=await repo.read(f.id);
  await admin.query(`CREATE FUNCTION little_worlds.test_narrative_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' AND NEW.source='narrator' THEN RAISE EXCEPTION 'narrator journal failure'; END IF; RETURN NEW; END $$`);
  await admin.query('CREATE TRIGGER test_narrative_fail BEFORE INSERT ON little_worlds.event_journal FOR EACH ROW EXECUTE FUNCTION little_worlds.test_narrative_fail()');
  try{await expect(repo.submit(f.narrator.p,'retry',seedProposal)).rejects.toThrow('narrator journal failure');expect(await repo.read(f.id)).toEqual(before);expect((await repo.context(f.narrator.p)).quest).toBeNull();expect((await repo.inspect(f.operator.p)).proposals).toHaveLength(0);}
  finally{await admin.query('DROP TRIGGER test_narrative_fail ON little_worlds.event_journal');await admin.query('DROP FUNCTION little_worlds.test_narrative_fail()');}
  expect((await repo.submit(f.narrator.p,'retry',seedProposal)).status).toBe('accepted');
 });
 it('enforces category pacing and catalogue registration against current state',async()=>{
  const f=await fixture();await admin.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[f.id,JSON.stringify({...defaultSettings,manualApproval:false,earliestDiscovery:0})]);
  expect((await repo.submit(f.narrator.p,'first',seedProposal)).status).toBe('accepted');
  expect((await repo.submit(f.narrator.p,'later',{...seedProposal,event_type:'social_interaction',effects:[{type:'adjust_mood',target_id:'pip',delta:1}]})).code).toBe('PACING_LIMIT');
  const other=await fixture();await admin.query("DELETE FROM little_worlds.items WHERE world_id=$1 AND id='glowing_seed'",[other.id]);
  expect((await repo.submit(other.narrator.p,'missing',seedProposal)).code).toBe('UNKNOWN_REFERENCE');
 });
 it('reserves concurrent daily budgets and protects replayed outbound attempts',async()=>{
  const f=await fixture();const reservations=await Promise.allSettled([0,1,2].map(i=>repo.reserveAi(f.narrator.p,`request-${i}`,0,'fake',100)));
  expect(reservations.filter(r=>r.status==='fulfilled')).toHaveLength(2);expect(reservations.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'AI_BUDGET_EXHAUSTED'}});
  const id=reservations.find(r=>r.status==='fulfilled');if(id?.status==='fulfilled')await repo.finishAi(f.narrator.p,id.value,25,null);
  expect((await repo.inspect(f.operator.p)).usage).toHaveLength(2);
  const g=await fixture();await repo.reserveAi(g.narrator.p,'same',0,'fake',100);await expect(repo.reserveAi(g.narrator.p,'same',0,'fake',100)).rejects.toMatchObject({code:'AI_ATTEMPT_EXISTS'});
 });
 it('enforces token ceilings and records conservative uncertainty without refunds',async()=>{
  const f=await fixture();await admin.query("UPDATE little_worlds.narrative_settings SET settings=jsonb_set(settings,'{dailyTokens}','150') WHERE world_id=$1",[f.id]);
  await expect(repo.reserveAi(f.narrator.p,'oversized',0,'fake',151)).rejects.toMatchObject({code:'AI_BUDGET_EXHAUSTED'});
  const id=await repo.reserveAi(f.narrator.p,'estimate',0,'fake',100);await repo.finishAi(f.narrator.p,id,200,null);
  const usage=(await repo.inspect(f.operator.p)).usage;expect(usage[0]).toMatchObject({status:'error',actual_tokens:200,error_code:'BUDGET_ESTIMATE_EXCEEDED'});
  await expect(repo.reserveAi(f.narrator.p,'next',0,'fake',1)).rejects.toMatchObject({code:'AI_BUDGET_EXHAUSTED'});
 });
 it('handles AI outages with bounded retries while ordinary ticks keep working',async()=>{
  const f=await fixture();let calls=0;
  const provider:LlmProvider={model:'fake',reservation:()=>100,generate:async()=>{calls++;throw new ProviderError('NETWORK_OR_TIMEOUT',true);}};
  const before=await repo.read(f.id);expect((await runNarrator(repo,f.narrator.p,provider,'outage',async()=>{})).status).toBe('unavailable');expect(calls).toBe(2);expect(await repo.read(f.id)).toEqual(before);
  const usage=(await repo.inspect(f.operator.p)).usage;expect(usage).toHaveLength(2);expect(usage.every(u=>u.status==='error'&&u.actual_tokens===null)).toBe(true);
  await repo.tick(f.id,'ordinary',300000);expect((await repo.read(f.id)).tick).toBe(1);
  expect((await runNarrator(repo,f.narrator.p,provider,'exhausted',async()=>{})).code).toBe('AI_BUDGET_EXHAUSTED');expect(calls).toBe(2);
 });
 it('records malformed structured output, honours long Retry-After and defers manual backlog',async()=>{
  const f=await fixture();let calls=0;const malformed:LlmProvider={model:'fake',reservation:()=>100,generate:async()=>{calls++;return {proposal:{sql:'do not execute'},tokens:10};}};
  const result=await runNarrator(repo,f.narrator.p,malformed,'malformed');expect(result).toMatchObject({status:'proposed',result:{status:'rejected',code:'INVALID_PROPOSAL'}});
  const limited:LlmProvider={model:'fake',reservation:()=>100,generate:async()=>{calls++;throw new ProviderError('RATE_LIMITED',true,60000);}};
  expect((await runNarrator(repo,f.narrator.p,limited,'rate',async()=>{throw Error('must not shorten Retry-After');})).status).toBe('unavailable');expect(calls).toBe(2);
  const g=await fixture(true);await repo.submit(g.narrator.p,'pending',seedProposal);expect((await runNarrator(repo,g.narrator.p,malformed,'pending')).status).toBe('deferred');expect(calls).toBe(2);
  expect((await runNarrator(repo,g.narrator.p,null)).status).toBe('disabled');
 });
 it('keeps narrator/operator HTTP permissions separate from caretaker access',async()=>{
  const f=await fixture(true);expect((await narratorApi(req(f.caretaker.token),f.id,'context',()=>repo)).status).toBe(401);
  expect((await caretakerApi(req(f.narrator.token),f.id,'world',()=>repo)).status).toBe(401);
  const response=await narratorApi(req(f.narrator.token,{request_id:'api',proposal:seedProposal}),f.id,'submit',()=>repo);expect(response.status).toBe(202);const pending=(await response.json()).result;
  expect((await narratorApi(req(f.narrator.token),f.id,'inspect',()=>repo)).status).toBe(401);
  expect((await narratorApi(req(f.operator.token,{approve:true}),f.id,'review',()=>repo,pending.id)).status).toBe(200);
  const observation=await repo.observe(f.caretaker.p);expect(observation).not.toHaveProperty('pacing');expect(observation).not.toHaveProperty('proposals');expect(observation).not.toHaveProperty('usage');
 });
});
