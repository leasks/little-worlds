import { spawnSync } from 'node:child_process';
const url=process.env.TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Browser tests require TEST_DATABASE_URL for a migrated disposable local DB');
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],{stdio:'inherit',env:process.env});process.exit(result.status??1);
