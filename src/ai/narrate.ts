import { randomUUID } from 'node:crypto';
import type { NarratorRepository } from '../repositories/narrator';
import type { Principal } from '../repositories/caretaker';
import { ApiError } from '../caretaker/commands';
import { ProviderError,type LlmProvider } from './provider';
export async function runNarrator(repo:NarratorRepository,p:Principal,provider:LlmProvider|null,workflow=randomUUID() as string,sleep:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 if(!provider)return {status:'disabled',code:'AI_NOT_CONFIGURED'};
 const context=await repo.context(p);const pacing=context.pacing;
 if(pacing.pending||pacing.eventsToday>=pacing.maxPerDay||(pacing.lastEvent!==null&&context.world.virtualTime-pacing.lastEvent<pacing.minGap))return {status:'deferred',code:'PACING_LIMIT'};
 const reserved=provider.reservation(context);
 for(let attempt=0;attempt<2;attempt++){
  let usage:string;
  try{usage=await repo.reserveAi(p,workflow,attempt,provider.model,reserved);}
  catch(error){if(error instanceof ApiError)return {status:'deferred',code:error.code};throw error;}
  let response;
  try{response=await provider.generate(context);}
  catch(error){
   const failure=error instanceof ProviderError?error:new ProviderError('PROVIDER_FAILURE');
   await repo.finishAi(p,usage,null,failure.code);
   // Do not shorten a provider's Retry-After. A later scheduled run can try again.
   if(attempt===0&&failure.retryable&&failure.retryAfterMs<=5000){await sleep(Math.max(250,failure.retryAfterMs));continue;}
   return {status:'unavailable',code:failure.code};
  }
  await repo.finishAi(p,usage,response.tokens,response.tokens>reserved?'BUDGET_ESTIMATE_EXCEEDED':null);
  if(response.tokens>reserved)return {status:'unavailable',code:'BUDGET_ESTIMATE_EXCEEDED'};
  // Structured proposal validation/audit happens even for malformed model output.
  return {status:'proposed',result:await repo.submit(p,`ai:${workflow}`,response.proposal)};
 }
 return {status:'unavailable',code:'PROVIDER_FAILURE'};
}
