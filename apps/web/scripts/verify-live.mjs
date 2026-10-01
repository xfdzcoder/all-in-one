/**
 * verify-live —— Q45–Q48 真机验收（D47 DoD：真机验证才算完成）：
 * 用真实生产实例（Immich/Navidrome/Portainer/Mihomo）走完整旅程——
 * 建连接（凭证入凭证库）→ 服务概览组件 → 断言主指标与真机实测基线一致、
 * 降级文案真实、无整卡空白。
 *
 * 凭证来源：`.opencode/.env.verify`（gitignored）或环境变量 VERIFY_*；缺失则 SKIP。
 * Run: node scripts/verify-live.mjs (server :3001, preview :4173)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 凭证装载（不打印、不入日志）
const envFile = join(import.meta.dirname, "../../../.opencode/.env.verify");
let env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
}
const need = ["VERIFY_IMMICH_URL", "VERIFY_IMMICH_API_KEY", "VERIFY_NAVIDROME_URL", "VERIFY_NAVIDROME_USER", "VERIFY_NAVIDROME_PASS", "VERIFY_PORTAINER_URL", "VERIFY_PORTAINER_TOKEN", "VERIFY_CLASH_URL", "VERIFY_CLASH_SECRET"];
if (!need.every((k) => env[k])) {
  console.log("SKIP  verify-live：凭证缺失（.opencode/.env.verify 未配置）");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = (label, exact = false) =>
  page.evaluate(
    ({ l, ex }) => {
      const btns = [...document.querySelectorAll("button")];
      const btn = ex ? btns.find((b) => b.textContent.trim() === l) : btns.find((b) => b.textContent.trim().includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
  );

const selectOption = async (label, optionText) => {
  await page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    wrapper?.querySelector("[role=combobox]")?.click();
  }, label);
  await sleep(300);
  return page.evaluate((o) => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.offsetParent !== null && e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
};

const addOverview = async (sourceName, cardPrefix = "服务概览") => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  const picked = await page.evaluate((p) => {
    const card = [...document.querySelectorAll(".wb-picker-card")].find((c) => c.textContent.trim().startsWith(p));
    card?.click();
    return Boolean(card);
  }, cardPrefix);
  if (!picked) return false;
  await sleep(400);
  if (!(await selectOption("数据连接", sourceName))) return false;
  await sleep(200);
  return clickBtn("确认添加", true);
};

/** 某张服务概览卡的文本（按连接名定位 grid item）。 */
const cardText = (sourceName) =>
  page.evaluate((n) => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(n));
    return item?.textContent ?? "";
  }, sourceName);

/** 等卡片取到数据（真机多接口串行 + 冷启动 DNS/TLS，3s 不够）。 */
const waitForCard = async (sourceName, timeoutMs = 30_000) => {
  const start = Date.now();
  let text = "";
  while (Date.now() - start < timeoutMs) {
    text = await cardText(sourceName);
    if (text.includes("详情") && (text.includes("探测失败") || text.includes("刷新") && text.length > 120)) return text;
    await sleep(700);
  }
  return text;
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });

  // 重置首页布局（清掉历史测试卡，防定位歧义）
  await page.evaluate(async () => {
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页");
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(800);

  const uniq = Date.now().toString(36).slice(-4);
  const names = {
    immich: `LIVE-immich-${uniq}`,
    navidrome: `LIVE-navidrome-${uniq}`,
    portainer: `LIVE-portainer-${uniq}`,
    mihomo: `LIVE-mihomo-${uniq}`,
  };

  // 建连接（secret → 凭证库，连接仅存引用 SEC3）
  const seeded = await page.evaluate(
    async ({ env, names }) => {
      const cred = (name, secret) =>
        fetch("/api/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, kind: "http-header", secret }),
        }).then((r) => r.json());
      const mk = (kind, name, config) =>
        fetch("/api/data-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name, config }),
        }).then((r) => r.ok);
      const immichCred = await cred(`${names.immich}-key`, env.VERIFY_IMMICH_API_KEY);
      const ndCred = await cred(`${names.navidrome}-pass`, env.VERIFY_NAVIDROME_PASS);
      const ptCred = await cred(`${names.portainer}-token`, env.VERIFY_PORTAINER_TOKEN);
      const clCred = await cred(`${names.mihomo}-secret`, env.VERIFY_CLASH_SECRET);
      return {
        immich: await mk("immich", names.immich, { url: env.VERIFY_IMMICH_URL, apiKey: { credentialRef: immichCred.id } }),
        navidrome: await mk("navidrome", names.navidrome, { url: env.VERIFY_NAVIDROME_URL, username: env.VERIFY_NAVIDROME_USER, password: { credentialRef: ndCred.id } }),
        portainer: await mk("portainer", names.portainer, { url: env.VERIFY_PORTAINER_URL, apiToken: { credentialRef: ptCred.id } }),
        mihomo: await mk("mihomo", names.mihomo, { url: env.VERIFY_CLASH_URL, secret: { credentialRef: clCred.id } }),
      };
    },
    { env: { ...env }, names },
  );
  ok("LIVE seed real connections", Object.values(seeded).every(Boolean), JSON.stringify(seeded));

  await clickBtn("编辑页面");
  await sleep(300);
  for (const n of Object.values(names)) {
    ok(`LIVE add overview (${n})`, await addOverview(n));
    await sleep(3000);
  }
  await clickBtn("完成编辑");
  await sleep(1500);

  // Q45 Immich：照片/视频/占用/按用户（真机基线：16309 照片 / 140 视频 / xfdzcoder）
  const imm = await waitForCard(names.immich);
  ok("LIVE immich metrics match real instance", imm.includes("16,309") && imm.includes("140") && imm.includes("xfdzcoder"), imm.slice(0, 160));
  ok("LIVE immich Q49 new-count + recent uploads", imm.includes("近 7 天新增") && imm.includes("最近上传"), imm.slice(0, 200));
  ok("LIVE immich no dishonest degradation", !imm.includes("获取失败"), imm.slice(-120));

  // Q46 Navidrome：曲目/专辑/艺术家聚合（真机基线：1376 / 269 / 38）
  const nd = await waitForCard(names.navidrome);
  ok("LIVE navidrome library counts match", nd.includes("1,376") && nd.includes("269") && nd.includes("38"), nd.slice(0, 160));
  ok("LIVE navidrome lists rendered (recent/now-playing)", nd.includes("最近添加") && nd.includes("正在播放"), nd.slice(0, 120));

  // Q47 Portainer：容器 23/25 + 异常清单（真机基线：23 running / 25 total，有异常容器）
  const pt = await waitForCard(names.portainer);
  ok("LIVE portainer container counts match", pt.includes("23/25"), pt.slice(0, 160));
  ok("LIVE portainer status list rendered", pt.includes("异常容器") || pt.includes("容器状态"), pt.slice(0, 120));

  // Q48 Mihomo：出口选择 + 活动连接 + 策略组清单（真机有 ♻️ 自动选择 组）
  const cl = await waitForCard(names.mihomo);
  ok("LIVE mihomo picks + connections rendered", cl.includes("出口选择") && cl.includes("活动连接") && cl.includes("自动选择"), cl.slice(0, 160));
  ok("LIVE mihomo memory metric or honest note", cl.includes("内存"), cl.slice(-120));

  // Q50 Immich 照片墙（D50 只读深度）：真机缩略图网格（服务端代取 data URI）
  await clickBtn("编辑页面");
  await sleep(300);
  ok("LIVE add immich gallery", await addOverview(names.immich, "Immich 照片墙"));
  await clickBtn("完成编辑");
  await sleep(1000);
  // 缩略图逐张服务端代取（12 张串行），轮询等就绪
  let gal = { count: 0, dataUri: 0 };
  for (let i = 0; i < 40 && gal.count === 0; i++) {
    gal = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll(".wb-gallery img")];
      return { count: imgs.length, dataUri: imgs.filter((x) => x.src.startsWith("data:image/jpeg;base64,")).length };
    });
    if (gal.count === 0) await sleep(700);
  }
  ok("LIVE immich gallery real thumbnails render", gal.count >= 6 && gal.dataUri === gal.count, JSON.stringify(gal));

  // Q51 Navidrome 专辑墙（D50）：真机封面网格
  await clickBtn("编辑页面");
  await sleep(300);
  ok("LIVE add navidrome album wall", await addOverview(names.navidrome, "Navidrome 专辑墙"));
  await clickBtn("完成编辑");
  await sleep(1000);
  let ndGal = { count: 0, dataUri: 0 };
  for (let i = 0; i < 40 && ndGal.count === 0; i++) {
    ndGal = await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((x) => x.textContent.includes("专辑墙"));
      const imgs = [...(item?.querySelectorAll(".wb-gallery img") ?? [])];
      return { count: imgs.length, dataUri: imgs.filter((x) => x.src.startsWith("data:image/jpeg;base64,")).length };
    });
    if (ndGal.count === 0) await sleep(700);
  }
  ok("LIVE navidrome album covers render", ndGal.count >= 6 && ndGal.dataUri === ndGal.count, JSON.stringify(ndGal));

  // Q55 Navidrome 播放遥控（D51）：真机写操作（点「播放」= 唤醒/继续，最低干预）
  ok(
    "LIVE navidrome write action accepted",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("专辑墙"));
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "播放");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(1500);
  const ndCtrlErr = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("专辑墙"));
    return item?.textContent.includes("控制失败") ?? false;
  });
  ok("LIVE navidrome write action no error surfaced", !ndCtrlErr);

  // Q52 Portainer 容器清单（D50）：真机清单 + 异常高亮
  await clickBtn("编辑页面");
  await sleep(300);
  ok("LIVE add portainer containers", await addOverview(names.portainer, "Portainer 容器清单"));
  await clickBtn("完成编辑");
  await sleep(2500);
  const pcTxt = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("容器清单"));
    return item?.textContent ?? "";
  });
  ok("LIVE portainer container list matches real host", pcTxt.includes("homepage") && pcTxt.includes("minecraft-mc-1") && pcTxt.includes("Exited (143)"), pcTxt.slice(0, 160));

  // Q56 容器重启守卫（D51）：真机连接无白名单 → 无重启入口 + API 拒绝（不触碰真实容器）
  const restartBtns = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("aria-label") || b.textContent).trim() === "重启").length,
  );
  ok("LIVE portainer restart hidden without whitelist (guardrail)", restartBtns === 0, "count=" + restartBtns);
  const denied = await page.evaluate(async (name) => {
    const list = await (await fetch("/api/data-sources")).json();
    const row = list.find((r) => r.name === name);
    const r = await fetch("/api/portainer/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: row?.id ?? "missing", containerId: "probe" }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  }, names.portainer);
  ok("LIVE portainer restart API denies without whitelist", denied.status === 400 && denied.body.includes("重启未开放"), JSON.stringify(denied));

  // Q53 Mihomo 节点面板（D50）：真机策略组/节点/订阅源
  await clickBtn("编辑页面");
  await sleep(300);
  ok("LIVE add mihomo nodes panel", await addOverview(names.mihomo, "Mihomo 节点面板"));
  await clickBtn("完成编辑");
  await sleep(2500);
  const mnTxt = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("节点面板"));
    return item?.textContent ?? "";
  });
  ok("LIVE mihomo nodes panel matches real instance", mnTxt.includes("策略组") && mnTxt.includes("节点（") && mnTxt.includes("订阅源"), mnTxt.slice(0, 160));

  // Q57 策略组切换（D51）：真机**空切换**（选当前节点 → PUT 同名，零实际影响）验证写路径
  ok(
    "LIVE mihomo switch entry",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("节点面板"));
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => (b.getAttribute("aria-label") || b.textContent).trim() === "切换");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(500);
  const pickNoop = await page.evaluate(() => {
    const current = document.querySelector(".mantine-Modal-root b")?.textContent ?? "";
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === current || b.textContent.trim() === `${current}（当前）`);
    btn?.click();
    return current;
  });
  await sleep(300);
  ok(
    "LIVE mihomo noop-switch confirmed (same node)",
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "确认切换");
      btn?.click();
      return Boolean(btn);
    }) && Boolean(pickNoop),
    "current=" + pickNoop,
  );
  await sleep(1500);
  const switchErr = await page.evaluate(() => (document.body.textContent ?? "").includes("切换失败"));
  ok("LIVE mihomo noop-switch no error surfaced", !switchErr);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
