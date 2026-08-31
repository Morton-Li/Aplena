# Aplena 首个正式版本发布就绪检查

本文件记录首个正式版本在本地完成的发布候选门禁。2026-08-31 的 schema 2 与临时类目改造使原有候选证据需要重新验收；它不授权合并、推送、打标签或发布，也不能替代远程 GitHub Actions 的实际运行结果。

## 1. 候选结论

- `LOCAL_RELEASE_CANDIDATE = NEEDS_REVALIDATION`
- `RELEASE_READY = CONDITIONAL_REMOTE_PIPELINE`
- `PUBLIC_RELEASE = PENDING_REMOTE_GITHUB_ACTIONS`
- 已发现的代码级 P1 阻断项均已修复，隔离真实应用冒烟已经完整通过。
- 本地 linker ad-hoc 签名是预期开发状态；正式标签工作流使用项目自签名证书做产物身份校验，但不声称具备 Apple Developer ID、公证或 stapling。

当前改造位于 `feature/monthly-temporary-categories`。本轮没有合并、推送、打标签、创建 Release 或修改用户正式数据库。

## 2. 产品与数据边界

首发候选保留以下范围：

- 默认人民币并直接进入总览，无启动配置页；
- 条目驱动的月度收入、支出、退款、冲减与历史报告；类目不再设计确认状态；
- 仅面向下月的预算目标，以及完全可选的周期规则；
- 分精度权威金额、八位汇率和实际条目的汇率快照；
- 从正式基线顺序迁移到 `schema 2` 的 SQLite 数据库。

不包含 Scenario、云同步、账户、银行同步、交易导入、备份、恢复、可读导出和独立“财务分析”模块。仓库按产品决定不维护 `CHANGELOG.md`，标签发行使用 GitHub 自动生成的 Release Notes。

数据库文件未静态加密。首版通过 macOS 用户权限、`0700` 数据目录以及数据库、WAL、SHM 的 `0600` 权限保护本地数据；该接受边界记录于 [ADR 0006](adr/0006-database-encryption-release-gate.md)，不得把产品描述为端到端加密。

## 3. P1 关闭矩阵

| 项目 | 处置 | 证据 |
| --- | --- | --- |
| 手工项目无法追加、编辑退款或冲减 | 保存条件按手工、周期、编辑来源分支，手工分类独立决定收支方向 | 自动测试通过；真实应用完成同项目第二笔支出、退款、收入冲减与编辑 |
| 删除依赖失效的原生确认框 | 改为位于详情抽屉上层的应用内 Dialog，支持取消、Escape、焦点约束、待处理保护与刷新 | 组件测试覆盖抽屉与确认框共存、取消、Escape 和正向删除 |
| 全新数据库无法首次选择外币 | 新库直接提供 CNY、USD、EUR、HKD、JPY、GBP；官方汇率可按需更新 | 真实应用从全新库创建 USD 支出并保存 ECB 汇率快照 |
| 汇率更新可能回算历史费用 | 实际条目固化原币、换算率、来源和参考日期 | 更新当前 USD 汇率后，既有 USD 条目的人民币值保持不变 |
| 类目状态造成额外生命周期 | 删除确认字段、状态枚举、确认命令和依赖的报表字段 | schema 2 迁移、前后端契约与回归测试覆盖；界面不再显示状态列或完成确认 |
| 数据库加密发布决策不明确 | 首版接受受权限保护的明文 SQLite，并公开风险边界 | ADR 0006、README 与开发文档一致 |
| 签名和版本策略缺失 | 增加标签驱动的双架构 Actions、严格字段同步和自签名身份验证 | 工作流 YAML 可解析；版本脚本正反例与不改写校验通过 |
| 发布材料不完整 | 补齐 LICENSE、NOTICE、第三方许可证和产品级 README | 文件存在、链接有效，许可证资源进入应用包 |

## 4. 自动化门禁

验证日期：2026-08-31。

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test`：8 个文件、59 项测试通过；
- `pnpm build`：通过；
- `cargo fmt --all -- --check`：通过；
- `cargo test --workspace --locked`：应用/数据库 27 项、领域 8 项，共 35 项通过；
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`：通过；
- `pnpm audit --prod --audit-level high`：未发现漏洞；
- `git diff --check`：通过。

本机未安装 `cargo-audit`、`actionlint` 或 `shellcheck`，本轮没有为此修改项目目录以外的本机环境。工作流已用本机 Ruby YAML 解析器验证语法。

## 5. 数据库基线

- 运行时先执行 `0001_initial_release.sql`，再执行 `0002_remove_monthly_item_status.sql`；
- 当前结构包含 6 张 STRICT 业务表、7 个业务索引和 9 个触发器；
- 新库记录成功的 schema 1 与 schema 2；
- 冻结的预发布最终结构应用 schema 2 状态移除后，与当前表、列、外键、索引和触发器等价；
- 带预发布迁移历史的数据库会被拒绝，且拒绝过程不改写迁移记录或业务数据；
- 预发布数据库换轨另见 [预发布数据库换轨](08-pre-release-database-transition.md)，本轮没有操作真实数据。

首发不承诺直接打开开发期迁移链数据库。任何真实数据换轨都必须在应用退出后完整复制数据库目录及 WAL/SHM、校验哈希，再把业务表显式迁入由目标应用建立到 schema 2 的新数据库；不得复制旧 `_sqlx_migrations` 或原地伪造版本。

## 6. GitHub Actions 与版本策略

### 6.1 质量工作流

`.github/workflows/quality.yml` 在推送到 `develop`，以及面向 `develop` 或 `main` 的 Pull Request 上运行前端和 Rust 门禁。权限限制为 `contents: read`，并配置并发取消与超时。

### 6.2 发布工作流

`.github/workflows/release.yml` 的触发边界为：

- `main` 普通提交：构建 `dev-<short_sha>` 双架构产物，不创建 Release；
- `workflow_dispatch`：只构建开发产物，不创建 Release；
- 严格 `vMAJOR.MINOR.PATCH` 标签：要求提交位于 `origin/main` 历史，完整验证后创建 GitHub Release。

发布矩阵配置 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`。每个任务验证可执行架构、Bundle ID、版本、签名 Authority、固定证书指纹、唯一 DMG 与 `hdiutil verify`。

`.github/scripts/set-build-version.mjs` 只接受严格三段 SemVer，并同步 `package.json`、根 `Cargo.toml`、`Cargo.lock` 中两个本地包以及 `src-tauri/tauri.conf.json`。在隔离副本中，`2.3.4` 正向同步全部字段；`v2.3.4`、`2.3`、`02.3.4`、`2.3.4-rc.1` 均被拒绝，失败前后文件哈希一致。

这些结论证明仓库配置与本地脚本行为，不代表两个远程 macOS Runner 已实际成功。双架构正式产物仍以远程标签流水线为准。

## 7. 隔离真实应用冒烟

冒烟使用 release `.app` 和系统临时目录，通过测试进程的 `APLENA_SMOKE_DATA_DIR` 指定数据位置；没有读取、复制或修改用户正式应用支持目录及数据库。

已验证：

- 默认人民币、无启动页、直接进入总览；
- 收入、支出、同项目追加、退款、冲减和编辑；
- 下月目标与 AMORTIZED 周期规则持久化，且存在周期规则时仍可创建独立本月项目；
- 全新数据库可直接选择 USD，ECB 汇率可更新，历史条目保留发生时快照；
- 总览、历史年份展开、月度详细报告、图表和实际存在性语义；
- 18 行长表中继续滚轮可把滚动传递给右侧主页面，左侧栏保持固定；
- 删除 Dialog 的取消、Escape、焦点行为；
- 经用户即时确认后真实删除一条 `2026-08-01 / 退款 / ¥500.00` 记录，类目派生实际随剩余条目更新；
- 删除后总支出更新为 `¥4,422.09`、净结余更新为 `¥7,077.91`，总览与历史报表一致；
- 两次重启后数据、目标、周期规则仍存在；
- `PRAGMA integrity_check = ok`，外键检查为空。

隔离数据库位于：`/var/folders/62/f1367xwj2f1glbw1b_d8zxd40000gn/T/aplena-first-release-final.ZPHe9Q/aplena.sqlite3`。当前保留以便查看，且仅包含验收数据。

## 8. 构建与签名证据

本地 macOS Apple Silicon 应用与 DMG 已构建成功：

- `.app`：`target/release/bundle/macos/Aplena.app`；
- `.dmg`：`target/release/bundle/dmg/Aplena_0.1.0_aarch64.dmg`；
- Bundle ID：`li.morton.aplena`；
- 开发基线版本：`0.1.0`；
- 可执行架构：`arm64`；
- 应用图标与源 `icon.icns` 哈希一致；
- LICENSE、NOTICE、第三方许可证资源与源文件哈希一致；
- DMG 通过 `hdiutil verify`。

本地包仅为 `adhoc,linker-signed`，严格 `codesign --verify --deep --strict` 不通过是该 linker ad-hoc 状态的预期结果，不等同于 CI 自签名流程。CI 会把 “Morton Li” 自签名证书导入临时 keychain，验证私钥 identity、Authority 和固定 SHA-256 指纹后重新签名并严格验证，结束时始终清理临时材料。

自签名证书只提供项目产物身份校验，不建立 Apple Developer ID 信任链。首版不承诺 Hardened Runtime、公证或 stapled ticket。

## 9. 剩余风险与发布门

- 远程 GitHub Actions 尚未实际运行；不得声称双架构构建、远程签名或 GitHub Release 已成功；
- Intel macOS 产物只完成工作流配置，尚未获得远程 Runner 的实际证据；
- 本机 Tauri 构建期间 `rust-objcopy` 因本地动态库环境产生剥离警告，但优化构建、应用包和 DMG 均成功；远程干净 Runner 是正式判据；
- Windows 不在本次首发目标内，未做真实构建、安装或卸载验证；
- SQLite 静态加密未实现，是 ADR 接受的首版产品边界，不是未披露能力。

## 10. Git 边界

- 当前功能分支：`feature/monthly-temporary-categories`；
- 远程：`origin = https://github.com/Morton-Li/Aplena.git`，原远程保留为 `rowsen`；
- 已完成本地分层提交；
- 未合并至 `develop` 或 `main`；
- 未推送、未打标签、未创建 Release；
- 未执行真实发布前数据库换轨；
- `CHANGELOG.md` 已按产品决定从当前分支全部可达历史中移除。

本轮类目语义改造的代码、数据迁移、文档、自动测试与隔离浏览器交互已通过；既有真实应用与产物证据仍是改造前基线。因此 `LOCAL_RELEASE_CANDIDATE` 保持 `NEEDS_REVALIDATION`，后续仍需在显式合并前重新执行真实 Tauri 应用与发布产物门禁；对外正式发布必须等待 `main` 与严格 SemVer 标签对应的远程双架构工作流成功。
