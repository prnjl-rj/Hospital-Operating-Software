import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { DiagnosticsPharmacyModule } from './diagnostics-pharmacy.module';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  const app = await NestFactory.create(DiagnosticsPharmacyModule);
  app.use(helmet());
  app.enableCors();
  const port = Number(process.env.DIAGNOSTICS_PHARMACY_SERVICE_PORT || 4004);
  await app.listen(port);
  console.log(`[DiagnosticsPharmacyService] Listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap();
}

