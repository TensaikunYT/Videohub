// VideoHub MCP server (stdio). stdout belongs to the MCP protocol: log only to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, setClient } from './tools.js';

const server = new McpServer({ name: 'videohub', version: '0.1.0' });
const ok = text => ({ content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 1) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });

for (const [name, tool] of Object.entries(TOOLS)) {
  // extra: the request's abort signal and progress token (hub_wait stops when the agent cancels the call)
  server.registerTool(name, { description: tool.description, inputSchema: tool.schema }, async (args, extra) => {
    try { return ok(await tool.run(args ?? {}, extra)); } catch (e) { console.error(e); return fail(e); }
  });
}
// which agent is connected (its MCP client name): hub_wait's default length and the "Sent to …" label follow it
server.server.oninitialized = () => setClient(server.server.getClientVersion());
await server.connect(new StdioServerTransport());
