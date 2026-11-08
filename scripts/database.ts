import { createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresWorldRepository } from '../src/repositories/postgres';
async function main(){
const url=process.env.DATABASE_URL;
if(!url)throw Error('DATABASE_URL is required (server only)');
const pool=new Pool({connectionString:url});
try {
 const command=process.argv[2];
 if(command==='migrate'){
  // Explicit opt-in guards against accidentally using remote production settings.
  const host=new URL(url).hostname;
  if(!['localhost','127.0.0.1','[::1]'].includes(host))throw Error('This runner only migrates local databases. Remote migrations require operator approval and a separate reviewed command.');
  const db=await pool.connect();
  try {await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(7346281)");
   await db.query('CREATE TABLE IF NOT EXISTS public.little_worlds_migrations(name text PRIMARY KEY,checksum text NOT NULL)');
   for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
    const sql=await readFile(`supabase/migrations/${name}`,'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
    const old=await db.query('SELECT checksum FROM public.little_worlds_migrations WHERE name=$1',[name]);
    if(old.rowCount){if(old.rows[0].checksum!==checksum)throw Error(`Applied migration changed: ${name}`);continue;}
    await db.query(sql);await db.query('INSERT INTO public.little_worlds_migrations VALUES($1,$2)',[name,checksum]);
   }await db.query('COMMIT');console.log('Migrations verified/applied');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }else if(command==='seed'){
   const id=await new PostgresWorldRepository(pool).seed('00000000-0000-4000-8000-000000000001');console.log(`Seeded/preserved world ${id}`);
 }else throw Error('Usage: npm run db:migrate or npm run db:seed');
}finally{await pool.end();}

}
main().catch(error=>{console.error(error instanceof Error?error.message:"Database command failed");process.exitCode=1;});
