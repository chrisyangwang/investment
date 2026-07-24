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

建议把该命令放进环境的 **Install / Setup** 脚本，或在自动化提示词开头要求 agent 先执行。

## Token 失效时

若 bootstrap 报 `invalid_grant`：到 https://myaccount.google.com/permissions 撤销应用授权，重新走一次手动 OAuth（redirect `http://127.0.0.1:8765`），用新 refresh token **覆盖** Secret `GOOGLE_REFRESH_TOKEN`。
