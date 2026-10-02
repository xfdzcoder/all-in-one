# @all-in-one/web

React 19 + Vite SPA —— 工作台前端宿主：布局引擎（gridstack，仅封装于此包）、Widget 渲染、登录与 Dashboard 壳。

## 常用命令

- `pnpm dev` — 开发服务器（`/api` 代理到 `127.0.0.1:3000`，dev 与 preview 均生效）；`pnpm dev --host` 仅本包（vite）开到局域网，其余子包忽略该参数（server 仍只监听 `127.0.0.1:3000`，局域网请求经 vite 代理进 API）
- `pnpm build` — `tsc -b && vite build`
- `pnpm typecheck` / `pnpm lint`（oxlint）
- `node scripts/verify-m1.mjs` — M1 端到端验收（需 server :3000 + preview :4173；依赖 puppeteer-core + 系统 Chrome）

## 结构

- `src/App.tsx` — 会话门禁 + Dashboard 壳（页面 Tab、新建/删除）
- `src/Board.tsx` — 单页布局：gridstack 挂接、编辑/浏览模式、防抖自动保存
- `src/widgets.tsx` / `src/widget-registry.ts` — 占位组件与组件映射（M2 换成 widget-sdk 注册表）
- `src/api.ts` — 工作台 REST 客户端（同源 Cookie 会话）

## 注意

- gridstack 的坑（options 稳定性、onAdded/onRemoved、50% 碰撞规则等）见根 `AGENTS.md`。
- 手机/平板禁布局编辑（D10）：`canEdit` 由 `useMediaQuery("(min-width: 768px)")` 决定。
