import { cronApi } from '../../../../src/server/cron-api';
import { getCaretakerRepository } from '../../../../src/server/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:Request){return cronApi(req,'tick',getCaretakerRepository);}
export async function POST(req:Request){return cronApi(req,'tick',getCaretakerRepository);}
