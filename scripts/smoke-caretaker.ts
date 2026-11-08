import { randomBytes,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { CaretakerRepository } from '../src/repositories/caretaker';
async function main(){
 const url=process.env.TEST_DATABASE_URL;const base=process.env.VILLAGE_URL??'http://127.0.0.1:3001';
 if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Smoke test requires local PostgreSQL and a local running Next server');
 const pool=new Pool({connectionString:url});let worldId:string|undefined;
 try{
  const repo=new CaretakerRepository(pool);const id=await repo.seed(undefined,Date.now());worldId=id;const token=randomBytes(32).toString('hex');
  const provisionEnv={...process.env,AGENT_ROLE:'caretaker',AGENT_ACTOR_ID:'local-caretaker',DATABASE_URL:url,WORLD_ID:id,CARETAKER_API_KEY:token};
  const provision=spawnSync(process.execPath,['--import','tsx','scripts/caretaker-credential.ts'],{env:provisionEnv,encoding:'utf8'});
  const credential=provision.stdout.match(/Credential registered: ([0-9a-f-]+)/)?.[1];
  if(provision.status!==0||!credential)throw Error('Credential provisioning tool failed');
  const endpoint=`${base}/api/worlds/${id}`;
  if((await fetch(endpoint)).status!==401)throw Error('Unauthenticated HTTP access was not denied');
  const env={...process.env,VILLAGE_URL:base,WORLD_ID:id,CARETAKER_API_KEY:token,ACTION_KEY:randomUUID()};
  for(let i=0;i<2;i++){
   const client=spawnSync(process.execPath,['--import','tsx','examples/caretaker.ts'],{env,encoding:'utf8'});
   if(client.status!==0)throw Error('Example external client failed');
   if(!client.stdout.includes(i===0?'duplicate: false':'duplicate: true'))throw Error('Unexpected retry response');
  }
  const response=await fetch(`${endpoint}/creatures`,{headers:{Authorization:`Bearer ${token}`}});const body=await response.json();
  if(!body.ok||body.result.creatures.find((c:{id:string})=>c.id==='pip').needs.hunger!==0)throw Error('Feed was not persisted through HTTP');
  const w=await repo.read(id);if(w.journal.length!==1)throw Error('Duplicate journal entry');
  const inventory=await pool.query("SELECT state FROM little_worlds.actors WHERE world_id=$1 AND id='local-caretaker'",[id]);if(inventory.rows[0].state.inventory.berries!==11)throw Error('Duplicate inventory cost');
  const revoke=spawnSync(process.execPath,['--import','tsx','scripts/caretaker-credential.ts','revoke'],{env:{...provisionEnv,CREDENTIAL_ID:credential},encoding:'utf8'});
  if(revoke.status!==0)throw Error('Credential revocation tool failed');
  if((await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`}})).status!==401)throw Error('Revoked HTTP credential accepted');
  console.log('HTTP smoke passed: private reads, example client feed, durable retry, persisted needs/inventory/journal, revocation');
 }finally{if(worldId)await pool.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE world_id=$1',[worldId]);await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'HTTP smoke failed');process.exitCode=1;});
