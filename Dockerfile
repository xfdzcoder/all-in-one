# 单镜像部署（04-tech-stack：Node 伺服 API + 静态资源，NFR1）。
# 构建：docker build -t all-in-one .
# 运行见 docker-compose.yml

# ---- 构建阶段 ----
FROM node:26-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/widget-sdk/package.json packages/widget-sdk/
# --ignore-scripts：此时 widget-sdk 的 tsconfig/src 尚未拷入，prepare(tsc) 必败；
# 产物改由下方显式 build 步骤产出
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# widget-sdk 发 dist；再构建 web 静态资源与 server
RUN pnpm --filter @all-in-one/widget-sdk build \
 && pnpm --filter @all-in-one/web build \
 && pnpm --filter @all-in-one/server build

# ---- 运行阶段 ----
FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm i -g pnpm@12.6.0
# 运行时仅需 server 的生产依赖（pnpm 处理 workspace 符号链接）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/widget-sdk/package.json packages/widget-sdk/
COPY --from=build /repo/packages/widget-sdk/dist packages/widget-sdk/dist
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /repo/apps/server/dist ./apps/server/dist
COPY --from=build /repo/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /repo/apps/web/dist ./public

# 数据卷（SQLite + 备份落点）
VOLUME ["/app/data"]
ENV DATABASE_URL=file:/app/data/app.db \
    PUBLIC_DIR=/app/public \
    HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
