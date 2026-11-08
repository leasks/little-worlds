import { describe,it,expect } from 'vitest';
import { seedWorld } from '../src/engine';
import { applyProposal,defaultSettings,DAY,progressQuest,type NarrativeState } from '../src/narrative/engine';
import { matchesObjective } from '../src/narrative/objectives';
import { GroqProvider,ProviderError } from '../src/ai/provider';
const state:NarrativeState={quest:null,lastEvent:null,eventsToday:0,thread:null};
import { seedProposal } from './fixtures/narrative';
function world(){const w=seedWorld();w.virtualTime=DAY;w.creatures.forEach(c=>c.location='garden');return w;}
describe('bounded narrative engine',()=>{
 it('starts the registered seed quest without mutating input',()=>{const w=world();const result=applyProposal(w,state,seedProposal,defaultSettings);expect(result.quest?.stage).toBe(0);expect(result.world.creatures[0]!.inventory.glowing_seed).toBe(1);expect(w.creatures[0]!.inventory.glowing_seed).toBeUndefined();});
 it('rejects invalid effects/references/participants and leaves state unchanged',()=>{
  const w=world(),before=structuredClone(w);
  for(const change of [{effects:[{type:'sql',sql:'select 1'}]},{participants:['nim']},{effects:[{type:'give_item',target_id:'pip',item_id:'unregistered',quantity:1}]},{effects:[...seedProposal.effects,seedProposal.effects[0]]},{effects:[{type:'adjust_relationship',source_id:'pip',target_id:'moss',delta:99}]}])expect(()=>applyProposal(w,state,{...seedProposal,...change},defaultSettings)).toThrow();
  expect(w).toEqual(before);
 });
 it('enforces pacing, prerequisites, consistency and bounds atomically',()=>{
  const w=world();expect(()=>applyProposal(w,{...state,eventsToday:1},seedProposal,defaultSettings)).toThrow('limit');
  expect(()=>applyProposal(w,{...state,lastEvent:DAY-1},seedProposal,defaultSettings)).toThrow('cooldown');
  expect(()=>applyProposal(w,{...state,lastRareEvent:DAY-1},seedProposal,defaultSettings)).toThrow('Rare');
  w.virtualTime=0;expect(()=>applyProposal(w,state,seedProposal,defaultSettings)).toThrow('prerequisites');
  w.virtualTime=DAY;expect(()=>applyProposal(w,state,{...seedProposal,effects:[seedProposal.effects[0]]},defaultSettings)).toThrow('both');
  w.creatures[0]!.relationships.moss=100;expect(()=>applyProposal(w,state,seedProposal,defaultSettings)).toThrow('bounds');
 });
 it('evaluates item, interaction and world-condition building blocks without executable rules',()=>{
  const w=world();w.creatures[0]!.inventory.glowing_seed=1;
  expect(matchesObjective({type:'find_item',item_id:'glowing_seed',quantity:1},'pip',w,null)).toBe(true);
  expect(matchesObjective({type:'wait_world_condition',condition:'night',not_before:DAY},'pip',w,null)).toBe(true);
  expect(matchesObjective({type:'wait_world_condition',condition:'rain',not_before:DAY},'pip',w,null)).toBe(false);
  expect(matchesObjective({type:'interact_creature',creature_id:'pip'},'pip',w,{actor_id:'local-caretaker',target_id:'pip',idempotency_key:'x',action:'interact_creature',parameters:{}})).toBe(true);
 });
 it('advances only the ordered predefined objectives for the seed owner',()=>{
  const w=world();let q=applyProposal(w,state,seedProposal,defaultSettings).quest;w.creatures[0]!.inventory.glowing_seed=1;
  const base={actor_id:'local-caretaker',target_id:'pip' as const,idempotency_key:'q'};
  q=progressQuest(q,{...base,action:'tend_crop',parameters:{}},w);expect(q?.stage).toBe(0);
  q=progressQuest(q,{...base,action:'investigate_discovery',parameters:{discovery_id:'glowing_seed'}},w);expect(q?.stage).toBe(1);
  w.creatures[0]!.location='pond';q=progressQuest(q,{...base,action:'visit_location',parameters:{location_id:'pond'}},w);expect(q?.stage).toBe(2);
  w.creatures[0]!.location='garden';q=progressQuest(q,{...base,action:'plant_crop',parameters:{}},w);q=progressQuest(q,{...base,action:'tend_crop',parameters:{}},w);expect(q?.status).toBe('completed');expect(q?.clues).toHaveLength(4);
 });
});
describe('Groq adapter without external requests',()=>{
 it('validates JSON and usage; fixes destination, timeout and model per configuration',async()=>{
  let sent:RequestInit|undefined;
  const provider=new GroqProvider('operator-selected-model','test-only-secret',async(url,init)=>{expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');sent=init;return Response.json({choices:[{message:{content:JSON.stringify(seedProposal)}}],usage:{total_tokens:200}});});
  const r=await provider.generate({pacing:defaultSettings});expect(r.proposal).toEqual(seedProposal);expect(r.tokens).toBe(200);expect(sent?.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(sent?.body as string).model).toBe('operator-selected-model');expect(provider.reservation({})).toBeGreaterThan(768);
 });
 it('handles malformed output and rate limits without exposing service response text',async()=>{
  const malformed=new GroqProvider('model','secret',async()=>Response.json({choices:[{message:{content:'not json'}}],usage:{total_tokens:10}}));await expect(malformed.generate({})).rejects.toMatchObject({code:'MALFORMED_JSON'});
  const limited=new GroqProvider('model','secret',async()=>new Response('sensitive upstream body',{status:429,headers:{'Retry-After':'7'}}));await expect(limited.generate({})).rejects.toMatchObject({code:'RATE_LIMITED',retryAfterMs:7000,retryable:true});
 });
 it('times out a stalled transport and rejects oversized responses',async()=>{
  const stalled=new GroqProvider('model','secret',async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('timeout')))),20);
  await expect(stalled.generate({})).rejects.toMatchObject({code:'NETWORK_OR_TIMEOUT'});
  const big=new GroqProvider('model','secret',async()=>new Response('x'.repeat(33000)));await expect(big.generate({})).rejects.toBeInstanceOf(ProviderError);
 });
});
