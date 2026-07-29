#!/usr/bin/env node
/**
 * Hydrate google-workspace-mcp credentials from Cloud Agent Secrets.
 *
 * Required env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *
 * Optional env:
 *   GOOGLE_ACCOUNT_EMAIL  (required)
 *
 * Writes:
 *   ~/.local/share/google-workspace-mcp/credentials/<slug>.json
 *   ~/.config/google-workspace-mcp/accounts.json
 *
 * Safe to re-run: overwrites credential file, upserts accounts.json entry.
 * Exit 0 on success / already-hydrated; exit 1 if required secrets missing.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const email = (process.env.GOOGLE_ACCOUNT_EMAIL || '').trim();
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

function fail(msg) {
  console.error(`[bootstrap-gws] ${msg}`);
  process.exit(1);
}

function loadRefreshToken() {
  const fromEnv = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  const fallbackPaths = [
    path.join('/workspace/tmp', 'GOOGLE_REFRESH_TOKEN.new'),
    path.join(os.tmpdir(), 'google-refresh-token.txt'),
  ];
  for (const p of fallbackPaths) {
    try {
      const fromFile = fs.readFileSync(p, 'utf8').trim();
      if (fromFile) {
        if (fromEnv && fromEnv !== fromFile) {
          console.error(`[bootstrap-gws] env GOOGLE_REFRESH_TOKEN differs from ${p}; preferring file`);
        }
        return fromFile;
      }
    } catch {
      /* missing */
    }
  }
  return fromEnv;
}

const refreshToken = loadRefreshToken();

if (!email) fail('GOOGLE_ACCOUNT_EMAIL is required');

if (!clientId) fail('GOOGLE_CLIENT_ID missing');
if (!clientSecret) fail('GOOGLE_CLIENT_SECRET missing');
if (!refreshToken) fail('GOOGLE_REFRESH_TOKEN missing — add it as a Cloud Agent Secret');
const APP = 'google-workspace-mcp';
const dataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP);
const configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP);
const credDir = path.join(dataDir, 'credentials');
const slug = email.replace(/[/\\]/g, '').replace(/@/g, '_at_').replace(/\./g, '_dot_');
const credPath = path.join(credDir, `${slug}.json`);
const accountsPath = path.join(configDir, 'accounts.json');

// Full service scopes matching google-workspace-mcp ALL_SERVICES default
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.settings',
];

async function validateRefreshToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    fail(`refresh token exchange failed (${r.status}): ${body}`);
  }
  return true;
}

fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

const credential = {
  type: 'authorized_user',
  client_id: clientId,
  client_secret: clientSecret,
  refresh_token: refreshToken,
  scopes: SCOPES,
};
fs.writeFileSync(credPath, JSON.stringify(credential, null, 2), { mode: 0o600 });

let accounts = { accounts: [] };
try {
  accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
} catch {
  /* empty */
}
if (!Array.isArray(accounts.accounts)) accounts.accounts = [];
if (!accounts.accounts.some((a) => a.email === email)) {
  accounts.accounts.push({ email, category: 'personal' });
}
fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });

await validateRefreshToken();
console.log(`[bootstrap-gws] OK hydrated ${email}`);
console.log(`[bootstrap-gws] cred: ${credPath}`);
