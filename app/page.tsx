import { cookies } from 'next/headers';
import { getCaretakerRepository } from '../src/server/database';
import { sessionCookie } from '../src/server/operator-api';
import { Login } from '../src/components/Login';
import { Dashboard } from '../src/components/Dashboard';
export const dynamic='force-dynamic';
export default async function Page(){
 const token=(await cookies()).get(sessionCookie)?.value;
 if(token){try{await getCaretakerRepository().session(token);return <Dashboard/>;}catch{/* No private state is rendered for an invalid or unavailable session. */}}
 return <Login/>;
}
