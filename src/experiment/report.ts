import { createHash } from 'node:crypto';
import { canonical } from '../repositories/narrator';
import { clock,validateWorld,type Creature } from '../engine';
import type { ExperimentData } from './contracts';
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const round=(n:number)=>Math.round(n*10000)/10000;
const money=(n:number)=>Math.round(n*100000000)/100000000;
const count=(values:string[])=>values.reduce<Record<string,number>>((out,key)=>{out[key]=(out[key]??0)+1;return out;},{});
export function fingerprint(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
export function escapeMarkdown(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_[\]{}()#!|])/g,'\\$1');}
export function buildExperimentReport(data:ExperimentData,allowPendingCompletion=false){
 validateWorld(data.final.world);
 const identities=new Map([[data.worldId,'<experiment-world>'],...data.proposals.map(p=>[p.id,`proposal:${p.actor_id}:${p.request_id}`] as [string,string])]);
 const normalize=(v:unknown):unknown=>typeof v==='string'?(identities.get(v)??v):Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
 const operations=new Map<string,{sequence:number;day:number}>();
 for(const step of data.inputs){
  const input=object(step.input),outcome=object(step.outcome);if(outcome.duplicate===true)continue;
  const command=object(input.command),key=step.kind==='tick'?input.request_id:command.idempotency_key;
  if(typeof key==='string'&&!operations.has(key))operations.set(key,{sequence:step.sequence,day:step.day});
  if(step.kind==='review'&&typeof input.proposal_id==='string'&&outcome.status==='accepted')operations.set(input.proposal_id,{sequence:step.sequence,day:step.day});
 }
 const ordered=data.journal.map(e=>{
  const operation=operations.get(e.correlationId);if(!operation)throw Error('EXPERIMENT_UNTRACED_EVENT');
  return {...e,operationSequence:operation.sequence,experimentDay:operation.day};
 }).sort((a,b)=>a.operationSequence-b.operationSequence||a.virtualTime-b.virtualTime||['pip','moss','nim'].indexOf(a.actor)-['pip','moss','nim'].indexOf(b.actor));
 const semanticEvents=ordered.map(({id:_,world_id:__,realTime, ...e})=>normalize(e.source==='simulation'?{...e,realTime}:e));
 const semantic={config:data.config,initial:normalize(data.initial),final:normalize(data.final),days:normalize(data.days),inputs:normalize(data.inputs),events:semanticEvents,proposals:normalize(data.proposals.map(({id:_,...p})=>p)),usage:data.usage};
 const semanticHash=fingerprint(semantic);
 const creatureMetrics=data.final.world.creatures.map(c=>{
  const initial=data.initial.world.creatures.find(x=>x.id===c.id)!;const events=ordered.filter(e=>e.actor===c.id),sim=events.filter(e=>e.source==='simulation');
  const activity=count(sim.map(e=>String(e.payload.activity)));
  const ranges=Object.fromEntries(Object.keys(c.needs).map(key=>{
   const need=key as keyof Creature['needs'];const values=[initial.needs[need],c.needs[need]];
   for(const e of events){for(const state of [e.effects.needsBefore,e.effects.needsAfter,object(e.effects.before).needs,object(e.effects.after).needs]){const value=object(state)[need];if(typeof value==='number')values.push(value);}}
   return [key,{min:round(Math.min(...values)),max:round(Math.max(...values))}];
  }));
  const memories=new Set(data.days.flatMap(d=>d.snapshot.world.creatures.find(x=>x.id===c.id)?.memories??[]));
  for(const e of events){for(const state of [e.effects.before,e.effects.after]){const value=object(state).memories;if(Array.isArray(value))value.forEach(m=>{if(typeof m==='string')memories.add(m);});}}
  const night=sim.filter(e=>clock(e.virtualTime).night),day=sim.filter(e=>!clock(e.virtualTime).night);
  return {id:c.id,name:c.name,activities:activity,recordedNeedsRange:ranges,finalNeeds:c.needs,
   personality:Object.fromEntries(Object.keys(c.traits).map(key=>{const k=key as keyof Creature['traits'];return [k,{before:round(initial.traits[k]),after:round(c.traits[k]),delta:round(c.traits[k]-initial.traits[k])}];})),
   relationships:{before:initial.relationships,after:c.relationships,changes:Object.fromEntries(Object.keys(c.relationships).map(id=>[id,round(c.relationships[id]!-(initial.relationships[id]??0))]))},
   memories:{retained:c.memories,observedCount:memories.size,observed:[...memories]},inventory:c.inventory,
   exploration:{nightSteps:night.length,daySteps:day.length,nightExplorations:night.filter(e=>e.payload.activity==='explore').length,dayExplorations:day.filter(e=>e.payload.activity==='explore').length}};
 });
 const daily=data.days.map(({day,snapshot})=>{
  const events=ordered.filter(e=>e.experimentDay===day);return {day,virtualTime:snapshot.world.virtualTime,tick:snapshot.world.tick,weatherAtCheckpoint:snapshot.world.weather,
   events:count(events.map(e=>e.source)),activities:count(events.filter(e=>e.source==='simulation').map(e=>String(e.payload.activity))),
   quest:snapshot.quest,caretakerInventory:snapshot.caretaker.inventory,
   mockProviderAttempts:data.usage.filter(u=>u.workflow_id.startsWith(`exp-d${day}-`)).length,
   highlights:events.flatMap(e=>{if(e.source==='narrator')return [String(e.payload.title)];const q=object(object(e.effects.questChange).after);const clues=q.clues;if(Array.isArray(clues)&&clues.length)return [`Quest clue ${q.stage}: ${String(clues.at(-1))}`];return [];})};
 });
 const sourceCounts=count(ordered.map(e=>e.source));const actions=data.inputs.filter(i=>i.kind==='action'&&object(i.input).command);
 const rejections=data.proposals.filter(p=>p.status==='rejected');const knownTokens=data.usage.reduce((sum,u)=>sum+(u.actual_tokens??0),0),reservedTokens=data.usage.reduce((sum,u)=>sum+u.reserved_tokens,0);
 const complete=data.completedDays===data.config.days&&data.failureCode===null&&(data.status==='completed'||(allowPendingCompletion&&data.status==='running'));
 const checks={horizonComplete:complete,checkpointsOrdered:data.days.length===data.config.days&&data.days.every((d,i)=>d.day===i+1&&d.snapshot.world.tick===d.day*96&&d.snapshot.world.virtualTime===d.day*86400000),
  expectedTicks:data.config.days*96,actualTicks:data.final.world.tick,expectedSimulationEvents:data.config.days*96*3,actualSimulationEvents:sourceCounts.simulation??0,
  finalMatchesCheckpoint:canonical(data.final)===canonical(data.days.at(-1)?.snapshot),clockSettingsUnchanged:data.final.world.multiplier===3&&data.final.world.intervalMs===300000&&data.days.every(d=>d.snapshot.world.multiplier===3&&d.snapshot.world.intervalMs===300000),caretakerEventsMatchActions:(sourceCounts.caretaker??0)===actions.filter(i=>object(i.outcome).duplicate!==true&&i.status==='completed').length,narratorEventsMatchAcceptedProposals:(sourceCounts.narrator??0)===data.proposals.filter(p=>p.status==='accepted').length,uniqueEventIds:new Set(data.journal.map(e=>e.id)).size===data.journal.length,allInputsCompleted:data.inputs.every(i=>i.status==='completed'),
  questCompletedWhenRequired:data.config.narrator!=='mocked'||data.config.days<5||data.final.quest?.status==='completed',oneQuestReward:data.config.narrator!=='mocked'||data.config.days<5||data.final.world.creatures.find(c=>c.id==='pip')?.inventory.seed_charm===1};
 const passed=checks.horizonComplete&&checks.checkpointsOrdered&&checks.expectedTicks===checks.actualTicks&&checks.expectedSimulationEvents===checks.actualSimulationEvents&&checks.finalMatchesCheckpoint&&checks.clockSettingsUnchanged&&checks.caretakerEventsMatchActions&&checks.narratorEventsMatchAcceptedProposals&&checks.uniqueEventIds&&checks.allInputsCompleted&&checks.questCompletedWhenRequired&&checks.oneQuestReward;
 const observations=creatureMetrics.flatMap(c=>{
  const top=Object.entries(c.activities).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  const lines=[`${c.name}'s most frequent autonomous activity was ${top?.[0]??'none'} (${top?.[1]??0} steps).`];
  const patience=c.personality.patience;if(patience&&patience.delta>0)lines.push(`${c.name}'s patience grew by ${patience.delta} through recorded gardening practice.`);
  if(c.id==='nim')lines.push(`Nim explored on ${round(c.exploration.nightExplorations/Math.max(1,c.exploration.nightSteps)*100)}% of night steps and ${round(c.exploration.dayExplorations/Math.max(1,c.exploration.daySteps)*100)}% of day steps.`);
  return lines;
 });
 const report={schemaVersion:1,status:passed?'complete':'incomplete',sourceHash:data.sourceHash,config:data.config,semanticHash,
  mode:'Local persistent test world; deterministic caretaker; scripted mock narrator or disabled; no live LLM',
  validation:{passed,...checks},villageDaysElapsed:data.final.world.virtualTime/86400000,
  eventFrequency:{total:ordered.length,bySource:sourceCounts,byType:count(ordered.map(e=>e.type)),narratorEventsPerVillageDay:round((sourceCounts.narrator??0)/data.config.days)},
  caretaker:{acceptedActions:actions.filter(i=>object(i.outcome).duplicate!==true&&i.status==='completed').length,replayedActions:actions.filter(i=>object(i.outcome).duplicate===true).length,policySkips:count(data.inputs.filter(i=>object(i.outcome).skipped===true).map(i=>String(object(i.outcome).reason))),finalResources:data.final.caretaker},
  replayedTicks:data.inputs.filter(i=>i.kind==='tick'&&object(i.outcome).duplicate===true).length,
  creatures:creatureMetrics,quest:data.final.quest,questCompletedDay:daily.find(d=>d.quest?.status==='completed')?.day??null,
  proposals:{accepted:data.proposals.filter(p=>p.status==='accepted').length,rejected:rejections.length,rejectionCodes:count(rejections.map(p=>p.code??'UNKNOWN')),records:normalize(data.proposals.map(({id:_,...p})=>p))},
  failures:{simulation:Math.max(data.inputs.filter(i=>i.status==='failed').length,data.failureCode?1:0),mockProviderErrors:data.usage.filter(u=>u.status==='error').length,incompleteInputs:data.inputs.filter(i=>i.status==='pending').length,fatalCode:data.failureCode},
  ai:{liveRequests:0,liveModelTokens:0,mockAttempts:data.usage.length,mockReportedTokens:knownTokens,mockReservedUnits:reservedTokens,unknownMockUsageAttempts:data.usage.filter(u=>u.actual_tokens===null).length,usage:data.usage},
  costs:{liveApiSpendUsd:0,hostingCostUsd:null,uniformMockUsdPerMillionTokens:data.config.usdPerMillionMockTokens,hypotheticalKnownMockCostUsd:data.config.usdPerMillionMockTokens===null?null:money(knownTokens*data.config.usdPerMillionMockTokens/1000000),hypotheticalReservedMockCostUsd:data.config.usdPerMillionMockTokens===null?null:money(reservedTokens*data.config.usdPerMillionMockTokens/1000000)},
  observations,daily,
  limitations:['Caretaker policy and two accepted story beats are scripted interventions, not emergent AI creativity.','The harness uses authenticated repository commands, not HTTP transport or its wall-clock rate limits.','Autonomous cottage food is unlimited; caretaker inventory is finite.','Need/relationship saturation and only gardening-driven patience development are current engine limitations.','Daily states and full event/input ledgers are retained; only the compact sample is committed.','Mock token units are not live Groq usage or a vendor bill. Hosting is unmetered.','Days cover each ordered care/story cycle followed by 96 fixed ticks, ending at the next midnight.','Interrupted/failed runs are preserved as incomplete; repeat in a new isolated world rather than resuming uncertain AI attempts.']};
 const chronicle=[`# The First ${data.config.days} Days — village chronicle`,'',`Local experiment: ${data.config.days} elapsed village days. Seed ${data.config.seed}. Narrator: ${data.config.narrator}.`,
  '',`Status: **${passed?'complete':'incomplete'}**. The caretaker is a deterministic rule-based test agent. Story events are scripted mock proposals; prose below is derived from recorded journal entries.`,
  '',...daily.flatMap(d=>[`## Day ${d.day}`,'',`${d.events.simulation??0} autonomous activity entries and ${d.events.caretaker??0} caretaker actions were recorded. The day ended with ${escapeMarkdown(d.weatherAtCheckpoint)} weather.`,
   '',...(d.highlights.length?d.highlights.map(h=>`- ${escapeMarkdown(h)}`):['Everyday village life filled this page.']),
   ...(d.mockProviderAttempts?[`\nOperator note: ${d.mockProviderAttempts} local mock-provider attempt(s); ordinary simulation continued independently.`]:[]),'']),
  '## What the village showed','',...observations.map(o=>`- ${escapeMarkdown(o)}`),'',`Final quest: ${data.final.quest?escapeMarkdown(data.final.quest.status):'none'}. Rejected proposals: ${rejections.length}. Live AI calls: 0.`,
  '',`Semantic fingerprint: \`${semanticHash}\`.`,''
 ].join('\n');
 const markdown=[`# The First ${data.config.days} Days — experiment report`,'',`Status: **${report.status}** · seed **${data.config.seed}** · ${report.villageDaysElapsed} village days · ${report.validation.actualTicks} ticks.`,
  '',`Semantic fingerprint: \`${semanticHash}\`. Source fingerprint: \`${data.sourceHash}\`.`,
  '',`Journal entries: ${report.eventFrequency.total}. Accepted caretaker actions: ${report.caretaker.acceptedActions}. Narrator events: ${sourceCounts.narrator??0}. Rejected proposals: ${rejections.length}. Simulation failures: ${report.failures.simulation}.`,
  '',`Mock attempts: ${data.usage.length}; reported mock units: ${knownTokens}; reserved units: ${reservedTokens}; unknown usage attempts: ${report.ai.unknownMockUsageAttempts}. **Live requests/tokens/spend: 0.** Hosting costs are unmetered.`,
  '',data.config.usdPerMillionMockTokens===null?'No pricing was supplied; no hypothetical token-cost estimate is claimed.':`Supplied uniform mock rate: $${data.config.usdPerMillionMockTokens}/million units. Hypothetical known/reserved amounts: $${report.costs.hypotheticalKnownMockCostUsd} / $${report.costs.hypotheticalReservedMockCostUsd}; these are not vendor charges.`,
  '',...creatureMetrics.flatMap(c=>[`## ${c.name}`,'',`Autonomous activity counts: ${Object.entries(c.activities).map(([a,n])=>`${a} ${n}`).join(', ')}.`,
   '',`Final needs: ${Object.entries(c.finalNeeds).map(([a,n])=>`${a} ${round(n)}`).join(', ')}. Patience: ${c.personality.patience?.before} → ${c.personality.patience?.after}. Retained/observed memories: ${c.memories.retained.length}/${c.memories.observedCount}.`,
   '',`Relationships: ${Object.entries(c.relationships.after).map(([a,n])=>`${escapeMarkdown(a)} ${round(n)}`).join(', ')||'none'}.`,'']),
  '## Quest and rejection checks','',`Quest: ${data.final.quest?.status??'none'}; completion day: ${report.questCompletedDay??'not completed'}. Rejections: ${Object.entries(report.proposals.rejectionCodes).map(([a,n])=>`${a} ${n}`).join(', ')||'none'}.`,
  '', '## Observed behavior','',...observations.map(o=>`- ${escapeMarkdown(o)}`),'','## Scope and limits','',...report.limitations.map(l=>`- ${l}`),'', 'See report.json for all metrics, daily records and recorded memories; chronicle.md follows the journal. Full raw ledgers are in the local artifact directory.',''].join('\n');
 return {report,semantic,chronicle,markdown};
}
export type ExperimentReport=ReturnType<typeof buildExperimentReport>['report'];
