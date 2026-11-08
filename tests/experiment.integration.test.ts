import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { createRuntimePool } from '../src/server/runtime-pool';
import { ExperimentRepository } from '../src/repositories/experiment';
import { runExperiment,ExperimentFailure } from '../src/experiment/runner';
import { experimentConfigSchema } from '../src/experiment/contracts';
import { buildExperimentReport } from '../src/experiment/report';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Local database required');
const owner=new Pool({connectionString:url,max:2}),runtime=url?createRuntimePool(url):new Pool({max:1}),admin=new ExperimentRepository(owner),repo=new ExperimentRepository(runtime);
afterAll(async()=>{await owner.end();await runtime.end();});
describe.skipIf(!url)('persistent 30-day caretaker experiment',()=>{
 it('reproduces complete 30-day state, journal, actions, quest and AI failure evidence',async()=>{
  const config=experimentConfigSchema.parse({});const one=await runExperiment(admin,repo,config,'b'.repeat(64));const two=await runExperiment(admin,repo,config,'b'.repeat(64));
  expect(one.worldId).not.toBe(two.worldId);expect(one.report.semanticHash).toBe(two.report.semanticHash);expect(one.report).toEqual(two.report);
  const r=one.report;expect(r.validation.passed).toBe(true);expect(r.validation.actualTicks).toBe(2880);expect(r.validation.actualSimulationEvents).toBe(8640);expect(r.daily).toHaveLength(30);expect(r.quest?.status).toBe('completed');expect(r.questCompletedDay).toBe(5);
  expect(r.proposals.accepted).toBe(2);expect(r.proposals.rejected).toBe(3);expect(r.proposals.rejectionCodes.DUPLICATE_PROPOSAL).toBe(1);expect(r.failures.simulation).toBe(0);expect(r.failures.mockProviderErrors).toBe(2);expect(r.ai.liveRequests).toBe(0);expect(r.ai.mockAttempts).toBe(5);expect(r.replayedTicks).toBe(1);expect(r.caretaker.replayedActions).toBe(1);
  const archived=(await owner.query('SELECT archived FROM little_worlds.world_settings WHERE world_id=$1',[one.worldId])).rows[0].archived;expect(archived).toBe(true);
  const credentials=(await owner.query('SELECT bool_and(revoked) AS revoked FROM little_worlds.agent_credentials WHERE world_id=$1',[one.worldId])).rows[0];expect(credentials.revoked).toBe(true);
  await expect(owner.query('UPDATE little_worlds.experiment_days SET day=1 WHERE world_id=$1',[one.worldId])).rejects.toThrow('append-only');
  await expect(owner.query("UPDATE little_worlds.experiment_runs SET status='running' WHERE world_id=$1",[one.worldId])).rejects.toThrow('final');
  expect(buildExperimentReport(await repo.experimentData(one.worldId)).report).toEqual(r);
 },120000);
 it('operates with narration disabled and cannot advance an unrelated world',async()=>{
  const result=await runExperiment(admin,repo,experimentConfigSchema.parse({days:2,narrator:'disabled',seed:7}),'b'.repeat(64));expect(result.report.ai.mockAttempts).toBe(0);expect(result.report.quest).toBeNull();expect(result.report.validation.passed).toBe(true);
  const live=await admin.seed(undefined,0);await expect(repo.advanceExperiment(live,'no-test-bypass',1)).rejects.toThrow('EXPERIMENT_WORLD_REJECTED');expect((await repo.read(live)).tick).toBe(0);
 });
 it('preserves failed checkpoints and never promotes an interrupted run to complete',async()=>{
  let world='';try{await runExperiment(admin,repo,experimentConfigSchema.parse({days:3,narrator:'disabled'}),'b'.repeat(64),day=>{if(day===2)throw Error('Injected interruption');});}catch(error){expect(error).toBeInstanceOf(ExperimentFailure);world=(error as ExperimentFailure).worldId;}
  expect(world).not.toBe('');const partial=await repo.experimentData(world);expect(partial.status).toBe('failed');expect(partial.completedDays).toBe(2);const report=buildExperimentReport(partial).report;expect(report.status).toBe('incomplete');expect(report.validation.passed).toBe(false);expect(report.failures.simulation).toBe(1);
 });
});
