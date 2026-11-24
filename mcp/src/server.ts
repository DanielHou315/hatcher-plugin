// The Hatcher MCP tools. Each one is a thin call to the site's REST API with the user's key; the
// site decides what the key may see and change.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HatcherError, type Client, type FileBody } from './api.js';
import { readFolder, readLocalFile, writeFolder } from './local.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (message: string, extra?: object): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
});

export const SETUP_HELP =
  'Hatcher is not configured. Set HATCHER_URL (the site, e.g. https://hatcher.example.com) and HATCHER_API_KEY ' +
  '(a key from the site\'s /account page) in the environment the MCP server starts in, then restart the agent.';

const pageId = z.string().max(40).describe('Page id, from list_pages or a page URL (/p/<id>)');
const version = z.number().int().min(1);
const fileInput = z
  .object({
    path: z.string().max(400).describe('Path inside the page, e.g. index.html or js/app.js'),
    text: z.string().optional().describe('UTF-8 content'),
    base64: z.string().optional().describe('Binary content, base64'),
    from: z.string().optional().describe('Absolute path of a local file to upload instead of inlining it'),
  })
  .describe('Give exactly one of text, base64 or from');

function toBody(files: z.infer<typeof fileInput>[] = []): FileBody[] {
  return files.map((f) => {
    const given = [f.text, f.base64, f.from].filter((x) => x !== undefined).length;
    if (given !== 1) throw new HatcherError(`file "${f.path}": give exactly one of text, base64 or from`);
    if (f.from !== undefined) return { path: f.path, base64: readLocalFile(f.from) };
    return f.text !== undefined ? { path: f.path, text: f.text } : { path: f.path, base64: f.base64 };
  });
}

/** Files from a local folder plus explicit files (which win on the same path). */
function gather(folder: string | undefined, files: z.infer<typeof fileInput>[] | undefined) {
  const fromFolder = folder ? readFolder(folder) : { files: [], skipped: [] };
  const explicit = toBody(files);
  const byPath = new Map(fromFolder.files.map((f) => [f.path, f]));
  for (const f of explicit) byPath.set(f.path, f);
  return { files: [...byPath.values()], skipped: fromFolder.skipped };
}

export function createServer(client: Client | null, serverVersion: string): McpServer {
  const server = new McpServer(
    { name: 'hatcher', version: serverVersion },
    {
      instructions:
        'Hatcher hosts private, shareable HTML pages (like artifacts) on the user\'s own server. Call guide before writing a page. ' +
        'Read a page with get_page before changing it and pass its version as expected_version. To work on many files, ' +
        'download_page to a local folder, edit there, and update_page with that folder.',
    },
  );

  /** Run a tool body against the API, turning errors into tool errors. */
  async function run(fn: (c: Client) => Promise<ToolResult>): Promise<ToolResult> {
    if (!client) return failure(SETUP_HELP);
    try {
      return await fn(client);
    } catch (err) {
      if (err instanceof HatcherError) return failure(err.message, err.code ? { code: err.code } : undefined);
      return failure((err as Error).message);
    }
  }

  server.registerTool(
    'guide',
    {
      title: 'Hatcher guide',
      description: 'Who you are connected as, what your key may do, what pages may load, limits, and how to write pages. Read it before writing.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async (c) => {
        const [me, guide] = await Promise.all([c.me(), c.guide()]);
        const who = me.user.name ? `${me.user.name} <${me.user.email}>` : me.user.id;
        return { content: [{ type: 'text', text: `Connected to ${c.base} (Hatcher ${me.server.version}) as ${who}.\n\n${guide}` }] };
      }),
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List pages',
      description: 'Pages you own or that are shared with you, most recently changed first.',
      inputSchema: { query: z.string().max(200).optional().describe('Only pages whose title or description contains this text') },
      annotations: { readOnlyHint: true },
    },
    ({ query }) => run(async (c) => json(await c.list(query))),
  );

  server.registerTool(
    'get_page',
    {
      title: 'Read a page',
      description: 'A page\'s details, its files, and the text of index.html. Pass its version as expected_version when you change it.',
      inputSchema: { id: pageId, version: version.optional().describe('An earlier version; default the current one') },
      annotations: { readOnlyHint: true },
    },
    ({ id, version: v }) =>
      run(async (c) => {
        const page = await c.get(id, v);
        const index = await c.file(id, 'index.html', page.shownVersion);
        return json({ ...page, index_html: index.text });
      }),
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read a file',
      description: 'One file of a page: text files as text, anything else as base64.',
      inputSchema: { id: pageId, path: z.string().max(400), version: version.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ id, path, version: v }) => run(async (c) => json(await c.file(id, path, v))),
  );

  server.registerTool(
    'list_versions',
    {
      title: 'Version history',
      description: 'Every saved version of a page, newest first.',
      inputSchema: { id: pageId },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(async (c) => json(await c.versions(id))),
  );

  server.registerTool(
    'download_page',
    {
      title: 'Download a page',
      description: 'Write every file of a page (or of one version) into a local folder, to edit there and upload with update_page.',
      inputSchema: {
        id: pageId,
        folder: z.string().describe('Absolute path of the local folder to write into; created if missing'),
        version: version.optional(),
        overwrite: z.boolean().optional().describe('Write into a folder that is not empty'),
      },
    },
    ({ id, folder, version: v, overwrite }) =>
      run(async (c) => {
        const page = await c.get(id, v);
        const files = await Promise.all(
          page.files.map(async (f) => {
            const got = await c.file(id, f.path, page.shownVersion);
            return { path: f.path, data: got.text !== undefined ? Buffer.from(got.text, 'utf8') : Buffer.from(got.base64 ?? '', 'base64') };
          }),
        );
        const root = writeFolder(folder, files, overwrite ?? false);
        return json({ id, version: page.shownVersion, current_version: page.version, folder: root, files: files.map((f) => f.path) });
      }),
  );

  server.registerTool(
    'create_page',
    {
      title: 'Create a page',
      description:
        'Create a new private page from index.html and any files beside it: a local folder, files (inline or from local paths), or both. ' +
        'Returns its id, version and URL. Only the owner sees it until they share it in the web UI.',
      inputSchema: {
        title: z.string().max(200),
        description: z.string().max(2000).optional().describe('One or two sentences shown in page lists'),
        folder: z.string().optional().describe('Absolute path of a local folder holding index.html and its files'),
        files: z.array(fileInput).max(300).optional().describe('Files to add; index.html is required unless the folder has it'),
        note: z.string().max(500).optional().describe('What this version is, shown in the history'),
      },
    },
    ({ title, description, folder, files, note }) =>
      run(async (c) => {
        const body = gather(folder, files);
        if (body.files.length === 0) throw new HatcherError('no files: give a folder or files, with index.html');
        const page = await c.create({ title, description, note, files: body.files });
        return json({ ...page, ...(body.skipped.length ? { skipped: body.skipped } : {}) });
      }),
  );

  server.registerTool(
    'update_page',
    {
      title: 'Change a page',
      description:
        'Save a new version based on expected_version (from get_page). With folder, the page becomes exactly that folder: its files ' +
        'are uploaded and page files not in it are deleted. Otherwise files are added or replaced and delete removes paths; the rest ' +
        'carries over. title and description change the page\'s details (owner only).',
      inputSchema: {
        id: pageId,
        expected_version: version,
        folder: z.string().optional().describe('Absolute path of a local folder to replace the page\'s files with'),
        files: z.array(fileInput).max(300).optional(),
        delete: z.array(z.string().max(400)).max(300).optional(),
        note: z.string().max(500).optional(),
        title: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
      },
    },
    ({ id, expected_version, folder, files, delete: remove, note, title, description }) =>
      run(async (c) => {
        const body = gather(folder, files);
        let removed = remove ?? [];
        if (folder) {
          const current = await c.get(id);
          if (current.version !== expected_version) {
            throw new HatcherError(`the page changed since version ${expected_version} (now ${current.version}); read it again`, 409, 'conflict');
          }
          const keep = new Set(body.files.map((f) => f.path));
          removed = [...new Set([...removed, ...current.files.map((f) => f.path).filter((p) => !keep.has(p))])];
        }
        const details = title !== undefined || description !== undefined;
        if (!body.files.length && !removed.length && !details) throw new HatcherError('nothing to change');
        let result: object | undefined;
        if (body.files.length || removed.length) {
          result = await c.update(id, { expectedVersion: expected_version, files: body.files, delete: removed, note });
        }
        if (details) result = { ...result, ...(await c.rename(id, { title, description })) };
        return json({ ...result, ...(body.skipped.length ? { skipped: body.skipped } : {}), ...(removed.length ? { deleted: removed } : {}) });
      }),
  );

  server.registerTool(
    'restore_version',
    {
      title: 'Restore a version',
      description: 'Save a new version that is a copy of an earlier one. Nothing is lost: the history keeps every version.',
      inputSchema: { id: pageId, version, expected_version: version },
    },
    ({ id, version: v, expected_version }) => run(async (c) => json(await c.restore(id, v, expected_version))),
  );

  return server;
}
