import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { ApiGatewayModule } from './api-gateway.module';

// Ensure BigInt values serialize cleanly to string in JSON responses
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

dotenv.config({ path: resolve(process.cwd(), '.env') });

function releasePortOnWindowsIfInUse(port: number) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = new Set<number>();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }
    for (const pid of pids) {
      try {
        console.log(`[ApiGateway] Releasing previous process (PID ${pid}) occupying port ${port}...`);
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        // Ignore if already exited
      }
    }
  } catch {
    // Port is free
  }
}

export async function createGatewayApp() {
  const app = await NestFactory.create(ApiGatewayModule, { logger: ['error', 'warn', 'log'] });
  app.use(helmet());
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Correlation-Id, Idempotency-Key, X-Internal-Service-Token',
  });

  try {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Hospital Operating Software (HOS) — Enterprise API Gateway')
      .setDescription('500+ Bed Multispecialty Hospital Operating Software REST & Event-Driven APIs')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  } catch {
    // Fallback when running under esbuild/vitest without design:paramtypes reflection
  }

  return app;
}

async function bootstrap() {
  const port = Number(process.env.API_GATEWAY_PORT || 4000);
  releasePortOnWindowsIfInUse(port);
  const app = await createGatewayApp();
  await app.listen(port);
  console.log(`[ApiGateway] Listening on http://localhost:${port} (Swagger: http://localhost:${port}/api/docs)`);
}

if (!process.env.VITEST) {
  bootstrap();
}
