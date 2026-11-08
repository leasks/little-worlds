import { z } from 'zod';

const bounded = z.number().finite().min(0).max(100);
const traits = z.object({curiosity: bounded, energy: bounded, sociability: bounded, patience: bounded, caution: bounded});
export const locations = [
  {id:'square', name:'Village Square', actions:['socialise','play']},
  {id:'cottage', name:'Caretaker Cottage', actions:['eat','rest']},
  {id:'garden', name:'Community Garden', actions:['garden','explore']},
  {id:'pond', name:'Village Pond', actions:['rest','explore']},
  {id:'forest', name:'Forest Edge', actions:['explore']},
] as const;
const locationId = z.enum(['square','cottage','garden','pond','forest']);
const activity = z.enum(['eat','rest','play','garden','explore','socialise']);
export const creatureSchema = z.object({
  id:z.string(), world_id:z.string(), name:z.string(), archetype:z.string(),
  createdAt:z.number().nonnegative(), ageDays:z.number().nonnegative(), location:locationId,
  needs:z.object({hunger:bounded,energy:bounded,happiness:bounded,health:bounded}),
  traits, preferences:z.array(activity), dislikes:z.array(activity), activity,
  relationships:z.record(z.string(),bounded), memories:z.array(z.string()).max(20),
  inventory:z.record(z.string(),z.number().int().nonnegative()), owner:z.string().nullable(),
  lastSimulated:z.number().nonnegative(),
});
export type Creature = z.infer<typeof creatureSchema>;
const eventSchema = z.object({id:z.string(),world_id:z.string(),virtualTime:z.number(),realTime:z.number(),source:z.enum(['simulation','caretaker','narrator']),type:z.string(),actor:z.string(),location:locationId,payload:z.record(z.string(),z.unknown()),effects:z.record(z.string(),z.unknown()),correlationId:z.string()});
export const worldSchema = z.object({
  id:z.string(),name:z.string(),virtualTime:z.number().nonnegative(),lastRealTime:z.number().nonnegative(),
  multiplier:z.number().positive().max(100),intervalMs:z.number().int().min(1000).max(3600000),
  randomState:z.number().int().min(1).max(4294967295),tick:z.number().int().nonnegative(),
  weather:z.enum(['clear','rain','cloudy']),creatures:z.array(creatureSchema).length(3),
  journal:z.array(eventSchema), receipts:z.array(z.string()),
});
export type World = z.infer<typeof worldSchema>;
const DAY = 86400000;
const clamp = (n:number) => Math.max(0,Math.min(100,n));
export function clock(virtualTime:number) {
  return {day:Math.floor(virtualTime/DAY)+1,hour:Math.floor(virtualTime/3600000)%24,night:virtualTime%DAY<21600000||virtualTime%DAY>=72000000};
}
export function seedWorld(seed=42,realTime=0):World {
  const names=['Pip','Moss','Nim'];
  const profiles=[{curiosity:90,energy:85,sociability:80,patience:20,caution:20},{curiosity:35,energy:45,sociability:50,patience:90,caution:85},{curiosity:75,energy:50,sociability:25,patience:75,caution:60}];
  return worldSchema.parse({id:'local-first-village',name:'The First Village',virtualTime:0,lastRealTime:realTime,multiplier:3,intervalMs:300000,randomState:seed,tick:0,weather:'clear',journal:[],receipts:[],creatures:names.map((name,i)=>({id:name.toLowerCase(),world_id:'local-first-village',name,archetype:['wayfarer','gardener','nightwatcher'][i],createdAt:0,ageDays:0,location:'cottage',needs:{hunger:20,energy:80,happiness:75,health:100},traits:profiles[i],preferences:[i===1?'garden':'explore'],dislikes:[i===1?'explore':'garden'],activity:'rest',relationships:{},memories:[],inventory:{},owner:'local-caretaker',lastSimulated:0}))});
}
function random(w:World) { let x=w.randomState; x^=x<<13; x^=x>>>17; x^=x<<5; w.randomState=x>>>0; return w.randomState/4294967296; }
export function validateWorld(w:World):void {
  worldSchema.parse(w);
  if(new Set(w.creatures.map(c=>c.id)).size!==w.creatures.length) throw Error('Duplicate creature');
  if(new Set(w.journal.map(e=>e.id)).size!==w.journal.length) throw Error('Duplicate event');
  for(const c of w.creatures) {
    if(c.world_id!==w.id||c.lastSimulated>w.virtualTime) throw Error('Invalid creature scope/time');
    if(Object.keys(c.relationships).some(id=>id===c.id||!w.creatures.some(other=>other.id===id))) throw Error('Invalid relationship');
  }
  if(w.journal.some(e=>e.world_id!==w.id||e.virtualTime>w.virtualTime)) throw Error('Invalid journal');
}
export function selectActivity(c:Creature,w:World):z.infer<typeof activity> {
  if(c.needs.hunger>65) return 'eat';
  if(c.needs.energy<30) return 'rest';
  const night=clock(w.virtualTime).night;
  const weights:[z.infer<typeof activity>,number][]=[
    ['rest',night&&c.id!=='nim'?65:5],['play',15+c.traits.energy/5],
    ['garden',c.preferences.includes('garden')?65:10],
    ['explore',(c.traits.curiosity*(1-c.traits.caution/130)+(night&&c.id==='nim'?35:0))*(w.weather==='rain'?0.3:1)],
    ['socialise',c.traits.sociability+Math.max(0,...Object.values(c.relationships))/4],
  ];
  let choice=random(w)*weights.reduce((sum,[,n])=>sum+n,0);
  for(const [act,weight] of weights) { choice-=weight; if(choice<=0)return act; }
  return 'rest';
}
// Pure local transition. Persistence, durable receipts and locking belong to Phase 2.
export function advance(input:World,requestId:string,now:number,maxSteps=96):World {
  validateWorld(input);
  if(!requestId||requestId.length>128||!Number.isFinite(now)||now<input.lastRealTime||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000) throw Error('Invalid tick input');
  if(input.receipts.includes(requestId)) return structuredClone(input);
  const w=structuredClone(input);
  const steps=Math.min(maxSteps,Math.floor((now-w.lastRealTime)/w.intervalMs));
  if(!steps)return w; // Do not consume an ID before any step is due.
  for(let i=0;i<steps;i++) {
    w.tick++; w.lastRealTime+=w.intervalMs; w.virtualTime+=w.intervalMs*w.multiplier;
    if(w.tick%32===1)w.weather=(['clear','cloudy','rain'] as const)[Math.floor(random(w)*3)]!;
    const hours=w.intervalMs*w.multiplier/3600000;
    for(const c of w.creatures) {
      const before=structuredClone(c.needs);
      c.needs.hunger=clamp(c.needs.hunger+hours*8); c.needs.energy=clamp(c.needs.energy-hours*5);
      c.needs.happiness=clamp(c.needs.happiness-hours*2);
      c.activity=selectActivity(c,w);
      if(c.activity==='eat'){c.location='cottage';c.needs.hunger=clamp(c.needs.hunger-hours*55);}
      if(c.activity==='rest'){c.location='cottage';c.needs.energy=clamp(c.needs.energy+hours*40);}
      if(c.activity==='play'){c.location='square';c.needs.happiness=clamp(c.needs.happiness+hours*18);}
      if(c.activity==='garden'){c.location='garden';c.needs.happiness=clamp(c.needs.happiness+hours*12);}
      if(c.activity==='explore'){c.location=c.traits.caution>50?'pond':'forest';c.needs.happiness=clamp(c.needs.happiness+hours*10);}
      let friendId:string|null=null;
      if(c.activity==='socialise') {
        c.location='square';
        const friend=w.creatures.filter(other=>other.id!==c.id).sort((a,b)=>(c.relationships[b.id]??0)-(c.relationships[a.id]??0))[0]!;
        friendId=friend.id; c.relationships[friend.id]=clamp((c.relationships[friend.id]??0)+hours*2);
        friend.relationships[c.id]=clamp((friend.relationships[c.id]??0)+hours*2);
        c.needs.happiness=clamp(c.needs.happiness+hours*15);
      }
      c.needs.health=clamp(c.needs.health+(c.needs.hunger>90?-hours*4:hours));
      const patienceBefore=c.traits.patience;
      if(c.activity==='garden')c.traits.patience=clamp(c.traits.patience+hours*0.02);
      c.ageDays=(w.virtualTime-c.createdAt)/DAY; c.lastSimulated=w.virtualTime;
      if(w.tick%96===0)c.memories=[...c.memories,`Day ${clock(w.virtualTime).day}: enjoyed ${c.activity} at ${c.location}`].slice(-20);
      w.journal.push({id:`${w.id}:${w.tick}:${c.id}`,world_id:w.id,virtualTime:w.virtualTime,realTime:w.lastRealTime,source:'simulation',type:'activity',actor:c.id,location:c.location,payload:{activity:c.activity,friendId},effects:{needsBefore:before,needsAfter:{...c.needs},patienceBefore,patienceAfter:c.traits.patience,reason:c.activity==='garden'?'Patient gardening practice':'No trait change'},correlationId:requestId});
    }
  }
  w.receipts.push(requestId); validateWorld(w); return w;
}
