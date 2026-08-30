# Aplena — Personal Financial Capacity

Aplena 是一款本地优先的个人财务规划桌面软件。PFCM（Personal Financial
Capacity Model）是它的内部领域模型与计算引擎。

Aplena 不是传统流水账。它按月聚合实际财务结果，将可选周期规则冻结为独立月度快照，
并允许用户逐笔添加实际支出、退款、收入或冲减；项目实际净额由这些条目实时汇总。

> 计划决定结构，条目说明结果；不引入账户、商户、复式记账或银行流水同步。

## 当前阶段

当前本地候选闭环已经落地：Aplena 已提供月度执行、项目实际条目、Dashboard、历史报表、
仅面向下一个自然月的目标、可选周期规则和财务承载能力。生产 CSP、数据库权限与数据写入边界均由 Rust 控制，前端没有
任意文件系统能力。

当前只定位为无 Developer ID 签名（构建产物仅为 ad-hoc/linker-signed）、未加密的本地 macOS 候选版。SQLCipher 跨平台验证、macOS Developer
ID 签名/公证和真实 Windows 安装仍是公开发布门禁，不能由本地构建或模拟测试替代。

## 已冻结的核心原则

- 单用户、单财务账本、本地优先、默认离线。
- 首发 macOS，并为后续 Windows 保留兼容架构。
- `PlanItem` 是长期计划，`MonthlyItem` 是不可被未来配置污染的月度事实快照，
  `ActualEntry` 是隶属于月度项目的实际结果条目。
- 月度项目可选择“月度均摊”或“按支付月计入”。
- 新自然月由系统自动初始化；历史补录和未来初始化必须显式触发。
- `NextMonthGoal` 只指向系统计算出的下一个自然月，不进入当前月或历史月分析。
- 实际净额只由 `INCREASE - DECREASE` 条目派生；月度项目另有明确确认时间。
- 无条目未确认、已有条目未确认、无条目已确认零、已有条目最终确认是四种不同状态。
- Dashboard、Monthly Report、趋势和结构分析均为实时派生数据，不重复持久化。
- 财务承载能力始终按月均负担计算，不因支付月份而漏算长期承诺。
- 金额使用固定精度十进制语义，禁止以二进制浮点数作为存储或权威计算口径。

## 文档索引

- [产品规格](docs/01-product-spec.md)
- [领域模型](docs/02-domain-model.md)
- [技术架构](docs/03-architecture.md)
- [数据库设计](docs/04-database-schema.md)
- [信息架构与用户流程](docs/05-ux-and-user-flows.md)
- [MVP 路线图](docs/06-mvp-roadmap.md)
- [本地候选与外部门禁](docs/07-release-readiness.md)
- [ADR：本地优先的 Tauri + SQLite](docs/adr/0001-local-first-tauri-sqlite.md)
- [ADR：双计入模式](docs/adr/0002-recognition-modes.md)
- [ADR：月度自动初始化](docs/adr/0003-automatic-month-initialization.md)
- [ADR：长期计划可选与手动月度项目](docs/adr/0008-optional-long-term-planning.md)
- [ADR：下月目标与报表隔离](docs/adr/0009-next-month-goal-isolation.md)
- [ADR：金额、日期与舍入](docs/adr/0004-money-date-and-rounding.md)
- [ADR：数据库静态加密发布门禁](docs/adr/0006-database-encryption-release-gate.md)
- [ADR：项目实际条目与确认状态](docs/adr/0007-actual-entries-and-completeness.md)

## 技术栈

- Tauri 2、Rust、React、TypeScript、Vite
- SQLite STRICT、WAL、SQLx、版本化 SQL migrations
- React Hook Form、Zod、TanStack Query、Apache ECharts、原生 CSS
- Cargo tests、Vitest、Testing Library

前端不直接访问数据库。所有权威校验、财务计算和数据写入都通过有限的 Tauri 业务命令
进入 Rust 应用层。

当前依赖已由 `Cargo.lock` 和 `pnpm-lock.yaml` 锁定。金额聚合、占比、排名、储蓄率和承载
能力都在 Rust 中计算；React 只负责命令调用、查询缓存、表单和展示。

## 工程结构

```text
crates/pfcm-domain/   与 Tauri、SQLite、React 无关的纯 Rust 领域层
src-tauri/            SQL migrations、Repository、应用服务、IPC DTO 和桌面入口
src/                  React 页面、查询适配器、表单、图表与样式
docs/                 产品、领域、架构、数据库与路线图基线
```

领域层已实现：

- `YearMonth`、`CalendarDate`、`CurrencyCode`、两位金额、八位汇率和基点储蓄率；
- 五种固定类别及派生收支方向；
- `AMORTIZED`（按月均摊）与 `PAYMENT`（支付月确认）；
- 独立 `MonthlyItem` 快照、日级支付锚点、`ActualEntry` 正数条目和可为负的派生实际净额；
- 按月均负担计算的保留预算后承载力、最大承载力、固定承诺占比和稳定收入覆盖倍数；
- 所有金额与比率通过 IPC 使用十进制字符串传输。

应用层已实现：

- 仅含 `settings`、`next_month_goal`、`exchange_rates`、`plan_items`、`monthly_items`、`actual_entries` 六张业务表的 SQLite
  STRICT schema，启用外键、WAL、约束、索引和版本化迁移；
- 启动时幂等补齐当前自然月；新增或修改周期规则不会回填本月，历史/未来月份只在用户确认后创建；
- 汇率与计划事实在月度快照创建时冻结，后续修改或删除来源不污染历史；
- 条目新增/编辑/删除自动重新打开确认，支持项目和整月最终确认；确认不会复制计划金额；
- 非支付月可为现有计划创建计划金额为零的 `ACTUAL_ONLY` 项，后续应计时原地提升并保留条目；
- 无需周期规则即可创建分类明确的本月项目并记录实际；周期规则仅用于月度基准、偏差和下月承载能力增强；
- 动态 Dashboard、历史时间序列、分类结构、项目排名和重要偏差；
- 以稳定收入和长期月均负担计算的保留预算后承载力与最大承载力，`PAYMENT` 项目在
  非支付月份仍计入长期负担；
- 追加式数据库迁移、未来 schema 拒绝、外键约束和事务回滚，保留确认状态与历史快照语义。

主要页面：`总览`、`月度执行`、`历史报表`、`目标`、`设置`。目标页集中管理下月储蓄率、
承载力和可选周期规则；图表均有 ARIA
描述和对应数值表；不完整月份明确显示“当前已录”，零分母显示 `N/A`。

## 本地运行

前置条件：Node.js、pnpm、Rust stable 和 macOS Command Line Tools。安装项目依赖：

```bash
pnpm install --frozen-lockfile
```

启动桌面开发模式：

```bash
pnpm tauri:dev
```

该命令显式合并 `src-tauri/tauri.dev.conf.json`；发布基线配置不包含开发服务器地址或
WebSocket CSP。

如果 Homebrew `rustup` 未加入全局 `PATH`，无需修改 shell 配置；可以仅给当前命令提供环境：

```bash
env CARGO_HOME="$PWD/.cargo-home" \
  PATH="/opt/homebrew/opt/rustup/bin:$PATH" \
  pnpm tauri:dev
```

这不会修改全局环境，也不会影响已经运行的其他任务。

## 验证命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace
pnpm tauri build --no-bundle
pnpm tauri build --bundles app
```

倒数第二条只生成本地可执行文件；最后一条生成无 Developer ID 签名的本地 `.app`。两者都不发布。完整安全与
发布清单见 `docs/07-release-readiness.md`。

## 当前边界

- 单用户、单账本、本地优先；不提供账户、云同步、遥测或后台网络服务。
- 只记录隶属计划项目的实际条目；不提供通用流水账、账户、商户、复式记账或公式输入。
- Scenario 模式和数据库静态加密尚未实现。
- `bundle.active` 仍为 `false`，只在本地门禁显式请求 macOS `app` bundle；当前构建不能
  视为已签名、公证、Windows 验证或公开发布产品。

## 分支模型

- `main`：已完成目标的稳定基线。
- `develop`：已验证并合并的阶段成果。
- `feature/*`、`fix/*`：具体功能或修复。

功能分支经验证后显式合并到 `develop`；只有完整目标达成后才显式合并到 `main`。
