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

首个正式版从 `src-tauri/migrations/0001_initial_release.sql` 建立 schema 1；当前应用继续执行 `0002_remove_monthly_item_status.sql`、`0003_remove_next_month_goal.sql`、`0004_add_automatic_rate_refresh.sql` 与 `0005_add_software_update_preferences.sql` 到 schema 5。schema 3 直接删除旧目标表及数据，schema 4 保存启动时自动更新汇率偏好，schema 5 以独立单行表保存软件更新偏好和最近检查结果。已发布迁移不可修改，只能追加。预发布数据库迁移链不属于公开兼容范围，换轨方案见 [预发布数据库换轨](08-pre-release-database-transition.md)。

本地 SQLite 使用外键、STRICT 表和 WAL，并将数据目录限制为 `0700`、数据库及 WAL/SHM 限制为 `0600`。数据库文件未静态加密，具体决策见 [ADR 0006](adr/0006-database-encryption-release-gate.md)。

## 3. 质量门禁

### 3.1 本地命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:release
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

- `main` 普通提交：生成 `dev-<short_sha>` 命名的双架构开发 DMG，不生成 updater 包，也不发布 GitHub Release；
- `workflow_dispatch`：只生成同样不带 updater artifact 的开发构建；
- 严格 `vMAJOR.MINOR.PATCH` 标签：要求标签提交位于 `main` 历史，运行完整门禁并生成 DMG、updater 包、签名与 `latest.json`。

发布矩阵覆盖 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`。两种架构分别验证可执行文件架构、Bundle ID、版本、签名、证书指纹和唯一 DMG，并执行 `hdiutil verify`。正式标签还会解开 `.app.tar.gz`，对其中真正将被安装的 `.app` 再次执行相同的代码签名、身份、版本和架构检查。

两个矩阵任务只把已验证的文件上传为短期 workflow artifact，不直接修改 GitHub Release。聚合任务要求本地集合恰好包含两个 DMG、两个 `.app.tar.gz` 与两个 `.sig`，随后创建或复用同标签的草稿 Release。确定性脚本从草稿说明、标签提交时间与两个签名生成 `latest.json`，平台键固定为 `darwin-aarch64`、`darwin-x86_64`，下载 URL 固定指向该精确标签。七个文件全部上传后，流水线通过 GitHub API 校验远端名称、大小、SHA-256 digest，并逐个下载与本地字节比较；只有全部通过才公开草稿并把它设为最新稳定版。任何前置检查失败都会让 Release 保持草稿，不会进入 `/releases/latest`。

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

### 4.3 Updater 签名与密钥

Updater 使用与 macOS 代码签名完全独立的 minisign 密钥。公开密钥编译进正式应用，私钥只在严格 SemVer 标签任务中通过 GitHub `codesign` environment 的 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供；公开密钥通过 environment variable `APLENA_UPDATER_PUBLIC_KEY` 提供给正式构建。标签任务先校验公钥，再由已提交的 `src-tauri/tauri.release.conf.json` 生成不入库的 `src-tauri/tauri.release.generated.conf.json`，确保 Tauri 打包器和运行时读取同一把公钥。三项输入任一缺失、公开密钥仍为 `APLENA_UPDATER_PUBLIC_KEY_REQUIRED` 占位符，或公开密钥不是合法 minisign envelope，流水线都会在打包前失败。私钥、密码和生成配置不得进入仓库、日志、workflow artifact 或 Release asset。

Updater 私钥需要独立的安全备份。丢失私钥后，已经安装的客户端不能验证以后发布的更新；轮换密钥时，必须先用旧私钥签署一个同时内嵌新公钥的桥接版本，确认现有安装能够升级到该版本后，才能改用新私钥签署后续版本。如果旧私钥已经丢失，只能要求用户再次手动安装新的桥接版本。

运行时固定使用 `tauri-plugin-updater = 2.11.0` 的下载和 minisign 验证能力，但不调用插件自带的 macOS `install`。仓库内安全安装器用于规避上游尚未关闭的 macOS 非原子替换问题：新包只在已安装应用同卷的隐藏临时目录解开，验证 Bundle ID、版本、单一当前架构、严格代码签名和固定证书指纹后，通过 `renamex_np(RENAME_SWAP)` 一次性交换。交换不可用或失败时立即停止，不使用两段 rename、AppleScript、提权或先删除旧应用的回退。旧应用只保留在带专用 marker 的目录中，并在下一次成功启动时按严格目录形状清理。

### 4.4 Bundle 行为

`src-tauri/tauri.conf.json` 保持 `bundle.active = false`，避免普通本地构建隐式生成安装包。CI 与本地发行检查通过 `--bundles app,dmg` 或 `--bundles app` 显式请求目标包。只有严格标签构建从 `src-tauri/tauri.release.conf.json` 生成包含已校验公钥的临时覆盖层，并把 `bundle.createUpdaterArtifacts` 设为 `true`；普通本地、`main` 和手动开发构建都不会因为缺少生产 updater 私钥而失败。

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
4. 观察远程 Actions 的双架构门禁、两套签名、DMG 与 updater archive 验证；
5. 确认草稿内七个资产的 exact-set、远端 digest 和下载字节验证通过；
6. 只有流水线公开草稿且 `/releases/latest/download/latest.json` 与已验证清单完全一致后，GitHub Release 才能作为远程发行证据。

当前仓库内存在工作流文件不等于远程 Actions 已经成功运行。完整本地检查记录见 [发布就绪检查](07-release-readiness.md)。
