// hatcher-mcp: a local (stdio) MCP server for a Hatcher site. Configure with HATCHER_URL and
// HATCHER_API_KEY (a key from the site's /account page).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from './api.js';
import { createServer, SETUP_HELP } from './server.js';

const VERSION = '0.1.0';

const url = process.env.HATCHER_URL?.trim();
const key = process.env.HATCHER_API_KEY?.trim();
// Start even when unconfigured, so the agent sees how to fix it instead of a server that will not start.
if (!url || !key) console.error(`[hatcher-mcp] ${SETUP_HELP}`);
const client = url && key ? createClient({ url, key }, `hatcher-mcp/${VERSION}`) : null;

await createServer(client, VERSION).connect(new StdioServerTransport());
