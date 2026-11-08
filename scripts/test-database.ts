import { spawnSync } from 'node:child_process';
if(!process.env.TEST_DATABASE_URL)throw Error('Set TEST_DATABASE_URL to a migrated, disposable local PostgreSQL database');
const result=spawnSync('node',['node_modules/vitest/vitest.mjs','run','tests/database.integration.test.ts','tests/caretaker.integration.test.ts','tests/narrator.integration.test.ts','tests/operator.integration.test.ts','tests/scheduler.integration.test.ts','tests/experiment.integration.test.ts'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
