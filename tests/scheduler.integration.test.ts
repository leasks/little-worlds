import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { SchedulerRepository } from '../src/repositories/scheduler';
import { createRuntimePool } from '../src/server/runtime-pool';
import { cronApi } from '../src/server/cron-api';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Local database required');
const admin=new Pool({connectionString:url}),pool=url?createRuntimePool(url):new Pool({max:1}),repo=new SchedulerRepository(pool);
afterAll(async()=>{await pool.end();await admin.end();});
describe.skipIf(!url)('scheduled persistence and recovery',()=>{
 it('commits one batch for concurrent identical cron slots and stable POST retries',async()=>{
  const id=await repo.seed(undefined,0);const results=await Promise.all(Array.from({length:5},()=>repo.scheduledTick(id,null,300000,96)));
  expect(results.filter(r=>!r.duplicate)).toHaveLength(1);expect((await repo.read(id)).tick).toBe(1);expect((await repo.read(id)).journal).toHaveLength(3);
  const after=await repo.scheduledTick(id,'external-worker',600000,96);expect(after.steps).toBe(1);
  expect((await repo.scheduledTick(id,'external-worker',900000,96)).duplicate).toBe(true);expect((await repo.read(id)).tick).toBe(2);
 });
 it('caps downtime work, retains backlog, and skips test/paused/archived worlds',async()=>{
  const id=await repo.seed(undefined,0);const first=await repo.scheduledTick(id,'downtime',1e12,96);expect(first.steps).toBe(96);expect(first.backlogSteps).toBeGreaterThan(96);
  const next=await repo.scheduledTick(id,'drain-next',1e12,96);expect(next.steps).toBe(96);expect((await repo.read(id)).journal).toHaveLength(576);
  for(const [column,status] of [['is_test','test_world'],['archived','archived']] as const){const other=await repo.seed(undefined,0);await admin.query(`UPDATE little_worlds.world_settings SET ${column}=true WHERE world_id=$1`,[other]);expect((await repo.scheduledTick(other,'skip',1e12)).status).toBe(status);expect((await repo.read(other)).tick).toBe(0);}
  const paused=await repo.seed(undefined,0);await admin.query('UPDATE little_worlds.world_settings SET paused=true,paused_at_ms=1 WHERE world_id=$1',[paused]);expect((await repo.scheduledTick(paused,'paused',1e12)).status).toBe('paused');
 });
 it('records safe failure, rolls back batch effects and resumes an interrupted attempt',async()=>{
  const id=await repo.seed(undefined,0);const before=await repo.read(id);
  await admin.query(`CREATE FUNCTION little_worlds.test_scheduled_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${id}' THEN RAISE EXCEPTION 'sensitive private failure'; END IF; RETURN NEW; END $$`);await admin.query('CREATE TRIGGER test_scheduled_fail BEFORE INSERT ON little_worlds.event_journal FOR EACH ROW EXECUTE FUNCTION little_worlds.test_scheduled_fail()');
  try{await expect(repo.scheduledTick(id,'recover',300000)).rejects.toThrow('sensitive private failure');expect(await repo.read(id)).toEqual(before);const run=(await admin.query('SELECT * FROM little_worlds.scheduler_runs WHERE world_id=$1',[id])).rows[0];expect(run.status).toBe('failed');expect(run.error_code).toBe('TICK_FAILED');expect(JSON.stringify(run)).not.toContain('sensitive');}
  finally{await admin.query('DROP TRIGGER test_scheduled_fail ON little_worlds.event_journal');await admin.query('DROP FUNCTION little_worlds.test_scheduled_fail()');}
  expect((await repo.scheduledTick(id,'recover',300000)).steps).toBe(1);
  // A process killed before commit leaves a visible started attempt with no effects.
  await admin.query("INSERT INTO little_worlds.scheduler_runs(world_id,request_id,status) VALUES($1,'worker:interrupted','started')",[id]);expect((await repo.scheduledTick(id,'interrupted',600000)).steps).toBe(1);expect((await repo.read(id)).journal).toHaveLength(6);
 });
 it('provides authenticated health with stale/failure/backlog signals and respects uppercase UUIDs',async()=>{
  const id=await repo.seed(undefined,0);expect((await repo.schedulingHealth(id,300000)).status).toBe('not_started');await repo.scheduledTick(id.toUpperCase(),'ready',300000);
  expect((await repo.schedulingHealth(id,300000)).healthy).toBe(true);
  await admin.query("UPDATE little_worlds.scheduler_runs SET last_attempt_at=now()-interval '1 hour' WHERE world_id=$1",[id]);expect((await repo.schedulingHealth(id,Date.now())).status).toBe('stale');
  const conf={secret:'private-test-secret-'.repeat(3),worldId:id,maxSteps:96};const req=new Request('http://test/api/cron/health',{headers:{Authorization:`Bearer ${conf.secret}`}});expect((await cronApi(req,'health',()=>repo,conf,Date.now())).status).toBe(503);
 });
 it('uses configured cadence when evaluating health for short world intervals',async()=>{
  const now=Date.now(),id=await repo.seed(undefined,now-60000);await admin.query('UPDATE little_worlds.world_settings SET interval_ms=1000 WHERE world_id=$1',[id]);
  await repo.scheduledTick(id,'fast-interval',now,96);expect((await repo.schedulingHealth(id,now+50000,60000)).healthy).toBe(true);expect((await repo.schedulingHealth(id,now+121000,60000)).healthy).toBe(false);
 });
 it('checks actual runtime role on new pooled connections and logs committed summaries',async()=>{
  const id=await repo.seed(undefined,0);const role=await pool.query('SELECT current_user');expect(role.rows[0].current_user).toBe('little_worlds_runtime');
  await repo.scheduledTick(id,'logged',300000);const record=(await admin.query('SELECT * FROM little_worlds.scheduler_runs WHERE world_id=$1',[id])).rows[0];expect(record.status).toBe('succeeded');expect(record.result.steps).toBe(1);
 });
});
