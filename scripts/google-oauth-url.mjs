#!/usr/bin/env node
/**
 * Step 1 of the manual Google OAuth flow: print a consent URL to open in a browser
 * on your own machine.
 *
 * A Cloud Agent VM has no browser the user can reach and no way to receive the
 * loopback redirect, so the flow is split in two. This step only needs the client
 * id (never the secret), so the URL is safe to hand over as-is. After consenting,
 * the browser lands on http://127.0.0.1:8765/?code=... and fails to connect --
 * that is expected; the address bar still holds the authorization code. Paste that
 * whole URL into google-oauth-exchange.mjs to finish.
 *
 * The session (client id, redirect uri, state, scopes) is recorded so the exchange
 * step can rebuild the request and verify `state`.
 *
 * Usage:
 *   node scripts/google-oauth-url.mjs [--client-id ID] [--services drive,sheets] [--port 8765]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';

// Mirrors SERVICE_SCOPE_MAP in @aaronsb/google-workspace-mcp (build/accounts/oauth.js)
// so the credential this produces satisfies the same tools the MCP server exposes.
const SERVICE_SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  drive: ['https://www.googleapis.com/auth/drive'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  docs: ['https://www.googleapis.com/auth/documents'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  slides: ['https://www.googleapis.com/auth/presentations'],
  contacts: [
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/contacts.other.readonly',
    'https://www.googleapis.com/auth/directory.readonly',
  ],
};

// userinfo.email is what lets the exchange step name the account it just authorized.
const BASE_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

export const SESSION_PATHS = [
  '/cursor/stores/self/google-oauth-session.json', // survives VM replacement
  '/tmp/google-oauth-session.json',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    args[m[1]] = m[2] ?? argv[++i] ?? '';
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const clientId = (args['client-id'] || process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    console.error('No client id. Pass --client-id or set GOOGLE_CLIENT_ID.');
    process.exit(1);
  }

  const port = args.port || '8765';
  const redirectUri = `http://127.0.0.1:${port}`;

  const services = (args.services || 'drive,sheets')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const scopes = new Set(BASE_SCOPES);
  for (const name of services) {
    const mapped = SERVICE_SCOPES[name];
    if (!mapped) {
      console.error(`Unknown service '${name}'. Known: ${Object.keys(SERVICE_SCOPES).join(', ')}`);
      process.exit(1);
    }
    for (const scope of mapped) scopes.add(scope);
  }

  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [...scopes].join(' '),
    access_type: 'offline',
    // Forces a refresh_token even when this account already consented once.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  const authUrl = `${AUTH_URL}?${params.toString()}`;

  const session = {
    clientId,
    redirectUri,
    state,
    scopes: [...scopes],
    services,
    createdAt: new Date().toISOString(),
  };

  // Sessions accumulate rather than overwrite, so generating a second URL (a different
  // client, or a retry) cannot invalidate a link already handed out. The exchange step
  // selects by `state`.
  const written = [];
  for (const target of SESSION_PATHS) {
    try {
      let sessions = [];
      try {
        const existing = JSON.parse(fs.readFileSync(target, 'utf-8'));
        sessions = Array.isArray(existing) ? existing : [existing];
      } catch {
        // No usable prior file.
      }
      sessions = [session, ...sessions.filter((s) => s?.state !== state)].slice(0, 10);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(sessions, null, 2), { mode: 0o600 });
      written.push(target);
    } catch {
      // A missing persistent store is not fatal; /tmp alone is enough in-session.
    }
  }

  console.log('Open this URL in your browser and grant access:\n');
  console.log(authUrl);
  console.log('\n---');
  console.log(`redirect_uri : ${redirectUri}`);
  console.log(`scopes       : ${[...scopes].join('\n               ')}`);
  console.log(`session      : ${written.join(', ') || '(none written)'}`);
  console.log(
    '\nAfter consenting the browser will try to reach ' + redirectUri +
    ' and fail to connect.\nThat is expected. Copy the FULL url from the address bar (it contains code=)\nand run:\n' +
    '\n  node scripts/google-oauth-exchange.mjs "<pasted url>"\n'
  );

  if (args['artifact-dir']) {
    const out = path.join(args['artifact-dir'], 'google_oauth_url.txt');
    fs.mkdirSync(args['artifact-dir'], { recursive: true });
    fs.writeFileSync(out, `${authUrl}\n`);
    console.log(`Also written to: ${out}`);
  }
}

main();
