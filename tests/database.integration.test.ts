import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { advance,seedWorld } from '../src/engine';
import { PostgresWorldRepository } from '../src/repositories/postgres';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Database tests require a disposable local database');
const admin=new Pool({connectionString:url,max:4});
const pool=new Pool({connectionString:url,max:8,options:'-c role=little_worlds_runtime',application_name:'little-worlds-integration'});
const repo=new PostgresWorldRepository(pool);
afterAll(async()=>{await pool.end();await admin.end();});
// Plain npm test reports these as skipped if a local DB was not explicitly selected.
// The dedicated test:db command requires a URL rather than claiming a zero-test pass.
describe.skipIf(!url)('PostgreSQL persistence',()=>{
 it('preserves seed, settings, scoped locations and creatures across new connections',async()=>{
  const id=await repo.seed(undefined,0);await repo.tick(id,'first',300000);
  const before=await repo.read(id);await repo.seed(id,999999);expect(await repo.read(id)).toEqual(before);
  const fresh=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'});
  try{expect(await new PostgresWorldRepository(fresh).read(id)).toEqual(before);}finally{await fresh.end();}
  const after=await repo.tick(id,'next',600000);expect(after.tick).toBe(2);
  expect((await repo.read(id)).journal).toHaveLength(6);
 });
 it('matches pure engine state and random stream after SQL recovery',async()=>{
  const id=await repo.seed(undefined,0);const initial=seedWorld();initial.id=id;initial.creatures.forEach(c=>c.world_id=id);
  const expected=advance(initial,'same',3000000);await repo.tick(id,'same',3000000);
  const actual=await repo.read(id);expect(actual.creatures).toEqual(expected.creatures);expect(actual.randomState).toBe(expected.randomState);
  expect(actual.journal.map(e=>e.id).sort()).toEqual(expected.journal.map(e=>e.id).sort());
 });
 it('serializes duplicate requests and returns the original receipt after later ticks',async()=>{
  const id=await repo.seed(undefined,0);
  const results=await Promise.all(Array.from({length:6},()=>repo.tick(id,'duplicate',300000)));
  expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
  await repo.tick(id,'later',600000);
  expect(await repo.tick(id,'duplicate',0)).toEqual({duplicate:true,tick:1,virtualTime:900000});
  const w=await repo.read(id);expect(w.tick).toBe(2);expect(w.journal).toHaveLength(6);expect(w.receipts).toHaveLength(2);
 });
 it('does not double advance for different simultaneous request IDs',async()=>{
  const id=await repo.seed(undefined,0);
  await Promise.all(Array.from({length:6},(_,i)=>repo.tick(id,`worker-${i}`,300000)));
  const w=await repo.read(id);expect(w.tick).toBe(1);expect(w.journal).toHaveLength(3);
 });
 it('rolls back clock, creatures and receipt if a late journal insert fails',async()=>{
  const id=await repo.seed(undefined,0);const before=await repo.read(id);
  await admin.query(`CREATE FUNCTION little_worlds.test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${id}' THEN RAISE EXCEPTION 'injected journal failure'; END IF; RETURN NEW; END $$`);
  await admin.query('CREATE TRIGGER test_failure BEFORE INSERT ON little_worlds.event_journal FOR EACH ROW EXECUTE FUNCTION little_worlds.test_failure()');
  try{await expect(repo.tick(id,'retry',300000)).rejects.toThrow('injected journal failure');expect(await repo.read(id)).toEqual(before);}
  finally{await admin.query('DROP TRIGGER test_failure ON little_worlds.event_journal');await admin.query('DROP FUNCTION little_worlds.test_failure()');}
  await repo.tick(id,'retry',300000);expect((await repo.read(id)).tick).toBe(1);
 });
 it('database bounds, foreign keys, monotonic time and history permissions reject corruption',async()=>{
  const id=await repo.seed(undefined,0);const other=await repo.seed(undefined,0);await repo.tick(id,'history',300000);
  await expect(pool.query("UPDATE little_worlds.creatures SET data=jsonb_set(data,'{needs,health}','101') WHERE world_id=$1",[id])).rejects.toThrow();
  await expect(pool.query("UPDATE little_worlds.creatures SET location_id='missing' WHERE world_id=$1",[id])).rejects.toThrow();
  await expect(pool.query('UPDATE little_worlds.simulation_state SET virtual_time=0 WHERE world_id=$1',[id])).rejects.toThrow('monotonic');
  await expect(pool.query("UPDATE little_worlds.event_journal SET event_type='tamper' WHERE world_id=$1",[id])).rejects.toThrow('permission denied');
  await expect(admin.query("DELETE FROM little_worlds.event_journal WHERE world_id=$1",[id])).rejects.toThrow('append-only');
  await expect(pool.query("INSERT INTO little_worlds.event_journal SELECT $1,id,virtual_time,real_time,recorded_at,source,event_type,actor_id,location_id,payload,effects,correlation_id FROM little_worlds.event_journal WHERE world_id=$2",[other,id])).rejects.toThrow();
 });
 it('denies unprivileged database access',async()=>{
  const db=await admin.connect();
  try{await db.query('BEGIN');await db.query('CREATE ROLE little_worlds_test_untrusted NOLOGIN');await db.query('SET LOCAL ROLE little_worlds_test_untrusted');await expect(db.query('SELECT * FROM little_worlds.worlds')).rejects.toThrow('permission denied');}
  finally{await db.query('ROLLBACK');db.release();}
 });
 it('retains bounded downtime backlog, isolates worlds and leaves early requests reusable',async()=>{
  const id=await repo.seed(undefined,0);const other=await repo.seed(undefined,0);
  expect((await repo.tick(id,'early',1)).tick).toBe(0);
  await repo.tick(id,'early',1e12);const w=await repo.read(id);
  expect(w.tick).toBe(96);expect(w.lastRealTime).toBe(28800000);expect(w.journal).toHaveLength(288);
  expect((await repo.read(other)).tick).toBe(0);
 });
 it('a killed worker rolls back and a retry safely completes',async()=>{
  const id=await repo.seed(undefined,0);const before=await repo.read(id);
  await admin.query(`CREATE FUNCTION little_worlds.test_interruption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${id}' THEN PERFORM pg_sleep(20); END IF; RETURN NEW; END $$`);
  await admin.query('CREATE TRIGGER test_interruption BEFORE INSERT ON little_worlds.event_journal FOR EACH ROW EXECUTE FUNCTION little_worlds.test_interruption()');
  const worker=new Pool({connectionString:url,options:'-c role=little_worlds_runtime',application_name:'little-worlds-kill-test'});
  worker.on('error',()=>{});
  const pending=new PostgresWorldRepository(worker).tick(id,'interrupted',300000).then(()=>null,e=>e as Error);
  try {
   let pid:number|undefined;
   for(let i=0;i<100&&!pid;i++){
    const r=await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name='little-worlds-kill-test' AND wait_event='PgSleep'");pid=r.rows[0]?.pid;
    if(!pid)await new Promise(resolve=>setTimeout(resolve,25));
   }
   expect(pid).toBeDefined();await admin.query('SELECT pg_terminate_backend($1)',[pid]);expect(await pending).toBeInstanceOf(Error);
  }finally{await worker.end();await admin.query('DROP TRIGGER test_interruption ON little_worlds.event_journal');await admin.query('DROP FUNCTION little_worlds.test_interruption()');}
  expect(await repo.read(id)).toEqual(before);await repo.tick(id,'interrupted',300000);expect((await repo.read(id)).journal).toHaveLength(3);
 },30000);
});
