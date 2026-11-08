import { Pool } from 'pg';
import { z } from 'zod';
import { settingsSchema } from '../src/narrative/engine';
async function main(){
 const url=process.env.DATABASE_URL;if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Settings tool requires a local database');
 const id=z.uuid().parse(process.env.WORLD_ID),p=new Pool({connectionString:url});
 try{
  const row=await p.query('SELECT settings FROM little_worlds.narrative_settings WHERE world_id=$1',[id]);if(!row.rowCount)throw Error('World not found');
  const settings=settingsSchema.parse(row.rows[0].settings);
  const numbers={NARRATOR_MIN_GAP_HOURS:'minGap',NARRATOR_RARE_GAP_HOURS:'rareMinGap',NARRATOR_EARLIEST_DISCOVERY_DAY:'earliestDiscovery',NARRATOR_MAX_EVENTS_PER_DAY:'maxPerDay',NARRATOR_DAILY_REQUEST_LIMIT:'dailyRequests',NARRATOR_DAILY_TOKEN_LIMIT:'dailyTokens'} as const;
  for(const [name,field] of Object.entries(numbers)){const value=process.env[name];if(value===undefined||value==='')continue;const factor=field==='earliestDiscovery'?86400000:field==='minGap'||field==='rareMinGap'?3600000:1;settings[field]=Number(value)*factor;}
  if(process.env.NARRATOR_MANUAL_APPROVAL){settings.manualApproval=z.enum(['true','false']).parse(process.env.NARRATOR_MANUAL_APPROVAL)==='true';}
  await p.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[id,JSON.stringify(settingsSchema.parse(settings))]);console.log('Narrative settings validated and saved for this local world');
 }finally{await p.end();}
}
main().catch(()=>{console.error('Settings update failed; check local database, WORLD_ID and documented bounded settings.');process.exitCode=1;});
