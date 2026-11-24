// A small client for Hatcher's REST API (Hatcher's docs/api.md). Every call sends the API key as a
// bearer token; failures become HatcherError with the server's message.

export interface Config {
  /** Site URL, e.g. https://hatcher.example.com */
  url: string;
  /** API key from the site's /account page (hk_...). */
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HatcherError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface PageSummary {
  id: string;
  title: string;
  description: string;
  access: 'owner' | 'write' | 'read';
  version: number;
  updatedAt: string;
  url: string;
}

export interface PageDetails extends PageSummary {
  shownVersion: number;
  files: { path: string; size: number }[];
  warnings: string[];
}

export interface FileContent {
  path: string;
  version: number;
  size: number;
  text?: string;
  base64?: string;
}

export interface FileBody {
  path: string;
  text?: string;
  base64?: string;
}

export interface Me {
  user: { id: string; name?: string; email?: string };
  via: string;
  actions: ('read' | 'write')[];
  server: { name: string; version: string; url: string };
}

export type Client = ReturnType<typeof createClient>;

export function createClient(config: Config, userAgent = 'hatcher-mcp') {
  const base = config.url.replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.key}`,
          'User-Agent': userAgent,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new HatcherError(`could not reach Hatcher at ${base}: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 500) || res.statusText;
      let code: string | undefined;
      try {
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        if (parsed.error) message = parsed.error;
        code = parsed.code;
      } catch {
        // not JSON
      }
      throw new HatcherError(`${res.status}: ${message}`, res.status, code);
    }
    if (raw) return text as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HatcherError(`unexpected response from ${base}${path} (is HATCHER_URL the Hatcher site?)`, res.status);
    }
  }

  const enc = encodeURIComponent;
  const v = (version?: number) => (version ? `?version=${version}` : '');
  const filePath = (p: string) => p.split('/').map(enc).join('/');

  return {
    base,
    me: () => request<Me>('GET', '/api/me'),
    guide: () => request<string>('GET', '/api/guide', undefined, true),
    list: (q?: string) => request<{ pages: PageSummary[] }>('GET', `/api/pages${q ? `?q=${enc(q)}` : ''}`),
    get: (id: string, version?: number) => request<PageDetails>('GET', `/api/pages/${enc(id)}${v(version)}`),
    file: (id: string, path: string, version?: number) => request<FileContent>('GET', `/api/pages/${enc(id)}/files/${filePath(path)}${v(version)}`),
    versions: (id: string) =>
      request<{ versions: { version: number; at: string; note: string | null; files: number; bytes: number }[] }>('GET', `/api/pages/${enc(id)}/versions`),
    create: (body: { title: string; description?: string; note?: string; files: FileBody[] }) =>
      request<PageSummary & { warnings: string[] }>('POST', '/api/pages', body),
    update: (id: string, body: { expectedVersion: number; files?: FileBody[]; delete?: string[]; note?: string }) =>
      request<PageSummary & { warnings: string[] }>('POST', `/api/pages/${enc(id)}/versions`, body),
    rename: (id: string, body: { title?: string; description?: string }) => request<PageSummary>('PATCH', `/api/pages/${enc(id)}`, body),
    restore: (id: string, version: number, expectedVersion: number) =>
      request<{ id: string; version: number; url: string }>('POST', `/api/pages/${enc(id)}/restore`, { version, expectedVersion }),
  };
}
