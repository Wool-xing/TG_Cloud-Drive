# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# ── Docker (recommended) ──
make help          # List all commands
make quickstart    # Interactive one-click deploy (first-time)
make prod          # Production startup (requires .env filled + TLS certs)
make dev           # Dev mode: start postgres+redis in Docker, run frontend/backend locally
make stop          # Stop all containers
make restart       # Restart all containers
make logs          # Tail all container logs
make status        # Container health status
make clean         # Stop + delete volumes (⚠️ destroys DB data)
make doctor        # Validate .env — no CHANGE_ME_ placeholders, no weak defaults
make seed          # Init DB + create admin account (idempotent)
make certs-dev     # Generate self-signed TLS cert for local dev

# ── Local dev (after `make dev` starts postgres+redis) ──
cd backend && npm install && npm run start:dev   # Backend on :3000, Swagger at /api/docs
cd frontend && npm install && npm run dev         # Frontend on :2222

# ── Worker ──
make worker-deploy       # Deploy Cloudflare Worker
make worker-secrets      # Set Worker secrets interactively

# ── Database ──
cd backend
npm run migration:generate  # Generate migration from entity changes
npm run migration:run       # Apply pending migrations
npm run migration:revert    # Revert last migration
```

Docker is the primary workflow. Local dev (`make dev`) only starts postgres + redis; run backend and frontend separately in terminals.

## Workflow preferences

- **Plan Mode** — default for this project. Non-trivial changes go through EnterPlanMode before coding. Trivial fixes (typos, single-line) skip.
- **Auto-compact** — run `/compact` when context exceeds ~60% capacity (long audit/fix sessions). Keeps cache warm.
- **Subagents** — use ECC agents by role:
  - `code-reviewer` after any code change (`.ts`/`.tsx`/`.py`)
  - `security-reviewer` for auth, crypto, input handling, env changes
  - `typescript-reviewer` for NestJS backend + React frontend changes
  - `python-reviewer` for Python verify/test scripts
  - `build-error-resolver` when `npm run build` or `docker compose up` fails
  - `silent-failure-hunter` when touching error-handling paths
- **Hooks** — global PostToolUse hook runs on every Edit/Write: secrets scan (BLOCK), ruff for `.py`, tsc for `.ts`/`.tsx` (warn only). No project-specific hooks added beyond global H2 config.

## Architecture

```
Browser (E2E crypto) → Nginx (:443, TLS) → Frontend (React SPA, :80)
                         │
                         ├─ /api/* → Backend (NestJS, :3000) → PostgreSQL 16 + Redis 7
                         │                │
                         │                ├─ /api/files/* → Cloudflare Worker (optional) → Telegram Bot API
                         │                │                    (proxies file upload/download, hides bot token)
                         │                └─ /api/webdav/* → WebDAV protocol
                         │
                         └─ /* → Frontend static (nginx serves SPA with content-hashed assets)
```

**Five Docker services** (docker-compose.yml): `postgres`, `redis`, `backend`, `frontend`, `nginx`.

**E2E encryption flow**: Browser derives MEK from password via PBKDF2 → generates per-file DEK → encrypts file chunks with AES-256-GCM → uploads ciphertext via Worker → Telegram. Server stores `message_id + file_id + encrypted metadata` only, never sees DEK.

### Backend (`backend/src/`)

NestJS modular monolith. Each domain is a NestJS module with controller + service + module + entities:

| Module | Path | Responsibility |
|--------|------|----------------|
| `auth` | `auth/` | Login/register, JWT access+refresh tokens, device session management |
| `users` | `users/` | User CRUD, quota management, audit logging |
| `files` | `files/` | File metadata, directory tree, encryption key storage (NodeKey), chunk tracking, trash, versions, file requests |
| `shares` | `shares/` | Share links with password/expiry/download-limit/one-time |
| `admin` | `admin/` | Admin panel: user management, system config hot-reload |
| `telegram` | `telegram/` | TG Bot API wrapper — upload, download, getFileUrl |
| `mail` | `mail/` | SMTP email (production only; dev mode skips) |
| `verification` | `verification/` | Rate-limited verification codes, anti-brute-force |
| `webdav` | `webdav/` | WebDAV protocol support |
| `common` | `common/` | AES encryption, env-validator (startup gate), guards (JWT, roles), filters, interceptors, Redis module |

**Key backend invariants**:
- `env-validator.ts` runs at startup (`validateEnvOrExit()`) — refuses to boot on `CHANGE_ME_*` placeholders, weak passwords, missing CF_WORKERS_URL in production
- `SYNCHRONIZE_DB` only allowed when `NODE_ENV=development`; production requires explicit opt-in
- Swagger (`/api/docs`) mounted **only** in non-production to avoid exposing API surface
- CORS whitelist: production uses exact `APP_URL`, dev adds `http://localhost:<port>`
- All controllers behind `JwtAuthGuard` by default; `@Public()` decorator for exceptions

### Frontend (`frontend/src/`)

React 18 + TypeScript + Vite + Tailwind CSS. State management via Zustand stores (`auth`, `file`, `upload`).

| Path | Purpose |
|------|---------|
| `pages/` | Route-level pages: Drive, Login, Register, Profile, Recent, Shares, Starred, Trash, SharedAccess, FileRequestPage, admin/* |
| `components/layout/` | AppLayout (shell), Sidebar, Topbar |
| `components/files/` | FileGrid, FileList, FileToolbar, FileContextMenu |
| `components/dialogs/` | ShareDialog, MoveDialog, RenameDialog, VersionDialog, FileRequestDialog, LockDialog, ConfirmPasswordDialog |
| `components/preview/` | PreviewModal (image zoom/pan, video, audio, PDF, text) |
| `components/upload/` | UploadQueue with progress |
| `stores/` | Zustand stores: `auth.store` (login state, MEK cache), `file.store` (file tree, selection, sort), `upload.store` (queue, progress) |
| `utils/crypto.ts` | All E2E crypto: `deriveMEK`, `generateDEK`, `encryptDEK`/`decryptDEK`, `encryptChunk`/`decryptChunk`, session MEK cache |
| `api/client.ts` | Axios instance with JWT interceptor + refresh token rotation |
| `i18n/` | Chinese + English translations (`t()` helper) |
| `types/` | Shared TypeScript types |

**Key frontend invariants**:
- MEK is derived client-side from password via PBKDF2 (310K iterations), cached in-memory only (`sessionMEK`), cleared on logout
- DEK is embedded in share URL `#fragment` (never sent to server); full link = decryption capability
- Content-hashed bundle filenames (Vite default); `index.html` must NOT be cached (nginx enforces this)
- build step: `tsc && vite build` (type-check then bundle)

### Worker (`worker/src/index.ts`)

Single-file Cloudflare Worker. Proxies TG Bot API calls to hide the bot token from browsers. Backend returns `CF_WORKERS_URL` for download URLs instead of `api.telegram.org/file/bot{TOKEN}/...`. Uses shared secret (`CF_WORKERS_SECRET`) to authenticate backend requests.

### Nginx (`nginx.conf`)

TLS termination (443) + HTTP→HTTPS redirect (80). Rate limits: API 30r/s burst 60, auth endpoints 5r/s burst 10, chunk upload up to 30MB body. Security headers: HSTS 2yr, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Static assets cached 1yr (immutable); `index.html` never cached.

## Project governance

The [`项目协作宪章.md`](./项目协作宪章.md) is the constitution for this project. Two North Stars:
1. **Landing**: A newcomer clones, follows `启动指南.md`, deploys in 30min, logs in, uploads, downloads, shares.
2. **Security**: Zero credential leaks + no trivial attack paths.

Fix priority = `max(severity, deployment-blocker-weight, attacker-ease-weight)`.

Before every fix: self-review Q1 (root cause or symptom?) + Q2 (cross-layer impact on frontend/Worker/nginx/DB?).

## Security-critical paths

- **`backend/src/common/env-validator.ts`**: Startup gate — never bypass. Blocks `CHANGE_ME_*`, weak passwords, missing CF_WORKERS_URL in production.
- **`frontend/src/utils/crypto.ts`**: E2E encryption core. MEK never leaves browser. DEK only in URL fragment.
- **`backend/src/auth/`**: JWT + refresh token rotation + device sessions.
- **`backend/src/telegram/telegram.service.ts`**: `getFileUrl()` gates direct TG URL behind CF_WORKERS_URL check.
- **`nginx.conf`**: TLS + rate limits + security headers + CSP.
- **`.env`**: Contains ALL real secrets. `.gitignore` covers it. Never commit `.env` or backups.

## Test scripts

E2E and verification scripts live in `tests/e2e/` (Python + Playwright). Previously scattered in project root — consolidated 2026-05-16. Run from project root: `python tests/e2e/<script>.py`.

No unit test suite exists yet for backend (`*.spec.ts`) or frontend (`*.test.tsx`). This is a known gap.

## Key docs

| File | Purpose |
|------|---------|
| `README.md` | Project overview, architecture diagram, features, security model |
| `启动指南.md` | Detailed deployment guide, production setup, Let's Encrypt |
| `项目协作宪章.md` | Engineering constitution — fix rules, self-review, gate mechanisms |
| `代码审查报告.md` | Historical code review records (218 findings, all resolved) |
| `灵感笔记.md` | Design trade-offs, unfinished ideas |
| `Makefile` | All operational commands |
| `.env.example` | All env vars with documentation |
