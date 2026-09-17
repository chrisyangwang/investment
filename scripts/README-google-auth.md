# Google Workspace MCP — Cloud Agent Secret 持久化

Cloud Agent VM 是临时的。`google-workspace-mcp` 把 OAuth refresh token 写在本机文件系统，新 VM 启动后会丢失。把 refresh token 做成 Cloud Agent Secret，启动时用本脚本回写即可。

## 一次性：把 Secret 挂到 Environment（不是只放 My Secrets）

环境：`<OWNER>/<REPO>`  
Environment secrets：https://cursor.com/dashboard/cloud-agents/environments/r/github.com/<OWNER>/<REPO>  

**重要：** Agent 运行时只注入当前 Environment 勾选/配置的 secrets（见 `CLOUD_AGENT_ALL_SECRET_NAMES`）。  
「My Secrets」里有 `GOOGLE_REFRESH_TOKEN` **不够**——必须在该 Environment 里启用/添加同名 secret，新开的 VM 才会注入。已在跑的 agent 不会热更新。

| Secret 名 | 值 | 说明 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id | Environment 已有 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Environment 已有 |
| `IFIND_AUTH_TOKEN` | iFind token | Environment 已有 |
| **`GOOGLE_REFRESH_TOKEN`** | refresh token（单行、无引号） | 须出现在 Environment（可从 My Secrets 启用） |
| **`GOOGLE_ACCOUNT_EMAIL`** | ``$GOOGLE_ACCOUNT_EMAIL`` | 可选（脚本默认该邮箱） |

校验：新 agent 里 `echo $CLOUD_AGENT_ALL_SECRET_NAMES` 应包含 `GOOGLE_REFRESH_TOKEN`。

## 每次运行：bootstrap

```bash
node scripts/bootstrap-google-workspace-mcp.mjs
```

成功后会写出：

- `~/.local/share/google-workspace-mcp/credentials/<email_slug>.json`
- `~/.config/google-workspace-mcp/accounts.json`

并做一次 refresh token 交换校验。

## 环境生命周期放置（Install vs Start）

Cloud Agent 环境用 **build 快照**：`install` 只在构建快照时跑一次并被烘进快照，**每次新 VM 启动不会重跑**；`start` 每次开机都会跑。

因此正确划分是：

- **`install`（构建期，一次性、可幂等、烘进快照）**：预热 `@aaronsb/google-workspace-mcp` 的 npx 包，保证 MCP server 立即可用：
  ```bash
  node --version
  npm exec -y --package=@aaronsb/google-workspace-mcp@^4.5.1 -- node -e "console.log('[install] google-workspace-mcp prewarmed')"
  ```
- **`start`（每次开机跑）**：回写 OAuth 凭据。凭据是临时的、且 refresh token 可能已在 Secret 里被更新，所以**必须放在 `start`**，不能放在 `install`：
  ```bash
  node scripts/bootstrap-google-workspace-mcp.mjs || echo "[start] google-workspace-mcp bootstrap skipped (Google secrets missing/invalid)"
  ```

`|| echo` 保证 token 缺失/失效时不会让开机失败；bootstrap 会把具体原因（含 `invalid_grant` 过期提示）打到 `start-user.log`。

## Token 失效时

若 bootstrap 报 `invalid_grant`：到 https://myaccount.google.com/permissions 撤销应用授权，重新走一次手动 OAuth（redirect `http://127.0.0.1:8765`），用新 refresh token **覆盖** Environment Secret `GOOGLE_REFRESH_TOKEN`。已注入的 agent 不会热更新，必须新开一轮。

Google Cloud OAuth 客户端若处于 **Testing** 发布状态，refresh token 约 7 天后失效。长期 cron 需要把客户端改为 **In production**，否则每次过期都要重做 consent。旧 VM / 历史 transcript 里的 fallback token 也会一并失效，不能作为持久方案。
