import { cronApi } from '../../../../src/server/cron-api';
import { getCaretakerRepository } from '../../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){return cronApi(req,'health',getCaretakerRepository);}
