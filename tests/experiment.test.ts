import { describe,it,expect } from 'vitest';
import { seedWorld,advance } from '../src/engine';
import { actorStateSchema } from '../src/caretaker/commands';
import { experimentConfigSchema,assertLocalExperimentDatabase,type ExperimentData } from '../src/experiment/contracts';
import { buildExperimentReport,escapeMarkdown } from '../src/experiment/report';
function data():ExperimentData{
 const initial=seedWorld(),advanced=advance(initial,'one',86400000/3);const state=(world:typeof initial)=>({world:{...world,journal:[],receipts:[]},quest:null,caretaker:actorStateSchema.parse({location:'cottage',inventory:{berries:12,seeds:3},crops:0})});
 return {worldId:initial.id,config:experimentConfigSchema.parse({days:1,narrator:'disabled'}),sourceHash:'a'.repeat(64),status:'completed',failureCode:null,completedDays:1,initial:state(initial),final:state(advanced),days:[{day:1,snapshot:state(advanced)}],inputs:[{sequence:1,day:1,label:'tick',kind:'tick',input:{request_id:'one'},outcome:{duplicate:false},status:'completed'}],journal:advanced.journal,proposals:[],usage:[]};
}
describe('experiment reports and isolation',()=>{
 it('requires a local test adapter and bounded non-live configuration',()=>{
  expect(()=>assertLocalExperimentDatabase('postgresql://app:placeholder@db.example/world')).toThrow('LOCAL_DATABASE_REQUIRED');
  expect(()=>experimentConfigSchema.parse({days:31})).toThrow();expect(()=>experimentConfigSchema.parse({seed:0})).toThrow();expect(()=>experimentConfigSchema.parse({narrator:'groq-live'})).toThrow();
 });
 it('requires the complete horizon and event evidence before claiming completion',()=>{
  const d=data();expect(buildExperimentReport(d).report.validation.passed).toBe(true);
  const broken=structuredClone(d);broken.journal.pop();expect(buildExperimentReport(broken).report.validation.passed).toBe(false);
  const interrupted=structuredClone(d);interrupted.status='running';expect(buildExperimentReport(interrupted).report.status).toBe('incomplete');
 });
 it('fingerprints effects, not just final counts/state, and rejects untraced history',()=>{
  const a=data(),b=structuredClone(a);b.journal[0]!.effects.reason='A different recorded explanation';expect(buildExperimentReport(a).report.semanticHash).not.toBe(buildExperimentReport(b).report.semanticHash);
  b.journal[0]!.correlationId='not-in-ledger';expect(()=>buildExperimentReport(b)).toThrow('UNTRACED_EVENT');
 });
 it('does not treat supplied mock pricing as a real vendor charge',()=>{
  const d=data();d.config.usdPerMillionMockTokens=2;d.usage=[{workflow_id:'fixture',attempt:0,model:'scripted-mock-v1',status:'ok',reserved_tokens:512,actual_tokens:96,error_code:null}];
  const report=buildExperimentReport(d).report;expect(report.costs.liveApiSpendUsd).toBe(0);expect(report.costs.hypotheticalKnownMockCostUsd).toBe(0.000192);expect(report.costs.hostingCostUsd).toBeNull();
 });
 it('escapes untrusted text before emitting Markdown chronicles',()=>{expect(escapeMarkdown('<img src=x>[click](https://bad.example)')).not.toContain('<img');expect(escapeMarkdown('[click]')).toBe('\\[click\\]');});
});
