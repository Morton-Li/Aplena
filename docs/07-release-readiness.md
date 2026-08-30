# Aplena 发布就绪检查

本文件记录第一个正式版本的本地发布候选门禁，不授权合并、推送、标签、签名、公证、版本变更或分发。

## 1. 候选范围

当前候选包含：

- 本地优先、单用户的个人财务承载模型；
- 默认人民币直接进入总览，无启动配置页；
- 条目驱动的月度实际、退款/冲减、确认状态和历史月报表；
- 仅面向下月的储蓄目标与可选周期规则；
- 分精度权威金额、八位汇率和实际条目的汇率快照；
- 第一个正式版本的单一 `schema 1` 数据库基线。

不包含 Scenario、云同步、账户、银行同步、交易导入、备份/恢复/可读导出，以及独立“财务分析”功能。

## 2. 数据库基线门

- [x] 运行时迁移只剩 `src-tauri/migrations/0001_initial_release.sql`；
- [x] 基线直接创建 6 张 STRICT 业务表、7 个业务索引和 12 个触发器；
- [x] 基线不包含临时列、过渡更新、旧表重建或业务种子数据；
- [x] 新建数据库的 `_sqlx_migrations` 只记录 `1 / initial release / success`；
- [x] 基线结构与冻结的发布前最终结构逐项等价，包括表 SQL、列、外键、索引和触发器；
- [x] 带有发布前迁移历史的数据库会被拒绝，且拒绝前后迁移记录和业务标记不变；
- [x] 发布前本地数据库过渡方案已写入 `docs/08-pre-release-database-transition.md`，但未执行。

首个正式版本不承诺直接打开开发期迁移链数据库。任何真实数据切换都必须先退出应用、完整复制数据库目录（含 WAL/SHM）、校验哈希，再把业务表显式复制到全新 `schema 1` 数据库；不得复制旧 `_sqlx_migrations`，也不得原地伪造版本号。

## 3. 自动门禁

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build

cargo fmt --all -- --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings

pnpm audit --prod --audit-level high
pnpm tauri build --bundles app
```

### 3.1 当前覆盖

- [x] 两位金额、边界溢出、闰年和日级区间；
- [x] AMORTIZED 与 PAYMENT 计划规则；
- [x] 支出/退款、收入/冲减与确认状态领域逻辑；
- [x] 初始化幂等、并发安全、缺汇率整体回滚；
- [x] 实际条目 CRUD、跨月拒绝、确认自动重开；
- [x] 下月目标与当前月、历史月隔离；
- [x] 自定义下拉、对话框焦点、月度筛选和滚动链自动测试；
- [x] 单迁移干净基线、旧最终结构等价与发布前数据库拒绝保护。

## 4. 真实应用隔离冒烟

冒烟必须使用 release `.app`，并满足：

- 数据目录由 `mktemp -d` 创建在 macOS 系统临时根目录下；
- 只通过测试进程的 `APLENA_SMOKE_DATA_DIR` 传入；
- 不读取、不复制、不修改用户正式应用支持目录或正式数据库；
- 结束时报告目录位置和保留/清理状态。

当前结果：

- [x] 默认人民币、无启动页并直接进入总览；
- [x] 创建收入与支出本月项目，金额正确聚合到总览和历史报表；
- [x] 单项确认、下月储蓄目标、AMORTIZED 周期规则保存成功；
- [x] 历史年份折叠/展开、月度详细报告和图表可访问；
- [x] 正常关闭并重启同一隔离目录后，数据、目标和规则仍存在；
- [x] `PRAGMA integrity_check = ok`，外键检查为空；
- [ ] 本月项目追加第二笔条目、退款/冲减和编辑：被错误禁用条件阻断；
- [ ] 全新数据库的外币自动汇率：官方更新提示成功，但外币下拉仍只有 CNY；
- [ ] 删除实际条目的真实 UI 操作尚未执行；自动化 CRUD 测试通过。

隔离数据库：`/var/folders/62/f1367xwj2f1glbw1b_d8zxd40000gn/T/aplena-first-release-smoke.PulTBe/aplena.sqlite3`。当前保留，便于用户查看最新版应用效果。

## 5. 安全、依赖与发布包

- [x] Tauri capability 只包含核心窗口、拖动和缩放能力；
- [x] CSP 的唯一外部连接为欧洲央行参考汇率接口；
- [x] SQL 均参数化，UI 错误映射未发现数据库路径、SQL 或内部诊断泄露；
- [x] 未发现被跟踪的密钥、数据库、日志、构建目录或环境文件；
- [x] `pnpm audit --prod --audit-level high` 无已知漏洞；
- [x] 已扫描前后端依赖许可证，未发现禁止许可证；
- [ ] 本机未安装 `cargo-audit`，未为本次审计改变环境；
- [ ] 仓库缺少正式 LICENSE、CHANGELOG 与第三方许可证清单；
- [ ] SQLite 数据库未静态加密，受 ADR 0006 的公开发布门约束；
- [ ] `.app` 仅为 linker ad-hoc 签名，无 Developer ID、hardened runtime、公证或 stapled ticket；严格 `codesign` 验证和 Gatekeeper 评估均未通过；
- [ ] 本机没有可用代码签名身份；本次未签名、未使用证书；
- [ ] `target/release/bundle/macos` 中存在早期 QA `.app` 残留，正式产物收集必须只选择 `Aplena.app`。

当前 `.app`：`target/release/bundle/macos/Aplena.app`；Bundle ID 为 `li.morton.aplena`，版本仍为 `0.1.0`，最低 macOS 11，仅包含 arm64 架构。图标与源 `icon.icns` 哈希一致。Windows 本轮仅完成配置和代码静态审计，没有真实构建或安装验证。

## 6. 发布阻断项

### P1：必须在正式分发前解决

1. 本月手工项目的追加条目和编辑按钮逻辑错误：`EntryDialog` 对 `fixedItem` 仍要求不存在的 `planId`，导致保存永久置灰，退款/冲减和确认后编辑均不可用。
2. 全新数据库无法进入自动外币汇率链路：设置页只导入既有/已引用币种，录入页只有选中外币后才请求参考汇率，造成外币无法首次出现的闭环依赖。
3. 完成数据库静态加密的发布决策与实现，或明确调整 ADR 0006 的发布政策。
4. 配置 Developer ID、hardened runtime、签名、公证与 Gatekeeper 验证。
5. 确认正式版本号；当前 `0.1.0` 未在本轮授权内调整。
6. 补齐 LICENSE、CHANGELOG 和必要的第三方许可证材料。

### P2：建议首发前处理或形成明确豁免

- 有周期规则后，“本月项目”新建对话框的类型标签会被默认周期规则的收支方向影响，可能显示与所选财务类别不一致的“收入/支出”；
- 历史详细报告仍重复展示总览已有的收入、支出、净结余和储蓄率表格，需要确认是否符合已确定的信息架构；
- ECB 请求无显式超时和最大可接受陈旧日期；
- 外汇导入、月度项目创建和实际条目保存跨多个 IPC 事务，失败时可能留下空的本月项目；
- 历史聚合按月份逐个查询，长期多年月数据存在 N+1 性能风险；
- 启动时没有自动数据库完整性检查和面向用户的损坏恢复路径；
- Windows 真实构建、安装、升级和卸载流程尚未验证。

## 7. Git 门

- [x] 工作位于 `fix/first-release-readiness`；
- [ ] 功能分支本地提交；
- [ ] 显式合并至 `develop`；
- [ ] 显式合并至 `main`；
- [x] 未 push、未 tag、未发布、未改变版本号；
- [x] 未执行真实发布前数据库过渡。

## 8. 当前验证记录

验证日期：2026-08-30

- 前端：TypeScript、ESLint、生产构建通过；Vitest 8 个文件、50 项测试通过；
- Rust：格式检查、workspace 测试和 Clippy `-D warnings` 通过；应用/数据库 27 项、领域 9 项，共 36 项测试通过；
- 数据库：发布前 6 段迁移的最终结构已冻结并与单一正式基线等价；干净数据库只记录正式迁移 1；旧迁移历史数据库拒绝且不改写；
- 依赖：`pnpm audit --prod --audit-level high` 无已知漏洞；`cargo-audit` 未安装；
- 构建：macOS arm64 `Aplena.app` 构建成功；生产前端最大异步块为 AnalyticsChart，约 537 KiB 原始、182 KiB gzip；
- 真实应用：隔离初始化、两项实际、确认、下月目标、周期规则、历史报表和重启持久化通过；追加/编辑本月项目条目及首次外币自动汇率失败并列为 P1；
- 签名：仅 linker ad-hoc，严格验证与 Gatekeeper 评估未通过；无可用代码签名身份，未做签名或公证；
- 平台：macOS 实机已构建和启动；Windows 仅静态审计。

## 9. 当前结论

`RELEASE_READY = NO`

单一首发数据库基线本身通过；正式发布仍被本月项目条目编辑/追加、首次外币自动汇率、数据库加密、签名公证和发布材料阻断。不得把本构建对外描述为可分发正式版。
