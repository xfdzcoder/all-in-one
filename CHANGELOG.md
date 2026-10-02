# Changelog

本项目所有值得记录的变更都写在这里。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

**发布流程**：把 `[Unreleased]` 段改写为版本段（`## [x.y.z] - 日期`）并在顶部新开 `[Unreleased]`，
然后打 `vx.y.z` tag —— CI 自动构建镜像推送 GHCR（tag 不带 `v`，如 `:x.y.z` / `:x.y` / `:latest`）
并创建 GitHub Release（说明取自本文件对应段落）。

## [Unreleased]

## [0.1.0] - 2026-10-03

首个公开版本：个人工作台本体（MVP M0–M3 交付）+ Docker 单镜像部署 + GitHub 发布配套。

### Added · 产品能力（MVP 交付）

- 可配置桌面：gridstack 自由拖放 / 缩放 / 断点布局，桌面端编辑、移动端浏览
- 16 个内置组件：个人 Todo、看板、RSS 聚合、应用入口、服务概览、嵌入页面、
  Immich 照片墙、Navidrome 专辑墙、Portainer 容器清单、Mihomo 节点面板、服务器监控、
  邮件聚合（IMAP / Gmail 只读）、图表（ECharts，HTTP 快照或 WS 实时流）、自定义 API、
  指标卡片、占位组件
- 组件系统：manifest + configSchema 声明契约、代码级插件（iframe 沙箱 + 权限声明）、受限 JSX 模板
- 凭证加密仓库（AES-256-GCM）+ 服务端 connector 统一出站（限流 / 超时 / 体积上限、默认拒绝内网目标）
- 主题与自定义 CSS 编辑器（高亮 / 提示 / 历史备份）、图标体系、账户设置（改名 / 改密须验当前口令）
- Docker 单镜像部署 + 备份 / 恢复文档（[`docs/deploy.md`](docs/deploy.md)）

### Added · 发布配套

- README 重写（特性矩阵 / Docker 快速开始 / 环境变量表）、MIT License、`CONTRIBUTING.md`、
  `SECURITY.md`、Issue 与 PR 模板、`.env.example`
- GitHub Actions：CI（test / typecheck / lint）与 Docker 流水线（构建 + 健康冒烟，tag 时推 GHCR 并创建 Release）

### Fixed · 发布配套

- Docker 构建失败：D49 的 `patches/gridstack@14.0.0.patch` 未在 `pnpm install` 之前拷入两个构建阶段，pnpm 直接中止
- 新增 `.dockerignore`：构建上下文 478M → 18kB，`.git`、`.opencode`（含真实凭证）、开发库与宿主 node_modules 不再进入构建上下文

0.1.0 之前的开发历程（迭代批次与全部技术决策）见
[`docs/feature-plan/05-mvp.md`](docs/feature-plan/05-mvp.md) 与 [`docs/feature-plan/02-decisions.md`](docs/feature-plan/02-decisions.md)。

<!-- 段落类型：Added / Changed / Deprecated / Removed / Fixed / Security -->
