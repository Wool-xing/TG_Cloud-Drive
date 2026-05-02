#!/usr/bin/env bash
# TG云盘 — One-click Docker startup (Linux / macOS)
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

cd "$(dirname "$0")"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       TG 云盘  一键启动脚本          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── 1. 检查 Docker ────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "未找到 Docker，请先安装 Docker Desktop"
docker info >/dev/null 2>&1      || die "Docker 未运行，请先启动 Docker Desktop"
ok "Docker 已就绪"

# ── 2. 初始化 .env ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  warn ".env 不存在，正在从 .env.example 创建..."
  cp .env.example .env

  # 自动生成随机密钥
  if command -v node >/dev/null 2>&1; then
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    CF_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
    DB_PASS=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

    sed -i.bak \
      -e "s|CHANGE_ME_64_char_hex_secret|${JWT_SECRET}|g" \
      -e "s|CHANGE_ME_32_byte_hex_key|${ENC_KEY}|g" \
      -e "s|CHANGE_ME_workers_secret|${CF_SECRET}|g" \
      -e "s|CHANGE_ME_strong_password_here|${DB_PASS}|g" \
      .env && rm -f .env.bak
    ok "随机密钥已自动生成"
  fi

  echo ""
  warn "请编辑 .env 文件，填入以下必填项后重新运行："
  echo "  - TELEGRAM_BOT_TOKEN   (从 @BotFather 获取)"
  echo "  - TELEGRAM_CHAT_ID     (频道 ID，机器人须为管理员)"
  echo "  - APP_URL              (你的域名或 http://localhost)"
  echo ""
  echo "  可选但推荐："
  echo "  - SMTP_HOST / SMTP_USER / SMTP_PASS  (邮件验证码)"
  echo "  - CF_WORKERS_URL                     (国内直连代理)"
  echo ""
  read -rp "已配置完成？按 Enter 继续，或 Ctrl+C 退出先编辑... "
fi

# ── 3. 检查必填变量 ───────────────────────────────────────────────────────────
# shellcheck source=.env
set -a; source .env; set +a

[[ -z "${TELEGRAM_BOT_TOKEN:-}" || "${TELEGRAM_BOT_TOKEN}" == *"AAXX"* ]] && \
  die "请在 .env 中填写有效的 TELEGRAM_BOT_TOKEN"
[[ -z "${TELEGRAM_CHAT_ID:-}" || "${TELEGRAM_CHAT_ID}" == "-100123"* ]] && \
  die "请在 .env 中填写有效的 TELEGRAM_CHAT_ID"

ok "环境变量检查通过"

# ── 4. 启动容器 ───────────────────────────────────────────────────────────────
info "启动所有服务 (docker compose up -d)..."
docker compose up -d --build
ok "容器已启动"

# ── 5. 等待 PostgreSQL 就绪 ───────────────────────────────────────────────────
info "等待 PostgreSQL 就绪..."
MAX_WAIT=60; ELAPSED=0
until docker compose exec -T postgres pg_isready -U "${DB_USER:-tgpan}" -d "${DB_NAME:-tgpan}" >/dev/null 2>&1; do
  sleep 2; ELAPSED=$((ELAPSED+2))
  [[ $ELAPSED -ge $MAX_WAIT ]] && die "PostgreSQL 超时未就绪，检查日志: docker compose logs postgres"
  echo -n "."
done
echo ""
ok "PostgreSQL 就绪"

# ── 6. 运行数据库迁移 / Seed ──────────────────────────────────────────────────
info "运行数据库初始化 (seed)..."
if docker compose exec -T backend npx ts-node src/database/seed.ts 2>&1; then
  ok "数据库初始化完成"
else
  warn "Seed 脚本报错（可能已初始化过，忽略即可）"
fi

# ── 7. 完成 ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ✅  TG 云盘启动成功！               ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  前端界面：  http://localhost               ║${NC}"
echo -e "${GREEN}║  API 文档：  http://localhost/api/docs      ║${NC}"
echo -e "${GREEN}║  管理员账号：Wool                           ║${NC}"
echo -e "${GREEN}║  初始密码：  见 .env 的 ADMIN_INITIAL_PASSWORD（默认 Admin@123456）║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  查看日志：  docker compose logs -f"
echo "  停止服务：  docker compose down"
echo ""
