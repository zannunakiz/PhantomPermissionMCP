/**
 * Step 40 + Step 48 — stdio entrypoint. Boots the NestJS application context
 * (same providers REST uses) and connects the MCP server over stdio.
 *
 * Step 48 contract: stdout is reserved for MCP protocol frames only —
 * Nest logger is disabled and all diagnostics go to stderr. Local trust:
 * any OS user that can launch this process can speak to the pipe, so every
 * protected tool still requires an `apiKey` argument (tenant+scope mapping,
 * identical to REST). Run one invocation per tenant operator; do not share
 * the process across tenants. Run: `npm run mcp:serve`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { McpService } from '../src/mcp/mcp.service';

async function main(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  // Diagnostics to stderr only — never touch stdout (protocol channel).
  console.error('[mcp-stdio] serving over stdio');
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.error(`[mcp-stdio] received ${signal}, shutting down`);
    try {
      await ctx.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  try {
    // serveStdio() resolves once the transport is connected; the context
    // must stay alive so stdin/stdout framing keeps working until a signal.
    await ctx.get(McpService).serveStdio();
  } catch (err) {
    console.error('[mcp-stdio] failed to start', err);
    await ctx.close();
    process.exit(1);
  }
  // Keep the event loop alive for the stdio transport; stdin listener holds
  // it open, this just guards against an early empty-tick exit.
  process.stdin.resume();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
