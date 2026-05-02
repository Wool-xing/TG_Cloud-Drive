# TG云盘 · 启动指南

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS + TypeScript + PostgreSQL + Redis |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 文件代理 | Cloudflare Workers |
| 容器 | Docker + Docker Compose |

---

## 一、快速启动（Docker Compose）

### 1. 准备环境变量

```bash
cp .env.example .env
# 编辑 .env，填写以下必填项：
# - TG_BOT_TOKEN          （到 @BotFather 获取）
# - TG_CHANNEL_ID         （频道 ID，机器人须为管理员）
# - DB_PASS               （数据库密码，随机字符串即可）
# - ENCRYPTION_MASTER_KEY （随机 32 字节十六进制）
# - JWT_SECRET            （随机 64 字节十六进制）
# - JWT_REFRESH_SECRET    （随机 64 字节十六进制，与上面不同）
```

生成随机密钥：
```bash
# 64字节（JWT用）
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# 32字节（ENCRYPTION_MASTER_KEY用）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. 启动所有服务

```bash
docker compose up -d
```

### 3. 初始化数据库 + 创建管理员

```bash
# 等待 postgres 健康后执行
docker compose exec backend npx ts-node src/database/seed.ts
```

### 4. 访问

- 前端：http://localhost（或配置的域名）
- 后端 API 文档：http://localhost/api/docs
- 管理员账号：Wool / ADMIN_INITIAL_PASSWORD（在 .env 中配置）

---

## 二、本地开发启动

### 前提
- Node.js 20+
- PostgreSQL 16（本地或 Docker）
- Redis 7（本地或 Docker）

### 启动 PostgreSQL + Redis（仅这两个服务）

```bash
docker compose up postgres redis -d
```

### 后端

```bash
cd backend
npm install
cp ../.env.example .env  # 配置本地环境变量，DATABASE_URL 改为 localhost
npm run start:dev
# 后端运行在 http://localhost:3000
# API 文档：http://localhost:3000/api/docs
```

### 前端

```bash
cd frontend
npm install
npm run dev
# 前端运行在 http://localhost:5173
# 自动代理 /api 到 localhost:3000
```

---

## 三、Cloudflare Workers 部署（国内直连必须）

### 1. 安装 Wrangler

```bash
cd worker
npm install
```

### 2. 配置 Secrets（不要写在代码里）

```bash
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put TG_CHANNEL_ID
npx wrangler secret put CF_WORKERS_SECRET
```

### 3. 部署

```bash
npx wrangler deploy
```

### 4. 配置后端

部署成功后将 Workers URL 填入 `.env`：
```
CF_WORKERS_URL=https://tg-pan-proxy.yourname.workers.dev
CF_WORKERS_SECRET=同上面设置的 secret
```

---

## 四、目录结构

```
TG云盘/
├── backend/               NestJS 后端
│   └── src/
│       ├── auth/          认证（登录/注册/JWT）
│       ├── users/         用户管理（个人中心/设备/日志）
│       ├── files/         文件管理（上传/下载/加密/目录）
│       ├── shares/        分享功能
│       ├── admin/         管理端（用户管理/系统配置）
│       ├── telegram/      Telegram Bot API 服务
│       ├── mail/          邮件服务（SMTP）
│       ├── verification/  验证码服务
│       └── common/        公共模块（加密/守卫/装饰器）
├── frontend/              React 前端
│   └── src/
│       ├── pages/         页面（登录/注册/网盘/管理/分享）
│       ├── components/    组件（布局/文件列表/上传/预览/对话框）
│       ├── stores/        状态管理（Zustand）
│       ├── api/           API 客户端（axios）
│       ├── utils/         工具（E2E加密）
│       └── types/         TypeScript 类型定义
├── worker/                Cloudflare Workers（TG代理/国内直连）
├── docker-compose.yml     一键启动所有服务
└── .env.example           环境变量模板
```

---

## 五、端到端加密说明

- 所有文件在上传前由浏览器加密（AES-256-GCM）
- 加密密钥（DEK）由用户密码派生的主密钥（MEK）保护
- 服务端只存储密文，无法读取文件内容
- 管理员也无法查看用户文件内容
- 忘记密码会导致已加密文件无法解密（这是设计如此）

---

## 六、常见问题

**Q: 国内访问慢/无法访问？**
A: 必须配置 Cloudflare Workers，参见第三节。Workers 的 workers.dev 域名在国内部分地区可直连。

**Q: 文件上传失败？**
A: 检查 TG_BOT_TOKEN 和 TG_CHANNEL_ID 是否正确，Bot 是否已添加为频道管理员。

**Q: 验证码收不到邮件？**
A: 开发模式下验证码会在 API 响应中直接返回（data.code）。生产环境需配置 SMTP。

**Q: 如何扩容？**
A: 后端无状态，可横向扩展（多副本 + Nginx 负载均衡）。数据库升级至主从架构。

---

## 七、公网访问配置

### 方式一：直接端口暴露（简单，不推荐生产）

在 `docker-compose.yml` 中确认 `nginx` 服务已映射端口到宿主机：

```yaml
nginx:
  ports:
    - "80:80"
    - "443:443"
```

然后在路由器/防火墙中放行 80/443 端口，通过服务器公网 IP 访问：`http://<公网IP>`

> 注意：大多数运营商封锁家庭宽带的 80/443 端口，建议使用云服务器。

---

### 方式二：域名 + Cloudflare（推荐）

1. **注册域名**（阿里云/腾讯云/Namecheap 等），解析 A 记录到服务器公网 IP。

2. **启用 Cloudflare 代理**（橙色云朵），获得 DDoS 防护和免费 HTTPS。

3. 在服务器 `docker-compose.yml` 中，将 Nginx 监听改为 443（或保持 80 使用 Cloudflare → 源站 HTTP 模式）。

4. 配置 `.env` 中的前端域名（如有 CORS 配置）：
   ```
   FRONTEND_URL=https://your-domain.com
   ```

5. 重启服务：
   ```bash
   docker compose up -d --force-recreate nginx
   ```

---

### 方式三：自签 HTTPS（Let's Encrypt）

如不使用 Cloudflare，可通过 Certbot 自动申请免费 SSL 证书：

```bash
# 安装 Certbot
apt install certbot python3-certbot-nginx

# 申请证书（需先停止 Nginx，或使用 --standalone）
certbot certonly --standalone -d your-domain.com

# 证书路径（挂载到 Docker 中）
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem
```

在 `nginx/nginx.conf` 中添加 HTTPS 配置：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://frontend:80;
    }

    location /api/ {
        proxy_pass http://backend:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

证书自动续期：
```bash
# 加入 crontab（每天检查一次）
0 3 * * * certbot renew --quiet && docker compose -f /path/to/docker-compose.yml restart nginx
```

---

### 方式四：内网穿透（无公网 IP 时）

适合家用机器或无固定公网 IP 的场景：

| 工具 | 特点 |
|---|---|
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | 免费，稳定，支持自定义域名 |
| [frp](https://github.com/fatedier/frp) | 自建，需要一台有公网 IP 的 VPS |
| [ngrok](https://ngrok.com/) | 简单易用，免费版有限制 |

**Cloudflare Tunnel 快速部署：**
```bash
# 1. 安装 cloudflared
# 参考：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# 2. 登录并创建隧道
cloudflared tunnel login
cloudflared tunnel create tg-pan

# 3. 配置 ~/.cloudflared/config.yml
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: your-domain.com
    service: http://localhost:80
  - service: http_status:404

# 4. 启动隧道
cloudflared tunnel run tg-pan
```

---

### 防火墙设置

```bash
# Ubuntu/Debian（ufw）
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp   # SSH，勿忘
ufw enable

# CentOS/RHEL（firewalld）
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

---

### 安全建议

- 修改默认管理员密码（首次登录后立即更改）
- `JWT_SECRET` 和 `ENCRYPTION_MASTER_KEY` 使用足够随机的值（32/64字节十六进制）
- 不要在公网暴露 PostgreSQL（5432）和 Redis（6379）端口
- 定期备份 PostgreSQL 数据：
  ```bash
  docker compose exec postgres pg_dump -U postgres tgpan > backup_$(date +%Y%m%d).sql
  ```
- 生产环境建议配置 SMTP 发送操作通知邮件
