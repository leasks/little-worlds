import {narratorApi} from '../../../../../src/server/narrator-api';
import {getCaretakerRepository} from '../../../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request,context:{params:Promise<{worldId:string}>}){
 const params=await context.params;return narratorApi(req,params.worldId,'submit',getCaretakerRepository);
}
export async function GET(req:Request,context:{params:Promise<{worldId:string}>}){
 const params=await context.params;return narratorApi(req,params.worldId,'inspect',getCaretakerRepository);
}
