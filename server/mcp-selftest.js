// Starts mcp.js over stdio like Claude Code does, lists the tools and calls hub_project.
//   node server/mcp-selftest.js [project]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { HUB_DIR } from './util.js';

const client = new Client({ name: 'videohub-selftest', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HUB_DIR, 'server', 'mcp.js')], env: { ...process.env } }));   // env: keeps VIDEOHUB_PORT (test hubs)
const { tools } = await client.listTools();
console.log('tools:', tools.map(t => t.name).join(', '));
const proj = process.argv[2];
if (proj) {
  const r = await client.callTool({ name: 'hub_project', arguments: { project: proj } });
  console.log(r.content.map(c => c.text).join('\n'));
}
await client.close();
