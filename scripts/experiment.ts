import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir,access,writeFile,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { Pool } from 'pg';
import { createRuntimePool } from '../src/server/runtime-pool';
import { ExperimentRepository } from '../src/repositories/experiment';
import { runExperiment,ExperimentFailure } from '../src/experiment/runner';
import { assertLocalExperimentDatabase,experimentConfigSchema } from '../src/experiment/contracts';
import { experimentSourceHash,writeExperimentArtifacts } from '../src/experiment/artifacts';
async function main(){
 const {values}=parseArgs({options:{seed:{type:'string'},days:{type:'string'},narrator:{type:'string'},output:{type:'string'},verify:{type:'boolean'},'publish-sample':{type:'boolean'},'usd-per-million-mock-tokens':{type:'string'},export:{type:'string'}}});
 if(values.export&&(values.verify||values['publish-sample']||values.seed||values.days||values.narrator||values['usd-per-million-mock-tokens']))throw Error('EXPERIMENT_EXPORT_OPTIONS_INVALID');
 const url=assertLocalExperimentDatabase(process.env.EXPERIMENT_DATABASE_URL??process.env.TEST_DATABASE_URL);
 const config=experimentConfigSchema.parse({seed:values.seed===undefined?42:Number(values.seed),days:values.days===undefined?30:Number(values.days),narrator:values.narrator??'mocked',usdPerMillionMockTokens:values['usd-per-million-mock-tokens']===undefined?null:Number(values['usd-per-million-mock-tokens'])});
 const output=resolve(values.output??join('.local','experiments',randomUUID()));
 try{await access(output);throw Error('EXPERIMENT_OUTPUT_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(values['publish-sample']&&(!values.verify||config.days!==30||config.narrator!=='mocked'||values.export))throw Error('EXPERIMENT_SAMPLE_REQUIRES_VERIFIED_30_DAYS');
 const sample=resolve('docs/experiment');if(values['publish-sample']){try{await access(sample);throw Error('EXPERIMENT_SAMPLE_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 await mkdir(output,{recursive:true,mode:0o700});
 const owner=new Pool({connectionString:url,max:2}),runtime=createRuntimePool(url);const admin=new ExperimentRepository(owner),repo=new ExperimentRepository(runtime);
 try{
  if(values.export){const data=await repo.experimentData(values.export);const built=await writeExperimentArtifacts(join(output,'export'),data);console.log(JSON.stringify({worldId:data.worldId,output,status:built.report.status,semanticHash:built.report.semanticHash}));if(!built.report.validation.passed)process.exitCode=1;return;}
  const sourceHash=await experimentSourceHash();const runs=[];
  for(let n=0;n<(values.verify?2:1);n++){
   const result=await runExperiment(admin,repo,config,sourceHash,day=>{if(day%5===0||day===config.days)console.log(JSON.stringify({run:n+1,completedDay:day,totalDays:config.days}));});
   const data=await repo.experimentData(result.worldId);const built=await writeExperimentArtifacts(join(output,`run-${n+1}`),data);runs.push({worldId:result.worldId,semanticHash:built.report.semanticHash});
  }
  const verified=values.verify?runs[0]!.semanticHash===runs[1]!.semanticHash:null;
  const evidence={schemaVersion:1,sourceHash,config,runs,verified,output,liveApiCalls:0};await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  if(verified===false)throw Error('EXPERIMENT_REPRODUCIBILITY_MISMATCH');
  if(values['publish-sample']){
   await mkdir(sample,{recursive:false});for(const file of ['report.json','report.md','chronicle.md'])await writeFile(join(sample,file),await readFile(join(output,'run-1',file)),{flag:'wx'});
   await writeFile(join(sample,'verification.json'),JSON.stringify({schemaVersion:1,sourceHash,config,verified:true,semanticHashes:runs.map(r=>r.semanticHash),liveApiCalls:0},null,2)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify(evidence));
 }finally{await owner.end();await runtime.end();}
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:error instanceof Error&&/^EXPERIMENT_[A-Z_]+$/.test(error.message)?error.message:'EXPERIMENT_FAILED',...(error instanceof ExperimentFailure?{worldId:error.worldId}:{})}));process.exitCode=1;});
