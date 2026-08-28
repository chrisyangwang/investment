#!/usr/bin/env bash
#
# Installs every skill the company-analysis automation depends on into the global
# skills directory ($HOME/.agents/skills). Idempotent: safe to re-run on a fresh
# Cloud Agent VM, where nothing is installed yet.
#
#   1. The two required Wind skills (wind-find-finance-skill, wind-mcp-skill).
#   2. The 15 Wind research skills listed in the automation prompt.
#   3. The China financial-services skills from jwangkun/claude-for-financial-services-cn.
#
# Wind data access additionally needs a key in $HOME/.wind-aifinmarket/config as
# `WIND_API_KEY=<key>`; this script only warns when it is absent.

set -uo pipefail

SKILLS_DIR="${SKILLS_DIR:-$HOME/.agents/skills}"
WIND_GITHUB="Wind-Information-Co-Ltd/wind-skills"
WIND_GITEE="https://gitee.com/wind_info/wind-skills.git"
CFS_REPO="https://github.com/jwangkun/claude-for-financial-services-cn.git"

# Required by skill.md, plus the 15 research skills named in the automation prompt.
# The prompt names them in Chinese; the repo directory name follows each comment.
WIND_SKILLS=(
  wind-find-finance-skill             # 必需
  wind-mcp-skill                      # 必需
  valuation-pricing-framework         # 估值与定价框架
  earnings-analysis                   # 财报解读
  dcf-model                           # DCF 估值模型
  valuation_snapshot_skill            # 估值快照
  equity-investment-thesis            # 个股投资逻辑研究
  bull_bear_case_builder_skill        # 多空论证
  peer_comparison_decision_skill      # 同业比选
  moat_strength_review_skill          # 护城河评估
  business_model_decoder_skill        # 业务模式拆解
  growth_quality_check_skill          # 增长质检
  hot_stock_quick_read_skill          # 热门股快读
  management_quality_check_skill      # 管理层体检
  stock_first_look_skill              # 初识个股
  stock_research_memo_writer_skill    # 个股研究备忘
  turnaround_story_validation_skill   # 反转逻辑验证
)

log()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

pick_wind_source() {
  if git ls-remote --exit-code "https://github.com/${WIND_GITHUB}.git" >/dev/null 2>&1; then
    printf '%s' "$WIND_GITHUB"
  elif git ls-remote --exit-code "$WIND_GITEE" >/dev/null 2>&1; then
    printf '%s' "$WIND_GITEE"
  fi
}

install_wind_skills() {
  local source
  source="$(pick_wind_source)"
  if [[ -z "$source" ]]; then
    warn "neither the GitHub nor the Gitee Wind skill remote is reachable; skipping Wind skills"
    return 1
  fi
  log "==> Installing Wind skills from ${source}"

  local skill
  for skill in "${WIND_SKILLS[@]}"; do
    if [[ -f "$SKILLS_DIR/$skill/SKILL.md" ]]; then
      log "    = $skill (already present)"
      continue
    fi
    # The registry only publishes a subset of these names; a miss is not fatal.
    if npx --yes skills add "$source" --skill "$skill" -g -y >/tmp/skills-add-$skill.log 2>&1 \
       && [[ -f "$SKILLS_DIR/$skill/SKILL.md" ]]; then
      log "    + $skill"
    else
      warn "    ! $skill not available from ${source} (see /tmp/skills-add-$skill.log)"
    fi
  done
}

install_cfs_skills() {
  local checkout
  checkout="$(mktemp -d)"
  log "==> Installing China financial-services skills from ${CFS_REPO}"
  if ! git clone --depth 1 "$CFS_REPO" "$checkout" >/dev/null 2>&1; then
    warn "could not clone ${CFS_REPO}; skipping"
    rm -rf "$checkout"
    return 1
  fi

  # The repo ships each skill under several plugin directories. Those copies are
  # byte-identical, so install one per name and prefer the vertical-plugins copy.
  local added=0 existing=0
  local skill_md name dest
  while IFS= read -r skill_md; do
    name="$(basename "$(dirname "$skill_md")")"
    dest="$SKILLS_DIR/$name"
    if [[ -e "$dest" ]]; then
      existing=$((existing + 1))
      continue
    fi
    mkdir -p "$dest"
    cp -R "$(dirname "$skill_md")/." "$dest/"
    added=$((added + 1))
    # vertical-plugins is searched first so it wins when a name appears in both.
  done < <(find "$checkout/vertical-plugins" "$checkout/agent-plugins" -name SKILL.md 2>/dev/null)

  rm -rf "$checkout"
  log "    installed ${added}, already present ${existing}"
}

main() {
  mkdir -p "$SKILLS_DIR"
  install_wind_skills
  install_cfs_skills

  if [[ ! -f "$HOME/.wind-aifinmarket/config" ]]; then
    warn "no $HOME/.wind-aifinmarket/config — Wind tools will return AUTH_ERROR until WIND_API_KEY is written there"
  fi

  log "==> Installed skills in ${SKILLS_DIR}: $(find "$SKILLS_DIR" -maxdepth 2 -name SKILL.md | wc -l)"
}

main "$@"
