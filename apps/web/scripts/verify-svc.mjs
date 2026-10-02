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
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { ADMIN_PASSWORD, backToWorkspace, createScratchDashboard, deleteScratchDashboard, makeApiFetch, makeOk, openSettings, sleep, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）
const uniq = uniqId(); // TST-8：时间戳+随机，防同毫秒重名/残留互撞

const json = (obj) => JSON.stringify(obj);

/** 最小 JPEG（含 SOF 段头，可被服务端 `imageSize()` 解析出声明宽高，D60 §1）。
 *  `marker` 写进 COM 段 —— **同尺寸也不同字节**（按资产 id 掺标），Q83 的
 *  「预览切换后内容真的变了」靠比较 src 成立；SOF 不动 ⇒ 宽高解析与 Q81 比例断言不变。 */
function miniJpeg(width, height, marker = 0) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xfe, 0x00, 0x04, (marker >> 8) & 0xff, marker & 0xff,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}
/** 资产 id → 稳定标记字节（同一资产重取字节不变，不同资产必不同 —— 16 位足够夹具集）。 */
const markerOf = (id) => {
  let h = 7;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return h;
};
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
    return res.end(
      json({
        "subsonic-response": {
          artists: { index: [{ artist: [{ id: "art-1", name: "甲", albumCount: 6 }, { id: "art-2", name: "乙", albumCount: 4 }] }] },
        },
      }),
    );
  // Q81：艺人筛选走 `getArtist.view?id=` → `artist.album[]`（Q94/反馈③ 实测口径）
  if (url.startsWith("/rest/getArtist.view")) {
    const id = new URL(url, "http://mock").searchParams.get("id");
    const albums =
      id === "art-1"
        ? [
            { id: "na-1", name: "甲的专辑一", artist: "甲", coverArt: "na-1" },
            { id: "na-2", name: "甲的专辑二", artist: "甲", coverArt: "na-2" },
          ]
        : id === "art-2"
          ? [{ id: "nb-1", name: "乙的专辑一", artist: "乙", coverArt: "nb-1" }]
          : // Q104（用户反馈①）：5 张专辑的艺人 —— 配 limit=2 验「显示张数」裁剪
          id === "art-3"
            ? Array.from({ length: 5 }, (_, i) => ({
                id: `nc-${i + 1}`,
                name: `丙的专辑${"一二三四五"[i]}`,
                artist: "丙",
                coverArt: `nc-${i + 1}`,
              }))
            : [];
    return res.end(json({ "subsonic-response": { artist: { id, name: id ?? "", album: albums } } }));
  }
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
    const defaultItems = () => {
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
      return items;
    };
    // Q81：**相册筛选生效**的端到端夹具 —— 按 body.albumIds 回该相册的专属条目
    // （alb-A 3 张 / alb-B 2 张；缩略图形状也专属，见 thumbnail 分支），未筛选才回默认清单。
    // 单页就回完（< IMMICH_PAGE_SIZE）⇒ 连接器立即停页，不会重复累页。
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let albumIds = [];
      try {
        albumIds = JSON.parse(raw || "{}").albumIds ?? [];
      } catch {
        /* 非 JSON 也按未筛选处理 */
      }
      const scoped = { "alb-A": ["a0", "a1", "a2"], "alb-B": ["b0", "b1"] };
      const ids = scoped[albumIds[0]];
      const items = ids
        ? ids.map((id, i) => ({ id, originalFileName: `${id}.jpg`, type: "IMAGE", createdAt: `2026-10-01T00:00:0${i}Z` }))
        : albumIds.length
          ? []
          : defaultItems();
      res.end(json({ assets: { total: items.length, count: items.length, nextPage: "2", items } }));
    });
    return;
  }
  if (url.startsWith("/api/assets/") && url.includes("/thumbnail")) {
    res.setHeader("Content-Type", "image/jpeg");
    // 每个资产返回**声明尺寸不同**的最小 JPEG（含 SOF）→ 服务端字节头解析出对应宽高（D60 §1）
    const m = /\/api\/assets\/([^/]+)\//.exec(url);
    const id = m ? String(m[1]) : "";
    // Q105（用户反馈④）：`size=preview` 回 **4× 尺寸**大图（灯箱预览用）；
    // t3 的 preview 404 → 连接器回落缩略图 + 提示（降级分支的 UI 面）
    const isPreview = url.includes("size=preview");
    if (isPreview && id === "t3") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "preview not found" }));
    }
    const shapes = [
      [640, 480],
      [480, 640],
      [500, 500],
      [900, 300],
      [640, 480],
      [480, 640],
    ];
    // Q81：相册夹具的缩略图有**专属形状**（alb-A 320×240 / alb-B 240×320），
    // 与默认清单的 6 形状循环不重叠 —— 有没有泄漏未筛选项，看 naturalWidth/Height 即知
    const byPrefix = { a: [320, 240], b: [240, 320] };
    const n = Number(id.replace(/^t/, ""));
    const wh = byPrefix[id.slice(0, 1)] ?? (Number.isFinite(n) ? shapes[n % shapes.length] : [400, 400]);
    const scale = isPreview ? 4 : 1;
    return res.end(Buffer.from(miniJpeg(wh[0] * scale, wh[1] * scale, markerOf(id))));
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

const api = makeApiFetch(page); // TST-23：带 method 的同源 fetch（建/删草稿盘用）
let scratch = null; // TST-23：本轮临时草稿盘 id（收尾自删）

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
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);
  await sleep(400);

  // TST-23（用户反馈②）：种子布局挂在**自建临时草稿盘**上 —— 不再「重置首页布局」，
  // 用户页面（「用户页面禁止修改」）零接触；`?page=` 深链定位，reload 不丢盘
  scratch = await createScratchDashboard(api);
  const seed = [
    { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
    { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
    { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
    { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
    { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
  ];
  const putSeed = await api(`/api/dashboards/${scratch.id}/layout`, {
    method: "PUT",
    body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
  });
  if (putSeed.status !== 200) throw new Error(`草稿盘布局写入失败：HTTP ${putSeed.status} ${putSeed.body}`);
  await page.goto(`${WEB}?page=${scratch.id}`, { waitUntil: "domcontentloaded" });
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
      // WEB-3 后行是 `div role=button`（原 <button> 内嵌按钮属非法嵌套）——锚点改语义类
      const row = [...(item?.querySelectorAll(".wb-admin-row") ?? [])].find((b) => b.textContent.includes("bad"));
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
  await openSettings(page, "数据源");
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
  // D66（opencode 退役）后画廊为 6 类、其中 5 类有官方品牌图标（http 走自绘通用标）
  ok("SVC gallery shows official brand icons (Q39)", galleryIcons.total >= 6 && galleryIcons.iconed >= 5, JSON.stringify(galleryIcons));

  // Q93（项 5）：计数必须按**全量**统计。原来复用「按选中类型过滤」的查询，
  // 首进 tab 所有类型都是「0 个连接」；进详情页才临时对上，切走又没了。
  const dsCounts = await page.evaluate(() =>
    [...document.querySelectorAll(".wb-source-card, [class*=source]")]
      .map((c) => (c.textContent || "").trim())
      .filter((t) => /\d+\s*个连接/.test(t))
      .map((t) => Number((/(\d+)\s*个连接/.exec(t) || [])[1])),
  );
  ok(
    "Q93 数据源计数首进即正确（不随选中类型过滤而归零）(项 5)",
    dsCounts.some((n) => n > 0), // unicorn(no-useless-length-check)：some() 已蕴含非空
    JSON.stringify({ counts: dsCounts }),
  );

  // 回到工作台（上一步切到了「数据源管理」全页视图，工作台组件不在 DOM）
  await backToWorkspace(page); // Q118：返回入口在左上角标题（aria-label="返回工作台"）
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
  // ── Q105（用户反馈④）：灯箱应显示**预览大图**（mock 对 size=preview 回 4× 尺寸）──
  // 夹具 JPEG 浏览器不完整解码（naturalWidth=0）⇒ 从 data URI 的 SOF 头读声明宽高；
  // 先等「缩略图 → 大图」异步替换完成，下面 Q83 的 src 比较才不受干扰。
  const lbSofDims = () =>
    page.evaluate(() => {
      const src = document.querySelector(".wb-lightbox__img")?.getAttribute("src") ?? "";
      if (!src.startsWith("data:")) return null;
      const bin = atob(src.slice(src.indexOf(",") + 1));
      for (let i = 0; i < bin.length - 9; i += 1) {
        if (bin.charCodeAt(i) === 0xff && [0xc0, 0xc2].includes(bin.charCodeAt(i + 1))) {
          return {
            h: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6),
            w: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8),
          };
        }
      }
      return null;
    });
  let bigDims = null;
  for (let i = 0; i < 20 && !(bigDims && bigDims.w >= 1200); i += 1) {
    await sleep(250);
    bigDims = await lbSofDims();
  }
  ok(
    "Q105 灯箱显示预览大图（SOF 声明宽 ≥1200，4× 墙上缩略图）",
    Boolean(bigDims && bigDims.w >= 1200),
    JSON.stringify(bigDims),
  );
  // Q83：**严格内容断言**（Q82 欠账收口）—— 夹具 JPEG 按资产 id 掺 COM 标记字节，
  // 同尺寸也不同字节 ⇒ 「切换后内容真的变了」可以直接比较 src（原先字节重复只能验派发）。
  const lbSrc = () => page.evaluate(() => document.querySelector(".wb-lightbox__img")?.getAttribute("src") ?? "");
  const srcBefore = await lbSrc();
  ok(
    "Q82 next is dispatched and lightbox stays open (项 8)",
    await page.evaluate(() => {
      document.querySelector(".wb-lightbox__nav--next")?.click();
      return Boolean(document.querySelector(".wb-lightbox__img"));
    }),
  );
  await sleep(400);
  const srcNext = await lbSrc();
  ok(
    "Q83 切换后内容真的变了（next 的 src ≠ 原图）",
    srcBefore.startsWith("data:image") && srcNext.startsWith("data:image") && srcBefore !== srcNext,
    JSON.stringify({ head: srcBefore.slice(0, 30), before: srcBefore.slice(-12), next: srcNext.slice(-12) }),
  );
  ok(
    "Q83 prev 回到原图（循环切换内容一致）",
    await page.evaluate(() => {
      document.querySelector(".wb-lightbox__nav--prev")?.click();
      return Boolean(document.querySelector(".wb-lightbox__img"));
    }),
  );
  await sleep(400);
  ok("Q83 prev 后 src 复原", (await lbSrc()) === srcBefore, "prev 内容未复原");
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

  // Q105 降级面：preview 404 → 回落缩略图 +「原因 + 怎么修」提示（D47，不整卡空白）
  ok(
    "Q105 open the cell whose preview 404s",
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll(".wb-gallery__cell")];
      const target = cells[3] ?? cells[0]; // t3：mock 对它的 size=preview 回 404
      target?.click();
      return Boolean(target);
    }),
  );
  await sleep(1200);
  const fbState = await page.evaluate(() => {
    const root = document.querySelector(".wb-lightbox");
    const t = root?.textContent ?? "";
    return {
      open: Boolean(root),
      img: Boolean(root?.querySelector(".wb-lightbox__img")?.getAttribute("src")?.startsWith("data:")),
      hint: t.includes("预览大图不可用") && t.includes("Immich"),
    };
  });
  ok(
    "Q105 preview 404 → 回落缩略图 + 提示（原因+怎么修，不空白）",
    fbState.open && fbState.img && fbState.hint,
    JSON.stringify(fbState),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return true;
  });
  await sleep(300);

  // Q84（项 5）：状态徽标不加粗 —— Mantine Badge 根类默认 700，须被 .wb-status-badge 压到非粗
  const sb = await page.evaluate(() => {
    const el = document.querySelector(".wb-status-badge");
    return el
      ? { found: true, fw: getComputedStyle(el).fontWeight, text: (el.textContent ?? "").trim() }
      : { found: false };
  });
  ok("Q84 status badge exists", sb.found === true, JSON.stringify(sb));
  ok("Q84 status badge is not bold (项 5)", Number(sb.fw) < 600, JSON.stringify(sb));

  // Q93（项 3）：容器清单按表格分列 + 徽标文字不得溢出底色
  // （原 `Group wrap="nowrap"` 会把徽标压窄而文字不缩 → 「RUNNING」字样溢出底色）
  const crow = await page.evaluate(() => {
    const row = document.querySelector(".wb-container-row");
    if (!row) return null;
    const badge = row.querySelector(".mantine-Badge-root");
    const name = row.children[0];
    const cells = [...row.children].map((c) => Math.round(c.getBoundingClientRect().left));
    const badgeFz = badge ? parseFloat(getComputedStyle(badge).fontSize) : 0;
    const nameFz = name ? parseFloat(getComputedStyle(name).fontSize) : 0;
    return {
      isGrid: getComputedStyle(row).display === "grid",
      badgeOverflow: badge ? badge.scrollWidth - badge.clientWidth : 0,
      leftAligned: cells.every((l) => Number.isFinite(l)),
      cols: getComputedStyle(row).gridTemplateColumns.split(" ").length,
      // 真正的回归点：徽标字号曾因 `size="compact-xs"` 是 Mantine **无效值**而回落到继承的 16px
      // （Badge 只有 xs/sm/md/lg/xl，`compact-*` 是 Button/ActionIcon 的特性）→ 显得巨大
      badgeFz,
      nameFz,
    };
  });
  ok(
    "Q93 容器行分列左对齐 + 徽标文字不溢出底色 (项 3)",
    Boolean(crow) && crow.isGrid && crow.cols >= 3 && crow.badgeOverflow <= 0,
    JSON.stringify(crow),
  );
  ok(
    "Q93 徽标字号不大于正文（size 值必须被 Mantine 真正识别）(项 3)",
    Boolean(crow) && crow.badgeFz > 0 && crow.badgeFz <= crow.nameFz,
    JSON.stringify({ badgeFz: crow?.badgeFz, nameFz: crow?.nameFz }),
  );

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
  const seedRes = await page.evaluate(async (dashId) => {
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.id === dashId); // TST-23：只认草稿盘，绝不回落 list[0]
    if (!home) return { found: false, put: 0, comps: [] };
    // 布局随 GET /api/dashboards 的行返回（无独立 GET layout 端点），
    // 契约是 layoutJson = gridstack widget 数组的 JSON 字符串
    const items = JSON.parse(home?.layoutJson ?? "[]");
    const gal = items.find((i) => i.component === "immich-gallery");
    let put = 0;
    if (gal) {
      gal.props = { ...gal.props, albumId: "album-should-be-sent" };
      const resp = await fetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
      });
      put = resp.status;
    }
    return { found: Boolean(gal), put, comps: items.map((i) => i.component) };
  }, scratch.id);
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

  // ── Q81：媒体墙筛选**真的生效**的端到端断言（Q72 收尾欠账）──
  // 全链路：组件 props → queryKey → 请求体 albumIds/artistId → 连接器上游过滤 → 渲染。
  // 夹具有「专属条目数 + 专属缩略图形状」（alb-A 3 张 320×240 / alb-B 2 张 240×320，
  // 与默认清单 15 张的 6 形状循环不重叠）—— 泄漏未筛选项时 count 与 naturalWidth/Height
  // 同时露馅；Navidrome 侧按专辑名 title 断言（getArtist.view 夹具见 mock）。
  const setWidgetProps = async (component, patch) => {
    await page.evaluate(
      async ({ comp, p, dashId }) => {
        const list = await (await fetch("/api/dashboards")).json();
        const home = list.find((d) => d.id === dashId); // TST-23：只认草稿盘
        if (!home) return;
        const items = JSON.parse(home?.layoutJson ?? "[]");
        const card = items.find((i) => i.component === comp);
        if (!card) return;
        card.props = { ...card.props, ...p };
        await fetch(`/api/dashboards/${home.id}/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
        });
      },
      { comp: component, p: patch, dashId: scratch.id },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".grid-stack", { timeout: 20000 });
    await sleep(2500);
  };
  const readWall = (marker) =>
    page.evaluate((m) => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
      const cells = [...(item?.querySelectorAll(".wb-gallery__cell") ?? [])];
      return {
        count: cells.length,
        // Q104：占位格（无图）计数 —— 专辑墙裁剪回归的判据
        empty: cells.filter((c) => c.classList.contains("wb-gallery__cell--empty")).length,
        // 夹具 JPEG 是「最小 SOF 头」——服务端能解析宽高（D60）但浏览器不完整解码
        // （naturalWidth=0），故用**渲染格子的宽高比**当判据：宽 = 行高 × 原始比例
        ratios: cells.map((c) => {
          const r = c.getBoundingClientRect();
          return r.height ? Number((r.width / r.height).toFixed(2)) : 0;
        }),
        titles: cells.map((c) => c.getAttribute("title") ?? "").toSorted(),
      };
    }, marker);

  await setWidgetProps("immich-gallery", { albumId: "alb-A" });
  const wallA = await readWall("照片墙");
  ok(
    "Q81 Immich 相册筛选生效：alb-A 只出 A 相册（3 张 · 4:3）",
    wallA.count === 3 && wallA.ratios.every((r) => Math.abs(r - 1.33) <= 0.02),
    JSON.stringify(wallA),
  );
  await setWidgetProps("immich-gallery", { albumId: "alb-B" });
  const wallB = await readWall("照片墙");
  ok(
    "Q81 Immich 换相册即换内容：alb-B 只出 B 相册（2 张 · 3:4）",
    wallB.count === 2 && wallB.ratios.every((r) => Math.abs(r - 0.75) <= 0.02),
    JSON.stringify(wallB),
  );
  await setWidgetProps("navidrome-library", { artistId: "art-1" });
  const wallN1 = await readWall("专辑墙");
  ok(
    "Q81 Navidrome 艺人筛选生效：art-1 只出甲的专辑",
    wallN1.count === 2 && wallN1.titles.join("|") === "甲的专辑一 · 甲|甲的专辑二 · 甲",
    JSON.stringify(wallN1),
  );
  await setWidgetProps("navidrome-library", { artistId: "art-2" });
  const wallN2 = await readWall("专辑墙");
  ok(
    "Q81 Navidrome 换艺人即换内容：art-2 只出乙的专辑",
    wallN2.count === 1 && wallN2.titles.join("|") === "乙的专辑一 · 乙",
    JSON.stringify(wallN2),
  );
  // ── Q104（用户反馈①）：「显示张数」裁剪 —— getArtist 返回 5 张只出 2 格、零占位块 ──
  // （真机实测：getArtist.view 回艺人全部 106 张，渲染全量 ⇒ 第 25 张起全是占位块）
  await setWidgetProps("navidrome-library", { artistId: "art-3", limit: 2 });
  const wallN3 = await readWall("专辑墙");
  ok(
    "Q104 专辑墙按「显示张数」裁剪：art-3 共 5 张只出 2 格且全有图",
    wallN3.count === 2 && wallN3.empty === 0 && wallN3.titles.join("|") === "丙的专辑一 · 丙|丙的专辑二 · 丙",
    JSON.stringify(wallN3),
  );
  // 还原筛选项 —— 后续用例不带着筛选跑（也少留改动在盘上）
  await setWidgetProps("immich-gallery", { albumId: "" });
  await setWidgetProps("navidrome-library", { artistId: "", limit: 12 });

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
    page.evaluate(async (dashId) => {
      const list = await (await fetch("/api/dashboards")).json();
      const d = list.find((x) => x.id === dashId); // TST-23：只认草稿盘
      if (!d) return { id: "", columns: 0, cellHeight: 0, widgets: [] };
      return {
        id: d.id,
        columns: d.columns,
        cellHeight: d.cellHeight,
        widgets: JSON.parse(d.layoutJson || "[]").map((w) => ({ x: w.x, w: w.w })),
      };
    }, scratch.id);
  const before = await readGrid();
  ok("Q91 pick 24 列 from page settings", await pickColumns("24 列"));
  const after = await readGrid();
  // Q93（项 4）：不只看落盘值 —— 从**渲染几何**反推真实列数，才能抓到 gridstack 内部钳制
  const renderedCols = await page.evaluate(() => {
    const gs = document.querySelector(".grid-stack");
    const it = gs?.querySelector(".grid-stack-item");
    if (!gs || !it) return null;
    const gw = gs.getBoundingClientRect().width;
    const iw = it.getBoundingClientRect().width;
    const wUnits = Number(it.getAttribute("gs-w") ?? it.getAttribute("data-gs-w") ?? it.getAttribute("gsWidth"));
    if (!gw || !iw || !Number.isFinite(wUnits) || wUnits <= 0) return null;
    return Math.round(wUnits / (iw / gw));
  });
  ok(
    "Q93 渲染出的列数 == 配置列数（gridstack columnMax 不再钳到 12）(项 4)",
    renderedCols === 24,
    JSON.stringify({ renderedCols, expected: 24 }),
  );
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
  // ── Q93（项 1）：畸形配置不得白屏 ──
  // 入参防呆（useFeeds 把非数组 tagIds 归一）+ 组件级 ErrorBoundary 双保险。
  // 原来 `("" ?? []).join()` 在 render 期抛 TypeError → 整树卸载白屏且每次渲染都抛、无法恢复。
  const crashSeed = await page.evaluate(async (dashId) => {
    const list = await (await fetch("/api/dashboards")).json();
    const d = list.find((x) => x.id === dashId); // TST-23：只认草稿盘
    if (!d) return { id: "", snapshot: "[]" };
    const widgets = JSON.parse(d.layoutJson || "[]");
    const snapshot = JSON.stringify(widgets);
    widgets.push({ id: "crash-rss", component: "rss", x: 0, y: 99, w: 4, h: 4, props: { tagIds: "", limit: 5 } });
    await fetch(`/api/dashboards/${d.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(widgets) }),
    });
    return { id: d.id, snapshot };
  }, scratch.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 20000 }).catch(() => null);
  await sleep(2500);
  const crashState = await page.evaluate(() => ({
    gridAlive: Boolean(document.querySelector(".grid-stack")),
    bodyText: (document.body.innerText || "").length,
    crashCard: Boolean(document.querySelector(".wb-widget__crash")),
  }));
  ok(
    "Q93 畸形 tagIds 不白屏：页面仍在、该卡进错误态/正常态 (项 1)",
    crashState.gridAlive && crashState.bodyText > 200,
    JSON.stringify(crashState),
  );
  // 还原布局 —— 不把测试卡片留在用户盘上
  await page.evaluate(async (seed) => {
    await fetch(`/api/dashboards/${seed.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: seed.snapshot }),
    });
  }, crashSeed);
  // ── Q93（项 2）/ D63：同一份数据可任意次展示 —— 同名组件不得被拒 ──
  // 旧守卫（D43）扫**全部页面布局**拒绝同 type 同值，把「数据唯一」错当成「展示唯一」，
  // 直接挡掉「多个页面放同一个 ToDo」。旧实现拒绝时调 `alert(...)`，故以**零弹窗**为信号。
  const alerts = [];
  page.on("dialog", (d) => {
    alerts.push(d.message());
    void d.dismiss().catch(() => {});
  });
  const addTodo = async (name) => {
    if (!(await clickBtn("添加组件"))) return "open-add";
    await sleep(300);
    const picked = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".wb-picker-card")].find((c) =>
        c.textContent.trim().startsWith("个人 Todo"),
      );
      card?.click();
      return Boolean(card);
    });
    if (!picked) {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(200);
      return "pick";
    }
    await sleep(400);
    if (!(await selectOption("名称", name))) {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(200);
      return "select-name";
    }
    await sleep(200);
    if (await clickBtn("确认添加", true)) return "ok";
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);
    return "confirm";
  };
  const todoSeed = await page.evaluate(async (dashId) => {
    const list = await (await fetch("/api/dashboards")).json();
    const d = list.find((x) => x.id === dashId); // TST-23：只认草稿盘
    return d ? { id: d.id, snapshot: d.layoutJson } : { id: "", snapshot: "[]" };
  }, scratch.id);
  // 上面的崩溃用例重载过页面 → 编辑态已退出，而「添加组件」只在编辑态的头部槽里
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "编辑页面")?.click(),
  );
  await sleep(500);
  // 自足 fixture：「名称」下拉的选项来自现存清单名 —— 先造一条 inbox 任务，
  // 否则空库时 creatable 选不上（本用例曾靠历史残留数据凑数，TST 家族）
  await page.evaluate(async () => {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `seed-${Date.now().toString(36)}`, list: "inbox" }),
    });
  });
  await sleep(600);
  const t1 = await addTodo("inbox");
  const t2 = await addTodo("inbox");
  ok(
    "Q93/D63 同名 ToDo 可重复添加（不拒绝；数据可任意次展示）(项 2)",
    t1 === "ok" && t2 === "ok" && alerts.length === 0,
    JSON.stringify({ t1, t2, alerts }),
  );
  await page.evaluate(async (seed) => {
    await fetch(`/api/dashboards/${seed.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: seed.snapshot }),
    });
  }, todoSeed);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

if (scratch) {
  // TST-23：临时草稿盘自删（失败打印告警供手工清理，不吞测试结论）
  await deleteScratchDashboard(api, scratch.id).catch((e) =>
    console.error("!! 临时草稿盘清理失败，需手工删除：", scratch.id, e?.message ?? e),
  );
}
await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
mock.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
