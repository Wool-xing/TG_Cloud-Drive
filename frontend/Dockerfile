# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build React app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY . .

# Build-time env vars can be injected via --build-arg or docker-compose env
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npx vite build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Serve with Nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom SPA-aware nginx config
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Aggressive caching for hashed static assets
    location ~* \.(js|css|woff2?|ttf|eot|otf|svg|webp|avif|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        access_log off;
        try_files $uri =404;
    }

    # index.html: no caching so updates are always picked up
    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        try_files $uri =404;
    }

    # SPA fallback: any path that doesn't match a real file → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Deny hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
