import {operatorApi} from '../../../../src/server/operator-api';
import {getCaretakerRepository} from '../../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){return operatorApi(req,'login',getCaretakerRepository);}
export async function DELETE(req:Request){return operatorApi(req,'logout',getCaretakerRepository);}
