#!/usr/bin/env bash
# Cloud Agent start: per-boot secret hydration (idempotent, fast).
# Invoked from environment.json "start".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

echo "[cloud-start] === Google Workspace credential hydrate ==="
node "$ROOT/scripts/bootstrap-google-workspace-mcp.mjs" \
  || echo "[start] google-workspace-mcp bootstrap skipped (Google secrets missing/invalid)"

echo "[cloud-start] === Wind API key hydrate ==="
# Re-run wind bootstrap key section only via full script (skills already present after install/snapshot).
if [[ -n "${WIND_API_KEY:-}" ]]; then
  mkdir -p "$HOME/.wind-aifinmarket"
  umask 077
  printf 'WIND_API_KEY=%s\n' "$WIND_API_KEY" > "$HOME/.wind-aifinmarket/config"
  chmod 600 "$HOME/.wind-aifinmarket/config"
  echo "[cloud-start] OK Wind key hydrated"
else
  echo "[cloud-start] WARN: WIND_API_KEY secret not injected"
fi

# If skills missing (JIT boot without snapshot), install them.
if [[ ! -f "$HOME/.agents/skills/wind-mcp-skill/SKILL.md" ]]; then
  echo "[cloud-start] wind skills missing — running bootstrap-wind-skills.sh"
  bash "$ROOT/scripts/bootstrap-wind-skills.sh" || true
fi
if ! compgen -G "$HOME/.agents/skills/china-*/SKILL.md" >/dev/null 2>&1; then
  echo "[cloud-start] china-finance skills missing — running bootstrap-china-finance-skills.sh"
  bash "$ROOT/scripts/bootstrap-china-finance-skills.sh" || true
fi
if [[ ! -x "$NPM_CONFIG_PREFIX/bin/google-workspace-mcp" && ! -L "$NPM_CONFIG_PREFIX/bin/google-workspace-mcp" ]]; then
  echo "[cloud-start] google-workspace-mcp missing — running install-google-workspace-mcp.sh"
  bash "$ROOT/scripts/install-google-workspace-mcp.sh" || true
fi

echo "[cloud-start] DONE"
