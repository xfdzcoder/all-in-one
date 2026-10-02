# 本目录是**故意的空占位**，请勿在此添加 workflow

Forgejo 按 `.forgejo/workflows` → `.gitea/workflows` → `.github/workflows` 的顺序查找
workflow 目录，**命中第一个存在的目录就只用它**（哪怕里面一个 workflow 都没有）——
见 `modules/actions/workflows.go` 的 `ListWorkflows`：

> returns the name of the first one it encounters … We have found a valid source that
> we will use, **no matter whether it contains workflows or not**.

本仓库从内部 Forgejo **单向镜像**到 GitHub：

- **CI 与发布流水线只在 GitHub 镜像侧运行**（`.github/workflows/`，badge 也指向 GitHub）；
- 本目录存在 → Forgejo 侧发现 0 个 workflow → 不再创建任何 run；
- GitHub 只读 `.github/workflows`，完全无视本目录。

若将来想让 Forgejo 侧也跑某些流水线，把 `*.yml` / `*.yaml` 放进本目录即可
（注意：届时 `.github/workflows/` 会被 Forgejo 忽略，需要的 workflow 要一并搬过来）。
