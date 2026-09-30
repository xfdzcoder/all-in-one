# 组件 · 插件组件（宿主运行时）

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> 插件体系（FR-W5③/W6/W7）：**D24** ABI 契约 · **D25** 沙箱 = iframe CSP · **D26** 数据/权限执行 · **D27** 动作服务端 registry + 审计。
> 管理面交互见 surfaces/plugin-admin.md（Q23c）；本篇 = 插件组件在**画布上**的宿主行为。

**截图**：——（需安装插件包出镜；行为证据见 verify-pl5~pl8 / verify-j8）

## 组件从哪来

1. 「插件管理」上传 zip（manifest.json + 入口模块）→ 校验（**D24**：entry 限包内相对路径、apiVersion semver、权限显式白名单）→ 解包落 `dataDir/plugins/<type>-<id>/` + 登记；
2. 启用后，manifest 并入**组件选择器**清单（J8"新增组件不改核心"）→ 添加即普通组件实例（gs-id、props、布局一致）。

## 配置（configSchema）

- 由插件 manifest 的 `configSchema` 声明（与内置组件同一套表单生成，FR-W2）。
- `secret` 类字段同内置：入凭证库（SEC3），配置仅存引用。

## 运行时（沙箱与通道）

| 层 | 行为 |
|---|---|
| 渲染 | **iframe CSP**（D25）：禁脚本逃逸、禁顶层导航、独立源；`sandbox` 由宿主给最小集 |
| 数据通道 | `capabilities.data` 声明的资源经宿主代取（FR-W3）；**D26**：按 `permissions` 白名单放行（widgets.data / credentialKinds / 数据源）——越权即拒 |
| 动作通道 | `permissions.actions` 白名单 → **服务端固定 registry** 执行（**D27**）+ 审计日志；插件不能直接调任意 API |
| 凭证 | `credentialKinds` 声明允许的凭证类型；解密只发生在服务端 connector 内 |

## 交互点（与内置组件一致的部分）

| 交互点 | 行为 | 备注 |
|---|---|---|
| 配置按钮（编辑态） | configSchema 表单 → 写回 props（D28） | 同内置 |
| 拖拽/缩放 | 同内置（编辑态布局手势） | iframe 内容吃掉指针事件 → 拖拽把手在外框层 |
| 筛选/刷新 | 视 manifest `capabilities` 而定 | `refresh` 声明才出刷新按钮 |
| 详情 | 视 `capabilities.detail` | FR-I4 同约定 |

## 状态与边界

| 状态 | 表现 |
|---|---|
| 安装失败 | 管理面逐条报错（manifest 校验拒绝原因、zip 越界、体积超限） |
| 运行时拒绝 | 权限越权/数据源未白名单 → 显式错误（不空白，D32 原则） |
| 禁用/卸载 | 禁用：组件保留但不可用；卸载：安装文件+登记删除，**业务数据不动**（§1.3），已添加实例显失效 |

## 已知问题

——（插件运行时细节问题归 Q23c 的 plugin-admin/plugin-runtime 走查一并记录）
