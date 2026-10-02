// oxlint-disable-next-line import/default -- `?raw` 导入的默认导出是文件文本，规则识别不了
import gridstackItemSrc from "gridstack/dist/react/gridstack-item.js?raw";
// oxlint-disable-next-line import/default -- 同上
import gridstackSrc from "gridstack/dist/react/gridstack.js?raw";
// oxlint-disable-next-line import/default -- 同上
import gridstackPkgRaw from "gridstack/package.json?raw";
import { describe, expect, it } from "vitest";

/**
 * DEP-2（Q100a）：**Q43 补丁失效检测**。
 *
 * `patches/gridstack@14.0.0.patch` 按**精确版本**记账，而依赖声明曾是 `^14.0.0` ——
 * 上游一旦发 14.0.1，新环境解析到新版本时补丁**不会应用**，拖动竞态（卡片内容消失，
 * Q43）静默回归。现已把声明锁成精确 `14.0.0`，本测试再守两道：
 *   ① 安装到的版本确实 = 补丁记账的版本；
 *   ② 补丁**真的应用了**（产物里有 Q43 守卫注释）——升级 gridstack 时此测试红 = 提醒重做补丁。
 *
 * 注：用 Vite `?raw` 导入取文件内容（web 的 TS 配置不含 node 类型，不引 node:fs）。
 */
describe("gridstack Q43 补丁守卫（DEP-2）", () => {
  it("安装版本 = 补丁记账版本（14.0.0）", () => {
    const pkg = JSON.parse(gridstackPkgRaw) as { version: string };
    expect(pkg.version).toBe("14.0.0");
  });

  it("补丁已应用：产物含 Q43 守卫（两处竞态修复）", () => {
    expect(gridstackItemSrc).toContain("Q43 patch"); // 保持旧容器、不因瞬时查不到节点卸载内容
    expect(gridstackSrc).toContain("Q43 patch"); // last-node 回退 + 拖动中短暂离引擎不丢节点
  });
});
