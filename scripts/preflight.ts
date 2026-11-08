import { z } from 'zod';
import { createRuntimePool } from '../src/server/runtime-pool';
import { cronConfigSchema } from '../src/server/cron-api';
async function main(){
 const url=process.env.DATABASE_URL;if(!url)throw Error('DATABASE_URL_REQUIRED');
 const origin=z.url().parse(process.env.APP_ORIGIN);const local=['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
 if(!local&&(new URL(origin).protocol!=='https:'||process.env.LOCAL_TEST_TOOLS_ENABLED==='true'))throw Error('PRODUCTION_SETTINGS_INVALID');
 const cron=cronConfigSchema.parse({secret:process.env.CRON_SECRET,worldId:process.env.CRON_WORLD_ID,maxSteps:process.env.CRON_MAX_STEPS??96,expectedInterval:process.env.CRON_EXPECTED_INTERVAL_MS??300000});
 const pool=createRuntimePool(url);
 try{
  const migration=await pool.query("SELECT world_id FROM little_worlds.scheduler_runs LIMIT 0");void migration;
  const role=await pool.query("SELECT has_table_privilege(current_user,'little_worlds.event_journal','UPDATE') OR has_table_privilege(current_user,'little_worlds.event_journal','DELETE') OR has_table_privilege(current_user,'little_worlds.event_journal','TRUNCATE') AS mutable");if(role.rows[0].mutable)throw Error('DATABASE_HISTORY_PERMISSION_INVALID');
  const world=await pool.query('SELECT archived,is_test,interval_ms FROM little_worlds.world_settings WHERE world_id=$1',[cron.worldId]);if(!world.rowCount||world.rows[0].archived||world.rows[0].is_test)throw Error('SCHEDULER_WORLD_INVALID');
  if(Math.ceil(cron.expectedInterval/world.rows[0].interval_ms)>=cron.maxSteps)throw Error('SCHEDULER_CATCHUP_CAPACITY_REQUIRED');
  const operator=await pool.query("SELECT c.id FROM little_worlds.agent_credentials c JOIN little_worlds.actors a ON a.world_id=c.world_id AND a.id=c.actor_id WHERE c.world_id=$1 AND c.role='operator' AND a.kind='operator' AND NOT c.revoked AND c.expires_at>now() LIMIT 1",[cron.worldId]);if(!operator.rowCount)throw Error('OPERATOR_CREDENTIAL_REQUIRED');
  const rls=await pool.query("SELECT bool_and(c.relrowsecurity) AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='little_worlds' AND c.relkind='r'");if(rls.rows[0].enabled!==true)throw Error('DATABASE_RLS_REQUIRED');
  const tls=await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
  console.log(JSON.stringify({ok:true,checks:{runtimeRole:true,historyProtected:true,rls:true,operatorCredential:true,schedulerWorld:true,appOrigin:true,databaseTlsObserved:tls.rows[0]?.ssl??null},liveGroqTested:false,deploymentPerformedByCheck:false}));
 }finally{await pool.end();}
}
main().catch(()=>{console.error(JSON.stringify({ok:false,code:'PREFLIGHT_FAILED',guidance:'Check DEPLOYMENT.md; no credentials or raw database errors are logged.'}));process.exitCode=1;});
