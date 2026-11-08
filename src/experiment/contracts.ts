import { z } from 'zod';
import type { World } from '../engine';
import type { Quest } from '../narrative/engine';
import type { ActorState } from '../caretaker/commands';
export const experimentConfigSchema=z.strictObject({
 schemaVersion:z.literal(1).default(1),policy:z.literal('caretaker-v1').default('caretaker-v1'),
 seed:z.number().int().min(1).max(4294967295).default(42),days:z.number().int().min(1).max(30).default(30),
 narrator:z.enum(['mocked','disabled']).default('mocked'),
 usdPerMillionMockTokens:z.number().finite().min(0).max(100000).nullable().default(null),
});
export type ExperimentConfig=z.infer<typeof experimentConfigSchema>;
export interface DayState {world:World;quest:Quest|null;caretaker:ActorState;}
export interface RecordedInput {sequence:number;day:number;label:string;kind:'tick'|'action'|'narrator'|'proposal'|'review';input:unknown;outcome:unknown;status:'pending'|'completed'|'failed';}
export interface ProposalRecord {id:string;actor_id:string;request_id:string;input:unknown;status:string;code:string|null;applied_virtual_time:number|null;}
export interface UsageRecord {workflow_id:string;attempt:number;model:string;status:string;reserved_tokens:number;actual_tokens:number|null;error_code:string|null;}
export interface ExperimentData {
 worldId:string;config:ExperimentConfig;sourceHash:string;status:string;failureCode:string|null;completedDays:number;
 initial:DayState;final:DayState;days:{day:number;snapshot:DayState}[];inputs:RecordedInput[];journal:World['journal'];proposals:ProposalRecord[];usage:UsageRecord[];
}
export function assertLocalExperimentDatabase(value:string|undefined){
 if(!value)throw Error('EXPERIMENT_DATABASE_REQUIRED');const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('EXPERIMENT_LOCAL_DATABASE_REQUIRED');return value;
}
