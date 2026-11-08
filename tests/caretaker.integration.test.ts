import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,describe,it,expect } from 'vitest';
import { CaretakerRepository,tokenHash } from '../src/repositories/caretaker';
import { caretakerApi } from '../src/server/caretaker-api';
import type { Command } from '../src/caretaker/commands';
const url=process.env.TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Local database required');
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'});const repo=new CaretakerRepository(pool);
afterAll(async()=>{await pool.end();await admin.end();});
async function fixture(){
 const id=await repo.seed(undefined,0),token=randomBytes(32).toString('hex'),credential=randomUUID();
 await admin.query("INSERT INTO little_worlds.agent_credentials(world_id,id,actor_id,token_hash,role,expires_at) VALUES($1,$2,'local-caretaker',$3,'caretaker',now()+interval '1 hour')",[id,credential,tokenHash(token)]);
 const p=await repo.authenticate(token,id);
 const command:Command={action:'feed_creature',actor_id:p.actorId,target_id:'pip',parameters:{food_id:'berries',quantity:1},idempotency_key:'feed-pip'};
 return {id,token,credential,p,command};
}
function req(token:string,body?:unknown){return new Request('http://test/api',{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
describe.skipIf(!url)('caretaker PostgreSQL API',()=>{
 it('authenticates, observes, feeds and exposes persistent results across connections',async()=>{
  const f=await fixture();const before=await caretakerApi(req(f.token),f.id,'world',()=>repo);expect(before.status).toBe(200);
  expect((await caretakerApi(req(f.token),f.id.toUpperCase(),'world',()=>repo)).status).toBe(200);
  const observed=(await before.json()).result;expect(observed).not.toHaveProperty('randomState');expect(observed).not.toHaveProperty('journal');expect(observed.creatures[0]).toHaveProperty('needs');
  const response=await caretakerApi(req(f.token,f.command),f.id,'actions',()=>repo);expect(response.status).toBe(200);
  const fresh=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'});
  try{const r=new CaretakerRepository(fresh);const w=await r.read(f.id);expect(w.creatures[0]!.needs.hunger).toBe(0);expect(w.journal).toHaveLength(1);expect(w.journal[0]!.source).toBe('caretaker');const obs=await r.observe(f.p);expect(obs.caretaker.state.inventory.berries).toBe(11);}
  finally{await fresh.end();}
 });
 it('serializes action retries, detects conflicting keys and survives subsequent ticks',async()=>{
  const f=await fixture();const results=await Promise.all(Array.from({length:5},()=>repo.act(f.p,f.command)));
  expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
  expect((await repo.observe(f.p)).caretaker.state.inventory.berries).toBe(11);
  const conflict={...f.command,parameters:{food_id:'berries' as const,quantity:2}};
  await expect(repo.act(f.p,conflict)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  await repo.tick(f.id,'after-action',300000);
  expect((await repo.act(f.p,f.command)).duplicate).toBe(true);
  const w=await repo.read(f.id);expect(w.journal).toHaveLength(4);expect(w.receipts).toEqual(['after-action']);
 });
 it('keeps concurrent actions and ticks consistent',async()=>{
  const f=await fixture();const [action,tick]=await Promise.allSettled([repo.act(f.p,f.command),repo.tick(f.id,'parallel',300000)]);
  expect(tick.status).toBe('fulfilled');
  // If simulation wins the lock, Pip may move away before the feed is validated.
  // Either serialization is legal; rejected actions must have no resource/effect loss.
  const applied=action.status==='fulfilled';
  if(!applied)expect(action.reason).toMatchObject({code:'PRECONDITION_FAILED'});
  const w=await repo.read(f.id);expect(w.tick).toBe(1);expect(w.journal).toHaveLength(applied?4:3);expect((await repo.observe(f.p)).caretaker.state.inventory.berries).toBe(applied?11:12);
 });
 it('denies wrong-world, revoked, expired, narrator and spoofed actors',async()=>{
  const f=await fixture();const other=await repo.seed(undefined,0);
  await expect(repo.authenticate(f.token,other)).rejects.toMatchObject({status:401});
  await expect(repo.act(f.p,{...f.command,actor_id:'imposter'})).rejects.toMatchObject({status:403});
  for(const update of ["revoked=true","revoked=false,expires_at=now()-interval '1 second'","expires_at=now()+interval '1 hour',role='narrator'"]){
   await admin.query(`UPDATE little_worlds.agent_credentials SET ${update} WHERE id=$1`,[f.credential]);await expect(repo.authenticate(f.token,f.id)).rejects.toMatchObject({status:401});await expect(repo.act(f.p,f.command)).rejects.toMatchObject({status:401});
  }
 });
 it('rejects unowned creatures and unavailable inventory without receipts or mutations',async()=>{
  const f=await fixture();await admin.query("UPDATE little_worlds.creatures SET owner_id=NULL,data=jsonb_set(data,'{owner}','null') WHERE world_id=$1 AND id='pip'",[f.id]);
  const before=await repo.read(f.id);await expect(repo.act(f.p,f.command)).rejects.toMatchObject({status:403});expect(await repo.read(f.id)).toEqual(before);
  await admin.query("UPDATE little_worlds.creatures SET owner_id='local-caretaker',data=jsonb_set(data,'{owner}','\"local-caretaker\"') WHERE world_id=$1 AND id='pip'",[f.id]);
  await admin.query("UPDATE little_worlds.actors SET state=jsonb_set(state,'{inventory,berries}','0') WHERE world_id=$1",[f.id]);
  await expect(repo.act(f.p,f.command)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  expect((await admin.query('SELECT count(*) FROM little_worlds.action_receipts WHERE world_id=$1',[f.id])).rows[0].count).toBe('0');
 });
 it('rolls back inventory, needs, receipt and journal on late write failure',async()=>{
  const f=await fixture(),before=await repo.read(f.id);const actorBefore=await repo.observe(f.p);
  await admin.query(`CREATE FUNCTION little_worlds.test_action_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'action journal failed'; END IF; RETURN NEW; END $$`);
  await admin.query('CREATE TRIGGER test_action_fail BEFORE INSERT ON little_worlds.event_journal FOR EACH ROW EXECUTE FUNCTION little_worlds.test_action_fail()');
  try{await expect(repo.act(f.p,f.command)).rejects.toThrow('action journal failed');expect(await repo.read(f.id)).toEqual(before);expect(await repo.observe(f.p)).toEqual(actorBefore);}
  finally{await admin.query('DROP TRIGGER test_action_fail ON little_worlds.event_journal');await admin.query('DROP FUNCTION little_worlds.test_action_fail()');}
  expect((await repo.act(f.p,f.command)).duplicate).toBe(false);
 });
 it('enforces shared concurrent request limits and restricts credential mutation',async()=>{
  const f=await fixture();await admin.query('UPDATE little_worlds.agent_credentials SET requests=59,window_start=now() WHERE id=$1',[f.credential]);
  const results=await Promise.allSettled([repo.authenticate(f.token,f.id),repo.authenticate(f.token,f.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const denied=results.find(r=>r.status==='rejected');expect(denied?.status==='rejected'&&denied.reason.status).toBe(429);
  await expect(pool.query("UPDATE little_worlds.agent_credentials SET role='narrator' WHERE id=$1",[f.credential])).rejects.toThrow('permission denied');
 });
 it('limits requests durably and returns structured input errors with no writes',async()=>{
  const f=await fixture();await admin.query('UPDATE little_worlds.agent_credentials SET requests=60,window_start=now() WHERE id=$1',[f.credential]);
  const limited=await caretakerApi(req(f.token),f.id,'world',()=>repo);expect(limited.status).toBe(429);expect(limited.headers.get('retry-after')).toBe('60');
  await admin.query("UPDATE little_worlds.agent_credentials SET window_start=now()-interval '2 minutes' WHERE id=$1",[f.credential]);
  const invalid=await caretakerApi(req(f.token,{...f.command,parameters:{quantity:-1}}),f.id,'actions',()=>repo);expect(invalid.status).toBe(400);
  const huge=new Request('http://test',{method:'POST',headers:{Authorization:`Bearer ${f.token}`,'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(9000)})});
  expect((await caretakerApi(huge,f.id,'actions',()=>repo)).status).toBe(413);
  const malformed=new Request('http://test',{method:'POST',headers:{Authorization:`Bearer ${f.token}`,'Content-Type':'application/json'},body:'{oops'});
  expect((await caretakerApi(malformed,f.id,'actions',()=>repo)).status).toBe(400);
  expect((await repo.read(f.id)).journal).toHaveLength(0);
 });
});
