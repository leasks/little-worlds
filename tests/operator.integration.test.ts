import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { OperatorRepository } from '../src/repositories/operator';
import { tokenHash } from '../src/repositories/caretaker';
import { operatorApi } from '../src/server/operator-api';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Local test database required');
const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'}),repo=new OperatorRepository(pool);
afterAll(async()=>{await pool.end();await admin.end();});
async function fixture(isTest=true){const world=await repo.seed(undefined,Date.now());const key=randomBytes(32).toString('hex');
 await admin.query('UPDATE little_worlds.world_settings SET is_test=$2 WHERE world_id=$1',[world,isTest]);
 const credential=await admin.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,'local-operator',$2,'operator',now()+interval '1 hour') RETURNING id",[world,tokenHash(key)]);
 const token=await repo.login(key,world),session=await repo.session(token);return {world,key,token,session,p:session.principal,credential:credential.rows[0].id};}
const request=(token:string,body?:unknown,origin='http://village.test')=>new Request('http://village.test/api/operator/control',{method:body?'POST':'GET',headers:{cookie:`lw_operator=${token}`,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
describe.skipIf(!url)('private operator services',()=>{
 it('issues opaque DB sessions, scopes them to operator credentials, and revokes immediately',async()=>{
  const f=await fixture();expect(f.token).not.toBe(f.key);expect(f.token).toHaveLength(64);expect((await repo.snapshot(f.p)).world.id).toBe(f.world);
  await repo.logout(f.token);await expect(repo.session(f.token)).rejects.toMatchObject({status:401});
  const expired=await repo.login(f.key,f.world);await admin.query("UPDATE little_worlds.operator_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(expired)]);await expect(repo.session(expired)).rejects.toMatchObject({status:401});
  const second=await repo.login(f.key,f.world);await admin.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE id=$1',[f.credential]);await expect(repo.session(second)).rejects.toMatchObject({status:401});
 });
 it('denies unauthenticated reads, missing/foreign Origin writes and caretaker login',async()=>{
  const noSession=await operatorApi(new Request('http://village.test/api/operator'),'snapshot',()=>repo);expect(noSession.status).toBe(401);
  const f=await fixture();expect((await operatorApi(request(f.token,{action:'pause',request_id:'csrf'},'https://elsewhere.test'),'control',()=>repo)).status).toBe(403);
  const noOrigin=new Request('http://village.test/api/operator/control',{method:'POST',headers:{cookie:`lw_operator=${f.token}`,'Content-Type':'application/json'},body:'{}'});expect((await operatorApi(noOrigin,'control',()=>repo)).status).toBe(403);
  const caretaker=randomBytes(32).toString('hex');await admin.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,'local-caretaker',$2,'caretaker',now()+interval '1 hour')",[f.world,tokenHash(caretaker)]);await expect(repo.login(caretaker,f.world)).rejects.toMatchObject({status:401});
 });
 it('counts rejected login attempts and returns no sensitive error details',async()=>{
  const f=await fixture();await admin.query('UPDATE little_worlds.operator_login_limits SET attempts=29,window_start=now() WHERE world_id=$1',[f.world]);
  await expect(repo.login('x'.repeat(64),f.world)).rejects.toMatchObject({status:401});await expect(repo.login(f.key,f.world)).rejects.toMatchObject({status:429});
  const result=await operatorApi(new Request('http://village.test/api/operator/session',{method:'POST',headers:{Origin:'http://village.test','Content-Type':'application/json'},body:JSON.stringify({world_id:f.world,token:'x'.repeat(64)})}),'login',()=>{throw Error('secret database detail');});expect(result.status).toBe(503);expect(await result.text()).not.toContain('secret');
 });
 it('serializes operator ticks, preserves retry results and rejects changed commands',async()=>{
  const f=await fixture(),command={action:'advance_test' as const,count:3,request_id:'same'};
  const results=await Promise.all([repo.control(f.p,command,true),repo.control(f.p,command,true)]);expect(results.filter(r=>!r.duplicate)).toHaveLength(1);expect((await repo.read(f.world)).tick).toBe(3);
  await expect(repo.control(f.p,{...command,count:4},true)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  expect((await repo.journal(f.p,{creature:'pip',source:'simulation'})).entries).toHaveLength(3);expect((await repo.journal(f.p,{type:'unknown_event'})).entries).toHaveLength(0);
 });
 it('honors persisted pause on every tick path and excludes paused time on resume',async()=>{
  const f=await fixture();await repo.control(f.p,{action:'pause',request_id:'pause'},true);const before=await repo.read(f.world);
  await repo.tick(f.world,'scheduled',before.lastRealTime+300000);await repo.control(f.p,{action:'advance_test',count:4,request_id:'while-paused'},true);expect((await repo.read(f.world)).tick).toBe(before.tick);
  await repo.control(f.p,{action:'resume',request_id:'resume'},true);await repo.control(f.p,{action:'run_tick',request_id:'one'},true);expect((await repo.read(f.world)).tick).toBe(1);
 });
 it('never accelerates/resets a live world, nor a test world without local tools enabled',async()=>{
  const live=await fixture(false);await expect(repo.control(live.p,{action:'advance_test',count:2,request_id:'live'},true)).rejects.toMatchObject({status:403});
  const f=await fixture();await expect(repo.control(f.p,{action:'reset_test',confirmation:'RESET TEST VILLAGE',request_id:'disabled'},false)).rejects.toMatchObject({status:403});
  await expect(repo.control(f.p,{action:'reset_test',confirmation:'wrong',request_id:'wrong'} as never,true)).rejects.toThrow();
 });
 it('creates a fresh test world on confirmed reset, retaining old history and idempotency',async()=>{
  const f=await fixture();await repo.control(f.p,{action:'advance_test',count:2,request_id:'prior'},true);const before=await repo.read(f.world);
  const command={action:'reset_test' as const,request_id:'reset-once',confirmation:'RESET TEST VILLAGE' as const};const reset=await repo.control(f.p,command,true);expect(reset.newWorldId).not.toBe(f.world);expect((await repo.control(f.p,command,true)).newWorldId).toBe(reset.newWorldId);
  expect(await repo.read(f.world)).toEqual(before);expect((await repo.snapshot(f.p)).world.archived).toBe(true);
  const token=await repo.resetSession(f.session,reset),session=await repo.session(token);const fresh=await repo.snapshot(session.principal);expect(fresh.world.tick).toBe(0);expect(fresh.world.virtualTime).toBe(0);expect(fresh.world.isTest).toBe(true);
  await expect(repo.control(f.p,{action:'resume',request_id:'archived'},true)).rejects.toMatchObject({code:'ARCHIVED'});
  await admin.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE id=$1',[f.credential]);await expect(repo.session(token)).rejects.toMatchObject({status:401});
 });
 it('rejects stale cross-world control requests after a session switch',async()=>{
  const f=await fixture(),other=await repo.seed(undefined,0);
  const response=await operatorApi(request(f.token,{world_id:other,command:{action:'run_tick',request_id:'stale-ui'}}),'control',()=>repo);
  expect(response.status).toBe(409);expect((await response.json()).code).toBe('WORLD_CHANGED');expect((await repo.read(f.world)).tick).toBe(0);
 });
 it('returns secure HttpOnly session cookies and never includes long-lived keys',async()=>{
  const f=await fixture();const req=new Request('https://village.test/api/operator/session',{method:'POST',headers:{Origin:'https://village.test','Content-Type':'application/json'},body:JSON.stringify({world_id:f.world,token:f.key})});
  const response=await operatorApi(req,'login',()=>repo);expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');expect(response.headers.get('set-cookie')).toContain('Secure');expect(response.headers.get('set-cookie')).not.toContain(f.key);expect(await response.text()).not.toContain(f.key);
 });
});
