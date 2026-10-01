/**
 * SVC acceptance（Q39 第三方服务接入 · D46 连接+概览展示）：
 *  ① 数据源管理建四类服务连接（mihomo/portainer/navidrome/immich，mock API）；
 *  ② 「服务概览」组件选连接 → 探活徽标 + 版本 + 各服务关键计数；
 *  ③ 官方品牌图标随连接展示；④ 坏连接 → 显式「探测失败」提示。
 * mock 服务在脚本内起 HTTP（同 verify-mon 模式）。
 * Run: node scripts/verify-svc.mjs (server :3000, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);

const json = (obj) => JSON.stringify(obj);
const ctrlHits = [];
const mock = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = req.url ?? "";
  // portainer 容器重启（Q56 写操作）——记录命中供断言
  // （D54：navidrome 播放遥控 / mihomo 策略组切换的 mock 与用例已随写操作移除）
  if (url.includes("/restart") && req.method === "POST") {
    ctrlHits.push("restart:" + url);
    return res.end(json({ message: "restarted" }));
  }
  // mihomo
  if (url.startsWith("/version")) return res.end(json("v1.18.8"));
  if (url.startsWith("/proxies"))
    return res.end(
      json({
        proxies: {
          GLOBAL: { now: "DIRECT", all: ["DIRECT"], history: [] },
          "♻️ 自动选择": { now: "香港WAP", all: ["a", "b"], history: [{ delay: 88 }] },
          香港WAP: { type: "Shadowsocks", alive: true, history: [{ delay: 88 }] },
          DIRECT: { history: [] },
        },
      }),
    );
  if (url.startsWith("/memory")) return res.end(json({ inuse: 67108864 }));
  if (url.startsWith("/connections"))
    return res.end(json({ downloadTotal: 2 ** 30, uploadTotal: 2 ** 28, connections: [{}, {}, {}] }));
  if (url.startsWith("/providers/rules")) return res.end(json({ providers: { custom: { ruleCount: 11 } } }));
  if (url.startsWith("/providers/proxies")) return res.end(json({ providers: { airport: {} } }));
  // portainer
  if (url.startsWith("/api/system/status")) return res.end(json({ Version: "2.21.4" }));
  if (url.startsWith("/api/endpoints/1/docker/containers/json"))
    return res.end(
      json([
        { Id: "c-good", Names: ["/good"], State: "running", Status: "Up 2 days" },
        { Id: "c-bad", Names: ["/bad"], State: "exited", Status: "Exited (1) 2 days ago" },
      ]),
    );
  if (url.startsWith("/api/endpoints/1/docker/info"))
    return res.end(json({ Images: 32, NVolumes: 5, NCPU: 8, MemTotal: 8 * 2 ** 30 }));
  if (url.startsWith("/api/endpoints/1/docker/containers/") && url.includes("/logs")) {
    res.setHeader("Content-Type", "application/vnd.docker.raw-stream");
    return res.end(Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, 5]), Buffer.from("hello")]));
  }
  if (url.startsWith("/api/endpoints")) return res.end(json([{ Id: 1 }, { Id: 2 }]));
  // navidrome（实测形态：无 getStats → getScanStatus + getArtists）
  if (url.startsWith("/rest/ping")) return res.end(json({ "subsonic-response": { status: "ok", version: "0.53.3" } }));
  if (url.startsWith("/rest/getScanStatus"))
    return res.end(json({ "subsonic-response": { scanStatus: { scanning: false, count: 100, lastScan: "2026-09-25T03:04:48Z" } } }));
  if (url.startsWith("/rest/getArtists"))
    return res.end(json({ "subsonic-response": { artists: { index: [{ artist: [{ name: "甲", albumCount: 6 }, { name: "乙", albumCount: 4 }] }] } } }));
  if (url.startsWith("/rest/getAlbumList2"))
    return res.end(json({ "subsonic-response": { albumList2: { album: [{ id: "al-1", name: "新专辑", artist: "某人", coverArt: "al-1" }] } } }));
  if (url.startsWith("/rest/getNowPlaying")) return res.end(json({ "subsonic-response": { nowPlaying: {} } }));
  if (url.startsWith("/rest/getCoverArt")) {
    res.setHeader("Content-Type", "image/jpeg");
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02]));
  }
  // immich（实测 v3 路由）
  if (url.startsWith("/api/server/ping")) return res.end(json({ res: "pong" }));
  if (url.startsWith("/api/server/version")) return res.end(json({ major: 3, minor: 2, patch: 2 }));
  if (url.startsWith("/api/server/statistics"))
    return res.end(
      json({
        photos: 12,
        videos: 3,
        usage: 2 ** 30,
        usagePhotos: 2 ** 29,
        usageVideos: 2 ** 29,
        usageByUser: [{ userId: "u1", userName: "mock-user", photos: 12, videos: 3, usage: 2 ** 30 }],
      }),
    );
  if (url.startsWith("/api/search/metadata"))
    return res.end(
      json({
        assets: {
          total: 2,
          count: 2,
          nextPage: "2",
          items: [
            { id: "t1", originalFileName: "shot.jpg", type: "IMAGE", createdAt: "2026-09-26T02:27:30Z" },
            { id: "t2", originalFileName: "clip.mp4", type: "VIDEO", createdAt: "2026-09-26T02:27:31Z" },
          ],
        },
      }),
    );
  if (url.startsWith("/api/assets/") && url.includes("/thumbnail")) {
    res.setHeader("Content-Type", "image/jpeg");
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]));
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;

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
  // 卡片 = name+category+desc 的 UnstyledButton —— 按 name 前缀定位（精确文本会失配）
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

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(400);

  // 重置首页布局（清掉历史轮次的测试卡 —— scoped 查找按首个匹配，残留会污染断言）
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

  // 前置：四类服务连接 + 一个坏连接（API 播种）
  const seeded = await page.evaluate(
    async ({ base, uniq }) => {
      const mk = (kind, name, config) =>
        fetch("/api/data-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name, config }),
        }).then((r) => r.ok);
      return {
        mihomo: await mk("mihomo", `svc-mihomo-${uniq}`, { url: base }),
        portainer: await mk("portainer", `svc-portainer-${uniq}`, { url: base, restartAllow: "bad" }),
        navidrome: await mk("navidrome", `svc-navidrome-${uniq}`, { url: base, username: "u", password: { credentialRef: "cred:none" } }),
        immich: await mk("immich", `svc-immich-${uniq}`, { url: base }),
        broken: await mk("mihomo", `svc-broken-${uniq}`, { url: "http://127.0.0.1:1" }),
      };
    },
    { base, uniq },
  );
  ok("SVC seed service connections", Object.values(seeded).every(Boolean), JSON.stringify(seeded));

  // ①② mihomo 概览
  ok("SVC enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("SVC add mihomo overview", await addOverview(`svc-mihomo-${uniq}`));
  await sleep(2500);
  let body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC mihomo version + structured metrics (D48)", body.includes("v1.18.8") && body.includes("出口选择") && body.includes("活动连接"), body.slice(-140));

  // portainer / navidrome / immich
  ok("SVC add portainer overview", await addOverview(`svc-portainer-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC portainer abnormal container surfaced first", body.includes("2.21.4") && body.includes("1/2") && body.includes("异常容器") && body.includes("bad"), body.slice(-140));

  ok("SVC add navidrome overview", await addOverview(`svc-navidrome-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC navidrome library aggregation (no getStats)", body.includes("0.53.3") && body.includes("曲目") && body.includes("100") && body.includes("专辑") && body.includes("10"), body.slice(-140));

  ok("SVC add immich overview", await addOverview(`svc-immich-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC immich v3 routes + per-user list", body.includes("3.2.2") && body.includes("照片") && body.includes("12") && body.includes("mock-user"), body.slice(-140));
  ok("SVC immich Q49 new-count + recent uploads", body.includes("近 7 天新增") && body.includes("最近上传") && body.includes("shot.jpg"), body.slice(-140));

  // Q69（项 4）：指标字号随卡片缩小而缩小，但**有最大字体**（用户明确要求）。
  // 用两个不同宽度的探针容器直接验证 CSS 契约 `clamp(min, 13cqw, max)`，与具体服务无关。
  const typo = await page.evaluate(() => {
    const mk = (w) => {
      const host = document.createElement("div");
      host.style.cssText = `position:absolute;left:-9999px;top:0;width:${w}px`;
      host.innerHTML =
        '<div class="wb-metric"><div class="wb-metric__label">照片</div><div class="wb-metric__value wb-metric__value--display">16,309</div></div>';
      document.body.appendChild(host);
      const m = host.querySelector(".wb-metric");
      const v = host.querySelector(".wb-metric__value");
      const out = {
        width: w,
        containerType: getComputedStyle(m).containerType,
        font: parseFloat(getComputedStyle(v).fontSize),
      };
      host.remove();
      return out;
    };
    return {
      wide: mk(420),
      narrow: mk(120),
      max: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wb-text-display")),
    };
  });
  ok(
    "Q69 metric font scales with card, capped at max (项 4)",
    typo.wide.font <= typo.max + 0.5 && typo.narrow.font < typo.wide.font,
    JSON.stringify(typo),
  );
  ok("Q69 .wb-metric is a size container", typo.wide.containerType === "inline-size", typo.wide.containerType);
  const primaryMinH = await page.evaluate(() => {
    const el = document.querySelector(".wb-metric--primary");
    return el ? parseFloat(getComputedStyle(el).minHeight) : -1;
  });
  ok("Q69 primary metric has min-height (项 3 出口选择不被裁切)", primaryMinH >= 60, `minHeight=${primaryMinH}`);
  const gridCols = await page.evaluate(() => {
    const el = document.querySelector(".wb-metric-grid--3");
    return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
  });
  ok("Q69 secondary metric grid is 3 columns (一行三个)", gridCols === 3, `cols=${gridCols}`);

  // Q50 Immich 照片墙（FR-X3 只读深度 D50）：缩略图服务端代取 → data URI 网格
  ok("SVC add immich gallery", await addOverview(`svc-immich-${uniq}`, "Immich 照片墙"));
  await sleep(2500);
  const gal = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll(".wb-gallery img")];
    return { count: imgs.length, dataUri: imgs.every((i) => i.src.startsWith("data:image/jpeg;base64,")) };
  });
  ok("SVC immich gallery renders server-fetched thumbs (D50)", gal.count >= 1 && gal.dataUri, JSON.stringify(gal));

  // Q51 Navidrome 专辑墙（D50 只读深度）：封面服务端代取 → data URI 网格
  ok("SVC add navidrome album wall", await addOverview(`svc-navidrome-${uniq}`, "Navidrome 专辑墙"));
  await sleep(2500);
  const ndGal = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("专辑墙"));
    const imgs = [...(item?.querySelectorAll(".wb-gallery img") ?? [])];
    return { count: imgs.length, dataUri: imgs.every((i) => i.src.startsWith("data:image/jpeg;base64,")) };
  });
  ok("SVC navidrome album covers render (D50)", ndGal.count >= 1 && ndGal.dataUri, JSON.stringify(ndGal));
  // D54：播放遥控写操作已移除 —— 专辑墙应为纯只读（无播放/暂停等按钮）
  ok(
    "SVC navidrome is read-only (D54, no remote control)",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("专辑墙"));
      const labels = [...(item?.querySelectorAll("button") ?? [])].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
      return !labels.some((l) => ["播放", "暂停", "上一首", "下一首", "停止"].includes(l));
    }),
  );

  // Q52 Portainer 容器清单（D50 只读深度）：清单 + 异常高亮 + 日志尾部只读
  ok("SVC add portainer containers", await addOverview(`svc-portainer-${uniq}`, "Portainer 容器清单"));
  await sleep(2500);
  const pc = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("容器清单"));
    const t = item?.textContent ?? "";
    return { hasGood: t.includes("good"), hasBad: t.includes("bad"), hasExited: t.includes("Exited (1)") };
  });
  ok("SVC portainer container list + abnormal surfaced", pc.hasGood && pc.hasBad && pc.hasExited, JSON.stringify(pc));
  ok(
    "SVC portainer logs modal (read-only)",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("容器清单"));
      const row = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("bad"));
      row?.click();
      return Boolean(row);
    }),
  );
  await sleep(1500);
  ok("SVC portainer logs tail renders", (await page.evaluate(() => document.body.textContent ?? "")).includes("hello"), "");
  await page.keyboard.press("Escape");
  await sleep(300);

  // Q56 容器重启（D51：仅 restart + 白名单 + 确认）——白名单行才有入口
  const restartBtns = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("容器清单"));
    return [...(item?.querySelectorAll("button") ?? [])].filter((b) => (b.getAttribute("aria-label") || b.textContent).trim() === "重启").length;
  });
  ok("SVC portainer restart only on whitelisted row (D51)", restartBtns === 1, "count=" + restartBtns);
  ok(
    "SVC portainer restart confirm dialog (D31)",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("容器清单"));
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => (b.getAttribute("aria-label") || b.textContent).trim() === "重启");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(500);
  ok(
    "SVC portainer restart confirmed",
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "确认");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(1500);
  ok("SVC portainer restart hit mock endpoint (audited)", ctrlHits.some((h) => String(h).includes("restart")), JSON.stringify(ctrlHits));

  // Q53 Mihomo 节点面板（D50 只读深度）：策略组/节点延迟/订阅源
  ok("SVC add mihomo nodes panel", await addOverview(`svc-mihomo-${uniq}`, "Mihomo 节点面板"));
  await sleep(2500);
  const mn = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("节点面板"));
    const t = item?.textContent ?? "";
    return { groups: t.includes("策略组"), pick: t.includes("自动选择"), delay: t.includes("88 ms"), prov: t.includes("订阅源") };
  });
  ok("SVC mihomo nodes groups/delays/providers render", mn.groups && mn.pick && mn.delay && mn.prov, JSON.stringify(mn));

  // D54：策略组切换（FR-X3g 写操作）已移除 —— 节点面板应为纯只读（无「切换」入口）
  ok(
    "SVC mihomo nodes panel is read-only (D54, no switch entry)",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("节点面板"));
      const labels = [...(item?.querySelectorAll("button") ?? [])].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
      return !labels.includes("切换") && !labels.some((l) => l.includes("确认切换"));
    }),
  );
  ok("SVC no mihomo write endpoint hit (D54)", !ctrlHits.some((h) => String(h).startsWith("select:")), JSON.stringify(ctrlHits));

  // ④ 坏连接显式失败
  ok("SVC add broken overview", await addOverview(`svc-broken-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC broken source surfaced", body.includes("探测失败") && body.includes("无法读取服务"), body.slice(-140));
  ok("SVC exit edit", await clickBtn("完成编辑"));
  await sleep(400);

  // ③ 官方品牌图标（数据连接画廊 —— 服务用官方图标不自绘；Q38a/Q39）
  await clickBtn("数据源管理");
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "数据连接")?.click());
  await sleep(400);
  const galleryIcons = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".wb-source-card")];
    return {
      total: cards.length,
      iconed: cards.filter((c) => c.querySelector(".wb-service-icon svg, img.wb-service-icon")).length,
    };
  });
  ok("SVC gallery shows official brand icons (Q39)", galleryIcons.total >= 7 && galleryIcons.iconed >= 6, JSON.stringify(galleryIcons));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
mock.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
