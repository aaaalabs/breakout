FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini

FROM base AS deps
COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN npm install --workspaces --include-workspace-root --omit=dev=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
RUN npm --workspace shared run build && npm --workspace server run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=2567
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY package.json ./
WORKDIR /app/server
EXPOSE 2567
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
