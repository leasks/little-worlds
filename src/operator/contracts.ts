import { z } from 'zod';
const base={request_id:z.string().min(1).max(128)};
export const controlSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('run_tick')}),
 z.strictObject({...base,action:z.literal('advance_test'),count:z.number().int().min(1).max(96)}),
 z.strictObject({...base,action:z.literal('pause')}),
 z.strictObject({...base,action:z.literal('resume')}),
 z.strictObject({...base,action:z.literal('reset_test'),confirmation:z.literal('RESET TEST VILLAGE')}),
]);
export type Control=z.infer<typeof controlSchema>;
export const journalFiltersSchema=z.strictObject({creature:z.enum(['','pip','moss','nim']).default(''),location:z.enum(['','square','cottage','garden','pond','forest']).default(''),source:z.enum(['','simulation','caretaker','narrator']).default(''),type:z.string().regex(/^[a-z_]*$/).max(80).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0)});
export interface JournalEntry {id:string;virtualTime:number;source:'simulation'|'caretaker'|'narrator';type:string;actor:string;location:string;payload:Record<string,unknown>;effects:Record<string,unknown>;}
