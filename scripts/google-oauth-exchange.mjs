#!/usr/bin/env node
/**
 * Step 2 of the manual Google OAuth flow: turn the authorization code into a
 * refresh token and install it where @aaronsb/google-workspace-mcp reads it.
 *
 * Takes either the whole redirect URL copied out of the address bar or just the
 * code. The session written by google-oauth-url.mjs supplies the client id,
 * redirect uri and state, all of which must match what the consent request used.
 *
 * Google requires client_secret for this exchange even for "Desktop app" clients,
 * and the secret must belong to the SAME OAuth client as the code. When the session
 * client id differs from GOOGLE_CLIENT_ID, pass the matching secret in
 * GOOGLE_CLIENT_SECRET_OVERRIDE.
 *
 * The refresh token is written to disk with 0600 permissions and is deliberately
 * never printed, so it does not end up in terminal scrollback or logs.
 *
 * Usage:
 *   node scripts/google-oauth-exchange.mjs "http://127.0.0.1:8765/?code=4/0A...&state=..."
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const APP_NAME = 'google-workspace-mcp';

const SESSION_PATHS = [
  '/cursor/stores/self/google-oauth-session.json',
  '/tmp/google-oauth-session.json',
];

const configDir = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
const dataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP_NAME);
const emailToSlug = (email) =>
  email.replace(/[/\\]/g, '').replace(/@/g, '_at_').replace(/\./g, '_dot_');

/**
 * Load the pending sessions and pick the one the pasted URL belongs to.
 *
 * Selection is by `state` so that having generated several URLs (a different client,
 * or a retry) does not make an older link unusable. Without a state to match on,
 * the newest session is the only reasonable guess.
 */
function loadSession(state) {
  for (const target of SESSION_PATHS) {
    let sessions;
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
      sessions = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      continue;
    }
    if (!sessions.length) continue;
    if (state) {
      const matched = sessions.find((s) => s?.state === state);
      if (matched) return { session: matched, from: target, matchedBy: 'state' };
      // A state that matches nothing here is a stale or tampered URL, not a reason
      // to fall back to an unrelated session.
      return { session: undefined, from: target, matchedBy: 'none' };
    }
    return { session: sessions[0], from: target, matchedBy: 'most recent' };
  }
  return { session: undefined, from: undefined, matchedBy: undefined };
}

/** Accepts a full redirect URL or a bare code. Returns { code, state }. */
function extractCode(input) {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  if (raw.includes('code=')) {
    // The URL may be unparseable as-is (e.g. copied without a scheme), so fall
    // back to a regex over the query string.
    try {
      const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
      const code = url.searchParams.get('code');
      if (code) return { code, state: url.searchParams.get('state') ?? undefined };
    } catch {
      // Fall through to the regex.
    }
    const m = /[?&]code=([^&\s]+)/.exec(raw);
    if (m) {
      const state = /[?&]state=([^&\s]+)/.exec(raw);
      return {
        code: decodeURIComponent(m[1]),
        state: state ? decodeURIComponent(state[1]) : undefined,
      };
    }
  }
  if (/^[\w/-]/.test(raw) && !raw.includes(' ')) return { code: raw, state: undefined };
  throw new Error('Could not find an authorization code in that input.');
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/google-oauth-exchange.mjs "<redirect url with code=>"');
    process.exit(1);
  }

  const { code, state } = extractCode(input);
  const { session, from, matchedBy } = loadSession(state);

  if (!session && matchedBy === 'none') {
    console.error(
      `\nThe state in that URL matches no pending session (stale URL from an earlier\n` +
      `attempt, or tampering). Re-run google-oauth-url.mjs and use the fresh link.`
    );
    process.exit(1);
  }
  if (!session) {
    console.error(
      'No OAuth session found. Re-run google-oauth-url.mjs first so the client id,\n' +
      'redirect uri and state match the consent request.'
    );
    process.exit(1);
  }
  console.log(`Session:      ${from} (matched by ${matchedBy})`);
  console.log(`State:        ${state ? 'verified' : 'absent in URL, skipped'}`);

  const clientId = session.clientId;
  const envClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const override = (process.env.GOOGLE_CLIENT_SECRET_OVERRIDE || '').trim();
  const clientSecret = override || (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!clientSecret) {
    console.error('No client secret. Set GOOGLE_CLIENT_SECRET or GOOGLE_CLIENT_SECRET_OVERRIDE.');
    process.exit(1);
  }
  if (!override && envClientId && envClientId !== clientId) {
    console.error(
      '\nThe consent request used a different OAuth client than GOOGLE_CLIENT_ID, so the\n' +
      'stored GOOGLE_CLIENT_SECRET belongs to the wrong client and Google will reject the\n' +
      'exchange with invalid_client. Supply the secret for the client that issued this code\n' +
      'via GOOGLE_CLIENT_SECRET_OVERRIDE, or re-run google-oauth-url.mjs without --client-id.'
    );
    process.exit(1);
  }

  console.log('Exchanging authorization code for tokens...');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: session.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hints = {
      invalid_client: 'The client secret does not match the client id that issued the code.',
      invalid_grant:
        'The code was already used, expired (they last minutes), or the redirect_uri differs ' +
        'from the one in the consent request.',
      redirect_uri_mismatch:
        `Register ${session.redirectUri} as an authorized redirect URI, or use a Desktop app ` +
        'client, which allows any loopback port.',
    };
    console.error(`\nExchange failed (${response.status}): ${JSON.stringify(token)}`);
    if (hints[token.error]) console.error(`\n${hints[token.error]}`);
    process.exit(1);
  }
  if (!token.refresh_token) {
    console.error(
      '\nGoogle returned no refresh_token. Revoke the app at ' +
      'https://myaccount.google.com/permissions and retry, so the consent screen is shown again.'
    );
    process.exit(1);
  }

  const userinfo = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  const email = userinfo.email || process.env.GOOGLE_ACCOUNT_EMAIL?.trim();
  if (!email) {
    console.error('Could not resolve the account email. Grant the userinfo.email scope.');
    process.exit(1);
  }

  const credentialFile = path.join(dataDir(), 'credentials', `${emailToSlug(email)}.json`);
  fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    credentialFile,
    JSON.stringify(
      {
        type: 'authorized_user',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refresh_token,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  const accountsFile = path.join(configDir(), 'accounts.json');
  let accounts = { accounts: [] };
  try {
    accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
    if (!Array.isArray(accounts.accounts)) accounts.accounts = [];
  } catch {
    // First account on this machine.
  }
  if (!accounts.accounts.some((a) => a.email === email)) {
    accounts.accounts.push({
      email,
      category: 'personal',
      description: 'Authorized via manual OAuth flow',
    });
  }
  fs.mkdirSync(path.dirname(accountsFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), { mode: 0o600 });

  // Kept out of stdout on purpose: this value belongs in the GOOGLE_REFRESH_TOKEN
  // secret, and printing it would leave it in terminal scrollback and logs.
  const tokenFile = '/cursor/stores/self/google-refresh-token.txt';
  let tokenFileWritten;
  try {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, `${token.refresh_token}\n`, { mode: 0o600 });
    tokenFileWritten = tokenFile;
  } catch {
    // Non-fatal: the credential file above already holds it.
  }

  console.log(`\nAccount:      ${email}`);
  console.log(`Credential:   ${credentialFile}`);
  console.log(`Registry:     ${accountsFile}`);
  console.log(`Granted:      ${(token.scope || '').split(' ').join('\n              ')}`);
  console.log(`Access token: valid for ${token.expires_in}s`);
  console.log(`Refresh token: obtained (${token.refresh_token.length} chars, not printed)`);
  if (tokenFileWritten) console.log(`               saved to ${tokenFileWritten}`);
  console.log('\nThe MCP server can now use this account. Store the refresh token in the');
  console.log('GOOGLE_REFRESH_TOKEN secret so future runs bootstrap without re-consenting.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
