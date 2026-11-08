import { z } from 'zod';
import { clock,type World } from '../engine';
import type { Command } from '../caretaker/commands';
// Registered content selects these data-only conditions; no callbacks/code from AI.
export const objectiveSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('visit_location'),location_id:z.enum(['square','cottage','garden','pond','forest'])}),
 z.strictObject({type:z.literal('find_item'),item_id:z.enum(['berries','seeds','glowing_seed','seed_charm']),quantity:z.number().int().min(1).max(2)}),
 z.strictObject({type:z.literal('interact_creature'),creature_id:z.enum(['pip','moss','nim'])}),
 z.strictObject({type:z.literal('complete_activity'),action:z.enum(['plant_crop','tend_crop','explore','encourage_play','encourage_rest']),location_id:z.enum(['square','cottage','garden','pond','forest'])}),
 z.strictObject({type:z.literal('wait_world_condition'),condition:z.enum(['night','rain','virtual_time']),not_before:z.number().finite().nonnegative()}),
 z.strictObject({type:z.literal('investigate_discovery'),discovery_id:z.literal('glowing_seed')}),
]);
export type Objective=z.infer<typeof objectiveSchema>;
export function matchesObjective(raw:Objective,owner:string,world:World,command:Command|null):boolean{
 const objective=objectiveSchema.parse(raw);const c=world.creatures.find(c=>c.id===owner);if(!c)return false;
 if(objective.type==='find_item')return (c.inventory[objective.item_id]??0)>=objective.quantity;
 if(objective.type==='wait_world_condition')return world.virtualTime>=objective.not_before&&(objective.condition==='virtual_time'||(objective.condition==='night'?clock(world.virtualTime).night:world.weather==='rain'));
 if(!command||command.target_id!==owner)return false;
 switch(objective.type){
  case 'visit_location':return command.action==='visit_location'&&command.parameters.location_id===objective.location_id&&c.location===objective.location_id;
  case 'interact_creature':return command.action==='interact_creature'&&command.target_id===objective.creature_id;
  case 'complete_activity':return command.action===objective.action&&c.location===objective.location_id;
  case 'investigate_discovery':return command.action==='investigate_discovery'&&command.parameters.discovery_id===objective.discovery_id;
 }
}
