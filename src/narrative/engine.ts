import { matchesObjective,type Objective } from './objectives';
import { z } from 'zod';
import { validateWorld, type World } from '../engine';
import type { Command } from '../caretaker/commands';
export const DAY=86400000;
export const questId='mystery_of_the_seed' as const;
export const itemIds=['berries','seeds','glowing_seed','seed_charm'] as const;
export const creatureId=z.enum(['pip','moss','nim']);
export const placeId=z.enum(['square','cottage','garden','pond','forest']);
export const stages=[
 {objective:{type:'investigate_discovery',discovery_id:'glowing_seed'},clue:'The seed gives a gentle pulse when examined.'},
 {objective:{type:'visit_location',location_id:'pond'},clue:'Its glow reflects softly in the pond.'},
 {objective:{type:'complete_activity',action:'plant_crop',location_id:'garden'},clue:'A sheltered patch of garden feels right.'},
 {objective:{type:'complete_activity',action:'tend_crop',location_id:'garden'},clue:'A small luminous flower leaves a seed-shaped charm.'},
] as const;
const effects=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('give_item'),target_id:creatureId,item_id:z.enum(itemIds),quantity:z.number().int().min(1).max(2)}),
 z.strictObject({type:z.literal('adjust_relationship'),source_id:creatureId,target_id:creatureId,delta:z.number().int().min(-3).max(3)}),
 z.strictObject({type:z.literal('unlock_quest'),quest_id:z.literal(questId)}),
 z.strictObject({type:z.literal('adjust_mood'),target_id:creatureId,delta:z.number().int().min(-5).max(5)}),
 z.strictObject({type:z.literal('set_weather'),weather:z.enum(['clear','rain','cloudy'])}),
]);
export const proposalSchema=z.strictObject({schema_version:z.literal(1),event_type:z.enum(['discovery','social_interaction','environmental_occurrence','relationship_development','item_discovery','quest_introduction','quest_progression','minor_world_change']),title:z.string().min(1).max(100),description:z.string().min(1).max(600),location_id:placeId,participants:z.array(creatureId).min(1).max(3),effects:z.array(effects).min(1).max(4)});
export type Proposal=z.infer<typeof proposalSchema>;
export const questSchema=z.object({id:z.literal(questId),owner:creatureId,stage:z.number().int().min(0).max(4),status:z.enum(['active','completed']),clues:z.array(z.string()).max(4)});
export type Quest=z.infer<typeof questSchema>;
export const settingsSchema=z.object({manualApproval:z.boolean(),minGap:z.number().int().min(0).max(30*DAY),earliestDiscovery:z.number().int().min(0).max(30*DAY),rareMinGap:z.number().int().min(0).max(30*DAY).default(3*DAY),maxPerDay:z.number().int().min(0).max(5),dailyRequests:z.number().int().min(0).max(100),dailyTokens:z.number().int().min(0).max(1000000)});
export type NarrativeSettings=z.infer<typeof settingsSchema>;
export const defaultSettings:NarrativeSettings={manualApproval:true,minGap:DAY,rareMinGap:3*DAY,earliestDiscovery:DAY,maxPerDay:1,dailyRequests:2,dailyTokens:12000};
export interface NarrativeState {quest:Quest|null;lastEvent:number|null;eventsToday:number;lastRareEvent?:number|null;thread:'unresolved'|'resolved'|null;}
export class NarrativeError extends Error {constructor(public code:string,message:string){super(message);}}
const ensure=(condition:boolean,code:string,message:string)=>{if(!condition)throw new NarrativeError(code,message);};
export function applyProposal(input:World,state:NarrativeState,raw:unknown,settings:NarrativeSettings){
 const parsed=proposalSchema.safeParse(raw);if(!parsed.success)throw new NarrativeError('INVALID_PROPOSAL','Proposal does not match schema');
 const p=parsed.data;const world=structuredClone(input);settingsSchema.parse(settings);
 ensure(state.eventsToday<settings.maxPerDay,'PACING_LIMIT','Daily narrative limit reached');
 ensure(state.lastEvent===null||world.virtualTime-state.lastEvent>=settings.minGap,'PACING_LIMIT','Narrative cooldown is active');
 if(['discovery','quest_introduction','item_discovery'].includes(p.event_type))ensure(state.lastRareEvent==null||world.virtualTime-state.lastRareEvent>=settings.rareMinGap,'RARITY_LIMIT','Rare event cooldown is active');
 ensure(new Set(p.participants).size===p.participants.length,'INVALID_PARTICIPANTS','Participants must be unique');
 const participant=(id:string)=>{const c=world.creatures.find(c=>c.id===id);ensure(!!c&&p.participants.includes(c.id as z.infer<typeof creatureId>)&&c.location===p.location_id,'INVALID_PARTICIPANTS','Referenced creatures must participate at the event location');return c!;};
 p.participants.forEach(participant);
 const keys=new Set<string>();let started=false;let seedOwner:string|null=null;
 for(const effect of p.effects){
  const key=effect.type==='adjust_relationship'?`${effect.type}:${[effect.source_id,effect.target_id].sort().join(':')}`:effect.type==='give_item'?`${effect.type}:${effect.target_id}:${effect.item_id}`:effect.type==='adjust_mood'?`${effect.type}:${effect.target_id}`:effect.type;
  ensure(!keys.has(key),'DUPLICATE_EFFECT','Repeated effects are not allowed');keys.add(key);
  if(effect.type==='give_item'){
   const c=participant(effect.target_id);
   ensure(effect.item_id!=='seed_charm','QUEST_REWARD_ONLY','Quest rewards cannot be granted by narrator');
   if(effect.item_id==='glowing_seed'){
    ensure(!state.quest&&state.thread===null&&!seedOwner&&effect.quantity===1&&['discovery','quest_introduction'].includes(p.event_type)&&p.location_id==='garden'&&world.virtualTime>=settings.earliestDiscovery,'QUEST_CONFLICT','Seed discovery prerequisites are not met');seedOwner=c.id;
   }else ensure(p.event_type==='item_discovery','CATEGORY_MISMATCH','Items require an item discovery');
   ensure((c.inventory[effect.item_id]??0)+effect.quantity<=100,'EFFECT_BOUNDS','Inventory limit reached');c.inventory[effect.item_id]=(c.inventory[effect.item_id]??0)+effect.quantity;
  }else if(effect.type==='adjust_relationship'){
   ensure(effect.source_id!==effect.target_id,'INVALID_RELATIONSHIP','Cannot relate a creature to itself');
   ensure(['discovery','social_interaction','relationship_development'].includes(p.event_type),'CATEGORY_MISMATCH','Relationship effect category mismatch');
   const a=participant(effect.source_id),b=participant(effect.target_id);const value=(a.relationships[b.id]??0)+effect.delta;
   ensure(value>=0&&value<=100,'EFFECT_BOUNDS','Relationship effect exceeds bounds');a.relationships[b.id]=value;
  }else if(effect.type==='adjust_mood'){
   const c=participant(effect.target_id);const value=c.needs.happiness+effect.delta;ensure(value>=0&&value<=100,'EFFECT_BOUNDS','Mood exceeds bounds');c.needs.happiness=value;
  }else if(effect.type==='set_weather'){
   ensure(['environmental_occurrence','minor_world_change'].includes(p.event_type),'CATEGORY_MISMATCH','Weather effect category mismatch');world.weather=effect.weather;
  }else{ensure(!state.quest&&!started&&['discovery','quest_introduction'].includes(p.event_type),'QUEST_CONFLICT','Quest already exists or category is inconsistent');started=true;}
 }
 ensure((seedOwner!==null)===started,'QUEST_CONFLICT','Seed discovery must both give one seed and activate its registered quest');
 if(['discovery','quest_introduction'].includes(p.event_type))ensure(started,'QUEST_CONFLICT','Only the registered Glowing Seed discovery is available');
 if(p.event_type==='quest_progression')ensure(state.quest?.status==='active','QUEST_CONFLICT','No active quest to describe');
 const quest:Quest|null=started?{id:questId,owner:creatureId.parse(seedOwner),stage:0,status:'active',clues:[]}:state.quest?structuredClone(state.quest):null;
 for(const id of p.participants){const c=participant(id);c.memories=[...c.memories,`Day ${Math.floor(world.virtualTime/DAY)+1}: ${p.title}`].slice(-20);}
 validateWorld(world);if(quest)questSchema.parse(quest);
 return {world,quest,started,proposal:p};
}
export function progressQuest(input:Quest|null,command:Command,world:World):Quest|null{
 if(!input||input.status==='completed'||input.owner!==command.target_id)return input?structuredClone(input):null;
 const quest=questSchema.parse(structuredClone(input));const c=world.creatures.find(c=>c.id===quest.owner)!;const objective=stages[quest.stage];
 if(!objective||!matchesObjective(objective.objective as Objective,quest.owner,world,command))return quest;
 ensure((c.inventory.glowing_seed??0)===1,'QUEST_CONFLICT','The quest owner must carry the discovered seed');
 quest.clues.push(objective.clue);quest.stage++;if(quest.stage===stages.length)quest.status='completed';return questSchema.parse(quest);
}
