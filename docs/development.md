# Aplena 开发、构建与发行

本文面向参与 Aplena 开发和发行的维护者。产品定位与使用方式见仓库根目录 [README](../README.md)。

## 1. 开发环境

### 1.1 前置条件

- Node.js 24；
- pnpm 11.19.0；
- Rust 1.97.1 或兼容 stable 工具链；
- macOS Command Line Tools。

依赖由 `pnpm-lock.yaml` 和 `Cargo.lock` 锁定。安装前端依赖：

```bash
pnpm install --frozen-lockfile
```

若 Homebrew `rustup` 未加入全局 `PATH`，可只为当前命令设置环境，不需要修改 shell 配置：

```bash
env CARGO_HOME="$PWD/.cargo-home" \
  PATH="/opt/homebrew/opt/rustup/bin:$PATH" \
  cargo test --workspace --locked
```

### 1.2 本地启动

```bash
pnpm tauri:dev
```

开发命令显式合并 `src-tauri/tauri.dev.conf.json`，发布配置不包含开发服务器地址或 WebSocket CSP。

## 2. 架构与代码边界

### 2.1 分层

```text
crates/pfcm-domain/   纯 Rust 领域类型、日期、金额与预算投影公式
src-tauri/            应用服务、SQLite、迁移、IPC 与桌面入口
src/                  React 页面、查询缓存、交互与图表
docs/                 产品、领域、架构、数据库和发行决策
```

依赖方向为 `React → Tauri IPC → Application → Domain / Infrastructure`。金额、日期计入、偏差、比例和预算投影由 Rust 后端权威计算；前端不复制财务公式，也不直接访问数据库。

### 2.2 数据库

首个正式版从 `src-tauri/migrations/0001_initial_release.sql` 建立 schema 1；当前应用继续执行 `0002_remove_monthly_item_status.sql`、`0003_remove_next_month_goal.sql` 与 `0004_add_automatic_rate_refresh.sql` 到 schema 4。schema 3 直接删除旧目标表及数据，schema 4 保存启动时自动更新汇率偏好。已发布迁移不可修改，只能追加。预发布数据库迁移链不属于公开兼容范围，换轨方案见 [预发布数据库换轨](08-pre-release-database-transition.md)。

本地 SQLite 使用外键、STRICT 表和 WAL，并将数据目录限制为 `0700`、数据库及 WAL/SHM 限制为 `0600`。数据库文件未静态加密，具体决策见 [ADR 0006](adr/0006-database-encryption-release-gate.md)。

## 3. 质量门禁

### 3.1 本地命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked

pnpm audit --prod --audit-level high
pnpm tauri build --bundles app
```

真实应用冒烟必须使用系统临时目录下全新创建的 `APLENA_SMOKE_DATA_DIR`，不得连接用户正式数据库或开发期预发布数据库。

### 3.2 GitHub Actions

`.github/workflows/quality.yml` 在推送到 `develop`，以及面向 `develop` 或 `main` 的 Pull Request 上执行前端与 Rust 门禁。工作流只授予 `contents: read`。

`.github/workflows/release.yml` 在以下边界构建 macOS 包：

- `main` 普通提交：生成 `dev-<short_sha>` 命名的开发构建，不发布 GitHub Release；
- `workflow_dispatch`：只生成开发构建；
- 严格 `vMAJOR.MINOR.PATCH` 标签：要求标签提交位于 `main` 历史，运行完整门禁并发布 Release。

发布矩阵覆盖 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`。两种架构分别验证可执行文件架构、Bundle ID、版本、签名、证书指纹和唯一 DMG，并执行 `hdiutil verify`。

## 4. 版本与签名

### 4.1 标签驱动版本

源码中的 `0.1.0` 是开发基线，不代表首个正式版本已经确定。发行时，工作流移除标签前缀 `v`，再由 `.github/scripts/set-build-version.mjs` 同步：

- `package.json`；
- 根 `Cargo.toml` 的 `workspace.package.version`；
- `Cargo.lock` 中 `aplena` 与 `pfcm-domain`；
- `src-tauri/tauri.conf.json`。

两个 Rust 包通过 `version.workspace = true` 继承同一版本。脚本只接受严格三段 SemVer，修改后会重新读取全部字段并验证一致性。

### 4.2 本地与 CI 签名

本地 Tauri 构建保留 macOS 默认的 linker ad-hoc 签名。这是预期的开发产物，不是 Developer ID 或已公证应用。

CI 使用 GitHub `codesign` environment 中的 `CODESIGN_CERTIFICATE_P12_BASE64` 与 `CODESIGN_CERTIFICATE_PASSWORD`，把 “Morton Li” 自签名证书导入临时 keychain。工作流同时校验可访问的私钥 identity、Authority 和固定 SHA-256 指纹，完成后始终删除临时 keychain、P12 与抽取证书。

自签名只建立项目自己的产物身份校验，不构成 Apple Developer ID 信任链，也不包含 Hardened Runtime、公证或 stapling 承诺。

### 4.3 Bundle 行为

`src-tauri/tauri.conf.json` 保持 `bundle.active = false`，避免普通本地构建隐式生成安装包。CI 与本地发行检查通过 `--bundles app,dmg` 或 `--bundles app` 显式请求目标包。

## 5. Git 与发行流程

### 5.1 分支模型

- `main`：完成目标后的稳定基线；
- `develop`：已验证并显式合并的阶段成果；
- `feature/*`、`fix/*`：具体功能或修复。

提交功能分支不等于授权合并、推送、打标签或发布。

### 5.2 发行步骤

1. 在功能分支完成发布检查与隔离真实应用冒烟；
2. 显式合并到 `develop`，再按目标边界合并到 `main`；
3. 在 `main` 历史中的目标提交创建严格 SemVer 标签；
4. 观察远程 Actions 的双架构门禁、签名和 DMG 验证；
5. 只有标签工作流通过后，GitHub Release 才能作为远程发行证据。

当前仓库内存在工作流文件不等于远程 Actions 已经成功运行。完整本地检查记录见 [发布就绪检查](07-release-readiness.md)。
