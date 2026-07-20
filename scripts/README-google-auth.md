# Google Workspace MCP — Cloud Agent Secret 持久化

Cloud Agent VM 是临时的。`google-workspace-mcp` 把 OAuth refresh token 写在本机文件系统，新 VM 启动后会丢失。把 refresh token 做成 Cloud Agent Secret，启动时用本脚本回写即可。

## 一次性：在 Dashboard 加 Secret

环境：`chrisyangwang/investment`  
Dashboard：https://cursor.com/dashboard/cloud-agents/environments/r/github.com/chrisyangwang/investment

| Secret 名 | 值 | 状态 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id | 已有 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | 已有 |
| `IFIND_AUTH_TOKEN` | iFind token | 已有 |
| **`GOOGLE_REFRESH_TOKEN`** | 本次授权拿到的 refresh token（单行、无引号） | **需新增** |
| **`GOOGLE_ACCOUNT_EMAIL`** | `chrisyangwang@gmail.com` | **需新增**（可选，脚本有默认值） |

本次授权产出的 token 文件：运行产物里的 `GOOGLE_REFRESH_TOKEN.secret.txt`（复制整行粘贴到 Secret Value）。

## 每次运行：bootstrap

```bash
node scripts/bootstrap-google-workspace-mcp.mjs
```

成功后会写出：

- `~/.local/share/google-workspace-mcp/credentials/chrisyangwang_at_gmail_dot_com.json`
- `~/.config/google-workspace-mcp/accounts.json`

并做一次 refresh token 交换校验。

建议把该命令放进环境的 **Install / Setup** 脚本，或在自动化提示词开头要求 agent 先执行。

## Token 失效时

若 bootstrap 报 `invalid_grant`：到 https://myaccount.google.com/permissions 撤销应用授权，重新走一次手动 OAuth（redirect `http://127.0.0.1:8765`），用新 refresh token **覆盖** Secret `GOOGLE_REFRESH_TOKEN`。
