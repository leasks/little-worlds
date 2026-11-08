import { seedWorld } from '../src/engine';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { tokenHash } from '../src/repositories/caretaker';
import { OperatorRepository } from '../src/repositories/operator';
class LocalSetup extends OperatorRepository{
 async prepare(key:string){const w=seedWorld(42,Date.now());w.id=randomUUID();w.creatures.forEach(c=>c.world_id=w.id);return this.transaction(async db=>{
  await this.seedInTransaction(db,w);await db.query('UPDATE little_worlds.world_settings SET is_test=true WHERE world_id=$1',[w.id]);
  await db.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,'local-operator',$2,'operator',now()+interval '30 days')",[w.id,tokenHash(key)]);return w.id;
 });}
}
async function main(){
 const url=process.env.DATABASE_URL,key=process.env.OPERATOR_API_KEY;
 if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('A local database is required');
 if(!key||!/^[A-Za-z0-9_-]{32,256}$/.test(key))throw Error('Generate OPERATOR_API_KEY securely before creating a test world');
 const pool=new Pool({connectionString:url});
 try{const world=await new LocalSetup(pool).prepare(key);console.log(`Test village ID: ${world}\nSign in with this ID and your privately held operator key. Key not displayed.`);}
 finally{await pool.end();}
}
main().catch(()=>{console.error('Test world setup failed. Check local DATABASE_URL and a newly generated OPERATOR_API_KEY.');process.exitCode=1;});
