.PHONY: help quickstart prod dev stop restart logs seed clean status worker-deploy certs-dev

# ─── TG 云盘 Makefile ────────────────────────────────────────────────────────
# Usage: make <target>

help: ## 显示帮助信息
	@echo ""
	@echo "  TG 云盘 — 可用命令"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ─── 一键部署 ────────────────────────────────────────────────────────────────

quickstart: ## 🚀 全新部署：交互式问 2 个 TG 值，其余全自动（密钥/证书/起容器/seed）
	@bash ./quickstart.sh

# ─── Docker 生产环境 ─────────────────────────────────────────────────────────

prod: ## 一键启动所有生产容器（含构建，需先填好 .env）
	@[ -f .env ] || (cp .env.example .env && echo "已创建 .env，请先填写必填项再重新运行" && exit 1)
	@[ -f certs/fullchain.pem ] && [ -f certs/privkey.pem ] || \
		(echo "❌ 缺少 TLS 证书 certs/fullchain.pem 与 certs/privkey.pem。开发可运行: make certs-dev；生产请配置 Let's Encrypt / Cloudflare / 商业证书后再启动" && exit 1)
	docker compose up -d --build
	@echo "等待 PostgreSQL 就绪..."
	@until docker compose exec -T postgres pg_isready -U tgpan -d tgpan >/dev/null 2>&1; do sleep 2; done
	@echo "同步 Postgres 内部密码到 .env（防止重复部署密码不匹配）..."
	@DB_PASS_VAL=$$(grep '^DB_PASS=' .env | cut -d= -f2-); \
		docker compose exec -T postgres psql -U tgpan -d tgpan -c "ALTER USER tgpan PASSWORD '$$DB_PASS_VAL';" >/dev/null 2>&1 || \
		(echo "❌ Postgres 密码同步失败" && exit 1)
	@docker compose restart backend >/dev/null 2>&1 || true
	@echo "等待 backend 就绪..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
		docker compose exec -T backend node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" >/dev/null 2>&1 && break; \
		sleep 2; \
	done
	@$(MAKE) seed
	@echo ""
	@echo "  ✅ 启动完成 → https://localhost"

# ─── TLS 证书 ────────────────────────────────────────────────────────────────

certs-dev: ## 生成开发用自签 TLS 证书（仅供本机调试，浏览器会显示不受信任警告）
	@mkdir -p certs/acme-webroot
	@if [ -f certs/fullchain.pem ] && [ -f certs/privkey.pem ]; then \
		echo "已存在 certs/fullchain.pem 与 certs/privkey.pem，跳过。如需重新生成请先删除。"; \
	else \
		command -v openssl >/dev/null 2>&1 || { \
			echo "❌ 缺少 openssl。macOS/Linux 自带；Windows 用 Git Bash 自带。请安装后重试。"; exit 1; }; \
		echo "生成 4096-bit 自签证书（CN=localhost，10 年有效）..."; \
		MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -days 3650 \
			-newkey rsa:4096 \
			-keyout certs/privkey.pem -out certs/fullchain.pem \
			-subj "/CN=localhost" \
			-addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"; \
		[ -f certs/fullchain.pem ] && [ -f certs/privkey.pem ] || \
			{ echo "❌ 证书生成失败（可能 openssl 输出被吞，请直接跑上面 openssl 命令查错）"; exit 1; }; \
		echo ""; \
		echo "  ✅ 证书已生成至 certs/。重要：浏览器首次访问会警告，开发期可点击高级 → 继续；"; \
		echo "     生产部署必须替换为 Let's Encrypt / Cloudflare / 商业证书。"; \
	fi

stop: ## 停止所有容器
	docker compose down

restart: ## 重启所有容器
	docker compose restart

logs: ## 实时查看所有日志
	docker compose logs -f

status: ## 查看容器状态
	docker compose ps

clean: ## 停止容器并删除数据卷（⚠️ 会清空数据库）
	@echo "警告：这将删除所有数据库数据！"
	@read -p "确认继续？[y/N] " c; [ "$$c" = "y" ] || exit 1
	docker compose down -v

# ─── 数据库 ──────────────────────────────────────────────────────────────────

seed: ## 初始化数据库（创建管理员账号；admin 已存在则跳过，密码不更新）
	docker compose exec -T backend node dist/database/seed.js

reset-admin: ## 重置 admin 密码为当前 .env 的 ADMIN_INITIAL_PASSWORD（首次跑可跳；重跑 quickstart 后必须跑此）
	@DB_PASS_VAL=$$(grep '^DB_PASS=' .env | cut -d= -f2-); \
		docker compose exec -T postgres psql -U tgpan -d tgpan -c "ALTER USER tgpan PASSWORD '$$DB_PASS_VAL';" >/dev/null 2>&1 || true
	@ADMIN_PASS=$$(grep '^ADMIN_INITIAL_PASSWORD=' .env | cut -d= -f2-); \
		ADMIN_USER=$$(grep '^ADMIN_USERNAME=' .env | cut -d= -f2-); \
		[ -z "$$ADMIN_PASS" ] && { echo "❌ .env 缺 ADMIN_INITIAL_PASSWORD"; exit 1; } || true; \
		HASH=$$(docker compose exec -T backend node -e "require('bcrypt').hash('$$ADMIN_PASS',12).then(h=>process.stdout.write(h))"); \
		docker compose exec -T postgres psql -U tgpan -d tgpan -c "UPDATE users SET password_hash='$$HASH' WHERE username='$$ADMIN_USER';" >/dev/null 2>&1 && \
		echo "✅ admin 密码已同步到 .env 的 ADMIN_INITIAL_PASSWORD" || \
		{ echo "❌ 密码同步失败"; exit 1; }
	@echo "⚠️  注意：如该 admin 之前上传过加密文件，由于密码改变 MEK 派生失效，旧文件无法解密。"

# ─── 本地开发模式 ─────────────────────────────────────────────────────────────

dev: ## 仅启动 PostgreSQL + Redis，本地运行前后端
	docker compose up postgres redis -d
	@echo ""
	@echo "  数据库 + Redis 已启动，请分别在两个终端运行："
	@echo ""
	@echo "  后端："
	@echo "    cd backend && npm install && npm run start:dev"
	@echo ""
	@echo "  前端："
	@echo "    cd frontend && npm install && npm run dev"
	@echo ""
	@echo "  后端地址：http://localhost:3000"
	@echo "  前端地址：http://localhost:5173"
	@echo "  API 文档：http://localhost:3000/api/docs"

dev-stop: ## 停止本地开发用的 PostgreSQL + Redis
	docker compose stop postgres redis

# ─── Cloudflare Worker ───────────────────────────────────────────────────────

worker-deploy: ## 部署 Cloudflare Worker（需先 cd worker && npm install）
	cd worker && npx wrangler deploy
	@echo "  ✅ Worker 已部署，将 Workers URL 填入 .env 的 CF_WORKERS_URL"

worker-secrets: ## 配置 Worker Secrets（交互式）
	@echo "依次设置 Worker Secrets："
	cd worker && npx wrangler secret put TELEGRAM_BOT_TOKEN
	cd worker && npx wrangler secret put TELEGRAM_CHAT_ID
	cd worker && npx wrangler secret put CF_WORKERS_SECRET
