/**
 * @all-in-one/widget-sdk —— Widget 契约包（D4/D7 的落地物）。
 *
 * 这是宿主（apps/web、apps/server）与所有 Widget（内置 + 未来第三方）之间
 * 的唯一契约来源：manifest / configSchema / 数据通道 / 动作 / 生命周期。
 *
 * 边界纪律（AGENTS.md）：本包不得反向依赖 apps；布局引擎（gridstack）
 * 不得泄漏进本包。
 */

export {
  type ConfigField,
  type ConfigFieldType,
  type ConfigSchema,
  type ConfigValues,
  type SecretRef,
  isSecretRef,
  validateConfigSchema,
} from "./config.ts";

export {
  type DataCapability,
  type DataSourceKind,
  type RefreshCapability,
  type WidgetDataResponse,
  type WidgetDataState,
} from "./data.ts";

export {
  type ActionCapability,
  type ActionDispatcher,
} from "./action.ts";

export {
  type WidgetComponent,
  type WidgetProps,
} from "./lifecycle.ts";

export {
  type WidgetManifest,
  type WidgetSize,
  validateManifest,
} from "./manifest.ts";

export {
  type PluginManifest,
  type PluginPermissions,
  isPluginManifest,
  isSafePluginEntry,
  validatePluginManifest,
  PLUGIN_ENTRY_PATTERN,
  SEMVER_PATTERN,
} from "./plugin.ts";
