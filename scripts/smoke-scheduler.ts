import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { SchedulerRepository } from '../src/repositories/scheduler';
import { tokenHash } from '../src/repositories/caretaker';
async function main(){
 const url=process.env.TEST_DATABASE_URL,base=process.env.VILLAGE_URL??'http://127.0.0.1:3001',file=process.env.SCHEDULER_TEST_CONTEXT??'/tmp/little-worlds-scheduler-context.json';
 if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Local disposable services required');
 const p=new Pool({connectionString:url});
 try{
  if(process.argv[2]==='prepare'){
   const repo=new SchedulerRepository(p),worldId=await repo.seed(undefined,Date.now()-900000),secret=randomBytes(32).toString('hex'),operator=randomBytes(32).toString('hex');
   await p.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,'local-operator',$2,'operator',now()+interval '1 hour')",[worldId,tokenHash(operator)]);
   writeFileSync(file,JSON.stringify({worldId,secret}),{mode:0o600,flag:'wx'});console.log('Private local scheduler fixture prepared; values not displayed');return;
  }
  const context=JSON.parse(readFileSync(file,'utf8')) as {worldId:string;secret:string};
  if((await fetch(`${base}/api/cron/tick`)).status!==401)throw Error('Unauthenticated cron was not denied');
  const requestId=`http-smoke-${randomUUID()}`;let advanced=0;const before=await new SchedulerRepository(p).read(context.worldId);
  const env={...process.env,DATABASE_URL:url,APP_ORIGIN:base,CRON_WORLD_ID:context.worldId,CRON_SECRET:context.secret,TICK_REQUEST_ID:requestId,VILLAGE_URL:base};
  const preflight=spawnSync(process.execPath,['--import','tsx','scripts/preflight.ts'],{env,encoding:'utf8'});if(preflight.status!==0)throw Error('Local deployment preflight failed');
  for(let i=0;i<2;i++){
   const worker=spawnSync(process.execPath,['--import','tsx','scripts/tick-worker.ts'],{env,encoding:'utf8'});if(worker.status!==0)throw Error('Standalone worker failed');
   const response=JSON.parse(worker.stdout.trim().split('\n').at(-1)!);if(i===0)advanced=response.steps;if(response.duplicate!==(i===1))throw Error('Unexpected worker retry outcome');
  }
  const repo=new SchedulerRepository(p),w=await repo.read(context.worldId);if(w.tick!==before.tick+advanced||w.journal.length!==w.tick*3)throw Error('Unexpected tick count or duplicate events');
  const health=await fetch(`${base}/api/cron/health`,{headers:{Authorization:`Bearer ${context.secret}`}});if(health.status!==200)throw Error('Health check not ready');
  const log=await p.query("SELECT status,attempts FROM little_worlds.scheduler_runs WHERE world_id=$1 AND request_id=$2",[context.worldId,`worker:${requestId}`]);if(log.rows[0]?.status!=='succeeded'||log.rows[0]?.attempts!==2)throw Error('Attempt accounting failed');
  const cron=await fetch(`${base}/api/cron/tick`,{headers:{Authorization:`Bearer ${context.secret}`}});if(cron.status!==200)throw Error('Vercel-style GET failed');
  const repeated=await fetch(`${base}/api/cron/tick`,{headers:{Authorization:`Bearer ${context.secret}`}});if(!(await repeated.json()).result.duplicate)throw Error('Cron time slot was not idempotent');
  console.log('Scheduler HTTP smoke passed: authentication, configured world, preflight, standalone worker, stable retry, health and persisted journal events');
 }finally{await p.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Scheduler smoke failed');process.exitCode=1;});
