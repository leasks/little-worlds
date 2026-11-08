import { Pool,type PoolConfig,type PoolClient } from 'pg';
export interface RoleCheck {current_safe:boolean;session_safe:boolean;member:boolean;owns_tables:boolean;}
export function assertRestrictedRole(row:RoleCheck,requireRestrictedSession:boolean){
 if(!row.current_safe||!row.member||row.owns_tables||(requireRestrictedSession&&!row.session_safe))throw Error('DATABASE_ROLE_REJECTED');
}
export function transportConfig(connectionString:string):PoolConfig{
 const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('DATABASE_URL_INVALID');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!local){
  const mode=url.searchParams.get('sslmode');if(mode&&!['require','verify-ca','verify-full'].includes(mode))throw Error('DATABASE_TLS_REQUIRED');
  for(const key of url.searchParams.keys())if(key.startsWith('ssl')&&key!=='sslmode')throw Error('DATABASE_TLS_USE_SYSTEM_TRUST');
  // Prevent connection-string parsing from overriding strict TLS options.
  url.searchParams.delete('sslmode');
 }
 return {connectionString:url.toString(),...(!local?{ssl:{rejectUnauthorized:true}}:{})};
}
export function runtimePoolConfig(connectionString:string,requireRestrictedSession=false):PoolConfig{
 const config=transportConfig(connectionString),local=['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname);
 return {...config,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,...(local?{options:'-c role=little_worlds_runtime'}:{}),
  verify(client:PoolClient,done:(error?:Error)=>void){
   void client.query(`SELECT
    NOT(c.rolsuper OR c.rolbypassrls OR c.rolcreaterole OR c.rolcreatedb) AS current_safe,
    NOT(s.rolsuper OR s.rolbypassrls OR s.rolcreaterole OR s.rolcreatedb) AS session_safe,
    pg_has_role(current_user,'little_worlds_runtime','USAGE') AS member,
    EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='little_worlds' AND t.relowner=c.oid) AS owns_tables
    FROM pg_roles c,pg_roles s WHERE c.rolname=current_user AND s.rolname=session_user`).then(r=>{try{assertRestrictedRole(r.rows[0],!local||requireRestrictedSession);done();}catch{done(Error('DATABASE_ROLE_REJECTED'));}},()=>done(Error('DATABASE_READINESS_FAILED')));
  }};
}
export function createRuntimePool(connectionString:string,requireRestrictedSession=false){
 const pool=new Pool(runtimePoolConfig(connectionString,requireRestrictedSession));pool.on('error',()=>{/* No credential-bearing database errors in logs. */});return pool;
}
