#!/usr/bin/env bash
# Idempotent: install Wind AIFin Market skills globally + hydrate WIND_API_KEY.
# Skills: wind-mcp-skill, wind-find-finance-skill
# Key source (priority): env WIND_API_KEY > existing ~/.wind-aifinmarket/config
set -euo pipefail

export PATH="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}/bin:$PATH"

echo "[wind] installing wind-find-finance-skill + wind-mcp-skill (global)"
npx --yes skills add Wind-Information-Co-Ltd/wind-skills --skill wind-find-finance-skill -g -y
npx --yes skills add Wind-Information-Co-Ltd/wind-skills --skill wind-mcp-skill -g -y

for skill in wind-find-finance-skill wind-mcp-skill; do
  if [[ ! -f "$HOME/.agents/skills/$skill/SKILL.md" ]]; then
    echo "[wind] ERROR: missing $HOME/.agents/skills/$skill/SKILL.md" >&2
    exit 1
  fi
  echo "[wind] OK $skill"
done

# Hydrate API key into global Wind config (never echo the key).
mkdir -p "$HOME/.wind-aifinmarket"
CONFIG="$HOME/.wind-aifinmarket/config"
KEY="${WIND_API_KEY:-}"
if [[ -z "$KEY" && -f "$CONFIG" ]]; then
  KEY="$(grep -E '^WIND_API_KEY=' "$CONFIG" | head -1 | cut -d= -f2- || true)"
fi

if [[ -z "$KEY" ]]; then
  echo "[wind] WARN: WIND_API_KEY not set — add Cloud Agent Secret WIND_API_KEY" >&2
  echo "[wind] skills installed; data calls will fail until key is configured"
  exit 0
fi

umask 077
printf 'WIND_API_KEY=%s\n' "$KEY" > "$CONFIG"
chmod 600 "$CONFIG"
echo "[wind] OK wrote $CONFIG (key present)"
