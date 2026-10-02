# Changelog

本项目所有值得记录的变更都写在这里。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

发布方式：打 `v*` tag → CI 构建镜像推送 GHCR 并创建 GitHub Release（说明取自本文件对应段落）。

## [Unreleased]

### Added

- GitHub 发布配套：README 重写（特性矩阵 / Docker 快速开始 / 环境变量表）、MIT License、`CONTRIBUTING.md`、`SECURITY.md`、Issue 与 PR 模板、`.env.example`
- GitHub Actions：CI（test / typecheck / lint）与 Docker 流水线（构建 + 健康冒烟，tag 时推 GHCR 并创建 Release）

### Fixed

- Docker 构建失败：D49 的 `patches/gridstack@14.0.0.patch` 未在 `pnpm install` 之前拷入两个构建阶段，pnpm 直接中止
- 新增 `.dockerignore`：构建上下文 478M → 18kB，`.git`、`.opencode`（含真实凭证）、开发库与宿主 node_modules 不再进入构建上下文

## 历史（0.x 前的迭代）

首个正式版本 `v0.1.0` 尚未发布。此前的开发历程（MVP 里程碑 M0–M3、组件与接入能力）见
[`docs/feature-plan/05-mvp.md`](docs/feature-plan/05-mvp.md) 与 [`docs/feature-plan/06-roadmap.md`](docs/feature-plan/06-roadmap.md)。

<!-- 段落类型：Added / Changed / Deprecated / Removed / Fixed / Security -->
