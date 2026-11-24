// Reading and writing page files on this machine, so agents can publish a folder or check a page
// out to edit it without pasting every file through the conversation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileBody } from './api.js';

/** File types Hatcher serves (its src/lib/sandbox.ts); others are skipped and reported. */
export const PAGE_EXTS = new Set(
  'html htm js mjs css json csv tsv txt md xml svg png jpg jpeg gif webp avif ico woff2 woff ttf otf wasm mp4 webm mp3 wav ogg pdf glb gltf'
    .split(' ')
    .map((e) => `.${e}`),
);

const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

/** An absolute local path; `~` is the home folder. Relative paths are refused: the server's working folder is not the agent's. */
export function localPath(p: string): string {
  const expanded = p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
  if (!path.isAbsolute(expanded)) throw new Error(`"${p}" is not an absolute path; give the full path (or start it with ~/)`);
  return path.normalize(expanded);
}

/** Every page file in a folder, as paths relative to it. Hidden files and folders, node_modules and unknown types are skipped. */
export function readFolder(folder: string): { files: FileBody[]; skipped: string[] } {
  const root = localPath(folder);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no folder at ${root}`);
  const files: FileBody[] = [];
  const skipped: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
      } else if (entry.isFile()) {
        if (PAGE_EXTS.has(path.extname(entry.name).toLowerCase())) files.push({ path: rel, base64: fs.readFileSync(abs).toString('base64') });
        else skipped.push(rel);
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

/** One local file, sent as base64. */
export function readLocalFile(from: string): string {
  return fs.readFileSync(localPath(from)).toString('base64');
}

/** Write files into a folder, creating it. Refuses a folder that has anything in it unless `overwrite`. */
export function writeFolder(folder: string, files: { path: string; data: Buffer }[], overwrite: boolean): string {
  const root = localPath(folder);
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0 && !overwrite) {
    throw new Error(`${root} is not empty; pass overwrite: true to write into it anyway`);
  }
  for (const f of files) {
    const abs = path.resolve(root, f.path);
    if (!abs.startsWith(root + path.sep)) throw new Error(`refusing to write outside ${root}: ${f.path}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
  }
  return root;
}
