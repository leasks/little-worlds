import { z } from 'zod';
import { ApiError,commandSchema } from '../caretaker/commands';
import type { CaretakerRepository } from '../repositories/caretaker';
const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,...(status===429?{'Retry-After':'60'}:{})}});
export async function body(req:Request){
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError('UNSUPPORTED_MEDIA_TYPE',415,'Use application/json');
 if(Number(req.headers.get('content-length'))>8192)throw new ApiError('BODY_TOO_LARGE',413,'Maximum body size is 8192 bytes');
 const reader=req.body?.getReader();if(!reader)throw new ApiError('INVALID_BODY',400,'JSON body required');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new ApiError('BODY_TOO_LARGE',413,'Maximum body size is 8192 bytes');}chunks.push(value);}}
 finally{reader.releaseLock();}
 try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError('INVALID_BODY',400,'Malformed JSON');}
}
export async function caretakerApi(req:Request,worldId:string,kind:'world'|'creatures'|'actions',getRepository:()=>CaretakerRepository){
 try{
  const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.get('authorization')??'');
  if(!match)throw new ApiError('UNAUTHORIZED',401,'Valid bearer credential required');
  if(!z.uuid().safeParse(worldId).success)throw new ApiError('INVALID_WORLD',400,'World ID must be a UUID');
  const repo=getRepository();const principal=await repo.authenticate(match[1]!,worldId);
  if(kind==='actions'){const command=commandSchema.safeParse(await body(req));if(!command.success)throw new ApiError('INVALID_COMMAND',400,'Command does not match the documented schema');return json({ok:true,result:await repo.act(principal,command.data)});}
  const state=await repo.observe(principal);return json({ok:true,result:kind==='creatures'?{creatures:state.creatures}:state});
 }catch(error){
  if(error instanceof ApiError)return json({ok:false,code:error.code,message:error.message},error.status);
  // Never echo database errors, connection strings, tokens or submitted content.
  return json({ok:false,code:'SERVICE_UNAVAILABLE',message:'Village service is temporarily unavailable'},503);
 }
}
