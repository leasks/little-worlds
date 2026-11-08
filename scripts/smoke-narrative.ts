import { randomBytes,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { NarratorRepository } from '../src/repositories/narrator';
import { defaultSettings,type Proposal } from '../src/narrative/engine';
async function main(){
 const url=process.env.TEST_DATABASE_URL,base=process.env.VILLAGE_URL??'http://127.0.0.1:3001';
 if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Local server and disposable local database required');
 const pool=new Pool({connectionString:url});let worldId:string|undefined;
 try{
  const repo=new NarratorRepository(pool);worldId=await repo.seed(undefined,Date.now());const id=worldId;
  await pool.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[id,JSON.stringify({...defaultSettings,earliestDiscovery:0,minGap:0,rareMinGap:0,maxPerDay:5})]);
  const tokens={caretaker:randomBytes(32).toString('hex'),narrator:randomBytes(32).toString('hex'),operator:randomBytes(32).toString('hex')};
  for(const role of ['caretaker','narrator','operator'] as const){
   const env={...process.env,DATABASE_URL:url,WORLD_ID:id,AGENT_ROLE:role,AGENT_ACTOR_ID:`local-${role}`,CARETAKER_API_KEY:tokens.caretaker,NARRATOR_API_KEY:tokens.narrator,OPERATOR_API_KEY:tokens.operator};
   const result=spawnSync(process.execPath,['--import','tsx','scripts/caretaker-credential.ts'],{env,encoding:'utf8'});if(result.status!==0)throw Error('Credential tool failed');
  }
  const endpoint=`${base}/api/worlds/${id}`;
  async function request(role:keyof typeof tokens,path:string,body?:unknown,status=200){
   const response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${tokens[role]}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.status!==status)throw Error(`Unexpected HTTP ${response.status} for ${path}`);return response.json();
  }
  const act=(action:string,parameters:unknown={},target_id='pip')=>request('caretaker','/actions',{actor_id:'local-caretaker',target_id,action,parameters,idempotency_key:randomUUID()});
  await act('visit_location',{location_id:'garden'});await act('visit_location',{location_id:'garden'},'moss');
  await request('narrator','',undefined,401);await request('caretaker','/proposals',undefined,401);
  const context=await request('narrator','/narrator/context');if(!context.result.allowed)throw Error('Context not provided');
  const proposal:Proposal={schema_version:1,event_type:'discovery',title:'The Glowing Seed',description:'Pip finds a gently glowing seed beside Moss.',location_id:'garden',participants:['pip','moss'],effects:[{type:'give_item',target_id:'pip',item_id:'glowing_seed',quantity:1},{type:'unlock_quest',quest_id:'mystery_of_the_seed'}]};
  const pending=await request('narrator','/proposals',{request_id:randomUUID(),proposal},202);
  await request('operator','/proposals');const reviewed=await request('operator',`/proposals/${pending.result.id}/review`,{approve:true});if(reviewed.result.status!=='accepted')throw Error('Proposal not accepted');
  await act('investigate_discovery',{discovery_id:'glowing_seed'});await act('visit_location',{location_id:'pond'});await act('visit_location',{location_id:'garden'});await act('plant_crop');await act('tend_crop');
  const state=await request('caretaker','');if(state.result.quest.status!=='completed'||state.result.quest.clues.length!==4)throw Error('Quest did not complete');
  const before=await repo.read(id);const rejected=await request('narrator','/proposals',{request_id:randomUUID(),proposal:{effects:[{type:'sql'}]}},422);
  if(rejected.code!=='INVALID_PROPOSAL'||JSON.stringify(await repo.read(id))!==JSON.stringify(before))throw Error('Invalid proposal mutated world');
  if(before.creatures[0]!.inventory.seed_charm!==1)throw Error('Reward missing');
  console.log('Narrative HTTP smoke passed: scoped credentials, compact context, manual approval, full seed quest, reward, rejection without mutation');
 }finally{if(worldId)await pool.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE world_id=$1',[worldId]);await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Narrative smoke failed');process.exitCode=1;});
