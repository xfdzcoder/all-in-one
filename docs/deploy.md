# 部署与备份（NFR1）

## Docker Compose（推荐，G15）

```bash
# 生成一次性密钥
export ADMIN_PASSWORD='你的口令'
export CREDENTIALS_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

docker compose up -d --build
# 首次访问 http://192.168.31.133:3000，用 ADMIN_USERNAME/ADMIN_PASSWORD 登录
```

- 数据（SQLite）持久化在 `./data/app.db`（含 `-wal`/`-shm`）；**插件安装目录 `./data/plugins`** 也在该卷下——备份 `./data` 即覆盖一切。
- `CREDENTIALS_MASTER_KEY` **必须妥善保存**：丢失后已存第三方凭证无法解密（只能重录）。
- 健康检查：`GET /api/health`（compose 内置 HEALTHCHECK）。
- **内网出站（SEC4）**：应用入口探活 / iframe 禁嵌检测 / OpenCode 探测**默认放行内网目标**（服务聚合核心场景，D22/D32）；**custom-api、邮件组件**以本机/内网服务为目标时需设 `ALLOW_PRIVATE_OUTBOUND=1`，否则被 SSRF 基线拒绝。

## 备份 / 恢复

> **迁移回滚（SRV-11）**：drizzle 迁移是 up-only、无 down 脚本 —— 回退靠**整卷还原备份**或手工反向 SQL，
> 步骤与半应用状态处理见 [`apps/server/drizzle/README.md`](../apps/server/drizzle/README.md)。
> 表结构迁移与布局 `LAYOUT_SCHEMA_VERSION` 是两条独立演进线，改数据结构前先看该文档。

```bash
# 备份（随时可做；含 WAL 一致性）
docker compose stop all-in-one     # 停服保证一致性
tar czf backup-$(date +%F).tar.gz ./data
docker compose start all-in-one

# 或在线备份（SQLite WAL 安全，但恢复点略旧）：
cp -r ./data ./backup-$(date +%F)

# 恢复
docker compose stop all-in-one
rm -rf ./data && tar xzf backup-YYYY-MM-DD.tar.gz
docker compose start all-in-one
```

## 接入 Gmail（可选，D37 只读聚合）

IMAP + 应用专用密码已可用；要用 **Gmail API（OAuth）** 专项时按下列步骤接入：

1. **Google Cloud Console**：建（或选）项目 → 启用 **Gmail API**；
2. **OAuth 同意屏幕**：External + Testing，把自己的 Google 账号加进测试用户；
3. **凭据** → 创建 OAuth 客户端 ID（类型：Web 应用）→ 授权重定向 URI 填
   `https://<工作台地址>/api/mail/gmail/callback`（HTTP LAN 场景用 `http://…`）；
4. 复制 **client_id / client_secret**，配置环境变量后重启：
   ```bash
   export GMAIL_CLIENT_ID=xxxx.apps.googleusercontent.com
   export GMAIL_CLIENT_SECRET=GOCSPX-xxxx
   docker compose up -d
   ```
5. **绑定**：邮件组件 →「管理账号」→「绑定 Gmail 账号（OAuth）」→ Google 同意页授权 →
   回调页显示"绑定成功"，账号自动出现在列表（只读：仅 profile / messages.list / messages.get）。
   refresh_token 存**凭证库**（与其它凭证同级加密，SEC3）。

注意：
- 同意屏幕处于 **Testing** 状态时 Google 的 refresh_token **7 天过期**，需重新绑定
  （或把应用"发布上线"以获得长期 token）；
- 重定向 URI 必须与实际访问地址**逐字符一致**（含协议/端口/路径），否则 Google 报 redirect_uri_mismatch；
- 自动化验收：`apps/web/scripts/verify-gmail.mjs`（mock Google，14 项断言，含完整绑定旅程）；
  真实 Google 侧为一次性手工旅程（本节 1–5 步即旅程记录）。

## 公网化前必做（SEC6，D9 触发）

HTTPS 强制（反代终止 TLS）、`COOKIE_SECURE=1`、速率限制、审计日志、
`ALLOW_PRIVATE_OUTBOUND` 保持关闭。见 `docs/feature-plan/06-roadmap.md` §2。

## 日志（NFR6）

- 结构化 JSON 日志；password/secret/token/cookie/authorization 字段自动 `[REDACTED]`。
- `LOG_LEVEL=debug|info|warn|error` 可调；容器日志走 `docker compose logs`。
