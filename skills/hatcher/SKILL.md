---
name: hatcher
description: Publish and update private, shareable HTML pages (like artifacts) on the user's self-hosted Hatcher server through the hatcher MCP tools. Use when asked to put something on Hatcher, make a page, chart, demo, report or interactive explainer the user can open and share, or change an existing Hatcher page.
---

# Working with Hatcher

Hatcher hosts HTML pages, like artifacts, on the user's own server. Each page is private to its
owner until they share it, and every change is a new version. You work through the `hatcher` MCP
tools; sharing and deleting are left to the user in the web UI.

## Before anything else

Call `guide` once per task. It says which account you act as, what the key may do, which CDN hosts
pages may load from right now, and the page format. Do not assume a host is allowed because it was
last time.

## Workflow

1. **Find.** `list_pages` (with `query`) to see if the page already exists. Prefer updating it over
   making a near-duplicate.
2. **Read before changing.** `get_page` returns `index.html`, the file list and `version`. Pass that
   `version` as `expected_version` to `update_page`. Use `read_file` for other files.
3. **Write.**
   - Small pages: `create_page` with a clear `title`, a one- or two-sentence `description`, and
     `files` (`index.html` plus anything it uses, as `{ path, text }`).
   - Pages with several files, or files already on disk: build them in a local folder and pass
     `folder` (an absolute path). A single local file can go in `files` as `{ path, from }`.
     Hidden files, `node_modules` and file types pages cannot use are skipped and listed.
   - Changes: `update_page` with only the files that changed, `delete` for removed ones, and a short
     `note`. To edit a larger page, `download_page` into an empty folder, edit there, then
     `update_page` with that `folder`: the page becomes exactly that folder.
4. **Check the result.** Fix anything in `warnings` (references to blocked hosts will not load).
   Give the user the page URL from the result.

## Rules the server enforces

- `index.html` is required and served as written. Make it a complete document (`<!doctype html>`,
  charset, viewport) that works at phone width and in dark mode.
- Pages may load only from their own files and the allowed CDN hosts, over HTTPS; they cannot send
  data anywhere. Pin library versions in CDN URLs. Storage (cookies, localStorage) does not persist.
- Limits: 300 files and 50 MB per page, 10 MB per file, 6 folders deep; file names of letters,
  digits, spaces, `.`, `_`, `-`.

## Errors

Tool errors are JSON with an `error` message and usually a `code`:

| Code | Do |
|------|----|
| `invalid` | Fix what the message says and retry |
| `conflict` | The page changed: `get_page` again, merge your change, retry with the new version |
| `forbidden` | The key is read-only, or the page is shared with you read-only; tell the user |
| `not_found` | Wrong id, or not shared with this account; check with `list_pages` |
| `too_large` | Shrink or split files |

If every call says Hatcher is not configured, or fails with 401, the user needs to set
`HATCHER_URL` and `HATCHER_API_KEY` (a key from their Hatcher `/account` page) where the agent
starts, and restart it. The plugin's README has the steps.
