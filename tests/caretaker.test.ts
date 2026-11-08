import { describe,it,expect } from 'vitest';
import { seedWorld } from '../src/engine';
import { actorStateSchema,applyCommand,commandSchema,type Command } from '../src/caretaker/commands';
import { caretakerApi } from '../src/server/caretaker-api';
const actor=actorStateSchema.parse({location:'cottage',inventory:{berries:12,seeds:3},crops:0});
const command:Command={action:'feed_creature',actor_id:'local-caretaker',target_id:'pip',parameters:{food_id:'berries',quantity:1},idempotency_key:'feed'};
describe('caretaker rules',()=>{
 it('feeds with bounded needs and a real inventory cost without mutating input',()=>{const w=seedWorld();w.creatures[0]!.needs.hunger=50;const result=applyCommand(w,actor,command,'local-caretaker');expect(result.creature.needs.hunger).toBe(30);expect(result.actor.inventory.berries).toBe(11);expect(w.creatures[0]!.needs.hunger).toBe(50);expect(actor.inventory.berries).toBe(12);});
 it('rejects spoofed ownership, missing resources and remote feeding',()=>{
  expect(()=>applyCommand(seedWorld(),actor,{...command,actor_id:'imposter'},'local-caretaker')).toThrow('Actor');
  const w=seedWorld();w.creatures[0]!.owner='someone-else';expect(()=>applyCommand(w,actor,command,'local-caretaker')).toThrow('owned');
  expect(()=>applyCommand(seedWorld(),{...actor,inventory:{berries:0,seeds:0}},command,'local-caretaker')).toThrow('berries');
  expect(()=>applyCommand(seedWorld(),{...actor,location:'forest'},command,'local-caretaker')).toThrow('Visit');
 });
 it('validates strict commands and refuses invented discoveries',()=>{
  expect(commandSchema.safeParse({...command,sql:'DROP TABLE'}).success).toBe(false);
  expect(commandSchema.safeParse({...command,parameters:{food_id:'berries',quantity:-1}}).success).toBe(false);
  expect(()=>applyCommand(seedWorld(),actor,{...command,action:'investigate_discovery',parameters:{discovery_id:'imaginary'}},'local-caretaker')).toThrow('registered');
 });
 it('runs garden and travel activities with resources and preconditions',()=>{
  let w=seedWorld();let a=structuredClone(actor);
  const act=(action:Command['action'],parameters:unknown={})=>{const result=applyCommand(w,a,commandSchema.parse({...command,action,parameters}),'local-caretaker');w=result.world;a=result.actor;return result;};
  act('visit_location',{location_id:'garden'});act('plant_crop');expect(a.inventory.seeds).toBe(2);expect(a.crops).toBe(1);
  act('tend_crop');expect(a.inventory.berries).toBe(14);expect(a.crops).toBe(0);
  expect(()=>act('tend_crop')).toThrow();act('visit_location',{location_id:'forest'});act('explore');act('interact_creature');expect(w.creatures[0]!.memories).toHaveLength(1);
  act('visit_location',{location_id:'square'});act('encourage_play');act('visit_location',{location_id:'cottage'});act('encourage_rest');
 });
 it('fails closed before touching unconfigured services',async()=>{
  const response=await caretakerApi(new Request('http://test'),'00000000-0000-4000-8000-000000000001','world',()=>{throw Error('must not execute');});expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');
 });
});
