# Hatcher client plugin

Lets your agent publish and update private, shareable HTML pages on your self-hosted
[Hatcher](https://github.com/DanielHou315/Hatcher) server. It contains:

- **`hatcher` MCP server** (`mcp/`): a local, stdio MCP server that calls Hatcher's REST API with your
  API key. It can upload a page straight from a folder on your machine and download one to edit,
  so whole pages do not have to pass through the conversation.
- **`hatcher` skill** (`skills/hatcher/`): when to use Hatcher and how to work with pages (read
  before changing, versions, what pages may load, errors).

Needs Node.js 20 or later and Hatcher 0.3 or later.

## Setup

1. On your Hatcher site, open **Account → API keys** and create a key: **read and write** to publish,
   **read** to only look.
2. Make two environment variables available where your agent starts (your shell profile, direnv, or
   the agent's own settings):

   ```sh
   export HATCHER_URL=https://hatcher.example.com
   export HATCHER_API_KEY=hk_...
   ```

3. Install the plugin (below) and restart the agent. Ask it to "call the hatcher guide tool": the
   first line says which site and account it is connected as.

## Installation

### Claude Code

```sh
claude plugin marketplace add DanielHou315/hatcher-client-plugin
claude plugin install hatcher@hatcher
```

### Codex

```sh
codex plugin marketplace add DanielHou315/hatcher-client-plugin
codex plugin add hatcher@hatcher
```

### Cursor

Add this repository in Cursor's plugin settings; it reads `.cursor-plugin/plugin.json`.

### pi and opencode

```sh
pi install git:github.com/DanielHou315/hatcher-client-plugin        # the skill only: pi has no MCP
opencode plugin -g github:DanielHou315/hatcher-client-plugin
```

### The MCP server outside Claude Code

The plugin's MCP config points at the server with `${CLAUDE_PLUGIN_ROOT}`, which Claude Code and the
opencode adapter fill in. If the `hatcher` tools do not appear in another agent, clone this
repository and register the server yourself, for example:

```sh
codex mcp add hatcher --env HATCHER_URL=https://hatcher.example.com --env HATCHER_API_KEY=hk_... \
  -- node /path/to/hatcher-client-plugin/mcp/dist/hatcher-mcp.mjs
```

or in a client's JSON config:

```json
{ "mcpServers": { "hatcher": {
    "command": "node",
    "args": ["/path/to/hatcher-client-plugin/mcp/dist/hatcher-mcp.mjs"],
    "env": { "HATCHER_URL": "https://hatcher.example.com", "HATCHER_API_KEY": "hk_..." } } } }
```

`mcp/dist/hatcher-mcp.mjs` is one bundled file; it needs no `npm install`.

## Tools

| Tool | Does |
|---|---|
| `guide` | Who you are connected as, what the key may do, allowed CDN hosts, limits, page format |
| `list_pages` | Pages you own or that are shared with you |
| `get_page` | Details, files and `index.html` of a page (or of one version) |
| `read_file` | One file, as text or base64 |
| `list_versions` | Version history |
| `download_page` | Write a page's files into a local folder |
| `create_page` | New page from a local `folder` and/or `files` (`text`, `base64`, or `from` a local path) |
| `update_page` | New version: changed files and deletions, or make the page match a local `folder`; also title and description |
| `restore_version` | Copy an earlier version forward as a new one |

Local paths must be absolute (or start with `~/`). Sharing and deleting stay in Hatcher's web UI.

## Development

```sh
cd mcp
npm install
npm run check && npm test
npm run build      # rebuilds dist/hatcher-mcp.mjs: commit it with the source
```

Then, from the repository root (see [`docs/develop_plugin.md`](docs/develop_plugin.md)):

```sh
scripts/gen_catalog.sh               # after editing a plugin.json
scripts/validate_plugin.sh --strict
```

Try it in Claude Code without installing: `claude --plugin-dir .`

---

Built with [multi-harness-plugin-template](https://github.com/DanielHou315/multi-harness-plugin-template).
