import type { ReactNode } from 'react';
import './globals.css';
export const metadata={title:'Little Worlds · The village',description:'A private village of little lives and growing stories.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
