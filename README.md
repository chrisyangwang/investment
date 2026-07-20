# investment

## Cloud Agent — Google Workspace auth

Ephemeral Cloud Agent VMs lose local OAuth credentials. Persist Google auth via Secrets + bootstrap:

1. Add Secrets (see `scripts/README-google-auth.md`)
2. On each run: `node scripts/bootstrap-google-workspace-mcp.mjs`
