# Optional static frontend image (production uses Firebase Hosting). Build context = repo root.
FROM node:22-slim AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root --no-audit --no-fund
COPY shared shared
COPY web web
RUN npm -w web run build
FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
RUN printf 'server { listen 8080; root /usr/share/nginx/html; location /assets/ { add_header Cache-Control "public,max-age=31536000,immutable"; } location = /sw.js { add_header Cache-Control "no-cache"; } location / { try_files $uri /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
