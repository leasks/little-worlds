import {operatorApi} from '../../../src/server/operator-api';
import {getCaretakerRepository} from '../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){return operatorApi(req,'snapshot',getCaretakerRepository);}
