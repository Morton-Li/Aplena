# Aplena 开发、验证与发行

本文说明现行开发流程和可重复的发行检查，不记录某次构建的通过状态。产品行为见 [产品与操作](product.md)，计算边界见 [架构与领域](architecture.md)，迁移和表结构见 [数据库](database.md)。

## 环境与启动

项目的 macOS CI 使用 Node.js 24、pnpm 11.19.0、Rust 1.97.1，并安装 `rustfmt`、`clippy`；本机还需要 macOS Command Line Tools。应用配置的最低系统版本为 macOS 11。版本依据为 [package.json](../package.json)、[质量工作流](../.github/workflows/quality.yml) 和 [发行工作流](../.github/workflows/release.yml)。

依赖由 `pnpm-lock.yaml` 和 `Cargo.lock` 锁定。前置工具准备好后，在项目根目录执行：

```bash
pnpm install --frozen-lockfile --store-dir .pnpm-store
pnpm tauri:dev
```

拉取依赖优先使用维护环境已有的镜像源；需要调整时使用单次命令参数或项目内配置，不要求改动全局源或 shell 配置。Cargo 如需使用项目内缓存，可为对应命令加 `env CARGO_HOME="$PWD/.cargo-home"`；工具链必须已可从当前 `PATH` 使用。

`pnpm tauri:dev` 合并 `src-tauri/tauri.dev.conf.json`，使用独立 Visual QA 标识和 Vite 开发服务器；它不使用正式应用的默认数据目录。`pnpm dev` 只运行前端，不能代替 Tauri IPC 验证。正式配置不含开发服务器地址或 WebSocket CSP。

## 分支与变更边界

- `main` 是完成目标后的稳定基线，`develop` 接收已验证的阶段成果。
- 在 `feature/*` 或 `fix/*` 分支实施变更，可分次提交，再显式合并到 `develop`；目标完成后再合并到 `main`。
- 提交、合并、推送、打标签和公开发行是不同操作，应按当前任务的授权范围执行。
- 已进入公开兼容边界的 SQL 迁移只追加，不修改旧文件或校验和。
- 金额/日期口径、历史事实、自动写入、迁移、安全或网络边界变更时，同步维护 [设计决策](decisions.md) 及对应参考文档。

## 最少必要验证

验证范围由改动决定。纯文档变更检查链接、引用和 `git diff --check`；功能变更运行对应测试与构建；发行候选运行完整门禁并补充隔离原生冒烟。不要把历史测试数量或旧机器产物当作当前证据。

完整本地门禁与严格标签流水线的主要命令为：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:release
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
```

发行候选另执行 `pnpm audit --prod --audit-level high` 和 `pnpm tauri build --bundles app`，分别检查当时的生产依赖审计结果与原生打包。依赖审计不在当前 CI 的自动门禁中。已具备完整缓存时可给 Cargo 加 `--offline`，缓存不足时不能以跳过测试代替通过。

关键验证入口：

| 范围 | 对应代码与测试 |
| --- | --- |
| 金额、日级日期、计入与借贷分期 | `crates/pfcm-domain/tests/domain.rs` 及 `crates/pfcm-domain/src/loan.rs` 内测试 |
| 迁移、重开、快照、条目和汇率 | `src-tauri/src/application/persistence_tests.rs` |
| 自动策略版本、到期、冲突、幂等、删除后重开 | `src-tauri/src/application/automatic_tests.rs` |
| 专项分配冻结、同一事实、退款与汇率快照 | `src-tauri/src/application/specials_tests.rs` |
| 双向借贷、追加本金、分配、纠错、重排与关联实际保护 | `src-tauri/src/application/loans_tests.rs` |
| 页面、查询刷新、报告、可访问交互 | `src/**/*.test.ts`、`src/**/*.test.tsx` |
| 版本同步、清单、资产集合和摘要 | `.github/scripts/*.node-test.mjs` |
| Updater 验签、归档限制、签名验证、原子替换与清理 | `src-tauri/src/application_updates/` 内测试 |

### 隔离原生冒烟

原生运行会初始化月份，自动入账会写入正式实际条目。所有自动化和界面冒烟使用合成账本；不得连接用户正式库或旧开发库。

1. 在系统临时目录内创建专用数据子目录，构建使用独立的 `.smoke` Bundle ID。
2. 通过 `APLENA_SMOKE_DATA_DIR` 显式传入已存在的目录；路径会 canonicalize，系统临时根目录本身及其范围外路径会被拒绝。
3. 从终端直接启动应用可执行文件以保留环境。通过 Launch Services 启动时须确保环境实际传入；缺目录的 `.smoke` 应用会拒绝启动。
4. debug 构建还可用 `APLENA_COMPILED_SMOKE_DATA_DIR` 编入隔离路径，且必须配合 `.smoke` 标识。非 debug 构建不读取此编译路径。
5. 检查首次默认设置、临时类目与实际增删改、退款/冲减、规则与下月预算、专项、借贷、历史月/年度报告，以及退出后重开持久化；按本次变更选取必要旅程。
6. 保存本次提交、构建方式、隔离目录和结果，检查 `PRAGMA integrity_check`、`PRAGMA foreign_key_check`，退出进程后清理测试产物。

纯前端合成 IPC 检查可以补充布局和交互证据，但不能证明原生迁移、系统签名或安装成功。

## CI 与产物边界

[质量工作流](../.github/workflows/quality.yml) 在推送到 `develop`、面向 `develop` 或 `main` 的 PR 上运行前端和 Rust 门禁，权限为 `contents: read`。它不执行 `pnpm test:release`、依赖审计、原生 UI 冒烟或 DMG 打包。

[发行工作流](../.github/workflows/release.yml) 区分以下触发：

| 触发 | 版本与行为 |
| --- | --- |
| `main` 普通推送 | 显示名为 `dev-<short_sha>`，包内版本为 `0.0.0`；生成双架构开发 DMG |
| `workflow_dispatch` | 同样生成开发 DMG，不生成 updater 归档或 Release |
| 严格 `vMAJOR.MINOR.PATCH` 标签 | 要求提交属于 `origin/main` 历史；运行完整门禁，构建并验证正式资产后发布 |
| 其他匹配触发过滤器的标签 | 元数据任务识别后跳过构建 |

矩阵分别使用 `aarch64-apple-darwin` / `arm64` 与 `x86_64-apple-darwin` / `x86_64`。普通开发 DMG 与正式 DMG 都需要 CI 自签名证书；只有严格标签需要 updater 密钥。矩阵任务把已验证文件上传为保留一天的 workflow artifact；只有标签的聚合任务有 `contents: write` 并修改 GitHub Release。

## 版本与两套签名

### 标签驱动版本

源码中的 `0.1.0` 是开发基线。构建工作区由 [.github/scripts/set-build-version.mjs](../.github/scripts/set-build-version.mjs) 同步以下字段：

- `package.json.version`；
- 根 `Cargo.toml` 的 `workspace.package.version`；
- `Cargo.lock` 中 `aplena`、`pfcm-domain` 的版本；
- `src-tauri/tauri.conf.json.version`。

两个 Rust 包均通过 `version.workspace = true` 继承版本。脚本只接受无前缀的严格三段版本，先校验修改计划中的字段一致性，再写入文件；正式标签去掉 `v` 后传给脚本。开发构建传入 `0.0.0`，显示版本另由 `APLENA_BUILD_VERSION` 提供。

### macOS 代码签名

普通本机构建使用默认 linker ad-hoc 签名。CI 在 GitHub `codesign` environment 读取 `CODESIGN_CERTIFICATE_P12_BASE64`、`CODESIGN_CERTIFICATE_PASSWORD`，把 “Morton Li” 证书及私钥导入临时 keychain，并检查私钥 identity、Authority 和固定 SHA-256 指纹。

指纹必须与工作流及 `src-tauri/src/application_updates/safe_macos.rs` 中的常量一致；更换证书必须同时评估已安装客户端的信任边界。临时 keychain、P12 和验证时抽取的证书在任务结束时清理。

此签名不属于 Apple Developer ID 信任链，不表示公证、stapling 或 Hardened Runtime 已具备。macOS 安全提示仍可能出现；ad-hoc 本机构建也不能作为生产证书证据。

### Updater 签名

Updater 使用独立的 minisign 密钥。严格标签需在 `codesign` environment 提供：

| 输入 | 用途 |
| --- | --- |
| `APLENA_UPDATER_PUBLIC_KEY` | variable 或 secret；编入运行时并写入打包配置 |
| `TAURI_SIGNING_PRIVATE_KEY` | secret；签署 updater 归档 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret；解锁私钥 |

标签任务先验证三项输入和公钥 envelope，再由已提交的 `tauri.release.conf.json` 生成被 Git 忽略的 `tauri.release.generated.conf.json`。占位符、空值或格式错误在打包前失败；归档生成后由 `verify_updater_signature` 示例程序作真实密码学验签，检测公私钥不匹配。私钥和密码不得进入仓库、日志或发布资产。

私钥应独立备份。轮换时先用旧私钥签署内嵌新公钥的桥接版本，让现有客户端完成升级，再使用新私钥签后续版本；旧私钥丢失时只能重新手动安装。没有 updater 能力的早期安装也需要手动安装一次桥接版本，不能凭文档中的历史版本号推断当前公开发行状态。

运行时固定使用 `tauri-plugin-updater = 2.11.0` 下载并验证签名，自有 macOS 安装器负责解包与安装。它验证归档路径/链接/大小、Bundle ID、版本、当前单一架构、代码签名和证书指纹，只在已安装应用同卷的隐藏暂存目录中准备新包，并通过 `renamex_np(RENAME_SWAP)` 原子交换。失败不删除旧应用，也不回退到两段 rename、提权或 AppleScript；旧包按 marker 和目录形状在后续成功启动时清理。

`tauri.conf.json` 的 `bundle.active = false`，本地打包需显式 `--bundles app`。CI 使用 `--bundles app,dmg`；只有标签生成配置启用 `createUpdaterArtifacts`，普通本地、`main` 和手动开发构建不要求 updater 私钥。

## 发行完成条件

每次正式发行按同一流程取证：

1. 功能分支完成必要验证和隔离冒烟，显式合并到 `develop`，目标完成后再合并到 `main`。
2. 在 `main` 历史中的目标提交创建严格版本标签；确认本次所需 CI environment 输入已就绪。
3. 两个矩阵任务验证 `.app` 的 Bundle ID、版本、单一架构、代码签名/证书指纹、唯一 DMG，并执行 `hdiutil verify`。
4. 正式 updater 归档通过真实验签，解开后对归档中实际安装的 `.app` 再作同等验证。
5. 聚合任务要求恰好两份 DMG、两份 `.app.tar.gz`、两份 `.sig`，拒绝覆盖已公开或预发布的同标签 Release。
6. 创建或复用草稿，用草稿说明、标签提交时间与两份签名确定性生成 `latest.json`；平台键固定为 `darwin-aarch64`、`darwin-x86_64`，URL 指向精确标签。
7. 七份资产上传后检查远端名称集合、上传状态、大小、SHA-256 digest，并逐份下载与本地字节比较；前置检查失败则不公开草稿。
8. 公开并设为最新稳定版后，复核 Release 元数据、latest Release 身份和 `/releases/latest/download/latest.json` 的逐字节一致性。此最后检查发生在公开之后，失败不能被描述为“未发布”。

仓库中存在工作流不等于本次发行成功。完成证据应指向本次提交、Actions run、Release 和资产校验结果；测试通过、打包通过、远程发行和实际安装分别记录。

## 旧开发数据库的受控换轨

这是维护者对明确识别的旧预发布测试库的一次性操作方案，不是应用功能，也没有通用转换工具。不得为排除启动错误而删除旧库、改写 `_sqlx_migrations` 或把旧库直接当作正式库。

当前正式迁移从 `0001_initial_release.sql` 顺序到 schema 9。高于最新版本的库在迁移前被拒绝；旧六步预发布链虽不高于 9，仍因 SQLx 迁移校验和不匹配而拒绝。旧文档中“版本 6 高于当前版本 1”的判断已不适用。冻结夹具是结构核对依据，不代表任意本地旧库都受支持。

实际数据换轨只在获得对应数据操作授权后执行：

1. 退出全部 Aplena 进程，确认没有数据库连接；记录旧应用与数据位置。
2. 复制整个旧数据目录，保留主库及可能的 WAL/SHM，记录大小与 SHA-256；另保留只读恢复点，所有检查在工作副本上进行。
3. 确认旧结构与 `src-tauri/tests/fixtures/pre_release_final_schema.sql` 一致；不一致时停止并单独评估。
4. 在系统临时目录由受控工具执行目标版本的正式迁移，建立全新 schema 1–9 数据库，确认原有财务表为空、新增偏好使用默认值，再只读附加旧副本。此时只执行迁移，不运行会创建默认设置和月份的应用启动流程。
5. 在启用外键的单一事务中，按显式字段列表复制 `exchange_rates` → `settings` → `plan_items` → `monthly_items` → `actual_entries`。不复制旧迁移历史、`actual_confirmed_at`、旧 `next_month_goal`；新增偏好和新业务表采用当前默认值。不得改写金额、日期或 UUID 来掩盖约束失败。
6. 提交前核对完整性与外键；对保留字段逐行核对，并检查原有五张财务表的行数、整数金额的总和/范围、逐月/逐类净额、UUID、来源及汇率快照。新库迁移应全部成功，旧库历史保持原状。
7. 用隔离 `.smoke` 构建打开转换后的副本，检查界面和重开持久化，随后再次核对数据库。任何失败均回滚或丢弃新副本，保留差异并停止。
8. 全部验证通过且切换已获授权后，才以同文件系统的可恢复目录重命名切换。保留原目录与恢复点；失败时停止新应用，恢复旧目录名并使用匹配的旧构建。

结构等价测试位于 `persistence_tests.rs`，覆盖冻结夹具应用公开迁移后的结构比较和旧链拒绝；它不证明真实账本已完成复制或换轨。应用当前不提供内置备份、恢复、导入或导出。
