#!/usr/bin/env node
// Shell-accessible Google Drive reader/writer, reusing the google-workspace-mcp
// OAuth credentials. Exists so subagents (which cannot reliably reach the MCP
// server) can pull source PDFs, and so the orchestrator can upload reports.
//
// Usage:
//   node scripts/drive-fetch.mjs list <folderId>
//   node scripts/drive-fetch.mjs find <parentFolderId> <nameSubstring>
//   node scripts/drive-fetch.mjs get <fileId> <outPath>
//   node scripts/drive-fetch.mjs text <fileId> [outPath]      # download + extract PDF text
//   node scripts/drive-fetch.mjs pull <folderId> <outDir>      # download every file in a folder
//   node scripts/drive-fetch.mjs upload <parentFolderId> <localPath> [name]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const EMAIL_SLUG = 'chrisyangwang_at_gmail_dot_com';
const CRED = path.join(
  os.homedir(),
  '.local/share/google-workspace-mcp/credentials',
  `${EMAIL_SLUG}.json`,
);

function loadCreds() {
  if (!fs.existsSync(CRED)) {
    throw new Error(`credentials not found at ${CRED} — run scripts/bootstrap-google-workspace-mcp.mjs`);
  }
  return JSON.parse(fs.readFileSync(CRED, 'utf8'));
}

let cachedToken = null;
async function accessToken() {
  if (cachedToken && cachedToken.expiry > Date.now() + 60_000) return cachedToken.value;
  const c = loadCreds();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(body)}`);
  cachedToken = { value: body.access_token, expiry: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function api(url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

async function listFolder(folderId) {
  const out = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await (await api(`https://www.googleapis.com/drive/v3/files?${params}`)).json();
    out.push(...body.files);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

// Google-native docs must be exported rather than downloaded directly.
const EXPORT_AS = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

async function download(fileId, outPath) {
  const meta = await (await api(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
  )).json();
  const exportMime = EXPORT_AS[meta.mimeType];
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const buf = Buffer.from(await (await api(url)).arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { name: meta.name, mimeType: meta.mimeType, bytes: buf.length, outPath };
}

function pdfToText(pdfPath, txtPath) {
  const script = `
import sys, pymupdf
doc = pymupdf.open(sys.argv[1])
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    for i, page in enumerate(doc, 1):
        fh.write(f"\\n===== PAGE {i} =====\\n")
        fh.write(page.get_text())
print(len(doc))
`;
  const pages = execFileSync('python3', ['-c', script, pdfPath, txtPath], { encoding: 'utf8' }).trim();
  return Number(pages);
}

function safeName(name) {
  return name.replace(/[/\\\0]/g, '_');
}

const MIME_BY_EXT = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Replaces any same-named file already in the folder, so re-runs stay idempotent
// instead of piling up duplicates (Drive allows identical names in one folder).
async function upload(parentFolderId, localPath, nameOverride) {
  const name = nameOverride || path.basename(localPath);
  const mime = MIME_BY_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream';
  const body = fs.readFileSync(localPath);

  const existing = (await listFolder(parentFolderId)).filter((f) => f.name === name);
  for (const dup of existing) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await accessToken()}` },
    });
  }

  const boundary = `bnd${Date.now()}`;
  const metadata = JSON.stringify({ name, parents: [parentFolderId] });
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    },
  );
  const out = await res.json();
  if (!res.ok) throw new Error(`upload failed: ${JSON.stringify(out)}`);
  return { ...out, mimeType: mime, replaced: existing.length };
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'list') {
    const files = await listFolder(args[0]);
    for (const f of files) {
      console.log(`${f.id}\t${f.mimeType.replace('application/vnd.google-apps.', 'g/')}\t${f.name}`);
    }
    console.error(`(${files.length} items)`);
  } else if (cmd === 'find') {
    const needle = args[1];
    const files = (await listFolder(args[0])).filter((f) => f.name.includes(needle));
    for (const f of files) console.log(`${f.id}\t${f.name}`);
  } else if (cmd === 'get') {
    console.log(JSON.stringify(await download(args[0], args[1]), null, 2));
  } else if (cmd === 'text') {
    const tmp = path.join(os.tmpdir(), `drive-${args[0]}.pdf`);
    const meta = await download(args[0], tmp);
    const txt = args[1] || tmp.replace(/\.pdf$/, '.txt');
    const pages = pdfToText(tmp, txt);
    console.log(JSON.stringify({ ...meta, pages, textPath: txt }, null, 2));
  } else if (cmd === 'pull') {
    const [folderId, outDir] = args;
    const files = await listFolder(folderId);
    for (const f of files) {
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      const dest = path.join(outDir, safeName(f.name));
      if (fs.existsSync(dest)) { console.log(`skip  ${f.name}`); continue; }
      await download(f.id, dest);
      console.log(`saved ${f.name}`);
    }
  } else if (cmd === 'upload') {
    console.log(JSON.stringify(await upload(args[0], args[1], args[2]), null, 2));
  } else {
    console.error(
      'commands: list <folderId> | find <folderId> <substr> | get <fileId> <out> | text <fileId> [out] | ' +
        'pull <folderId> <outDir> | upload <parentFolderId> <localPath> [name]',
    );
    process.exit(2);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
