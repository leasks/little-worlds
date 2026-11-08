import type { PoolClient } from 'pg';
import { questId,questSchema,progressQuest,type Quest } from './engine';
import type { Command } from '../caretaker/commands';
import type { World } from '../engine';
export async function loadQuest(db:PoolClient,worldId:string):Promise<Quest|null>{
 const {rows}=await db.query('SELECT * FROM little_worlds.quest_instances WHERE world_id=$1 AND id=$2',[worldId,questId]);const q=rows[0];
 return q?questSchema.parse({id:q.id,owner:q.owner_id,stage:q.stage,status:q.status,clues:q.clues}):null;
}
export async function advanceCaretakerQuest(db:PoolClient,world:World,command:Command){
 const before=await loadQuest(db,world.id);const after=progressQuest(before,command,world);
 if(!after||after.stage===before?.stage)return null;
 await db.query('UPDATE little_worlds.quest_instances SET stage=$3,status=$4,clues=$5,completed_at=$6 WHERE world_id=$1 AND id=$2',[world.id,questId,after.stage,after.status,JSON.stringify(after.clues),after.status==='completed'?world.virtualTime:null]);
 if(after.status==='completed'){
  const c=world.creatures.find(c=>c.id===after.owner)!;c.inventory.glowing_seed=0;c.inventory.seed_charm=(c.inventory.seed_charm??0)+1;
  c.memories=[...c.memories,'The Glowing Seed bloomed into a gentle garden light.'].slice(-20);
  await db.query("UPDATE little_worlds.story_threads SET status='resolved' WHERE world_id=$1 AND quest_id=$2",[world.id,questId]);
 }
 return {before,after};
}
