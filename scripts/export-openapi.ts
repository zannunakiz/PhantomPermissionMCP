/**
 * Step 38 — export the generated OpenAPI JSON without booting a server
 * or touching a database. Run: `npm run docs:openapi`.
 */
import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { setupSwagger } from '../src/docs/swagger';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  setupSwagger(app, join(__dirname, '..', 'docs', 'openapi.json'));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
