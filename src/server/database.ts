import { Pool } from 'pg';
import { OperatorRepository } from '../repositories/operator';
let repository:OperatorRepository|undefined;
export function getCaretakerRepository(){
 if(!process.env.DATABASE_URL)throw Error('Database is not configured');
 if(!repository){const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,options:'-c role=little_worlds_runtime',connectionTimeoutMillis:5000});pool.on('error',()=>{/* Checked-out failures propagate; never log credential-bearing errors. */});repository=new OperatorRepository(pool);}
 return repository;
}
