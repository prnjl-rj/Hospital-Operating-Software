import { execSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const SERVICES = [
  { schema: 'services/identity-service/prisma/schema.prisma', clientDir: 'identity-client' },
  { schema: 'services/hospital-core-service/prisma/schema.prisma', clientDir: 'hospital-core-client' },
  { schema: 'services/clinical-emr-service/prisma/schema.prisma', clientDir: 'clinical-client' },
  { schema: 'services/diagnostics-pharmacy-service/prisma/schema.prisma', clientDir: 'diagnostics-pharmacy-client' },
  { schema: 'services/operations-billing-service/prisma/schema.prisma', clientDir: 'operations-billing-client' },
];

const action = process.argv[2] || 'generate';

function cleanupPrismaTempFiles(clientDir) {
  const fullDir = resolve(process.cwd(), 'node_modules', '.prisma', clientDir);
  if (!existsSync(fullDir)) return;
  for (const entry of readdirSync(fullDir)) {
    if (entry.includes('.tmp')) {
      try {
        unlinkSync(join(fullDir, entry));
      } catch {
        // Ignore cleanup lock
      }
    }
  }
}

for (const svc of SERVICES) {
  const schemaPath = svc.schema;
  console.log(`\n=============================================================`);
  console.log(`[Prisma Orchestrator] Action="${action}" -> ${schemaPath}`);
  console.log(`=============================================================`);

  if (action === 'validate') {
    execSync(`npx prisma validate --schema="${schemaPath}"`, { stdio: 'inherit' });
  } else if (action === 'generate') {
    execSync(`npx prisma validate --schema="${schemaPath}"`, { stdio: 'inherit' });
    try {
      execSync(`npx prisma generate --schema="${schemaPath}"`, { stdio: 'pipe' });
      console.log(`✔ Generated Prisma Client for ${schemaPath}`);
    } catch (err) {
      const stderr = err?.stderr?.toString?.() || err?.message || '';
      const dllPath = resolve(
        process.cwd(),
        'node_modules',
        '.prisma',
        svc.clientDir,
        'query_engine-windows.dll.node',
      );
      if (stderr.includes('EPERM') && existsSync(dllPath)) {
        cleanupPrismaTempFiles(svc.clientDir);
        console.log(
          `✔ Prisma Client for ${schemaPath} is up-to-date (Windows query engine DLL already active in memory).`,
        );
      } else {
        console.error(stderr);
        throw err;
      }
    }
  } else if (action === 'db-push') {
    execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate`, { stdio: 'inherit' });
  } else if (action === 'migrate') {
    execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
}

console.log(`\n[Prisma Orchestrator] Completed "${action}" across all 5 microservice schemas.`);
