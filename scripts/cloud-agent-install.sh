#!/usr/bin/env bash
# Cloud Agent install: durable packages + skills (idempotent).
# Invoked from environment.json "install".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
mkdir -p "$NPM_CONFIG_PREFIX"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

echo "[cloud-install] === Google Workspace MCP package ==="
bash "$ROOT/scripts/install-google-workspace-mcp.sh"

echo "[cloud-install] === Google Workspace credential hydrate ==="
node "$ROOT/scripts/bootstrap-google-workspace-mcp.mjs" \
  || echo "[install] google-workspace-mcp bootstrap skipped (Google secrets missing/invalid)"

echo "[cloud-install] === Wind AIFin Market skills ==="
bash "$ROOT/scripts/bootstrap-wind-skills.sh"

echo "[cloud-install] === china-finance skills (jwangkun) ==="
bash "$ROOT/scripts/bootstrap-china-finance-skills.sh"

echo "[cloud-install] DONE"
