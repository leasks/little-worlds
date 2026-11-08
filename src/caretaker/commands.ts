import type { Quest } from '../narrative/engine';
import { z } from 'zod';
import { validateWorld, type World } from '../engine';
const base={actor_id:z.string().min(1).max(80),target_id:z.enum(['pip','moss','nim']),idempotency_key:z.string().min(1).max(128)};
const empty=z.strictObject({});
export const commandSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('feed_creature'),parameters:z.strictObject({food_id:z.literal('berries'),quantity:z.number().int().min(1).max(3)})}),
 z.strictObject({...base,action:z.literal('encourage_rest'),parameters:empty}),
 z.strictObject({...base,action:z.literal('encourage_play'),parameters:empty}),
 z.strictObject({...base,action:z.literal('visit_location'),parameters:z.strictObject({location_id:z.enum(['square','cottage','garden','pond','forest'])})}),
 z.strictObject({...base,action:z.literal('plant_crop'),parameters:empty}),
 z.strictObject({...base,action:z.literal('tend_crop'),parameters:empty}),
 z.strictObject({...base,action:z.literal('explore'),parameters:empty}),
 z.strictObject({...base,action:z.literal('interact_creature'),parameters:empty}),
 z.strictObject({...base,action:z.literal('investigate_discovery'),parameters:z.strictObject({discovery_id:z.string().min(1).max(80)})}),
]);
export type Command=z.infer<typeof commandSchema>;
export const actorStateSchema=z.object({location:z.enum(['square','cottage','garden','pond','forest']),inventory:z.object({berries:z.number().int().min(0).max(1000),seeds:z.number().int().min(0).max(1000)}),crops:z.number().int().min(0).max(10)});
export type ActorState=z.infer<typeof actorStateSchema>;
export class ApiError extends Error {constructor(public code:string,public status:number,message:string){super(message);}}
function requireCondition(ok:boolean,message:string){if(!ok)throw new ApiError('PRECONDITION_FAILED',409,message);}
export function applyCommand(input:World,actorInput:ActorState,raw:Command,actorId:string,quest:Quest|null=null){
 const command=commandSchema.parse(raw);const world=structuredClone(input);const actor=actorStateSchema.parse(structuredClone(actorInput));
 if(command.actor_id!==actorId)throw new ApiError('FORBIDDEN',403,'Actor does not match credential');
 const c=world.creatures.find(c=>c.id===command.target_id);
 if(!c||c.owner!==actorId)throw new ApiError('FORBIDDEN',403,'Creature is not owned by this caretaker');
 const before=structuredClone(c);const actorBefore=structuredClone(actor);
 if(command.action==='visit_location'){
  requireCondition(c.needs.energy>=3,'Creature needs rest before travelling');c.needs.energy-=3;c.location=command.parameters.location_id;actor.location=c.location;c.activity='explore';
 }else{
  requireCondition(c.location===actor.location,'Visit the creature location first');
  switch(command.action){
   case 'feed_creature':{
    const q=command.parameters.quantity;requireCondition(c.location==='cottage','Feeding requires the cottage');requireCondition(actor.inventory.berries>=q,'Not enough berries');requireCondition(c.needs.hunger>0,'Creature is already full');actor.inventory.berries-=q;c.needs.hunger=Math.max(0,c.needs.hunger-20*q);c.activity='eat';break;
   }
   case 'encourage_rest':requireCondition(c.location==='cottage'||c.location==='pond','Rest requires cottage or pond');requireCondition(c.needs.energy<100,'Creature is fully rested');c.needs.energy=Math.min(100,c.needs.energy+15);c.activity='rest';break;
   case 'encourage_play':requireCondition(c.location==='square','Play requires the square');requireCondition(c.needs.energy>=8,'Not enough energy');c.needs.energy-=8;c.needs.happiness=Math.min(100,c.needs.happiness+10);c.activity='play';break;
   case 'plant_crop':requireCondition(c.location==='garden','Planting requires the garden');requireCondition(actor.inventory.seeds>0&&actor.crops<10&&c.needs.energy>=5,'Seeds, space and energy are required');actor.inventory.seeds--;actor.crops++;c.needs.energy-=5;c.activity='garden';break;
   case 'tend_crop':requireCondition(c.location==='garden'&&actor.crops>0&&c.needs.energy>=5,'A crop in the garden and energy are required');actor.crops--;actor.inventory.berries=Math.min(1000,actor.inventory.berries+2);c.needs.energy-=5;c.activity='garden';break;
   case 'explore':requireCondition((c.location==='forest'||c.location==='pond')&&c.needs.energy>=10,'Exploration requires pond or forest and energy');c.needs.energy-=10;c.needs.happiness=Math.min(100,c.needs.happiness+5);c.activity='explore';break;
   case 'interact_creature':c.needs.happiness=Math.min(100,c.needs.happiness+3);c.memories=[...c.memories,`Day ${Math.floor(world.virtualTime/86400000)+1}: a kind visit from ${actorId}`].slice(-20);break;
   case 'investigate_discovery':
    if(!quest||quest.status!=='active'||quest.owner!==c.id||quest.stage!==0||command.parameters.discovery_id!=='glowing_seed'||c.inventory.glowing_seed!==1||c.location!=='garden')throw new ApiError('DISCOVERY_UNAVAILABLE',409,'No registered discovery available for this creature');
    c.memories=[...c.memories,'The Glowing Seed pulses gently in the garden.'].slice(-20);break;
  }
 }
 validateWorld(world);actorStateSchema.parse(actor);
 return {world,actor,before,actorBefore,creature:c};
}
