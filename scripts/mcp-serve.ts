/**
 * Step 40 — stdio entrypoint. Boots the NestJS application context (same
 * providers REST uses) and connects the MCP server over stdio.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { McpService } from '../src/mcp/mcp.service';

async function main(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    await ctx.get(McpService).serveStdio();
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
