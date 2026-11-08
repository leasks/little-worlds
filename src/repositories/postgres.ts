import { ApiError } from '../caretaker/commands';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { advance, locations, seedWorld, validateWorld, worldSchema, type World } from '../engine';

export interface TickResult { duplicate:boolean; tick:number; virtualTime:number; }
export interface WorldRepository {
  seed(id?:string,now?:number):Promise<string>;
  read(id:string):Promise<World>;
  tick(id:string,requestId:string,now:number,maxSteps?:number):Promise<TickResult>;
}
export class PostgresWorldRepository implements WorldRepository {
  constructor(protected readonly pool:Pool) {}
  protected async transaction<T>(work:(db:PoolClient)=>Promise<T>):Promise<T>{
    const db=await this.pool.connect();
    let broken=false;
    const onError=()=>{broken=true;};
    db.on("error",onError);
    try { await db.query('BEGIN'); await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='45s'; SET LOCAL idle_in_transaction_session_timeout='20s'");
      const result=await work(db); await db.query('COMMIT'); return result;
    } catch(error){try{await db.query('ROLLBACK');}catch{broken=true;}throw error;} finally{db.release(broken);db.removeListener('error',onError);}
  }
  async seed(id:string=randomUUID(),now=Date.now()):Promise<string>{
    const w=seedWorld(42,now);w.id=id;w.creatures.forEach(c=>c.world_id=id);validateWorld(w);
    await this.transaction(db=>this.seedInTransaction(db,w));return id;
  }
  protected async seedInTransaction(db:PoolClient,w:World){
      const id=w.id;
      const inserted=await db.query('INSERT INTO little_worlds.worlds(world_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING world_id',[id,w.name]);
      if(!inserted.rowCount)return; // Never reset an existing world.
      await db.query('INSERT INTO little_worlds.world_settings VALUES($1,$2,$3)',[id,w.multiplier,w.intervalMs]);
      await db.query('INSERT INTO little_worlds.simulation_state VALUES($1,$2,$3,$4,$5,$6)',[id,w.virtualTime,w.lastRealTime,w.tick,w.randomState,w.weather]);
      for(const l of locations)await db.query('INSERT INTO little_worlds.locations VALUES($1,$2,$3,$4)',[id,l.id,l.name,JSON.stringify(l.actions)]);
      await db.query("INSERT INTO little_worlds.actors VALUES($1,'local-caretaker','caretaker')",[id]);
      for(const c of w.creatures)await db.query('INSERT INTO little_worlds.creatures VALUES($1,$2,$3,$4,$5)',[id,c.id,c.location,c.owner,JSON.stringify(c)]);
  }
  protected async assertWorldWritable(db:PoolClient,id:string){
    const r=await db.query('SELECT archived FROM little_worlds.world_settings WHERE world_id=$1',[id]);
    if(r.rows[0]?.archived)throw new ApiError('ARCHIVED',409,'This village is preserved as a read-only archive');
  }
  protected async load(db:PoolClient,id:string,history:boolean):Promise<World>{
    const {rows}=await db.query(`SELECT w.name,s.*,v.multiplier,v.interval_ms FROM little_worlds.worlds w
      JOIN little_worlds.simulation_state s USING(world_id) JOIN little_worlds.world_settings v USING(world_id) WHERE world_id=$1`,[id]);
    const r=rows[0];if(!r)throw Error('World not found');
    const creatures=await db.query('SELECT data FROM little_worlds.creatures WHERE world_id=$1 ORDER BY id',[id]);
    // Preserve engine processing order; SQL row order must not change seeded outcomes.
    const order=['pip','moss','nim'];creatures.rows.sort((a,b)=>order.indexOf(a.data.id)-order.indexOf(b.data.id));
    const journal:World['journal']=[];const receipts:string[]=[];
    if(history){
      const events=await db.query('SELECT * FROM little_worlds.event_journal WHERE world_id=$1 ORDER BY virtual_time,id',[id]);
      for(const e of events.rows)journal.push({id:e.id,world_id:id,virtualTime:e.virtual_time,realTime:e.real_time,source:e.source,type:e.event_type,actor:e.actor_id,location:e.location_id,payload:e.payload,effects:e.effects,correlationId:e.correlation_id});
      const results=await db.query('SELECT request_id FROM little_worlds.simulation_ticks WHERE world_id=$1 ORDER BY tick_to,request_id',[id]);
      receipts.push(...results.rows.map(r=>r.request_id));
    }
    const w=worldSchema.parse({id,name:r.name,virtualTime:r.virtual_time,lastRealTime:r.last_real_time,tick:Number(r.tick),randomState:Number(r.random_state),weather:r.weather,multiplier:r.multiplier,intervalMs:r.interval_ms,creatures:creatures.rows.map(c=>c.data),journal,receipts});validateWorld(w);return w;
  }
  async read(id:string):Promise<World>{
    // One consistent snapshot across current state, creatures and history.
    return this.transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return this.load(db,id,true);});
  }
  async tick(id:string,requestId:string,now:number,maxSteps=96):Promise<TickResult>{
    if(!requestId||requestId.length>128||!Number.isFinite(now)||now<0||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000)throw Error('Invalid tick input');
    return this.transaction(db=>this.tickInTransaction(db,id,requestId,now,maxSteps));
  }
  protected async tickInTransaction(db:PoolClient,id:string,requestId:string,now:number,maxSteps:number):Promise<TickResult>{
      const lock=await db.query('SELECT world_id FROM little_worlds.simulation_state WHERE world_id=$1 FOR UPDATE',[id]);
      if(!lock.rowCount)throw Error('World not found');
      const receipt=await db.query('SELECT tick_to,virtual_time FROM little_worlds.simulation_ticks WHERE world_id=$1 AND request_id=$2',[id,requestId]);
      if(receipt.rowCount)return {duplicate:true,tick:Number(receipt.rows[0].tick_to),virtualTime:receipt.rows[0].virtual_time};
      // History and receipts stay in SQL; a tick only loads bounded current state.
      const before=await this.load(db,id,false);
      const settings=await db.query('SELECT paused,archived FROM little_worlds.world_settings WHERE world_id=$1',[id]);
      if(settings.rows[0].paused||settings.rows[0].archived)return {duplicate:false,tick:before.tick,virtualTime:before.virtualTime};
      // A worker that queued behind another may have an older observation time.
      const after=advance(before,requestId,Math.max(now,before.lastRealTime),maxSteps);
      if(after.tick===before.tick)return {duplicate:false,tick:after.tick,virtualTime:after.virtualTime};
      await db.query('INSERT INTO little_worlds.simulation_ticks(world_id,request_id,tick_from,tick_to,virtual_time,real_time) VALUES($1,$2,$3,$4,$5,$6)',[id,requestId,before.tick,after.tick,after.virtualTime,after.lastRealTime]);
      await db.query('UPDATE little_worlds.simulation_state SET virtual_time=$2,last_real_time=$3,tick=$4,random_state=$5,weather=$6 WHERE world_id=$1',[id,after.virtualTime,after.lastRealTime,after.tick,after.randomState,after.weather]);
      for(const c of after.creatures)await db.query('UPDATE little_worlds.creatures SET location_id=$3,owner_id=$4,data=$5 WHERE world_id=$1 AND id=$2',[id,c.id,c.location,c.owner,JSON.stringify(c)]);
      await db.query(`INSERT INTO little_worlds.event_journal(world_id,id,virtual_time,real_time,source,event_type,actor_id,location_id,payload,effects,correlation_id,tick_request_id)
       SELECT e.world_id,e.id,e.virtual_time,e.real_time,e.source,e.event_type,e.actor_id,e.location_id,e.payload,e.effects,e.correlation_id,e.correlation_id
       FROM jsonb_to_recordset($1::jsonb) AS e(world_id uuid,id text,virtual_time double precision,real_time double precision,source text,event_type text,actor_id text,location_id text,payload jsonb,effects jsonb,correlation_id text)`,
       [JSON.stringify(after.journal.map(e=>({world_id:id,id:e.id,virtual_time:e.virtualTime,real_time:e.realTime,source:e.source,event_type:e.type,actor_id:e.actor,location_id:e.location,payload:e.payload,effects:e.effects,correlation_id:requestId})))]);

      return {duplicate:false,tick:after.tick,virtualTime:after.virtualTime};

  }
}
