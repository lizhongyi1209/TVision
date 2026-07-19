# TVision 多租户在线部署镜像（PLAN-MULTI-TENANT 阶段 6）
# next.config.mjs 里 output: "standalone" —— 运行时只需要 .next/standalone。

FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 需要编译工具链
RUN apk add --no-cache python3 make g++
# .npmrc 带 legacy-peer-deps=true —— lock 文件是在该设置下生成的（不含 peer
# 依赖树），漏拷会让容器内 npm ci 误报 lock 与 package.json 不同步。
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite + workflow 文件全在这个卷里
ENV DATA_DIR=/data
# 未配 S3 时的本地媒体回退目录（生产建议配 S3_*）
ENV OUTPUT_DIR=/data/output

RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
USER app

# 本项目没有 public/ 目录（图标走 app/icon.svg），只拷 standalone + static
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static

VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
