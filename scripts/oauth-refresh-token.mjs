#!/usr/bin/env node
/**
 * One-shot Google OAuth (offline) to mint a new refresh token.
 * Redirect URI must match the OAuth client: http://127.0.0.1:8765
 *
 * Writes:
 *   /tmp/google-refresh-token.txt          (refresh token only)
 *   /tmp/google-oauth-result.json          (full result, no secrets in stdout beyond status)
 *   ~/.local/share/google-workspace-mcp/credentials/<slug>.json
 *   ~/.config/google-workspace-mcp/accounts.json
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optional GOOGLE_ACCOUNT_EMAIL
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const expectedEmail = (process.env.GOOGLE_ACCOUNT_EMAIL || '').trim();

if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET required');
  process.exit(1);
}

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
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

const state = randomBytes(16).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

fs.writeFileSync('/tmp/google-oauth-url.txt', authUrl.toString());
console.log(`[oauth] listening on ${REDIRECT_URI}`);
console.log(`[oauth] open URL written to /tmp/google-oauth-url.txt`);
console.log(`[oauth] waiting up to 10 minutes for consent…`);

function openBrowser(url) {
  execFile('xdg-open', [url], (err) => {
    if (err) {
      console.error(`[oauth] xdg-open failed: ${err.message}`);
      console.error(`[oauth] URL:\n${url}`);
    } else {
      console.log('[oauth] browser open requested');
    }
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', REDIRECT_URI);
    if (url.pathname !== '/' && url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const err = url.searchParams.get('error');
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body><h2>OAuth failed</h2><pre>${err}</pre></body></html>`);
      console.error(`[oauth] error callback: ${err}`);
      process.exit(2);
    }
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (!code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>Waiting for Google OAuth callback…</h2></body></html>');
      return;
    }
    if (returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>Invalid state</h2></body></html>');
      console.error('[oauth] state mismatch');
      process.exit(3);
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenBody = await tokenRes.text();
    if (!tokenRes.ok) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body><h2>Token exchange failed</h2><pre>${tokenBody}</pre></body></html>`);
      console.error(`[oauth] token exchange failed: ${tokenBody}`);
      process.exit(4);
    }
    const tokens = JSON.parse(tokenBody);
    if (!tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>No refresh_token returned</h2><p>Revoke app access and retry with prompt=consent.</p></body></html>');
      console.error('[oauth] no refresh_token in response');
      process.exit(5);
    }

    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userinfo = await userinfoRes.json();
    const email = userinfo.email || expectedEmail;
    if (expectedEmail && email && email !== expectedEmail) {
      console.warn(`[oauth] warning: authenticated as ${email}, expected ${expectedEmail}`);
    }

    // Persist for google-workspace-mcp
    const APP = 'google-workspace-mcp';
    const dataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP);
    const configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP);
    const credDir = path.join(dataDir, 'credentials');
    fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const slug = String(email).replace(/[/\\]/g, '').replace(/@/g, '_at_').replace(/\./g, '_dot_');
    const credPath = path.join(credDir, `${slug}.json`);
    fs.writeFileSync(
      credPath,
      JSON.stringify(
        {
          type: 'authorized_user',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token,
          scopes: (tokens.scope || '').split(' ').filter(Boolean),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const accountsPath = path.join(configDir, 'accounts.json');
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

    fs.writeFileSync('/tmp/google-refresh-token.txt', tokens.refresh_token + '\n', { mode: 0o600 });
    fs.writeFileSync(
      '/tmp/google-oauth-result.json',
      JSON.stringify(
        {
          ok: true,
          email,
          expires_in: tokens.expires_in,
          scope: tokens.scope,
          refresh_token_path: '/tmp/google-refresh-token.txt',
          cred_path: credPath,
          refresh_token_len: tokens.refresh_token.length,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<html><body><h2>Authentication successful</h2><p>Account: ${email}</p><p>Refresh token saved. You can close this tab.</p></body></html>`,
    );
    console.log(`[oauth] OK email=${email}`);
    console.log(`[oauth] refresh token written to /tmp/google-refresh-token.txt (len=${tokens.refresh_token.length})`);
    console.log(`[oauth] credentials: ${credPath}`);
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('[oauth] handler error', e);
    try {
      res.writeHead(500);
      res.end('error');
    } catch {
      /* ignore */
    }
    process.exit(6);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  openBrowser(authUrl.toString());
});

setTimeout(() => {
  console.error('[oauth] timed out after 10 minutes');
  process.exit(7);
}, 10 * 60 * 1000);
