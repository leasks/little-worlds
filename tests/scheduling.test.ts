import { describe,it,expect } from 'vitest';
import { cronApi } from '../src/server/cron-api';
import { tickWorker } from '../src/scheduling/worker';
import { runtimePoolConfig,assertRestrictedRole } from '../src/server/runtime-pool';
import type { SchedulerRepository } from '../src/repositories/scheduler';
const config={secret:'test-secret-'.repeat(4),worldId:'00000000-0000-4000-8000-000000000001',maxSteps:96};
describe('stateless scheduler boundaries',()=>{
 it('fails closed before database access for missing/wrong credentials or missing config',async()=>{
  const noDb=()=>{throw Error('Database must not be touched');};
  expect((await cronApi(new Request('http://test/api/cron/tick'),'tick',noDb,{})).status).toBe(503);
  expect((await cronApi(new Request('http://test/api/cron/tick'),'tick',noDb,config)).status).toBe(401);
  expect((await cronApi(new Request('http://test/api/cron/tick',{headers:{cookie:'lw_operator=anything',Authorization:'Bearer wrong'}}),'tick',noDb,config)).status).toBe(401);
 });
 it('pins the world and real timestamp; refuses timestamps, world overrides and query parameters',async()=>{
  const calls:unknown[][]=[];const repo={scheduledTick:async(...args:unknown[])=>{calls.push(args);return {status:'not_due'};}} as unknown as SchedulerRepository;
  const req=(data:unknown)=>new Request('http://test/api/cron/tick',{method:'POST',headers:{Authorization:`Bearer ${config.secret}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
  expect((await cronApi(req({request_id:'one',now:1}),'tick',()=>repo,config,123)).status).toBe(400);
  expect((await cronApi(req({request_id:'one',world_id:'other'}),'tick',()=>repo,config,123)).status).toBe(400);
  expect((await cronApi(req({request_id:'one'}),'tick',()=>repo,config,123)).status).toBe(200);expect(calls).toEqual([[config.worldId,'one',123,96]]);
  expect((await cronApi(new Request('http://test/api/cron/tick?world=other',{headers:{Authorization:`Bearer ${config.secret}`}}),'tick',()=>repo,config)).status).toBe(400);
 });
 it('never includes provider or DB exception details in failure responses',async()=>{
  const repo={scheduledTick:async()=>{throw Error('sensitive URL and credentials');}} as unknown as SchedulerRepository;
  const response=await cronApi(new Request('http://test/api/cron/tick',{headers:{Authorization:`Bearer ${config.secret}`}}),'tick',()=>repo,config);expect(response.status).toBe(503);expect(await response.text()).not.toContain('sensitive');
 });
 it('retries worker timeouts/errors with the same ID and no redirects',async()=>{
  const bodies:string[]=[],delays:number[]=[];let count=0;
  const result=await tickWorker({baseUrl:'https://village.example',secret:config.secret,requestId:'stable',sleep:async ms=>{delays.push(ms);},transport:async(_url,options)=>{bodies.push(options?.body as string);expect(options?.redirect).toBe('error');expect(options?.signal).toBeInstanceOf(AbortSignal);if(++count===1)throw Error('network');if(count===2)return new Response('',{status:503,headers:{'Retry-After':'invalid-date'}});return Response.json({ok:true,result:{status:'advanced',steps:1}});}});
  expect(result.steps).toBe(1);expect(new Set(bodies).size).toBe(1);expect(delays).toEqual([250,500]);
 });
 it('bounds worker attempts and honors a long Retry-After without sleeping or losing the key',async()=>{
  let calls=0;await expect(tickWorker({baseUrl:'https://village.example',secret:config.secret,requestId:'same',sleep:async()=>{},transport:async()=>{calls++;return new Response('',{status:503});}})).rejects.toThrow('WORKER_UNCONFIRMED_RETRY_SAME_ID');expect(calls).toBe(3);
  await expect(tickWorker({baseUrl:'https://village.example',secret:config.secret,requestId:'same',sleep:async()=>{throw Error('must not shorten Retry-After');},transport:async()=>new Response('',{status:429,headers:{'Retry-After':'60'}})})).rejects.toThrow('WORKER_DEFERRED');
  await expect(tickWorker({baseUrl:'http://public.example',secret:config.secret,requestId:'same'})).rejects.toThrow('HTTPS_REQUIRED');
 });
});
describe('verified database transport and role contract',()=>{
 it('enforces remote TLS even for a require-style connection string and rejects disabled TLS',()=>{
  const cfg=runtimePoolConfig('postgresql://app:placeholder@db.example/village?sslmode=require');expect(cfg.ssl).toEqual({rejectUnauthorized:true});expect(cfg.connectionString).not.toContain('sslmode');expect(cfg.options).toBeUndefined();
  expect(()=>runtimePoolConfig('postgresql://app:placeholder@db.example/village?sslmode=disable')).toThrow('TLS_REQUIRED');
  expect(runtimePoolConfig('postgresql://app:placeholder@localhost/village').options).toBe('-c role=little_worlds_runtime');
 });
 it('denies superuser, owner, nonmember or privileged session roles',()=>{
  const safe={current_safe:true,session_safe:true,member:true,owns_tables:false};expect(()=>assertRestrictedRole(safe,true)).not.toThrow();
  for(const change of [{current_safe:false},{session_safe:false},{member:false},{owns_tables:true}])expect(()=>assertRestrictedRole({...safe,...change},true)).toThrow('ROLE_REJECTED');
 });
});
