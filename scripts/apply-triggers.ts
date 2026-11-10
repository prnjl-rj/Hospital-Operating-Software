import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const sqlPath = resolve(process.cwd(), 'database/migrations/001_baseline_multi_schema_ddl.sql');

console.log('[DB Triggers] Applying PostgreSQL medico-legal & audit immutability triggers...');
execSync(
  `docker exec -i hos-postgres psql -U hos_admin -d hos_db < "${sqlPath}"`,
  { stdio: 'inherit' },
);
console.log('✔ [DB Triggers] Successfully installed/verified PL/pgSQL immutability triggers in clinical and identity schemas.');

