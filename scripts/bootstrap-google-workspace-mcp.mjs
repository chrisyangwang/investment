#!/usr/bin/env node
/**
 * Materialises @aaronsb/google-workspace-mcp credentials from environment secrets.
 *
 * Cloud Agent VMs are ephemeral, so the OAuth files the MCP server expects on disk
 * are gone on every boot. The long-lived refresh token lives in a Cloud Agent Secret
 * instead and is rehydrated here into the two files the server reads:
 *
 *   ~/.local/share/google-workspace-mcp/credentials/<email-slug>.json
 *   ~/.config/google-workspace-mcp/accounts.json
 *
 * Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * Optional env: GOOGLE_ACCOUNT_EMAIL (otherwise resolved from the token itself)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const APP_NAME = 'google-workspace-mcp';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const configDir = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
const dataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP_NAME);

// Mirrors emailToSlug in the MCP server's executor/paths.js.
const emailToSlug = (email) =>
  email.replace(/[/\\]/g, '').replace(/@/g, '_at_').replace(/\./g, '_dot_');

const credentialPath = (email) =>
  path.join(dataDir(), 'credentials', `${emailToSlug(email)}.json`);
const accountsFilePath = () => path.join(configDir(), 'accounts.json');

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}. ` +
      'Add it under Cursor Dashboard > Cloud Agents > Secrets.');
  }
  return value.trim();
}

async function fetchAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body.error === 'invalid_grant') {
      throw new Error(
        'Google rejected the refresh token (invalid_grant). It was revoked, expired, or ' +
        'belongs to a different OAuth client. Re-run the OAuth consent flow and update the ' +
        'GOOGLE_REFRESH_TOKEN secret.'
      );
    }
    throw new Error(`Token refresh failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function resolveEmail(accessToken) {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return undefined;
  const body = await response.json().catch(() => ({}));
  return body.email;
}

async function writeCredential(email, credential) {
  const filePath = credentialPath(email);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(credential, null, 2), { mode: 0o600 });
  return filePath;
}

async function upsertAccount(email) {
  const filePath = accountsFilePath();
  let data = { accounts: [] };
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    if (!Array.isArray(data.accounts)) data.accounts = [];
  } catch {
    // No registry yet — start from an empty one.
  }

  if (!data.accounts.some((account) => account.email === email)) {
    data.accounts.push({
      email,
      category: 'personal',
      description: 'Bootstrapped from Cloud Agent secrets',
    });
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  return filePath;
}

async function main() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');

  console.log('Exchanging refresh token for an access token...');
  const token = await fetchAccessToken({ clientId, clientSecret, refreshToken });

  const email =
    process.env.GOOGLE_ACCOUNT_EMAIL?.trim() ||
    (await resolveEmail(token.access_token));
  if (!email) {
    throw new Error(
      'Could not determine the account email. Set GOOGLE_ACCOUNT_EMAIL, or grant the ' +
      'userinfo.email scope so it can be resolved automatically.'
    );
  }

  const credentialFile = await writeCredential(email, {
    type: 'authorized_user',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const accountsFile = await upsertAccount(email);

  console.log(`Account:     ${email}`);
  console.log(`Credential:  ${credentialFile}`);
  console.log(`Registry:    ${accountsFile}`);
  console.log(`Token valid: yes (expires in ${token.expires_in}s)`);
  if (token.scope) console.log(`Scopes:      ${token.scope}`);
  console.log('\nBootstrap complete. Restart/retry the MCP tool call to pick up the account.');
}

main().catch((error) => {
  console.error(`\nBootstrap failed: ${error.message}`);
  process.exit(1);
});
