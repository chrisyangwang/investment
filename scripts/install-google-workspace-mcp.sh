#!/usr/bin/env bash
# Idempotent: install @aaronsb/google-workspace-mcp for Cloud Agents.
set -euo pipefail

PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
mkdir -p "$PREFIX"
npm config set prefix "$PREFIX" >/dev/null 2>&1 || true
export PATH="$PREFIX/bin:$PATH"

echo "[install-gws] installing @aaronsb/google-workspace-mcp into $PREFIX"
npm install -g @aaronsb/google-workspace-mcp

BIN="$PREFIX/bin/google-workspace-mcp"
if [[ ! -x "$BIN" && ! -L "$BIN" ]]; then
  echo "[install-gws] ERROR: binary missing at $BIN" >&2
  exit 1
fi

mkdir -p "$HOME/.cursor"
MCP_JSON="$HOME/.cursor/mcp.json"
# Write/merge MCP server entry without printing secrets.
node --input-type=module <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
const bin = path.join(process.env.NPM_CONFIG_PREFIX || path.join(os.homedir(), '.npm-global'), 'bin', 'google-workspace-mcp');
let cfg = { mcpServers: {} };
try {
  cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
} catch {
  /* empty */
}
if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
cfg.mcpServers['google-workspace-mcp'] = {
  command: bin,
  env: {
    GOOGLE_CLIENT_ID: '${env:GOOGLE_CLIENT_ID}',
    GOOGLE_CLIENT_SECRET: '${env:GOOGLE_CLIENT_SECRET}',
  },
};
fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
console.log(`[install-gws] wrote ${mcpPath}`);
EOF

# Persist PATH for interactive shells
if ! grep -q 'npm-global/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
fi

echo "[install-gws] OK binary=$BIN"
