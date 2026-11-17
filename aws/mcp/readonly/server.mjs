#!/usr/bin/env node
// readonly-aws: read-only AWS MCP server over stdio. Four tools: profile, login, logout, query.
// stdout carries the MCP protocol only; every log line goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { err } from './contract.mjs';
import { createKeychain } from './keychain.mjs';
import { createProfiles, configDir, profileTool } from './profiles.mjs';
import { execAws } from './awsexec.mjs';
import { login } from './login.mjs';
import { logoutTool } from './logout.mjs';
import { queryTool } from './query.mjs';

const log = (...a) => process.stderr.write(`[readonly-aws] ${a.join(' ')}\n`);

export const TOOLS = [profileTool, login, logoutTool, queryTool];

// ctx is the one object every tool handler gets (see contract.mjs).
export function createServer(ctx, tools = TOOLS) {
  const server = new Server({ name: 'readonly-aws', version: '0.1.0' }, { capabilities: { tools: {} } });
  const byName = new Map(tools.map((t) => [t.name, t]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const tool = byName.get(name);
    if (!tool) return err(`unknown tool "${name}"`);
    try {
      return await tool.handler(args, ctx);
    } catch (e) {
      return err(e?.message ?? 'tool failed');
    }
  });
  return server;
}

export async function main() {
  const keychain = createKeychain();
  const ctx = { profiles: createProfiles({ dir: configDir(), keychain }), keychain, exec: execAws, env: process.env };
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  log('ready');
  const shutdown = () => process.exit(0);
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Run when started directly (node server.mjs). The bundle's entry (build.mjs) calls main() itself.
if (process.argv[1]?.endsWith('server.mjs')) {
  main().catch((e) => {
    log(`fatal: ${e.message}`);
    process.exit(1);
  });
}
