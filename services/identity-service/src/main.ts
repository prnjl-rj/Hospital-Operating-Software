import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { IdentityModule } from './identity.module';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  const app = await NestFactory.create(IdentityModule);
  app.use(helmet());
  app.enableCors();
  const port = Number(process.env.IDENTITY_SERVICE_PORT || 4001);
  await app.listen(port);
  console.log(`[IdentityService] Listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap();
}

