import { experimentConfigSchema,type ExperimentConfig,type RecordedInput } from './contracts';
import { ExperimentRepository } from '../repositories/experiment';
import { actorStateSchema,commandSchema,type Command } from '../caretaker/commands';
import type { AgentRole,Principal } from '../repositories/caretaker';
import { runNarrator } from '../ai/narrate';
import { ProviderError,type LlmProvider } from '../ai/provider';
import type { Proposal } from '../narrative/engine';
import { buildExperimentReport } from './report';
export const seedStory:Proposal={schema_version:1,event_type:'discovery',title:'The Glowing Seed',description:'Beside Moss in the garden, Pip notices a seed with a quiet green glow.',location_id:'garden',participants:['pip','moss'],effects:[{type:'give_item',target_id:'pip',item_id:'glowing_seed',quantity:1},{type:'adjust_relationship',source_id:'pip',target_id:'moss',delta:2},{type:'unlock_quest',quest_id:'mystery_of_the_seed'}]};
const socialStory:Proposal={schema_version:1,event_type:'social_interaction',title:'A Familiar Bench',description:'Pip and Moss share a quiet moment on their familiar bench in the square.',location_id:'square',participants:['pip','moss'],effects:[{type:'adjust_relationship',source_id:'pip',target_id:'moss',delta:0}]};
export class ExperimentFailure extends Error{constructor(public worldId:string){super('EXPERIMENT_EXECUTION_FAILED');}}
export async function runExperiment(admin:ExperimentRepository,repo:ExperimentRepository,raw:ExperimentConfig,sourceHash:string,onCheckpoint?:(day:number)=>void|Promise<void>){
 const config=experimentConfigSchema.parse(raw),worldId=await admin.createExperiment(config,sourceHash);let sequence=0,day=1;
 try{
  const keys=await admin.issueExperimentKeys(worldId),principals={} as Record<AgentRole,Principal>;
  for(const role of ['caretaker','narrator','operator'] as const)principals[role]=await repo.authenticate(keys[role],worldId,role);
  async function step<T>(kind:RecordedInput['kind'],label:string,input:unknown,perform:()=>Promise<T>){
   const n=++sequence;await repo.recordInput(worldId,{sequence:n,day,label:`d${day}:${label}`,kind,input});
   try{const outcome=await perform();await repo.finishInput(worldId,n,outcome);return outcome;}
   catch(error){await repo.finishInput(worldId,n,{code:'EXPERIMENT_OPERATION_FAILED'},true);throw error;}
  }
  const observe=()=>repo.observe(principals.caretaker);
  async function creature(id:Command['target_id']){const c=(await observe()).creatures.find(c=>c.id===id);if(!c?.needs)throw Error('EXPERIMENT_OWNERSHIP_INVARIANT');return c as typeof c&{needs:NonNullable<typeof c.needs>};}
  async function action(label:string,target:Command['target_id'],name:Command['action'],parameters:unknown={}){
   const command=commandSchema.parse({actor_id:'local-caretaker',target_id:target,action:name,parameters,idempotency_key:`exp:d${day}:${label}`});
   const result=await step('action',label,{command},()=>repo.act(principals.caretaker,command));return {command,result};
  }
  async function skip(label:string,reason:string){await step('action',label,{policyDecision:'skip',reason},async()=>({skipped:true,reason}));}
  async function go(label:string,target:Command['target_id'],location:string){
   const o=await observe(),c=o.creatures.find(c=>c.id===target);if(!c?.needs)throw Error('EXPERIMENT_CREATURE_MISSING');
   if(c.location===location&&o.caretaker.state.location===location){await skip(label,'Already together at the location');return;}
   await action(label,target,'visit_location',{location_id:location});
  }
  async function rest(label:string,target:Command['target_id'],minimum=65){
   for(let n=0;n<4;n++){if((await creature(target)).needs.energy>=minimum)break;await action(`${label}:${n}`,target,'encourage_rest');}
  }
  async function prepare(label:string,target:Command['target_id']){await go(`${label}:cottage`,target,'cottage');await rest(`${label}:rest`,target,70);}
  async function care(){
   for(const target of ['pip','moss','nim'] as const){
    await go(`care:${target}:cottage`,target,'cottage');await rest(`care:${target}:rest`,target);
    const c=await creature(target),inventory=actorStateSchema.parse((await observe()).caretaker.state).inventory;
    if(c.needs.hunger>=25&&inventory.berries>0)await action(`care:${target}:feed`,target,'feed_creature',{food_id:'berries',quantity:1});
    else await skip(`care:${target}:feed`,inventory.berries===0?'No caretaker berries available':'No feeding needed');
    await action(`care:${target}:visit`,target,'interact_creature');
    if(target==='pip'&&day%3===0){await go('care:pip:square',target,'square');await action('care:pip:play',target,'encourage_play');}
    if(target==='moss'&&day%7===0){
     if(actorStateSchema.parse((await observe()).caretaker.state).inventory.seeds>0){await go('care:moss:garden',target,'garden');await action('care:moss:plant',target,'plant_crop');await action('care:moss:tend',target,'tend_crop');}
     else await skip('care:moss:plant','No caretaker seeds available');
    }
    if(target==='nim'&&day%4===0){await go('care:nim:pond',target,'pond');await action('care:nim:explore',target,'explore');}
   }
  }
  async function narrate(label:string,scenario:'seed'|'malformed'|'outage'|'social'){
   const contexts:unknown[]=[];
   const proposal=scenario==='seed'?seedStory:scenario==='social'?socialStory:{schema_version:1,effects:[{type:'execute_sql',sql:'not executable'}]};
   const provider:LlmProvider={model:'scripted-mock-v1',reservation:()=>512,generate:async context=>{contexts.push(context);if(scenario==='outage')throw new ProviderError('NETWORK_OR_TIMEOUT',true);return {proposal,tokens:96};}};
   const result=await step('narrator',label,{mode:'mocked',scenario,proposal:scenario==='outage'?null:proposal},async()=>({result:await runNarrator(repo,principals.narrator,provider,`exp-d${day}-${label}`,async()=>{}),contexts}));
   const outcome=result.result;
   if(scenario==='seed'||scenario==='social'){
    if(outcome.status!=='proposed'||!outcome.result||outcome.result.status!=='pending')throw Error('EXPERIMENT_NARRATOR_EXPECTATION');
    const id=outcome.result.id;const reviewed=await step('review',`${label}:approve`,{proposal_id:id,approve:true},()=>repo.review(principals.operator,id,true));if(reviewed.status!=='accepted')throw Error('EXPERIMENT_REVIEW_EXPECTATION');
   }else if(scenario==='outage'){if(outcome.status!=='unavailable')throw Error('EXPERIMENT_OUTAGE_EXPECTATION');}
   else if(outcome.status!=='proposed'||outcome.result?.status!=='rejected')throw Error('EXPERIMENT_REJECTION_EXPECTATION');
  }
  for(day=1;day<=config.days;day++){
   await care();
   if(config.narrator==='mocked'){
    if(day===3){await prepare('seed:pip','pip');await prepare('seed:moss','moss');await go('seed:pip:garden','pip','garden');await go('seed:moss:garden','moss','garden');await narrate('seed','seed');}
    if(day===4){await prepare('quest:pip','pip');await go('quest:investigate:garden','pip','garden');await action('quest:investigate','pip','investigate_discovery',{discovery_id:'glowing_seed'});await go('quest:pond','pip','pond');}
    if(day===5){await prepare('quest:pip','pip');await go('quest:plant:garden','pip','garden');await action('quest:plant','pip','plant_crop');const tend=await action('quest:tend','pip','tend_crop');await step('action','quest:tend-retry',{command:tend.command,retryProof:true},()=>repo.act(principals.caretaker,tend.command));}
    if(day===9)await narrate('malformed','malformed');
    if(day===15)await narrate('outage','outage');
    if(day===21){await prepare('social:pip','pip');await prepare('social:moss','moss');await go('social:pip:square','pip','square');await go('social:moss:square','moss','square');await narrate('social','social');}
    if(day===24)await step('proposal','duplicate-seed',{request_id:'exp-duplicate-seed',proposal:seedStory},()=>repo.submit(principals.narrator,'exp-duplicate-seed',seedStory));
    if(day===27){const proposal={...seedStory,effects:[{type:'give_item',target_id:'pip',item_id:'unregistered_artifact',quantity:1}]};await step('proposal','unknown-item',{request_id:'exp-unknown-item',proposal},()=>repo.submit(principals.narrator,'exp-unknown-item',proposal));}
   }else if(day===1)await step('narrator','disabled',{mode:'disabled'},()=>runNarrator(repo,principals.narrator,null,'exp-disabled'));
   const requestId=`exp:tick:day-${day}`;
   await step('tick','advance',{request_id:requestId,logicalRealTime:day*86400000/3},()=>repo.advanceExperiment(worldId,requestId,day));
   if(day===12)await step('tick','tick-retry',{request_id:requestId,retryProof:true,logicalRealTime:day*86400000/3},()=>repo.advanceExperiment(worldId,requestId,day));
   await repo.checkpoint(worldId,day);await onCheckpoint?.(day);
  }
  const data=await repo.experimentData(worldId),built=buildExperimentReport(data,true);if(!built.report.validation.passed)throw Error('EXPERIMENT_FINAL_INVARIANT');
  await repo.finishExperiment(worldId,built.report,built.report.semanticHash);return {worldId,...built};
 }catch(error){await repo.failExperiment(worldId);throw new ExperimentFailure(worldId);}
 finally{await admin.revokeExperimentKeys(worldId);}
}
