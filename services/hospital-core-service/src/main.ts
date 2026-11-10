import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { HospitalCoreModule } from './hospital-core.module';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  const app = await NestFactory.create(HospitalCoreModule);
  app.use(helmet());
  app.enableCors();
  const port = Number(process.env.HOSPITAL_CORE_SERVICE_PORT || 4002);
  await app.listen(port);
  console.log(`[HospitalCoreService] Listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap();
}

