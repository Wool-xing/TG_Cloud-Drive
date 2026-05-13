# TG 云盘

> 把 Telegram 当存储后端的自托管私有云盘。文件在浏览器端 AES-256-GCM 加密后上传到 Telegram 私有频道，服务端只看得到密文。

![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-20%2B-brightgreen) ![Stack](https://img.shields.io/badge/stack-NestJS%20%2B%20React%20%2B%20Postgres-orange) ![Status](https://img.shields.io/badge/status-self--hosted-lightgrey)

---

## ⚡ 5 分钟部署（一条命令）

前置：装好 [Docker Desktop](https://www.docker.com/products/docker-desktop) + 一个 [Telegram](https://telegram.org) 账号。

```bash
git clone <this-repo-url> tg-pan
cd tg-pan
make quickstart
```

脚本会做完这些：

- ✅ 自动生成 7 个强随机密钥（JWT × 2 / 加密主密钥 / DB / Redis / 管理员密码 / Workers secret）
- ✅ 自签 TLS 证书（开发用）
- ✅ 构建 + 启动 4 个容器（前端 / 后端 / Postgres / Redis）
- ✅ 初始化数据库 + 创建管理员账号
- ⚠️ **交互式问你 2 个值**（无法自动）：Telegram Bot Token 和私有频道 ID

完事后浏览器打开 [https://localhost](https://localhost)，用脚本最后打印的 `admin` 账号登录，**首次登录立刻改密**。

> **这是 dev 模式实例**，方便本地试跑（API 文档 `/api/docs` 挂载、验证码直接在 API 响应返回、不发邮件）。
> **正经公网部署**请改 `NODE_ENV=production` 后用 `make prod`，并按 [`启动指南.md`](./启动指南.md) 第七节配真证书。

---

## 这是什么

一个**为不想信任公有云盘**的人做的自托管方案：

- **存储 0 成本**：文件存进你自己的 Telegram 私有频道（Telegram 单文件 2GB，频道总容量无上限）
- **服务端零知识**：DEK 在浏览器派生，密文进 Telegram，明文从不离开你的浏览器
- **完整网盘体验**：目录 / 上传下载 / 预览 / 分享 / 回收站 / 多设备 / 配额 / 管理后台
- **国内可用**：可选挂 Cloudflare Workers 做 TG 反代，绕过 api.telegram.org 不可达问题

不是什么：

- 不是 demo / 玩具——已有完整鉴权、加密、限流、审计日志、管理后台
- 不是企业级 SaaS——存储后端是 Telegram，受 TG 服务条款 + 频道封禁风险约束（见下方"已知权衡"）
- 不是"军用级加密"的营销话术——下面把所有威胁模型和已知设计取舍**摊开来讲**

---

## 截图

> _占位：在这里放 3-4 张截图（登录页 / 文件管理 / 分享对话框 / 管理后台），首屏决定 70% 的点 star 概率_

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + Zustand |
| 后端 | NestJS + TypeScript |
| 数据库 | PostgreSQL 16 |
| 缓存 / 限流 | Redis 7 |
| 文件代理（可选） | Cloudflare Workers |
| 加密 | 浏览器端 AES-256-GCM（DEK）+ 服务端 AES-256-GCM（敏感字段） |
| 容器化 | Docker Compose |
| 反代 / TLS | Nginx |

---

## 架构一图流

```
┌─────────────┐     HTTPS    ┌──────────┐     ┌─────────────┐
│  Browser    │──────────────▶│  Nginx   │────▶│  Frontend   │
│  (E2E 加密) │              │  443→    │     │  (React)    │
└──────┬──────┘              └────┬─────┘     └─────────────┘
       │                          │
       │ /api/*                   │
       │                          ▼
       │                   ┌─────────────┐    ┌────────────┐
       │                   │  Backend    │───▶│ PostgreSQL │
       │                   │  (NestJS)   │    └────────────┘
       │                   │             │    ┌────────────┐
       │                   │             │───▶│   Redis    │
       │                   └──────┬──────┘    └────────────┘
       │                          │
       │  上传密文 chunk           │ 上传 / 下载密文
       │  ╔════════════════╗      │
       └─▶║ Cloudflare     ║◀─────┘
          ║ Worker (可选)  ║
          ╚════════╤═══════╝
                   │ Bot API
                   ▼
          ┌──────────────────┐
          │ Telegram         │
          │ Private Channel  │
          │ (你拥有)         │
          └──────────────────┘
```

**数据流**：浏览器派生 DEK → 加密文件 → 切 chunk → 走（可选）CF Worker → 进 TG 频道。服务端只存 `message_id + file_id + 密文 metadata`，无 DEK。

---

## 核心功能

- 📁 文件管理：上传 / 下载 / 重命名 / 移动 / 删除 / 回收站（30 天）
- 🔐 端到端加密：浏览器 AES-256-GCM，服务端无法读文件内容
- 🔗 分享：密码保护 / 过期时间 / 下载次数上限 / 一次性链接
- 👀 在线预览：图片 / 视频 / 音频 / PDF / 文本（解密后流式预览）
- 📱 多设备 + 设备管理：JWT + Refresh Token，可远程踢出会话
- 👮 管理后台：用户管理 / 配额调整 / 操作审计日志 / 系统配置热更新
- 📊 配额：默认 50GB / 用户，管理员可调
- 🌐 国内直连：可选 Cloudflare Workers 反代

---

## 🚨 安全模型 & 已知设计权衡（请认真读完再用）

这一节是这个项目和其他"号称端到端加密"网盘项目的最大区别——**所有设计取舍摊开来讲**。

### 威胁模型覆盖

| 威胁 | 是否防 |
|---|---|
| 服务器被入侵，攻击者拿到数据库 | ✅ 防——数据库只有密文，DEK 不落服务端 |
| 服务器管理员（即你自己）想看用户文件 | ✅ 防——你也没 DEK |
| 中间人嗅探流量 | ✅ 防——HTTPS 默认强制 + HSTS |
| 用户忘记密码 | ⚠️ 文件**永久无法解密**（这是设计如此，不是 bug） |
| 暴力破解登录 | ✅ 防——Redis 限流 + 失败锁定 |
| Telegram 官方读取你的文件 | ✅ 防——TG 看到的也是密文 |

### 三个必须知道的已知权衡

**① 分享链接 = 完整解密钥匙**

分享时 DEK 以 base64 嵌入 URL 的 `#fragment`（fragment 不发服务端，仅在客户端解密用）。这意味着：

- ✅ 服务端被脱库，攻击者拿到 share 表也解不开
- ⚠️ **完整链接（含 `#xxx`）落到任何人手里 = 该人能下载**，跟你设没设密码无关

**对策**：永远设访问密码（额外服务端闸）+ 设最短过期 + 设下载次数上限 + **绝对不在公开渠道发完整链接**。

未来计划重设为"服务端二级密钥包裹 + 密码派生 KEK"，属计划中重构。

**② Telegram 频道封禁是单点故障**

文件物理存储在 Telegram。如果你的频道被 TG 以违反服务条款为由封禁，所有文件**直接丢失**（除非你之前自己备份了密文）。

**对策**：

- 不要在频道里上传明显违反 TG TOS 的内容（密文 TG 看不出来，但元数据 + 文件名 + 文件大小模式可能被检测）
- 重要文件别只放这一处（任何"自托管"方案都不该当唯一备份）

**③ 忘记密码 = 永久数据丢失**

用户密码派生 MEK，MEK 包裹 DEK。**没有密码就没有 MEK 就没有 DEK**。管理员也救不回来——管理员也没有你的 MEK。

**对策**：

- 用密码管理器
- 项目计划加恢复 phrase（24 个助记词，类似加密钱包），但目前没有

### 部署期安全闸

后端启动会强制校验环境变量（[`backend/src/common/env-validator.ts`](./backend/src/common/env-validator.ts)），任何项不合格会 `process.exit(1)` 拒绝启动——见到 `CHANGE_ME_*` 占位符、弱密码、JWT/Refresh 相同、ENCRYPTION_MASTER_KEY 非 64 hex 等情况都启动不了。**这道闸不要绕开**。

---

## 目录结构

```
TG云盘/
├── backend/                 NestJS 后端
│   └── src/
│       ├── auth/            鉴权（登录 / 注册 / JWT / Refresh / 设备）
│       ├── users/           用户管理 / 配额 / 审计日志
│       ├── files/           文件管理 / 加密 / 目录 / 回收站
│       ├── shares/          分享（密码 / 过期 / 次数）
│       ├── admin/           管理后台
│       ├── telegram/        TG Bot API 封装
│       ├── mail/            SMTP（生产模式）
│       ├── verification/    验证码（限流 / 反爆破）
│       └── common/          加密 / 守卫 / 启动期 env 校验
├── frontend/                React 前端
├── worker/                  Cloudflare Worker（可选）
├── nginx.conf               反代 + TLS
├── docker-compose.yml       4 服务编排
├── Makefile                 quickstart / prod / dev / certs-dev / ...
├── quickstart.sh            交互式一键部署
├── 启动指南.md              详细部署 + 公网 + Let's Encrypt
├── 项目协作宪章.md          工程治理北极星（落地 + 安全双轨）
├── 代码审查报告.md          历史代码审查记录
└── 灵感笔记.md              设计取舍 + 未完成想法
```

---

## 常用命令

```bash
make help          # 列所有命令
make quickstart    # 交互式一键部署（首次推荐）
make prod          # 生产模式启动（要求 .env 已填好）
make dev           # 只起 Postgres + Redis，本地跑前后端（Node 20+）
make stop          # 停所有容器
make restart       # 重启
make logs          # 跟日志
make clean         # 停容器 + 删数据卷（⚠️ 清库，需确认）
make worker-deploy # 部署 Cloudflare Worker
```

---

## 进阶 / 公网部署

完整公网部署、域名 + Cloudflare、Let's Encrypt 续签、Cloudflare Tunnel、防火墙配置——见 [`启动指南.md`](./启动指南.md) 第七节"公网访问配置"。

工程治理规则（贡献前必读）：[`项目协作宪章.md`](./项目协作宪章.md)。

---

## License

[MIT](./LICENSE)

---

## 致谢 / 设计参考

- [Telegram Bot API](https://core.telegram.org/bots/api) — 存储后端
- NestJS / React / Cloudflare Workers — 工程主干
- 设计哲学来源：[`项目协作宪章.md`](./项目协作宪章.md) 北极星条款
