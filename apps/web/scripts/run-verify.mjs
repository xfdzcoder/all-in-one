#!/usr/bin/env node
/**
 * verify 脚本跑批入口（**TST-18**）。
 *
 * 此前 40 个 verify 脚本 + Playwright 没有任何 pnpm 入口，靠 AGENTS.md 人肉记忆挑选执行
 * （过时注释还会误导）。本入口提供：
 *   `pnpm verify`             —— 用法与脚本清单
 *   `pnpm verify smoke`       —— 冒烟集（数据通道/交互主链）
 *   `pnpm verify <name...>`   —— 指定脚本（可多个，按序跑）
 *
 * 前置（脚本自身不拉起）：server :3000 + preview :4173 + `.opencode/.env.verify` 已 source。
 * 任一脚本非零退出即整体非零（D53 门禁判定用）。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname);
const all = readdirSync(dir)
  .filter((f) => f.startsWith("verify-") && f.endsWith(".mjs"))
  .map((f) => f.replace(/\.mjs$/, ""))
  .toSorted();

/** 冒烟集：数据通道/交互主链（D53 门禁常用面）——真机类（live/gallery-live）不含。 */
const SMOKE = ["verify-fr3", "verify-mon", "verify-svc", "verify-tag", "verify-pl5"];

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "list") {
  console.log("用法：pnpm verify smoke | pnpm verify <script...>\n");
  console.log(`冒烟集：${SMOKE.join(" ")}`);
  console.log(`全部脚本（${all.length}）：\n  ${all.join("\n  ")}`);
  process.exit(0);
}

const targets = args[0] === "smoke" ? SMOKE : args.map((a) => a.replace(/\.mjs$/, ""));
const unknown = targets.filter((t) => !all.includes(t));
if (unknown.length > 0) {
  console.error(`未知脚本：${unknown.join(", ")}（pnpm verify list 看清单）`);
  process.exit(2);
}

// 前置探测：server / preview 必须在跑（脚本自身不拉起环境）
for (const [name, url] of [
  ["server :3000", "http://localhost:3000/api/health"],
  ["preview :4173", "http://localhost:4173/"],
]) {
  try {
    await fetch(url);
  } catch {
    console.error(`✗ ${name} 不可达 —— 先起服务：pnpm dev:server / pnpm --filter @all-in-one/web preview（并 source .opencode/.env.verify）`);
    process.exit(2);
  }
}

let failed = 0;
for (const t of targets) {
  console.log(`\n════ ${t} ════`);
  const r = spawnSync(process.execPath, [join(dir, `${t}.mjs`)], { stdio: "inherit" });
  if (r.status !== 0) {
    failed += 1;
    console.error(`✗ ${t} 退出码 ${r.status}`);
  }
}
console.log(`\n════ 跑批结束：${targets.length - failed}/${targets.length} 脚本全绿 ════`);
process.exit(failed > 0 ? 1 : 0);
