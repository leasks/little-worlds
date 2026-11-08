import { createRuntimePool } from '../src/server/runtime-pool';
import { z } from 'zod';
import { NarratorRepository } from '../src/repositories/narrator';
import { GroqProvider } from '../src/ai/provider';
import { runNarrator } from '../src/ai/narrate';
async function main(){
 if(!process.env.DATABASE_URL||!process.env.NARRATOR_API_KEY)throw Error('Configure server database and narrator credentials');
 const pool=createRuntimePool(process.env.DATABASE_URL);
 try{
  const repo=new NarratorRepository(pool);const p=await repo.authenticate(process.env.NARRATOR_API_KEY,z.uuid().parse(process.env.WORLD_ID),'narrator');
  const provider=process.env.GROQ_API_KEY&&process.env.GROQ_MODEL?new GroqProvider(process.env.GROQ_MODEL,process.env.GROQ_API_KEY):null;
  console.log(JSON.stringify(await runNarrator(repo,p,provider)));
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Narrator worker failed; simulation remains independent. Check configuration and operator usage records.');process.exitCode=1;});
