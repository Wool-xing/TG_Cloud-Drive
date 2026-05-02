.PHONY: help prod dev stop restart logs seed clean status worker-deploy

# ─── TG 云盘 Makefile ────────────────────────────────────────────────────────
# Usage: make <target>

help: ## 显示帮助信息
	@echo ""
	@echo "  TG 云盘 — 可用命令"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ─── Docker 生产环境 ─────────────────────────────────────────────────────────

prod: ## 一键启动所有生产容器（含构建）
	@[ -f .env ] || (cp .env.example .env && echo "已创建 .env，请先填写必填项再重新运行" && exit 1)
	docker compose up -d --build
	@echo "等待 PostgreSQL 就绪..."
	@until docker compose exec -T postgres pg_isready -U tgpan -d tgpan >/dev/null 2>&1; do sleep 2; done
	@$(MAKE) seed
	@echo ""
	@echo "  ✅ 启动完成 → http://localhost"

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

seed: ## 初始化数据库（创建管理员账号）
	docker compose exec -T backend npx ts-node src/database/seed.ts

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
