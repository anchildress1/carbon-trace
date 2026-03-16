# Build stage — install deps and run Vite build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY index.html vite.config.js ./
COPY src/ src/
COPY public/ public/

ARG VITE_BASE_PATH=/carbon-trace/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN pnpm build

# Production stage — serve static files with nginx
FROM nginx:1-alpine

# Remove default nginx site
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from builder into the path-prefixed directory
COPY --from=builder /app/dist /usr/share/nginx/html/carbon-trace

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run requires port 8080
EXPOSE 8080

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
