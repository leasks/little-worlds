import { readFile,readdir,writeFile,mkdir } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { createHash } from 'node:crypto';
import { buildExperimentReport } from './report';
import type { ExperimentData } from './contracts';
export async function experimentSourceHash(root=process.cwd()){
 const files:string[]=[];
 async function walk(dir:string){for(const entry of await readdir(join(root,dir),{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(ts|tsx|sql)$/.test(path))files.push(path);}}
 await walk('src');await walk('supabase/migrations');files.push('scripts/experiment.ts','package-lock.json');
 const hash=createHash('sha256');for(const file of files.sort()){hash.update(relative(root,join(root,file)));hash.update('\0');hash.update(await readFile(join(root,file)));hash.update('\0');}return hash.digest('hex');
}
export async function writeExperimentArtifacts(directory:string,data:ExperimentData){
 await mkdir(directory,{recursive:false});const built=buildExperimentReport(data);
 const files:Record<string,string>={
  'report.json':JSON.stringify(built.report,null,2)+'\n','report.md':built.markdown,'chronicle.md':built.chronicle,
  'inputs.json':JSON.stringify(data.inputs,null,2)+'\n','journal.json':JSON.stringify(data.journal,null,2)+'\n',
  'daily-states.json':JSON.stringify(data.days,null,2)+'\n','semantic.json':JSON.stringify(built.semantic,null,2)+'\n',
  'manifest.json':JSON.stringify({schemaVersion:1,worldId:data.worldId,config:data.config,status:data.status,completedDays:data.completedDays,sourceHash:data.sourceHash,nodeVersion:process.version,semanticHash:built.report.semanticHash,containsCredentials:false},null,2)+'\n',
 };
 for(const [name,contents] of Object.entries(files))await writeFile(join(directory,name),contents,{flag:'wx',mode:0o600});
 await writeFile(join(directory,'SHA256SUMS'),Object.entries(files).map(([name,value])=>`${createHash('sha256').update(value).digest('hex')}  ${name}`).join('\n')+'\n',{flag:'wx',mode:0o600});
 return built;
}
