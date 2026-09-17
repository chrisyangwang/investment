# Cloud Agent environment bootstrap

These scripts make Google Workspace MCP, Wind skills, and A-share finance skills
survive Cloud Agent VM rebuilds when wired into the environment **Install** / **Start** commands.

## Scripts

| Script | Role |
| --- | --- |
| `cloud-agent-install.sh` | Durable install: npm package, Wind skills, china-finance skills, then Google credential hydrate |
| `cloud-agent-start.sh` | Per-boot: re-hydrate secrets; fill missing skills if JIT boot |
| `install-google-workspace-mcp.sh` | `npm i -g @aaronsb/google-workspace-mcp` + `~/.cursor/mcp.json` |
| `bootstrap-google-workspace-mcp.mjs` | Write OAuth refresh token files from Cloud Secrets |
| `bootstrap-wind-skills.sh` | Global `wind-mcp-skill` + `wind-find-finance-skill` + `WIND_API_KEY` config |
| `bootstrap-china-finance-skills.sh` | Copy skills from `jwangkun/claude-for-financial-services-cn` |

## Recommended environment.json commands

**Install**

```bash
bash scripts/cloud-agent-install.sh
```

**Start**

```bash
bash scripts/cloud-agent-start.sh
```

Equivalent one-liners matching the Google-only pattern:

```bash
# install
bash scripts/cloud-agent-install.sh

# start
node scripts/bootstrap-google-workspace-mcp.mjs || echo "[start] google-workspace-mcp bootstrap skipped (Google secrets missing/invalid)"
```

Prefer `cloud-agent-start.sh` so Wind key + missing-skill recovery also run every boot.

## Required Cloud Agent Secrets (Environment-scoped)

| Secret | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REFRESH_TOKEN` | Non-interactive auth for Cloud Agents |
| `GOOGLE_ACCOUNT_EMAIL` | Account email for google-workspace-mcp |
| `WIND_API_KEY` | Wind AIFin Market key (`ak_…`) |
| `IFIND_AUTH_TOKEN` | Optional (iFind) |

Do **not** commit API keys into the repository. Put them in the Environment secrets panel.

## Verify

```bash
bash scripts/cloud-agent-install.sh
ls ~/.agents/skills/wind-mcp-skill/SKILL.md
ls ~/.agents/skills/china-dcf/SKILL.md
test -f ~/.wind-aifinmarket/config && echo wind_key_ok
test -x ~/.npm-global/bin/google-workspace-mcp && echo gws_pkg_ok
```
