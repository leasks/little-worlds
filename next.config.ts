import type { NextConfig } from 'next';
const config:NextConfig={outputFileTracingIncludes:{"/*":["./certs/supabase-ca.crt"]},async headers(){return [{source:'/:path*',headers:[{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'same-origin'},{key:'Content-Security-Policy',value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"}]}];}};
export default config;
