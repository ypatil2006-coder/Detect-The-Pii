# Stage 1: Build static Vite + React bundle (including public/fonts and dist/ocr assets)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve static assets with unprivileged nginx on port 8080
FROM nginxinc/nginx-unprivileged:alpine AS runner

ENV PORT=8080

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
