import { randomUUID } from 'node:crypto';
async function main(){
 const base=new URL(process.env.VILLAGE_URL??'http://127.0.0.1:3000');
 if(base.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Use HTTPS outside loopback');
 const token=process.env.CARETAKER_API_KEY,world=process.env.WORLD_ID;
 if(!token||!world)throw Error('Set CARETAKER_API_KEY and WORLD_ID securely');
 const path=`/api/worlds/${encodeURIComponent(world)}`;
 async function request(suffix:string,command?:unknown){
  const response=await fetch(new URL(path+suffix,base),{method:command?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(command?{'Content-Type':'application/json'}:{})},body:command?JSON.stringify(command):undefined,signal:AbortSignal.timeout(10000),redirect:'error'});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(`Caretaker request failed: ${response.status} ${result.code??'UNKNOWN'}`);return result.result;
 }
 const observed=await request('');console.log('Observed village:',observed.name);
 // Preserve this key across retries after timeouts. Set ACTION_KEY when retrying.
 const key=process.env.ACTION_KEY??randomUUID();console.log('Action retry key:',key);
 const command={action:'feed_creature',actor_id:process.env.CARETAKER_ACTOR_ID??'local-caretaker',target_id:'pip',parameters:{food_id:'berries',quantity:1},idempotency_key:key};
 const result=await request('/actions',command);console.log('Feed result:',result);
 const after=await request('/creatures');console.log('Pip after action:',after.creatures.find((c:{id:string})=>c.id==='pip'));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Client failed');process.exitCode=1;});
