async function main(){
 const base=process.env.VILLAGE_URL,secret=process.env.CRON_SECRET;if(!base||!secret||secret.length<32||secret.length>256)throw Error('HEALTH_CONFIGURATION_REQUIRED');
 const url=new URL(base);if(url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('HEALTH_HTTPS_REQUIRED');
 const response=await fetch(new URL('/api/cron/health',url),{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10000),redirect:'error'});const data=await response.json();
 // Only output the endpoint's documented small health projection.
 if(data.result){const {status,tick,backlogSteps,lastRun}=data.result;console.log(JSON.stringify({ok:response.ok,status,tick,backlogSteps,lastRun}));}else console.log(JSON.stringify({ok:false,code:'HEALTH_UNAVAILABLE'}));
 if(!response.ok)process.exitCode=1;
}
main().catch(()=>{console.error(JSON.stringify({ok:false,code:'HEALTH_UNAVAILABLE'}));process.exitCode=1;});
