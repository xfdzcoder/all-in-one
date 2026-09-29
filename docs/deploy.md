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

## 公网化前必做（SEC6，D9 触发）

HTTPS 强制（反代终止 TLS）、`COOKIE_SECURE=1`、速率限制、审计日志、
`ALLOW_PRIVATE_OUTBOUND` 保持关闭。见 `docs/feature-plan/06-roadmap.md` §2。

## 日志（NFR6）

- 结构化 JSON 日志；password/secret/token/cookie/authorization 字段自动 `[REDACTED]`。
- `LOG_LEVEL=debug|info|warn|error` 可调；容器日志走 `docker compose logs`。
