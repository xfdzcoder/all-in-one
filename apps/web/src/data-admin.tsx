import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import type { DataSourceRow, FeedSource, TagRow, TodoItem } from "./api";
import { ConfirmAction } from "./confirm";
import { configForSubmit, propsWithSecretRefs } from "./config-form-utils";
import { api } from "./api";
import {
  useDashboards,
  useDataSources,
  useDataSourceMutations,
  useDraft,
  useFeedMutations,
  useFeedSources,
  useKanbanBoards,
  useKanbanMutations,
  useKanbanTree,
  useTagMutations,
  useTags,
  useTodoMutations,
  useTodos,
} from "./data-hooks";
import { IconLibrary } from "./icon-library";
import { MailAccountsPanel } from "./mail-accounts";
import { TagInput } from "./tag-input";
import { ServiceIcon } from "./service-icon";
import { WbAlert } from "./ui";
import { reportError } from "./feedback";

/**
 * 数据源管理（FR-D2/D40；Q25c/#2 由弹窗改为**独立全页**——大数量好展示）：
 * 任务 / 信息源 / 标签 三区；顶部搜索 + 逐行打标签（TagInput：输入搜索/回车即建）。
 * 卡片只做视图（数据/视图分离）：组件按标签选数据（FR-D3）。
 */

const TAG_COLORS = [
  { value: "", label: "默认" },
  { value: "blue", label: "蓝" },
  { value: "green", label: "绿" },
  { value: "orange", label: "橙" },
  { value: "red", label: "红" },
  { value: "violet", label: "紫" },
  { value: "teal", label: "青" },
];

export function DataAdmin({ onBack, initialTab }: { onBack: () => void; initialTab?: string }) {
  const { data: dashboards } = useDashboards();
  const todos = useTodos(undefined, undefined, true); // Q29b：管理面含归档
  const sources = useFeedSources();
  const tags = useTags();
  const tagMut = useTagMutations();
  const todoMut = useTodoMutations();
  const feedMut = useFeedMutations();
  // D43/Q29b：任务页签 = 单 ToDo 视图（下拉切换 + 快捷筛选 + 所在 Dashboard）
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [activeTodoName, setActiveTodoName] = useState<string | undefined>(undefined);
  const [todoFilter, setTodoFilter] = useState<"all" | "open" | "done">("all");
  // 名称 → 所在 Dashboard（布局反查；页面被删 = 未挂载）
  const todoDashboard = (n: string): string => {
    for (const d of dashboards ?? []) {
      try {
        const layout = JSON.parse(d.layoutJson ?? "[]") as Array<{ component?: string; props?: Record<string, unknown> }>;
        for (const w of layout) {
          if (w.component !== "todo") continue;
          const props = (w.props ?? {}) as { name?: unknown; list?: unknown };
          if (String(props.name ?? props.list ?? "") === n) return d.title;
        }
      } catch {
        /* noop */
      }
    }
    return "";
  };
  const [newSourceTitle, setNewSourceTitle] = useDraft();
  const [newSourceUrl, setNewSourceUrl] = useDraft();
  const [newTagName, setNewTagName] = useDraft();
  const [newTagColor, setNewTagColor] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // Q25c/#2：搜索（标题/URL/清单名/标签名）
  const [q, setQ] = useState("");
  // Q26a/#1：看板管理（看板/列/卡片 CRUD + 归档恢复）
  const boards = useKanbanBoards();
  const [boardId, setBoardId] = useState<string | undefined>(undefined);
  const activeBoardId = boardId ?? boards.boards[0]?.id;
  const tree = useKanbanTree(activeBoardId);
  const m = useKanbanMutations(activeBoardId);
  const [newBoard, setNewBoard] = useState("");
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newColumn, setNewColumn] = useState("");
  // Q26b/D42：命名数据连接（monitor / opencode / http）
  const dsMut = useDataSourceMutations();
  const [dsKind, setDsKind] = useState<string>("monitor");
  const dsRows = useDataSources(dsKind);
  // Q93（项 5）：计数要用**全量**，不能跟着选中类型过滤 —— 否则其它类型的计数恒为 0。
  // 原来复用 `dsRows`（已按 dsKind 过滤），首进 tab 全是「0 个连接」；进详情页会改 dsKind
  // 才临时对上，再切走就又没了。计数与列表**解耦**：列表按选中类型过滤，计数按全量统计。
  const allDsRows = useDataSources();
  const [dsEditing, setDsEditing] = useState<string | null>(null);
  const [dsName, setDsName] = useState("");
  const [dsConfig, setDsConfig] = useState<Record<string, string>>({});
  const [dsError, setDsError] = useState<string | null>(null);
  // Q27c#3：数据连接 = 类型画廊（卡片 + logo）→ 点击进入该类型连接管理
  const [dsView, setDsView] = useState<string>("gallery");
  const DS_KINDS = [
    { value: "monitor", label: "监控源", desc: "Glances 等服务监控（CPU / 内存 / 磁盘 / 运行时长）", icon: "monitor" },
    { value: "opencode", label: "OpenCode", desc: "opencode server 会话与状态（实验性接口）", icon: "opencode" },
    { value: "http", label: "HTTP / 自定义 API", desc: "任意 HTTP 接口的认证来源（Bearer / 自定义头）", icon: "http" },
    // Q39/D46：第三方服务四类（服务概览组件消费）
    { value: "immich", label: "Immich", desc: "照片库（API Key 认证；版本/照片/视频计数）", icon: "immich" },
    { value: "navidrome", label: "Navidrome", desc: "音乐库（Subsonic u/p；版本/歌曲/专辑/艺术家）", icon: "navidrome" },
    { value: "portainer", label: "Portainer", desc: "容器管理（API Key；版本/端点/容器运行数）", icon: "portainer" },
    { value: "mihomo", label: "Mihomo / metacubexd", desc: "代理内核（secret；版本/代理数/内存）", icon: "mihomo" },
  ] as Array<{ value: string; label: string; desc: string; icon: string }>;
  const DS_FIELDS: Record<string, Array<{ key: string; label: string; type: "text" | "select" | "secret"; options?: Array<{ value: string; label: string }> }>> = {
    monitor: [
      { key: "url", label: "监控源地址", type: "text" },
      { key: "authMode", label: "认证方式", type: "select", options: [{ value: "none", label: "无认证" }, { value: "basic", label: "Basic" }, { value: "bearer", label: "Bearer" }] },
      { key: "username", label: "用户名", type: "text" },
      // Q36：键与连接器/组件对齐（apiToken）——旧 password 行仍被连接器兼容
      { key: "apiToken", label: "口令 / 令牌", type: "secret" },
    ],
    opencode: [
      { key: "url", label: "服务地址", type: "text" },
      { key: "apiToken", label: "访问令牌", type: "secret" },
    ],
    http: [
      { key: "url", label: "接口地址", type: "text" },
      { key: "authHeader", label: "认证头名", type: "text" },
      { key: "apiToken", label: "访问令牌", type: "secret" },
    ],
    // Q39/D46：服务连接表单（secret → 凭证库 SEC3）
    immich: [
      { key: "url", label: "服务地址", type: "text" },
      { key: "apiKey", label: "API Key", type: "secret" },
    ],
    navidrome: [
      { key: "url", label: "服务地址", type: "text" },
      { key: "username", label: "用户名", type: "text" },
      { key: "password", label: "口令", type: "secret" },
    ],
    portainer: [
      { key: "url", label: "服务地址", type: "text" },
      { key: "apiToken", label: "访问令牌", type: "secret" },
      { key: "restartAllow", label: "重启白名单（容器名逗号分隔，留空 = 禁止重启）", type: "text" },
    ],
    mihomo: [
      { key: "url", label: "服务地址", type: "text" },
      { key: "secret", label: "secret", type: "secret" },
    ],
  };

  const resetDsForm = () => {
    setDsEditing(null);
    setDsName("");
    setDsConfig({});
    setDsError(null);
  };

  const submitDs = async () => {
    setDsError(null);
    try {
      const schema = DS_FIELDS[dsKind].map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
      }));
      const config = await propsWithSecretRefs(
        schema,
        { ...dsConfig } as Record<string, unknown>,
        (name, secret) => api.createCredential(name, secret),
      );
      // WEB-2：文本字段空串**保留**（= 显式清空），secret 空串仍剔除（= 不改）——见 configForSubmit
      const clean = configForSubmit(schema, config as Record<string, unknown>);
      if (dsEditing) await dsMut.update.mutateAsync({ id: dsEditing, name: dsName.trim(), config: clean });
      else await dsMut.create.mutateAsync({ kind: dsKind, name: dsName.trim(), config: clean });
      resetDsForm();
    } catch (e) {
      setDsError(e instanceof Error ? e.message : String(e));
    }
  };

  const tagRows = tags.data ?? [];

  return (
    <div className="wb-admin">
      <div className="wb-admin__bar">
        <Button variant="default" size="xs" onClick={onBack}>
          ← 返回工作台
        </Button>
        <Title order={4} className="wb-admin__title">
          数据源管理
        </Title>
        <TextInput
          size="xs"
          className="wb-admin__search"
          placeholder="搜索任务 / 订阅源 / 标签…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      {error && (
        <WbAlert tone="error" size="sm" onClose={() => setError(null)}>
          {error}
        </WbAlert>
      )}
      <Tabs defaultValue={initialTab ?? "todo"}>
        <Tabs.List>
          <Tabs.Tab value="todo">任务</Tabs.Tab>
          <Tabs.Tab value="feeds">信息源</Tabs.Tab>
          <Tabs.Tab value="kanban">看板</Tabs.Tab>
          <Tabs.Tab value="mail">邮箱</Tabs.Tab>
          <Tabs.Tab value="sources">数据连接</Tabs.Tab>
          <Tabs.Tab value="icons">图标</Tabs.Tab>
          <Tabs.Tab value="tags">标签</Tabs.Tab>
        </Tabs.List>

        {/* ── 任务（Q29b：单 ToDo 视图 —— 下拉切换 + 快捷筛选 + 所在 Dashboard） ── */}
        <Tabs.Panel value="todo" pt="xs">
          <Stack gap="xs">
            {(() => {
              const all = (todos.data ?? []) as TodoItem[];
              const names = [...new Set(all.map((t: TodoItem) => t.list || "未命名"))];
              const current = activeTodoName ?? names[0];
              const items = all
                .filter((t: TodoItem) => t.list === current)
                .filter((t: TodoItem) =>
                  todoFilter === "open" ? !t.done : todoFilter === "done" ? t.done : true,
                );
              const totalCount = all.filter((t: TodoItem) => t.list === current).length;
              const dash = todoDashboard(current);
              return (
                <>
                  <Group gap="xs" wrap="nowrap">
                    <Select
                      size="xs"
                      placeholder="选择 ToDo"
                      data={names.map((n: string) => ({
                        value: n,
                        label: n,
                      }))}
                      value={current ?? null}
                      onChange={(v) => setActiveTodoName(v ?? undefined)}
                      nothingFoundMessage="暂无 ToDo —— 在 Dashboard 添加组件并命名"
                      className="wb-grow"
                      aria-label="ToDo 选择"
                    />
                    {current && (
                      <ConfirmAction
                        label="删除 ToDo"
                        size="compact-xs"
                        variant="subtle"
                        title="删除 ToDo？"
                        message={`确认删除 ToDo「${current}」？将真删其全部 ${totalCount} 项任务（不可恢复；Dashboard 上的卡片只是视图）`}
                        onConfirm={() => {
                          todoMut.deleteGroup.mutate(current);
                          setActiveTodoName(undefined);
                        }}
                      />
                    )}
                  </Group>
                  {current && (
                    <Group gap="xs" wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        {totalCount} 项 · {dash ? `所在页面：${dash}` : "未挂载（卡片已删，数据保留）"}
                      </Text>
                      <SegmentedControl
                        size="xs"
                        value={todoFilter}
                        onChange={(v) => setTodoFilter(v as "all" | "open" | "done")}
                        data={[
                          { value: "open", label: "未完成" },
                          { value: "done", label: "已完成" },
                          { value: "all", label: "全部" },
                        ]}
                      />
                    </Group>
                  )}
                  {current && (
                    <div className="wb-admin__table">
                      {items.filter((t: TodoItem) => !q || t.title.includes(q) || (t.list ?? "").includes(q)).map((t: TodoItem) => (
                        <div key={t.id} className="wb-admin__row" data-admin-row="todo">
                          <Checkbox
                            checked={t.done}
                            onChange={(e) => todoMut.toggle.mutate({ id: t.id, done: e.currentTarget.checked })}
                            aria-label={`toggle ${t.title}`}
                          />
                          <Text
                            size="sm"
                            className="wb-grow"
                            truncate
                            style={t.done ? { textDecoration: "line-through" } : undefined}
                          >
                            {t.title}
                          </Text>
                          {t.archived && (
                            <Badge size="xs" variant="outline">
                              已归档
                            </Badge>
                          )}
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => todoMut.toggleArchive.mutate({ id: t.id, archived: !t.archived })}
                          >
                            {t.archived ? "恢复" : "归档"}
                          </Button>
                          <ConfirmAction
                            label="×"
                            size="compact-xs"
                            variant="subtle"
                            title="删除任务？"
                            message={`确认删除任务「${t.title}」？（不可恢复）`}
                            onConfirm={() => todoMut.remove.mutate(t.id)}
                          />
                        </div>
                      ))}
                      {items.length === 0 && (
                        <Text size="xs" c="dimmed">
                          {todoFilter === "all" ? "暂无任务" : `暂无${todoFilter === "open" ? "未完成" : "已完成"}任务`}
                        </Text>
                      )}
                    </div>
                  )}
                  {current && (
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder={`「${current}」新任务…`}
                        value={groupDrafts[current] ?? ""}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setGroupDrafts((d) => ({ ...d, [current]: v }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (groupDrafts[current] ?? "").trim()) {
                            todoMut.create.mutate({ title: (groupDrafts[current] ?? "").trim(), list: current });
                            setGroupDrafts((d) => ({ ...d, [current]: "" }));
                          }
                        }}
                        className="wb-grow"
                      />
                      <Button
                        size="xs"
                        disabled={!(groupDrafts[current] ?? "").trim()}
                        onClick={() => {
                          todoMut.create.mutate({ title: (groupDrafts[current] ?? "").trim(), list: current });
                          setGroupDrafts((d) => ({ ...d, [current]: "" }));
                        }}
                      >
                        添加
                      </Button>
                    </Group>
                  )}
                  {names.length === 0 && (
                    <Text size="xs" c="dimmed">
                      暂无 ToDo —— 在 Dashboard「添加组件 · 个人 Todo」创建并命名后，这里按名称管理
                    </Text>
                  )}
                </>
              );
            })()}
          </Stack>
        </Tabs.Panel>

        {/* ── 信息源（RSS 订阅） ── */}
        <Tabs.Panel value="feeds" pt="xs">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <TextInput
                size="xs"
                placeholder="标题"
                value={newSourceTitle}
                onChange={(e) => setNewSourceTitle(e.currentTarget.value)}
                style={{ width: 130 }}
              />
              <TextInput
                size="xs"
                placeholder="https://…/feed.xml"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSourceUrl.trim()) {
                    feedMut.addSource.mutate(
                      { title: newSourceTitle.trim() || "订阅", url: newSourceUrl.trim() },
                      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                    );
                    setNewSourceUrl("");
                    setNewSourceTitle("");
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                disabled={!newSourceUrl.trim()}
                onClick={() => {
                  feedMut.addSource.mutate(
                    { title: newSourceTitle.trim() || "订阅", url: newSourceUrl.trim() },
                    { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                  );
                  setNewSourceUrl("");
                  setNewSourceTitle("");
                }}
              >
                订阅
              </Button>
            </Group>
            <div className="wb-admin__table">
              {(sources.data ?? [])
                .filter((src: FeedSource) => !q || src.title.includes(q) || src.url.includes(q))
                .map((s: FeedSource) => (
                  <div key={s.id} className="wb-admin__row" data-admin-row="feed">
                    <Text size="sm" fw={600} style={{ width: 140 }} truncate>
                      {s.title}
                    </Text>
                    <Text size="xs" c="dimmed" className="wb-grow" truncate>
                      {s.url}
                    </Text>
                    <TagInput
                      tags={tagRows}
                      value={s.tagIds ?? []}
                      onChange={(tagIds) =>
                        tagMut.setTarget.mutate({ targetType: "feed", targetId: s.id, tagIds })
                      }
                      width={220}
                    />
                    <ConfirmAction
                      label="退订"
                      size="compact-xs"
                      variant="subtle"
                      title="确认退订？"
                      message={`确认退订「${s.title}」？（已读标记保留，可随时重新订阅）`}
                      onConfirm={() => feedMut.removeSource.mutate(s.id)}
                    />
                  </div>
                ))}
              {(sources.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">
                  暂无订阅源
                </Text>
              )}
            </div>
          </Stack>
        </Tabs.Panel>

        {/* ── 看板（Q26a/#1：看板/列/卡片管理 + 归档恢复） ── */}
        <Tabs.Panel value="kanban" pt="xs">
          <Stack gap="xs">
            {/* 一.1（Q30）：左=看板下拉（缩短）+「＋ 新建看板」紧邻；右=当前看板名称+删除看板（同一行、缩短、靠右） */}
            <div className="wb-admin__bar">
              <div className="wb-admin__bar-group">
                <Select
                  size="xs"
                  w={200}
                  placeholder="选择看板"
                  data={boards.boards.map((b) => ({ value: b.id, label: b.title }))}
                  value={activeBoardId ?? null}
                  onChange={(v) => v && setBoardId(v)}
                  nothingFoundMessage="暂无看板"
                  aria-label="看板选择"
                />
                <Button
                  size="xs"
                  variant={newBoardOpen ? "default" : "filled"}
                  onClick={() => setNewBoardOpen((v) => !v)}
                >
                  {newBoardOpen ? "收起" : "＋ 新建看板"}
                </Button>
              </div>
              {activeBoardId && (
                <div className="wb-admin__bar-group wb-admin__bar-right">
                  <TextInput
                    key={activeBoardId}
                    size="xs"
                    w={170}
                    placeholder="看板名称"
                    defaultValue={boards.boards.find((b) => b.id === activeBoardId)?.title ?? ""}
                    aria-label="看板名称"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      const cur = boards.boards.find((b) => b.id === activeBoardId);
                      if (v && cur && v !== cur.title) void m.renameBoard(activeBoardId, v);
                    }}
                  />
                  <ConfirmAction
                    label="删除看板"
                    size="compact-xs"
                    variant="subtle"
                    title="删除看板？"
                    message={`删除看板将一并删除其中全部列与卡片（不可恢复）。业务数据边界：仅删看板数据。确认删除？`}
                    onConfirm={() => {
                      void m.deleteBoard(activeBoardId).then(() => setBoardId(undefined)).catch((e) => reportError("删除看板失败", e)); // WEB-4
                    }}
                  />
                </div>
              )}
            </div>
            {newBoardOpen && (
              <div className="wb-admin__section">
                <Text size="xs" c="dimmed">新建看板</Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    placeholder="新看板名"
                    value={newBoard}
                    onChange={(e) => setNewBoard(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBoard.trim()) {
                        void m.createBoard(newBoard.trim()).then((res) => res && setBoardId(res.id)).catch((err) => reportError("新建看板失败", err)); // WEB-4
                        setNewBoard("");
                        setNewBoardOpen(false);
                      }
                    }}
                    className="wb-grow"
                  />
                  <Button
                    size="xs"
                    disabled={!newBoard.trim()}
                    onClick={() => {
                      void m.createBoard(newBoard.trim()).then((res) => res && setBoardId(res.id)).catch((err) => reportError("新建看板失败", err)); // WEB-4
                      setNewBoard("");
                      setNewBoardOpen(false);
                    }}
                  >
                    创建
                  </Button>
                </Group>
              </div>
            )}

            {activeBoardId && (
              <>
                {/* Q28b：真·看板式列排布（列并排横排、列内卡片纵排） */}
                <div className="wb-admin__board">
                  {(tree.tree?.columns ?? [])
                    .filter((c) => !q || c.title.includes(q))
                    .map((col) => (
                      <div key={col.id} className="wb-admin__col" data-admin-col={col.title}>
                        <div className="wb-admin__colhead">
                          <TextInput
                            size="xs"
                            defaultValue={col.title}
                            className="wb-grow"
                            aria-label={`列名 ${col.title}`}
                            onBlur={(e) => {
                              const v = e.currentTarget.value.trim();
                              if (v && v !== col.title) void m.renameColumn(col.id, v);
                            }}
                          />
                          <ConfirmAction
                            label="×"
                            size="compact-xs"
                            variant="subtle"
                            title="删除列？"
                            message={`删除列「${col.title}」将一并删除其中卡片（不可恢复）。确认删除？`}
                            onConfirm={() => void m.deleteColumn(col.id)}
                          />
                        </div>
                        {(tree.tree?.cards ?? [])
                          .filter((c) => c.columnId === col.id && (!q || c.title.includes(q)))
                          .map((card) => (
                            <div key={card.id} className="wb-admin__card" data-admin-card={card.title}>
                              <TextInput
                                size="xs"
                                defaultValue={card.title}
                                aria-label={`卡片标题 ${card.title}`}
                                onBlur={(e) => {
                                  const v = e.currentTarget.value.trim();
                                  if (v && v !== card.title) void m.patchCard(card.id, { title: v });
                                }}
                              />
                              <div className="wb-admin__cardmeta">
                                {card.archived && (
                                  <Badge size="xs" variant="outline">
                                    已归档
                                  </Badge>
                                )}
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={() => void m.patchCard(card.id, { archived: !card.archived })}
                                >
                                  {card.archived ? "恢复" : "归档"}
                                </Button>
                                <ConfirmAction
                                  label="删除"
                                  size="compact-xs"
                                  variant="subtle"
                                  title="删除卡片？"
                                  message={`确认删除卡片「${card.title}」？（不可恢复）`}
                                  onConfirm={() => void m.deleteCard(card.id)}
                                />
                              </div>
                            </div>
                          ))}
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          className="wb-ghost-add"
                          onClick={() => void m.createCard(col.id, "新卡片")}
                        >
                          ＋ 卡片
                        </Button>
                      </div>
                    ))}
                  {/* 末列：添加列（管理页 = 加列唯一入口） */}
                  <div className="wb-admin__col wb-admin__col--ghost">
                    <Text size="xs" c="dimmed">
                      添加列
                    </Text>
                    <TextInput
                      size="xs"
                      placeholder="列名"
                      value={newColumn}
                      onChange={(e) => setNewColumn(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newColumn.trim()) {
                          void m.createColumn(newColumn.trim());
                          setNewColumn("");
                        }
                      }}
                    />
                    <Button
                      size="xs"
                      disabled={!newColumn.trim()}
                      onClick={() => {
                        if (newColumn.trim()) {
                          void m.createColumn(newColumn.trim());
                          setNewColumn("");
                        }
                      }}
                    >
                      添加列
                    </Button>
                  </div>
                </div>
                {(tree.tree?.columns ?? []).length === 0 && (
                  <Text size="xs" c="dimmed">
                    暂无列 —— 在右侧「添加列」开始规划
                  </Text>
                )}
              </>
            )}
            {!activeBoardId && (
              <Text size="xs" c="dimmed">
                暂无看板 —— 新建后即可管理列与卡片
              </Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── 邮箱（D42：数据源，管理自邮件组件迁入） ── */}
        <Tabs.Panel value="mail" pt="xs">
          <MailAccountsPanel />
        </Tabs.Panel>

        {/* ── 数据连接（D42）：类型画廊（Q27c#3）→ 连接管理 ── */}
        <Tabs.Panel value="sources" pt="xs">
          <Stack gap="xs">
            {dsView === "gallery" ? (
              <div className="wb-source-grid">
                {DS_KINDS.map((k) => {
                  const count = (allDsRows.data ?? []).filter((r: DataSourceRow) => r.kind === k.value).length;
                  return (
                    <button
                      key={k.value}
                      type="button"
                      className="wb-source-card"
                      onClick={() => {
                        setDsKind(k.value);
                        resetDsForm();
                        setDsView(k.value);
                      }}
                    >
                      <SourceLogo kind={k.icon} />
                      <Text size="sm" fw={600}>
                        {k.label}
                      </Text>
                      <Text size="xs" c="dimmed" className="wb-source-card__desc">
                        {k.desc}
                      </Text>
                      <Badge size="xs" variant="light">
                        {count} 个连接
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Stack gap="xs">
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      resetDsForm();
                      setDsView("gallery");
                    }}
                  >
                    ← 返回
                  </Button>
                  <Text size="sm" fw={600}>
                    {DS_KINDS.find((k) => k.value === dsView)?.label}连接
                  </Text>
                </Group>
                {dsError && (
                  <WbAlert tone="error" size="sm" onClose={() => setDsError(null)}>
                    {dsError}
                  </WbAlert>
                )}
                <div className="wb-admin__section">
                  <Text size="xs" c="dimmed">
                    {dsEditing ? "编辑连接" : "添加连接"}
                  </Text>
                  <Group gap="xs" wrap="nowrap">
                    <TextInput
                      size="xs"
                      placeholder="连接名称"
                      value={dsName}
                      onChange={(e) => setDsName(e.currentTarget.value)}
                      style={{ width: 150 }}
                    />
                    {DS_FIELDS[dsKind].map((f) =>
                      f.type === "select" ? (
                        <Select
                          key={f.key}
                          size="xs"
                          data={f.options ?? []}
                          value={dsConfig[f.key] ?? "none"}
                          onChange={(v) => setDsConfig((c) => ({ ...c, [f.key]: v ?? "" }))}
                          style={{ width: 110 }}
                          aria-label={f.label}
                        />
                      ) : (
                        <TextInput
                          key={f.key}
                          size="xs"
                          type={f.type === "secret" ? "password" : "text"}
                          placeholder={f.label}
                          value={dsConfig[f.key] ?? ""}
                          onChange={(e) => {
                            // 事件属性先取值：updater 延迟执行时 e.currentTarget 已回收（黑屏崩溃根因）
                            const v = e.currentTarget.value;
                            setDsConfig((c) => ({ ...c, [f.key]: v }));
                          }}
                          style={{ width: 160 }}
                        />
                      ),
                    )}
                    <Button size="xs" disabled={!dsName.trim()} onClick={() => void submitDs()}>
                      {dsEditing ? "保存修改" : "添加连接"}
                    </Button>
                    {dsEditing && (
                      <Button size="xs" variant="default" onClick={resetDsForm}>
                        取消
                      </Button>
                    )}
                  </Group>
                </div>
                <Text size="xs" c="dimmed">已添加连接</Text>
                <div className="wb-admin__table">
                  {(dsRows.data ?? [])
                    .filter((r: DataSourceRow) => r.kind === dsView && (!q || r.name.includes(q)))
                    .map((r: DataSourceRow) => (
                      <div key={r.id} className="wb-admin__row" data-admin-row="source">
                        <Text size="sm" fw={600} style={{ width: 140 }} truncate>
                          {r.name}
                        </Text>
                        <Text size="xs" c="dimmed" className="wb-grow" truncate>
                          {String((r.config as Record<string, unknown> | undefined)?.url ?? "")}
                        </Text>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => {
                            setDsEditing(r.id);
                            // SRV-07：损坏配置不再显示成空表单 —— 明确告知「为什么空 + 怎么修」
                            setDsError((r as { configError?: string }).configError ?? null);
                            setDsKind(r.kind);
                            setDsName(r.name);
                            setDsConfig(
                              Object.fromEntries(
                                Object.entries((r.config as Record<string, unknown> | undefined) ?? {})
                                  .filter(([, v]) => typeof v === "string")
                                  .map(([k, v]) => [k, String(v)]),
                              ),
                            );
                          }}
                        >
                          编辑
                        </Button>
                        <ConfirmAction
                          label="删除"
                          size="compact-xs"
                          variant="subtle"
                          title="删除连接？"
                          message={`确认删除连接「${r.name}」？（引用它的组件将回落内联配置；业务数据保留）`}
                          onConfirm={() => dsMut.remove.mutate(r.id)}
                        />
                      </div>
                    ))}
                  {(dsRows.data ?? []).filter((r: DataSourceRow) => r.kind === dsView).length === 0 && (
                    <Text size="xs" c="dimmed">
                      暂无连接 —— 添加后组件可引用
                    </Text>
                  )}
                </div>
              </Stack>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── 自定义图标库（Q38b/D45） ── */}
        <Tabs.Panel value="icons" pt="xs">
          <IconLibrary />
        </Tabs.Panel>

        {/* ── 标签 ── */}
        <Tabs.Panel value="tags" pt="xs">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <TextInput
                size="xs"
                placeholder="新标签名（行内打标签可直接回车创建）"
                value={newTagName}
                onChange={(e) => setNewTagName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim()) {
                    tagMut.create.mutate(
                      { name: newTagName.trim(), color: newTagColor || undefined },
                      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                    );
                    setNewTagName("");
                  }
                }}
                style={{ flex: 1 }}
              />
              <Select
                size="xs"
                data={TAG_COLORS}
                value={newTagColor}
                onChange={(v) => setNewTagColor(v ?? "")}
                style={{ width: 90 }}
                aria-label="标签颜色"
              />
              <Button
                size="xs"
                disabled={!newTagName.trim()}
                onClick={() => {
                  tagMut.create.mutate(
                    { name: newTagName.trim(), color: newTagColor || undefined },
                    { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                  );
                  setNewTagName("");
                }}
              >
                添加
              </Button>
            </Group>
            <div className="wb-admin__table">
              {tagRows.filter((t: TagRow) => !q || t.name.includes(q)).map((t: TagRow) => (
                <div key={t.id} className="wb-admin__row" data-admin-row="tag">
                  <TextInput
                    size="xs"
                    defaultValue={t.name}
                    className="wb-grow"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== t.name) tagMut.update.mutate({ id: t.id, name: v });
                    }}
                  />
                  <Select
                    size="xs"
                    data={TAG_COLORS}
                    value={t.color ?? ""}
                    onChange={(v) => tagMut.update.mutate({ id: t.id, color: v || null })}
                    style={{ width: 90 }}
                    aria-label={`标签颜色 ${t.name}`}
                  />
                  <Text size="xs" c="dimmed" style={{ width: 64 }}>
                    {t.targetCount} 项
                  </Text>
                  <ConfirmAction
                    label="×"
                    size="compact-xs"
                    variant="subtle"
                    title="删除标签？"
                    message={`确认删除标签「${t.name}」？（仅移除标签与关联，Todo/订阅数据保留）`}
                    onConfirm={() => tagMut.remove.mutate(t.id)}
                  />
                </div>
              ))}
              {tagRows.length === 0 && (
                <Text size="xs" c="dimmed">
                  暂无标签 —— 新建后即可给任务与订阅源打标
                </Text>
              )}
            </div>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** 数据源 logo（Q27c：自绘简洁 SVG 标 —— 离线环境无官方资源）。 */
function SourceLogo({ kind }: { kind: string }) {
  // Q38a（三.1）：已接入服务用官方图标（vendored，SOURCES.md 登记）；通用概念保留自绘
  const brand: Record<string, string> = { monitor: "glances", opencode: "opencode", immich: "immich", navidrome: "navidrome", portainer: "portainer", mihomo: "mihomo" };
  if (brand[kind]) {
    return (
      <span className="wb-source-logo" aria-hidden>
        <ServiceIcon name={brand[kind]} size={22} />
      </span>
    );
  }
  return (
    <span className="wb-source-logo" aria-hidden>
      {kind === "http" && (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )}
    </span>
  );
}
