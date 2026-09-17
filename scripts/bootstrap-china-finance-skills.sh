#!/usr/bin/env bash
# Idempotent: globally install skills from jwangkun/claude-for-financial-services-cn
# by copying vertical-plugins/*/skills/* into ~/.agents/skills/
set -euo pipefail

REPO_URL="${CHINA_FINANCE_SKILLS_REPO:-https://github.com/jwangkun/claude-for-financial-services-cn.git}"
CACHE_DIR="${CHINA_FINANCE_SKILLS_CACHE:-$HOME/.cache/china-finance-skills}"
DEST="$HOME/.agents/skills"
REF="${CHINA_FINANCE_SKILLS_REF:-HEAD}"

mkdir -p "$CACHE_DIR" "$DEST"

if [[ -d "$CACHE_DIR/.git" ]]; then
  echo "[china-finance] updating $CACHE_DIR"
  git -C "$CACHE_DIR" fetch --depth 1 origin "$REF" 2>/dev/null || git -C "$CACHE_DIR" fetch --depth 1 origin
  git -C "$CACHE_DIR" reset --hard FETCH_HEAD >/dev/null 2>&1 || git -C "$CACHE_DIR" pull --ff-only
else
  echo "[china-finance] cloning $REPO_URL"
  rm -rf "$CACHE_DIR"
  git clone --depth 1 "$REPO_URL" "$CACHE_DIR"
fi

count=0
# Prefer vertical plugin skills (canonical skill packs).
while IFS= read -r -d '' skill_md; do
  skill_dir="$(dirname "$skill_md")"
  skill_name="$(basename "$skill_dir")"
  target="$DEST/$skill_name"
  mkdir -p "$target"
  # Replace contents idempotently
  rm -rf "$target"
  cp -a "$skill_dir" "$target"
  count=$((count + 1))
done < <(find "$CACHE_DIR/vertical-plugins" -type f -path '*/skills/*/SKILL.md' -print0 2>/dev/null)

if [[ "$count" -eq 0 ]]; then
  echo "[china-finance] ERROR: no SKILL.md found under vertical-plugins/*/skills" >&2
  exit 1
fi

echo "[china-finance] OK installed $count skills into $DEST"
