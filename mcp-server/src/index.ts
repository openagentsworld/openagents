#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { OpenAgentsClient } from './client.js';
import { loadConfig } from './config.js';
import { redactSensitiveText } from './errors.js';
import { buildMcpServer } from './tools.js';

const clients = new Set<OpenAgentsClient>();

const handle = serveStdio(() => {
  const client = new OpenAgentsClient(loadConfig());
  clients.add(client);
  return buildMcpServer(client);
}, {
  legacy: 'serve',
  onerror: (error) => console.error(
    `[openagents-mcp] ${redactSensitiveText(error, [...clients].flatMap((client) => client.secrets))}`
  )
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await Promise.allSettled([...clients].map((client) => client.close()));
  await handle.close();
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

console.error('[openagents-mcp] stdio server ready');
