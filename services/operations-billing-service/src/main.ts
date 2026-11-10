import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { OperationsBillingModule } from './operations-billing.module';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  const app = await NestFactory.create(OperationsBillingModule);
  app.use(helmet());
  app.enableCors();
  const port = Number(process.env.OPERATIONS_BILLING_SERVICE_PORT || 4005);
  await app.listen(port);
  console.log(`[OperationsBillingService] Listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap();
}

