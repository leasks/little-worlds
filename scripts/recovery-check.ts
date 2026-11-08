import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createRuntimePool } from '../src/server/runtime-pool';
import { SchedulerRepository } from '../src/repositories/scheduler';
import { canonical } from '../src/repositories/narrator';
async function main(){
 const source=process.env.DATABASE_URL,target=process.env.RESTORE_DATABASE_URL,id=z.uuid().parse(process.env.RECOVERY_WORLD_ID);
 if(!source||!target)throw Error('RECOVERY_CONFIG_REQUIRED');const a=new URL(source),b=new URL(target);
 const local=(u:URL)=>['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(!local(b)||(local(a)&&a.port===b.port&&a.pathname===b.pathname))throw Error('RECOVERY_ISOLATED_LOCAL_TARGET_REQUIRED');
 const sp=createRuntimePool(source),tp=createRuntimePool(target);
 try{
  const paused=await sp.query('SELECT paused,archived FROM little_worlds.world_settings WHERE world_id=$1',[id]);if(!paused.rows[0]?.paused&&!paused.rows[0]?.archived)throw Error('RECOVERY_SOURCE_MUST_BE_PAUSED');
  const original=new SchedulerRepository(sp),restored=new SchedulerRepository(tp);const before=await restored.read(id);
  if(canonical(await original.read(id))!==canonical(before))throw Error('RECOVERY_STATE_MISMATCH');
  const tables=await sp.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='little_worlds' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='world_id' AND NOT a.attisdropped) ORDER BY c.relname");
  for(const {relname} of tables.rows){
   if(!/^[a-z_]+$/.test(relname))throw Error('RECOVERY_SCHEMA_INVALID');
   const sql=`SELECT to_jsonb(t) AS data FROM little_worlds."${relname}" t WHERE world_id=$1`;
   const left=await sp.query(sql,[id]),right=await tp.query(sql,[id]);
   const digest=(rows:{data:unknown}[])=>createHash('sha256').update(rows.map(r=>canonical(r.data)).sort().join('\n')).digest('hex');
   if(digest(left.rows)!==digest(right.rows))throw Error('RECOVERY_TABLE_MISMATCH');
  }
  const receipt=await tp.query('SELECT request_id FROM little_worlds.simulation_ticks WHERE world_id=$1 ORDER BY tick_to DESC LIMIT 1',[id]);if(!receipt.rowCount)throw Error('RECOVERY_NEEDS_EXISTING_TICK');
  const result=await restored.tick(id,receipt.rows[0].request_id,0);if(!result.duplicate||canonical(await restored.read(id))!==canonical(before))throw Error('RECOVERY_RETRY_CHANGED_STATE');
  console.log(JSON.stringify({ok:true,stateMatches:true,historyMatches:true,worldTablesVerified:tables.rows.length,tickRetryUnchanged:true}));
 }finally{await sp.end();await tp.end();}
}
main().catch(error=>{const code=error instanceof Error&&/^RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_FAILED';console.error(JSON.stringify({ok:false,code}));process.exitCode=1;});
