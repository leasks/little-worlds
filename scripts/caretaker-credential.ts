import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { tokenHash } from '../src/repositories/caretaker';
async function main(){
 const url=process.env.DATABASE_URL;if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Credential provisioning tool requires a local database');
 const role=z.enum(['caretaker','narrator','operator']).parse(process.env.AGENT_ROLE??'caretaker');
 const world=z.uuid().parse(process.env.WORLD_ID);const actor=process.env.AGENT_ACTOR_ID??(role==='caretaker'?process.env.CARETAKER_ACTOR_ID:undefined)??`local-${role}`;
 const p=new Pool({connectionString:url});
 try{
  if(process.argv[2]==='revoke'){
   const id=z.uuid().parse(process.env.CREDENTIAL_ID);await p.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE world_id=$1 AND id=$2',[world,id]);console.log('Credential revoked (if present)');return;
  }
  const token=role==='caretaker'?process.env.CARETAKER_API_KEY:role==='narrator'?process.env.NARRATOR_API_KEY:process.env.OPERATOR_API_KEY;if(!token||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw Error('Set CARETAKER_API_KEY to a securely generated token of at least 32 characters; never put it on the command line');
  const id=randomUUID();const result=await p.query(`INSERT INTO little_worlds.agent_credentials(world_id,id,actor_id,token_hash,role,expires_at)
   SELECT world_id,$2,id,$4,$5,now()+interval '30 days' FROM little_worlds.actors WHERE world_id=$1 AND id=$3 AND kind=$5 RETURNING id`,[world,id,actor,tokenHash(token),role]);
  if(!result.rowCount)throw Error('Caretaker actor does not exist');console.log(`Credential registered: ${id} (expires in 30 days; token not displayed)`);
 }finally{await p.end();}
}
main().catch(()=>{console.error('Credential operation failed. Check local DATABASE_URL, WORLD_ID, actor and credential environment inputs.');process.exitCode=1;});
