export interface WorkerOptions {baseUrl:string;secret:string;requestId:string;transport?:typeof fetch;sleep?:(ms:number)=>Promise<void>;}
export async function tickWorker({baseUrl,secret,requestId,transport=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}:WorkerOptions){
 const base=new URL(baseUrl);
 if(base.username||base.password||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw Error('WORKER_HTTPS_REQUIRED');
 if(secret.length<32||secret.length>256||!requestId||requestId.length>100)throw Error('WORKER_CONFIGURATION_INVALID');
 for(let attempt=0;attempt<3;attempt++){
  let delay=250*2**attempt;
  try{
   const response=await transport(new URL('/api/cron/tick',base),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId}),signal:AbortSignal.timeout(30000),redirect:'error'});
   if(response.ok){const data=await response.json();if(data.ok&&data.result)return data.result as {requestId:string;status:string;steps:number;backlogSteps:number;duplicate:boolean};throw Error('WORKER_INVALID_RESPONSE');}
   const retry=response.headers.get('retry-after');const seconds=retry?Number(retry):0;const wait=Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry!)-Date.now());if(Number.isFinite(wait))delay=Math.max(delay,wait);
   await response.body?.cancel();
   if(![429,500,502,503,504].includes(response.status))throw Error('WORKER_REJECTED');
   if(delay>5000)throw Error('WORKER_DEFERRED');
  }catch(error){if(error instanceof Error&&['WORKER_REJECTED','WORKER_DEFERRED','WORKER_INVALID_RESPONSE'].includes(error.message))throw error;}
  if(attempt<2)await sleep(delay);
 }
 throw Error('WORKER_UNCONFIRMED_RETRY_SAME_ID');
}
