import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { localPath, readFolder } from '../src/local.js';
import { createServer } from '../src/server.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatcher-mcp-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Call = { method: string; url: string; auth: string | null; body: unknown };

/** A fake Hatcher: records requests and answers from `routes` ("METHOD /path" -> body or [status, body]). */
function fakeHatcher(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', url: `${url.pathname}${url.search}`, auth: headers.get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!(key in routes)) return new Response(JSON.stringify({ error: `no route ${key}`, code: 'not_found' }), { status: 404 });
    const r = routes[key];
    const [status, body] = Array.isArray(r) ? (r as [number, unknown]) : [200, r];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: status as number });
  }) as typeof fetch;
  return { calls, client: createClient({ url: 'https://h.example/', key: 'hk_test', fetch: fetchFn }) };
}

async function connect(client: ReturnType<typeof createClient> | null) {
  const server = createServer(client, 'test');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), c.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = r.content[0].text;
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      // plain text
    }
    return { error: Boolean(r.isError), body, text };
  };
}

const page = (over: object = {}) => ({ id: 'AbC123xYz789', title: 'T', description: '', access: 'owner', version: 1, updatedAt: '', url: 'https://h.example/p/AbC123xYz789', ...over });

describe('hatcher-mcp', () => {
  it('explains the setup when unconfigured', async () => {
    const call = await connect(null);
    const r = await call('list_pages');
    expect(r.error).toBe(true);
    expect(r.text).toContain('HATCHER_API_KEY');
  });

  it('sends the key and passes server errors through', async () => {
    const { calls, client } = fakeHatcher({ 'GET /api/pages/AbC123xYz789': [404, { error: 'no page', code: 'not_found' }] });
    const call = await connect(client);
    const r = await call('get_page', { id: 'AbC123xYz789' });
    expect(r.error).toBe(true);
    expect(r.body.code).toBe('not_found');
    expect(calls[0].auth).toBe('Bearer hk_test');
  });

  it('creates a page from a folder, skipping hidden files and unknown types', async () => {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'x');
    fs.writeFileSync(path.join(dir, 'README'), 'notes');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'x');
    const { calls, client } = fakeHatcher({ 'POST /api/pages': [201, { ...page(), warnings: [] }] });
    const call = await connect(client);
    const r = await call('create_page', { title: 'T', folder: dir, files: [{ path: 'data.json', text: '[]' }] });
    expect(r.error).toBe(false);
    expect(r.body.skipped).toEqual(['README']);
    const sent = (calls[0].body as { files: { path: string; base64?: string; text?: string }[] }).files;
    expect(sent.map((f) => f.path).sort()).toEqual(['data.json', 'index.html', 'js/app.js']);
    expect(Buffer.from(sent.find((f) => f.path === 'js/app.js')!.base64!, 'base64').toString()).toBe('x');
  });

  it('makes the page match a folder: uploads its files and deletes the rest', async () => {
    fs.writeFileSync(path.join(dir, 'index.html'), 'new');
    const { calls, client } = fakeHatcher({
      'GET /api/pages/AbC123xYz789': { ...page({ version: 3 }), shownVersion: 3, files: [{ path: 'index.html', size: 1 }, { path: 'old.css', size: 1 }], warnings: [] },
      'POST /api/pages/AbC123xYz789/versions': [201, { ...page({ version: 4 }), warnings: [] }],
    });
    const call = await connect(client);
    const r = await call('update_page', { id: 'AbC123xYz789', expected_version: 3, folder: dir });
    expect(r.body.version).toBe(4);
    expect(calls[1].body).toMatchObject({ expectedVersion: 3, delete: ['old.css'] });
    const stale = await call('update_page', { id: 'AbC123xYz789', expected_version: 2, folder: dir });
    expect(stale.body.code).toBe('conflict');
  });

  it('downloads a page into a folder and will not write into a full one', async () => {
    const { client } = fakeHatcher({
      'GET /api/pages/AbC123xYz789': { ...page(), shownVersion: 1, files: [{ path: 'index.html', size: 2 }, { path: 'img/a.png', size: 2 }], warnings: [] },
      'GET /api/pages/AbC123xYz789/files/index.html?version=1': { path: 'index.html', version: 1, size: 2, text: 'hi' },
      'GET /api/pages/AbC123xYz789/files/img/a.png?version=1': { path: 'img/a.png', version: 1, size: 2, base64: Buffer.from([1, 2]).toString('base64') },
    });
    const call = await connect(client);
    const out = path.join(dir, 'out');
    expect((await call('download_page', { id: 'AbC123xYz789', folder: out })).error).toBe(false);
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toBe('hi');
    expect([...fs.readFileSync(path.join(out, 'img', 'a.png'))]).toEqual([1, 2]);
    expect((await call('download_page', { id: 'AbC123xYz789', folder: out })).error).toBe(true);
  });

  it('wants exactly one source per file and absolute local paths', async () => {
    const { client } = fakeHatcher({});
    const call = await connect(client);
    expect((await call('create_page', { title: 'T', files: [{ path: 'index.html', text: 'x', base64: 'eA==' }] })).text).toContain('exactly one');
    expect(() => localPath('relative/dir')).toThrow('absolute');
    expect(localPath('~/x')).toBe(path.join(os.homedir(), 'x'));
    expect(() => readFolder(path.join(dir, 'missing'))).toThrow('no folder');
  });
});
