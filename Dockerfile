# API image (Render "Docker" runtime or any container host). Build context = repo root.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root --no-audit --no-fund
COPY shared shared
COPY server server
RUN npm -w server run build && npm prune --omit=dev --workspace server --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 BOOTSTRAP_DATA_DIR=/app/server/data
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server server
WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
