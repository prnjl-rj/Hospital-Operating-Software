import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { ClinicalEmrModule } from './clinical-emr.module';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  const app = await NestFactory.create(ClinicalEmrModule);
  app.use(helmet());
  app.enableCors();
  const port = Number(process.env.CLINICAL_EMR_SERVICE_PORT || 4003);
  await app.listen(port);
  console.log(`[ClinicalEmrService] Listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap();
}

