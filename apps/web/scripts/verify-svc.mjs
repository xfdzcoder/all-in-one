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

/** 最小 JPEG（含 SOF 段头，可被服务端 `imageSize()` 解析出声明宽高，D60 §1）。 */
function miniJpeg(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}
let seq = 0; // Q82：让每张缩略图字节不同，便于断言「切换到了另一张」
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
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, (seq = (seq + 1) % 250)]));
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
  if (url.startsWith("/api/search/metadata")) {
    // Q89（项 2）：横/竖/方/超宽混合比例共 14 张 + 1 个视频（Q88/项 3 应被滤掉）
    // —— 数量要够撑出**多行**，否则验不到「行内等高」与「末行不拉伸」
    const items = [{ id: "t2", originalFileName: "clip.mp4", type: "VIDEO", createdAt: "2026-09-26T02:27:31Z" }];
    for (let i = 0; i < 14; i += 1) {
      items.push({
        id: `t${i}`,
        // 第一张保持 `shot.jpg` 且时间最新 —— 另有旧断言（Q49「最近上传」）依赖它出现在最近列表里
        originalFileName: i === 0 ? "shot.jpg" : `shot${i}.jpg`,
        type: "IMAGE",
        createdAt: i === 0 ? "2026-09-26T02:27:59Z" : `2026-09-26T02:27:${String(i).padStart(2, "0")}Z`,
      });
    }
    return res.end(json({ assets: { total: items.length, count: items.length, nextPage: "2", items } }));
  }
  if (url.startsWith("/api/assets/") && url.includes("/thumbnail")) {
    res.setHeader("Content-Type", "image/jpeg");
    // 每个资产返回**声明尺寸不同**的最小 JPEG（含 SOF）→ 服务端字节头解析出对应宽高（D60 §1）
    const shapes = [
      [640, 480],
      [480, 640],
      [500, 500],
      [900, 300],
      [640, 480],
      [480, 640],
    ];
    const m = /\/api\/assets\/([^/]+)\//.exec(url);
    const n = m ? Number(String(m[1]).replace(/^t/, "")) : 0;
    const wh = Number.isFinite(n) ? shapes[n % shapes.length] : [400, 400];
    return res.end(Buffer.from(miniJpeg(wh[0], wh[1])));
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
// Q80 回归守卫：`crypto.randomUUID` / `navigator.clipboard` **只在安全上下文可用**
// （HTTPS 或 localhost）。用户用 HTTP 访问时是 undefined，调用即抛。
// 而本脚本跑在 http://localhost —— **localhost 属安全上下文**，这个 bug 复现不了，
// 故**整个会话显式摘掉这两个 API**，让下面 40+ 条断言同时充当「HTTP 可用」回归。
await page.evaluateOnNewDocument(() => {
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  } catch {
    /* 忽略 */
  }
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", { value: undefined, configurable: true });
  } catch {
    /* 忽略 */
  }
});
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

const addOverview = async (sourceName, cardPrefix = "服务概览", sourceLabel = "数据连接") => {
  const fail = (step) => {
    // 返回值必须是布尔 —— 诊断字符串是 truthy，会被 ok() 当成通过（静默假绿）
    console.error(`[addOverview] failed at ${step}`);
    return false;
  };
  if (!(await clickBtn("添加组件"))) return fail("open-add");
  await sleep(300);
  // 卡片 = name+category+desc 的 UnstyledButton —— 按 name 前缀定位（精确文本会失配）
  const picked = await page.evaluate((p) => {
    const card = [...document.querySelectorAll(".wb-picker-card")].find((c) => c.textContent.trim().startsWith(p));
    card?.click();
    return Boolean(card);
  }, cardPrefix);
  if (!picked) {
    // 失败必须关掉 picker，否则它会挡住后续所有点击（历史级联失败的根因）
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);
    return fail(`pick(${cardPrefix})`);
  }
  await sleep(400);
  // 各组件的 sourceId 字段标签不统一（monitor 叫「监控源」、其余叫「数据连接」）
  if (!(await selectOption(sourceLabel, sourceName))) {
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);
    return fail(`select-source(${sourceName})`);
  }
  await sleep(200);
  return (await clickBtn("确认添加", true)) ? true : fail("confirm");
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  // 自证守卫生效：若这两个 API 仍在，下面的「HTTP 可用」回归就是平凡通过
  ok(
    "Q80 insecure-context APIs stripped (guard active)",
    await page.evaluate(
      () => typeof globalThis.crypto.randomUUID !== "function" && globalThis.navigator.clipboard === undefined,
    ),
    await page.evaluate(
      () => `randomUUID=${typeof globalThis.crypto.randomUUID} clipboard=${typeof globalThis.navigator.clipboard}`,
    ),
  );
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
    const home = list.find((d) => d.title === "首页") ?? list[0]; // Q82：真机/历史残留可能没有「首页」，回落首个页面
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
        monitor: await mk("monitor", `svc-monitor-${uniq}`, { url: base }),
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

  // Q85（项 11）：服务器监控卡标题 = **实际的数据源名称**（不再是硬编码「服务器监控」）
  ok("Q85 add monitor card", await addOverview(`svc-monitor-${uniq}`, "服务器监控", "监控源"));
  await sleep(600);
  const monTitle = await page.evaluate((name) => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(name));
    return { text: (item?.textContent ?? "").replace(/\s+/g, " ").slice(0, 70) };
  }, `svc-monitor-${uniq}`);
  ok(
    "Q85 monitor title shows the data source name (项 11)",
    (monTitle.text ?? "").includes(`svc-monitor-${uniq}`),
    JSON.stringify(monTitle),
  );
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

  // 回到工作台（上一步切到了「数据源管理」全页视图，工作台组件不在 DOM）
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("返回工作台"))?.click());
  await sleep(600);

  // Q89（项 2，D60/D61/**D62**）：媒体墙「全局等高行」契约。
  // 旧断言「grid-auto-rows 含 minmax(…,1fr) 撑满卡片」正是被本项推翻的行为，故整体替换。
  const wall = await page.evaluate(() => {
    const g = document.querySelector(".wb-gallery");
    if (!g) return null;
    const rows = [...g.querySelectorAll(".wb-gallery__row")];
    const gaps = parseFloat(getComputedStyle(g).columnGap) || 0;
    const gw = g.clientWidth;
    const detail = rows.map((r) => {
      const cells = [...r.querySelectorAll(".wb-gallery__cell")].map((c) => ({
        w: c.getBoundingClientRect().width,
        h: c.getBoundingClientRect().height,
      }));
      return {
        height: Math.round(r.getBoundingClientRect().height * 100) / 100,
        heights: [...new Set(cells.map((c) => Math.round(c.h * 100) / 100))],
        used: Math.round((cells.reduce((s, c) => s + c.w, 0) + gaps * Math.max(0, cells.length - 1)) * 100) / 100,
        ratios: cells.map((c) => Math.round((c.w / c.h) * 1000) / 1000),
      };
    });
    return { gw: Math.round(gw), gaps, rows: detail };
  });
  const rows = wall?.rows ?? [];
  const allRatios = [...new Set(rows.flatMap((r) => r.ratios))];
  // 允许的原始比例（mock 夹具：640/480、480/640、500/500、900/300）
  const shapeSet = [640 / 480, 480 / 640, 500 / 500, 900 / 300];
  const ratiosMatchShape = allRatios.length > 0 && allRatios.every((x) => shapeSet.some((s) => Math.abs(s - x) < 0.02));
  ok(
    "Q89 D62 全局等高行：**所有行**高度完全相同 + 宽度按原比例 (项 2)",
    rows.length >= 2 &&
      new Set(rows.map((r) => r.height)).size === 1 &&
      rows.every((r) => r.heights.length === 1) &&
      allRatios.length >= 3 &&
      ratiosMatchShape,
    JSON.stringify({ rowCount: rows.length, rowHeights: rows.map((r) => r.height), distinctRatios: allRatios }),
  );
  ok(
    "Q89 任何行都不溢出容器宽度（行尾允许留白，D62 明确接受）(项 2)",
    rows.length > 0 && rows.every((r) => r.used <= wall.gw + 1),
    JSON.stringify({ gw: wall?.gw, used: rows.map((r) => r.used) }),
  );
  ok(
    "Q89 行高由目标行高决定（显式 px、与卡片高度无关）—— 卡片再高也不拉长",
    rows.every((r) => Number.isFinite(r.height) && r.height > 0 && r.height < 400),
    JSON.stringify(rows.map((r) => r.height)),
  );

  // Q71（项 6）：**随机模式** —— 配置表单可选「随机」，整卡只展示一张图
  ok("Q71 enter edit for random mode", await clickBtn("编辑页面"));
  await sleep(300);
  ok(
    "Q71 open gallery widget config",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes("照片墙"));
      const chrome = item?.querySelector(".wb-chrome");
      const btn = [...(chrome?.querySelectorAll(".wb-chrome__actions button") ?? [])].find(
        (b) => (b.getAttribute("aria-label") || b.textContent).trim() === "配置",
      );
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(500);
  ok("Q71 pick 随机 layout", await selectOption("展示模式", "随机"));
  await sleep(200);
  ok("Q71 save config", await clickBtn("保存配置", true));
  await sleep(600);
  ok("Q71 exit edit", await clickBtn("完成编辑"));
  await sleep(800);
  const rand = await page.evaluate(() => {
    const r = document.querySelector(".wb-gallery--random");
    return {
      random: Boolean(r),
      imgs: r ? r.querySelectorAll("img").length : -1,
      cells: document.querySelectorAll(".wb-gallery--random .wb-gallery__cell").length,
    };
  });
  ok(
    "Q71 random mode shows exactly one image (项 6)",
    rand.random && (rand.imgs === 1 || rand.cells === 1),
    JSON.stringify(rand),
  );

  // Q82（项 8/9）：无边框遮罩层 + 左右切换 —— 先切回铺开模式
  ok("Q82 enter edit to restore grid", await clickBtn("编辑页面"));
  await sleep(300);
  ok(
    "Q82 open gallery config",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes("照片墙"));
      const btn = [...(item?.querySelectorAll(".wb-chrome__actions button") ?? [])].find(
        (b) => (b.getAttribute("aria-label") || b.textContent).trim() === "配置",
      );
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(500);
  ok("Q82 pick 铺开 layout", await selectOption("展示模式", "铺开（网格填满卡片）"));
  await sleep(200);
  ok("Q82 save", await clickBtn("保存配置", true));
  await sleep(600);
  ok("Q82 exit edit", await clickBtn("完成编辑"));
  await sleep(800);
  ok(
    "Q82 open lightbox from a cell",
    await page.evaluate(() => {
      const cell = document.querySelector(".wb-gallery__cell");
      cell?.click();
      return Boolean(cell);
    }),
  );
  await sleep(500);
  const lb = await page.evaluate(() => {
    const root = document.querySelector(".wb-lightbox");
    if (!root) return { found: false };
    const cs = getComputedStyle(root);
    const img = root.querySelector(".wb-lightbox__img");
    const ics = img ? getComputedStyle(img) : null;
    return {
      found: true,
      fixed: cs.position,
      overlay: cs.backgroundColor,
      // 项 9：图片**无边框、无圆角、无阴影**
      img: ics ? `${ics.borderRadius}|${ics.boxShadow}|${ics.borderTopWidth}` : null,
      hasPrev: Boolean(root.querySelector(".wb-lightbox__nav--prev")),
      hasNext: Boolean(root.querySelector(".wb-lightbox__nav--next")),
    };
  });
  ok(
    "Q82 lightbox is borderless overlay (项 9)",
    lb.found && lb.fixed === "fixed" && Boolean(lb.img) && (lb.img ?? "").startsWith("0px|none"),
    JSON.stringify(lb),
  );
  ok("Q82 lightbox has prev/next (项 8)", Boolean(lb.hasPrev && lb.hasNext), JSON.stringify(lb));
  // 注意：mock 的缩略图字节可能重复 → 不比较内容，只验证「切换被派发且遮罩仍在」。
  // 严格的内容切换断言需要可区分的 mock 图片，记 Q83 待补。
  ok(
    "Q82 next is dispatched and lightbox stays open (项 8)",
    await page.evaluate(() => {
      document.querySelector(".wb-lightbox__nav--next")?.click();
      return Boolean(document.querySelector(".wb-lightbox__img"));
    }),
  );
  await sleep(400);
  // Q84（项 1）：预览遮罩不再有「照片预览（只读）」标题；「在 Immich 中打开」是 icon 链接
  const lbQ84 = await page.evaluate(() => {
    const root = document.querySelector(".wb-lightbox");
    const title = root?.querySelector(".wb-lightbox__title");
    const link = root?.querySelector(".wb-lightbox__actions a");
    // IconAction 会渲染 `.wb-sr-only` 无障碍文本（设计如此），断言要排除它 ——
    // 判据是「去掉 sr-only 后无可见文字 + 有图标」，而非整段 textContent
    let visibleText = "";
    if (link) {
      const clone = link.cloneNode(true);
      clone.querySelectorAll(".wb-sr-only").forEach((n) => n.remove());
      visibleText = (clone.textContent ?? "").trim();
    }
    return {
      hasTitle: Boolean(title && (title.textContent ?? "").trim()),
      linkHref: link?.getAttribute("href") ?? null,
      linkTarget: link?.getAttribute("target") ?? null,
      linkRel: link?.getAttribute("rel") ?? null,
      visibleText,
      hasSvg: Boolean(link?.querySelector("svg")),
    };
  });
  ok(
    "Q84 lightbox has no title text (项 1)",
    lbQ84.hasTitle === false,
    JSON.stringify(lbQ84),
  );
  ok(
    "Q84 open-in-Immich is an icon link (项 1)",
    Boolean(lbQ84.linkHref) &&
      lbQ84.linkTarget === "_blank" &&
      (lbQ84.linkRel ?? "").includes("noopener") &&
      lbQ84.visibleText === "" &&
      Boolean(lbQ84.hasSvg),
    JSON.stringify(lbQ84),
  );

  ok(
    "Q82 Esc closes lightbox",
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      return true;
    }),
  );
  await sleep(300);
  ok("Q82 lightbox closed", await page.evaluate(() => !document.querySelector(".wb-lightbox")));

  // Q84（项 5）：状态徽标不加粗 —— Mantine Badge 根类默认 700，须被 .wb-status-badge 压到非粗
  const sb = await page.evaluate(() => {
    const el = document.querySelector(".wb-status-badge");
    return el
      ? { found: true, fw: getComputedStyle(el).fontWeight, text: (el.textContent ?? "").trim() }
      : { found: false };
  });
  ok("Q84 status badge exists", sb.found === true, JSON.stringify(sb));
  ok("Q84 status badge is not bold (项 5)", Number(sb.fw) < 600, JSON.stringify(sb));

  // Q84（项 7）：Navidrome 概览不再展示「库就绪」
  ok(
    "Q84 no 库就绪 badge (项 7)",
    await page.evaluate(
      () => ![...document.querySelectorAll(".wb-status-badge")].some((b) => (b.textContent ?? "").includes("库就绪")),
    ),
  );
  // Q85（项 12）：信息流卡标题统一为「RSS」，不再叫「信息流」
  const rss = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".grid-stack-item")];
    const card = items.find((i) => (i.textContent ?? "").includes("未读"));
    const txt = card?.textContent ?? "";
    return { hasRSS: txt.includes("RSS"), hasOld: txt.includes("信息流") };
  });
  ok("Q85 rss title is RSS (项 12)", rss.hasRSS && !rss.hasOld, JSON.stringify(rss));

  // Q85（项 14/15）：「添加组件」是 icon 按钮；顶栏按钮放大一档（md = 28px）
  ok("Q85 enter edit for header checks", await clickBtn("编辑页面"));
  await sleep(500);
  const hdr = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btns = [...(header?.querySelectorAll("button") ?? [])];
    const add = btns.find((b) => (b.textContent ?? "").includes("添加组件"));
    let addVisible = "";
    if (add) {
      const clone = add.cloneNode(true);
      clone.querySelectorAll(".wb-sr-only").forEach((n) => n.remove());
      addVisible = (clone.textContent ?? "").trim();
    }
    return {
      widths: btns.map((b) => Number.parseFloat(getComputedStyle(b).width)),
      addFound: Boolean(add),
      addVisible,
      addHasSvg: Boolean(add?.querySelector("svg")),
      labels: btns.map((b) => b.getAttribute("aria-label")),
    };
  });
  ok(
    "Q85 add-widget button is an icon (项 14)",
    hdr.addFound && hdr.addVisible === "" && hdr.addHasSvg,
    JSON.stringify(hdr),
  );
  ok(
    "Q85 header buttons enlarged (项 15)",
    hdr.widths.length > 0 && hdr.widths.every((w) => w >= 26),
    JSON.stringify(hdr),
  );
  ok("Q85 exit edit", await clickBtn("完成编辑"));
  await sleep(300);

  // Q86（项 13）：标题区可跳转到数据源站点 —— **仅标题区**（logo+文本），整卡不可点
  const t13 = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".grid-stack-item")];
    const mon = items.find((i) => (i.textContent ?? "").includes("svc-monitor-"));
    const a = mon?.querySelector("a.wb-widget__title-link");
    const card = mon?.querySelector(".wb-widget");
    const rssCard = items.find((i) => (i.textContent ?? "").includes("未读"));
    return {
      href: a?.getAttribute("href") ?? null,
      target: a?.getAttribute("target") ?? null,
      rel: a?.getAttribute("rel") ?? null,
      // 整卡不可点：卡片本身不能是 <a>，也不能被 <a> 包住
      cardIsLink: card ? card.tagName === "A" || Boolean(card.closest("a")) : null,
      // 无站点的组件（信息流）不渲染成链接
      rssHasLink: Boolean(rssCard?.querySelector("a.wb-widget__title-link")),
    };
  });
  ok(
    "Q86 title links to the data source site (项 13)",
    Boolean(t13.href) && t13.target === "_blank" && (t13.rel ?? "").includes("noopener") && t13.cardIsLink === false,
    JSON.stringify(t13),
  );
  ok("Q86 sourceless card title is not a link (项 13)", t13.rssHasLink === false, JSON.stringify(t13));

  // Q87（项 4）：手动刷新必须带 `force` —— 否则服务端 DataCache TTL 60s 直接回旧数据
  const seen = { force: 0, albumId: 0 };
  const onReq = (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/widgets/data")) return;
    try {
      const body = JSON.parse(req.postData() ?? "{}");
      if (body.force === true) seen.force += 1;
      if (body.config && body.config.albumId) seen.albumId += 1;
    } catch {
      /* 非 JSON 请求体 */
    }
  };
  page.on("request", onReq);

  ok(
    "Q87 click refresh on a card",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) =>
        (i.textContent ?? "").includes("svc-monitor-"),
      );
      const btn = [...(item?.querySelectorAll("button") ?? [])].find(
        (b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === "刷新",
      );
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(1500);
  ok("Q87 manual refresh sends force (项 4)", seen.force >= 1, JSON.stringify(seen));

  // Q87（项 4）：配置里的 albumId 必须真的发给后端 —— 此前前端把它整条丢了
  const seedRes = await page.evaluate(async () => {
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0];
    // 布局随 GET /api/dashboards 的行返回（无独立 GET layout 端点），
    // 契约是 layoutJson = gridstack widget 数组的 JSON 字符串
    const items = JSON.parse(home?.layoutJson ?? "[]");
    const gal = items.find((i) => i.component === "immich-gallery");
    let put = 0;
    if (gal) {
      gal.props = { ...(gal.props ?? {}), albumId: "album-should-be-sent" };
      const resp = await fetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
      });
      put = resp.status;
    }
    return { found: Boolean(gal), put, comps: items.map((i) => i.component) };
  });
  // 改的是 DB 里的布局 —— 运行中的组件不会自己换 props，必须重载页面才生效。
  // 注意不能用 networkidle0：应用持有 /api/events SSE 长连接，网络永不空闲。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 20000 });
  await sleep(3000);
  page.off("request", onReq);
  ok(
    "Q87 albumId from config reaches the request (项 4)",
    seen.albumId >= 1,
    JSON.stringify({ seen, seedRes }),
  );
  // ── Q91（项 8）：页面级网格粒度（列数 / 行高）──
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "编辑页面")?.click(),
  );
  await sleep(500);
  ok(
    "Q91 页面设置暴露「网格列数 / 网格行高」(项 8)",
    await page.evaluate(
      () => Boolean(document.querySelector('[aria-label="网格列数"]') && document.querySelector('[aria-label="网格行高"]')),
    ),
  );
  const pickColumns = async (label) => {
    await page.evaluate(() => document.querySelector('[aria-label="网格列数"]')?.click());
    await sleep(400);
    const clicked = await page.evaluate((l) => {
      const opt = [...document.querySelectorAll("[role=option]")].find((o) => (o.textContent ?? "").trim() === l);
      opt?.click();
      return Boolean(opt);
    }, label);
    await sleep(1500);
    return clicked;
  };
  const readGrid = async () =>
    page.evaluate(async () => {
      const list = await (await fetch("/api/dashboards")).json();
      const d = list.find((x) => (x.layoutJson ?? "[]") !== "[]") ?? list[0];
      return {
        id: d.id,
        columns: d.columns,
        cellHeight: d.cellHeight,
        widgets: JSON.parse(d.layoutJson || "[]").map((w) => ({ x: w.x, w: w.w })),
      };
    });
  const before = await readGrid();
  ok("Q91 pick 24 列 from page settings", await pickColumns("24 列"));
  const after = await readGrid();
  const scaled =
    before.widgets.length > 0 &&
    after.widgets.length === before.widgets.length &&
    after.widgets.every((w, i) => Math.abs(w.w - (before.widgets[i].w ?? 0) * 2) <= 1 && Math.abs(w.x - (before.widgets[i].x ?? 0) * 2) <= 1);
  ok(
    "Q91 切列数 12→24 **按比例重算 x/w**（组件不占错位置）(项 8)",
    before.columns === 12 && after.columns === 24 && scaled,
    JSON.stringify({ cols: [before.columns, after.columns], before: before.widgets.slice(0, 3), after: after.widgets.slice(0, 3) }),
  );
  // 切回 12 列 —— 往返应精确复原（rescaleLayout 单测已证），不留改动在用户盘上
  await pickColumns("12 列");
  const restored = await readGrid();
  ok(
    "Q91 12→24→12 往返精确复原布局",
    restored.columns === 12 &&
      restored.widgets.length === before.widgets.length &&
      restored.widgets.every((w, i) => w.x === before.widgets[i].x && w.w === before.widgets[i].w),
    JSON.stringify({ before: before.widgets.slice(0, 3), restored: restored.widgets.slice(0, 3) }),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
mock.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
