import { createRuntimePool } from './runtime-pool';
import { SchedulerRepository } from '../repositories/scheduler';
let repository:SchedulerRepository|undefined;
export function getCaretakerRepository(){
 if(!process.env.DATABASE_URL)throw Error('Database is not configured');
 if(!repository)repository=new SchedulerRepository(createRuntimePool(process.env.DATABASE_URL));
 return repository;
}
