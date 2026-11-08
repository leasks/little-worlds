import {caretakerApi} from '../../../../../src/server/caretaker-api';
import {getCaretakerRepository} from '../../../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request,context:{params:Promise<{worldId:string}>}){
 const {worldId}=await context.params;return caretakerApi(req,worldId,'creatures',getCaretakerRepository);
}
