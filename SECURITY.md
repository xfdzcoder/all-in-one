# 安全策略

## 支持版本

| 分支 | 支持 |
|---|---|
| `main` | ✅ 持续维护 |
| 其他分支 / 历史 tag | ❌ 不提供安全修复 |

项目处于早期开发阶段，版本号为 0.x，请始终使用 `main` 最新代码或最新的 Release 镜像。

## 报告漏洞

- **请优先使用 GitHub 的 Private Vulnerability Reporting**（仓库 Security 页 → Report a vulnerability），不要在公开 Issue 中披露细节。
- 若该功能未开启，请开一个**不含细节**的公开 Issue 索取私下联系方式，我会主动跟进。
- 报告请包含：影响版本/部署方式、复现步骤、影响评估。**请勿附带真实凭证、密钥、cookie 或个人数据**。
- 我会尽力在收到报告后 7 天内给出初步回应；修复后在 [`CHANGELOG.md`](CHANGELOG.md) 与 Release 说明中致谢（如你希望署名）。

## 安全模型（摘要）

- 单账号密码登录，口令 `argon2id` 哈希存储；会话 TTL 30 天。
- 第三方凭证 **AES-256-GCM** 加密存储，主密钥来自环境变量 `CREDENTIALS_MASTER_KEY`；凭证不下发前端明文、日志自动 `[REDACTED]`。
- 第三方出站请求全部经服务端 connector，带超时/体积上限，**默认拒绝内网目标**（SSRF 基线；`ALLOW_PRIVATE_OUTBOUND=1` 为显式逃生阀，仅内网自建服务聚合场景使用）。
- 嵌入页面走 iframe 沙箱并做禁嵌检测；静态资源伺服带路径穿越防护。
- 数据库迁移 up-only、无自动回滚，回退依赖 `./data` 备份（见 [`docs/deploy.md`](docs/deploy.md)）。

## 公网化部署前必做（重要）

在把实例暴露到公网之前**必须**完成（否则存在会话劫持与滥用风险）：

1. HTTPS 反代终止 TLS；
2. 设置 `COOKIE_SECURE=1`（否则会话 cookie 明文可截获）；
3. 速率限制与审计日志；
4. `ALLOW_PRIVATE_OUTBOUND` 保持关闭。

完整清单见 [`docs/deploy.md`](docs/deploy.md)「公网化前必做」与 [`docs/feature-plan/06-roadmap.md`](docs/feature-plan/06-roadmap.md)。

## 明确的非目标（当前版本）

多用户/RBAC/OAuth/2FA、公网高可用、插件沙箱强隔离等仍在路线图（`01-requirements.md` §1.2/§2.3），**不要假设当前版本可安全承载多租户或不可信用户**。
