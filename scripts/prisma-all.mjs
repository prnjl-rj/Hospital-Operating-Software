import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const SERVICES = [
  'services/identity-service/prisma/schema.prisma',
  'services/hospital-core-service/prisma/schema.prisma',
  'services/clinical-emr-service/prisma/schema.prisma',
  'services/diagnostics-pharmacy-service/prisma/schema.prisma',
  'services/operations-billing-service/prisma/schema.prisma',
];

const action = process.argv[2] || 'generate';

for (const schemaPath of SERVICES) {
  console.log(`\n=============================================================`);
  console.log(`[Prisma Orchestrator] Action="${action}" -> ${schemaPath}`);
  console.log(`=============================================================`);

  if (action === 'validate') {
    execSync(`npx prisma validate --schema="${schemaPath}"`, { stdio: 'inherit' });
  } else if (action === 'generate') {
    execSync(`npx prisma validate --schema="${schemaPath}"`, { stdio: 'inherit' });
    execSync(`npx prisma generate --schema="${schemaPath}"`, { stdio: 'inherit' });
  } else if (action === 'db-push') {
    execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate`, { stdio: 'inherit' });
  } else if (action === 'migrate') {
    execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
}

console.log(`\n[Prisma Orchestrator] Completed "${action}" across all 5 microservice schemas.`);

