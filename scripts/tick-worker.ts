import { randomUUID } from 'node:crypto';
import { tickWorker } from '../src/scheduling/worker';
async function main(){
 const baseUrl=process.env.VILLAGE_URL,secret=process.env.CRON_SECRET;if(!baseUrl||!secret)throw Error('WORKER_CONFIGURATION_INVALID');
 const requestId=process.env.TICK_REQUEST_ID??randomUUID();console.log(JSON.stringify({requestId}));
 console.log(JSON.stringify(await tickWorker({baseUrl,secret,requestId})));
}
main().catch(error=>{const code=error instanceof Error&&/^WORKER_[A-Z_]+$/.test(error.message)?error.message:'WORKER_FAILED';console.error(JSON.stringify({ok:false,code}));process.exitCode=1;});
