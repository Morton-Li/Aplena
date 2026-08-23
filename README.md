# Aplena — Personal Financial Capacity

Aplena 是一款本地优先的个人财务规划桌面软件。PFCM（Personal Financial
Capacity Model）是它的内部领域模型与计算引擎。

Aplena 不是逐笔记账软件。它维护长期计划，将计划冻结为独立的月度快照，让用户只在
项目层更新实际金额，并实时回答计划执行情况与长期财务承载能力。

> 维护计划，而不是维护流水；跟踪结果，而不是记录每一次交易。

## 当前阶段

第二阶段“可执行工程与领域内核”已经落地：仓库包含可运行的 Tauri 2 + React +
TypeScript + Vite 桌面应用骨架、独立 `pfcm-domain` Rust 包、受限 Tauri IPC 边界和自动化
测试。第一阶段冻结的产品与架构文档仍是后续实现的权威基线。

当前 UI 只用于证明 React 与真实 Rust 命令已经打通，不展示虚构财务数据。SQLite、自动月度
初始化和完整业务页面属于后续阶段。

## 已冻结的核心原则

- 单用户、单财务账本、本地优先、默认离线。
- 首发 macOS，并为后续 Windows 保留兼容架构。
- `PlanItem` 是长期计划，`MonthlyItem` 是不可被未来配置污染的月度事实快照。
- 月度项目可选择“月度均摊”或“按支付月计入”。
- 新自然月由系统自动初始化；历史补录和未来初始化必须显式触发。
- `actual_amount = NULL` 表示尚未录入，`actual_amount = 0` 表示已确认实际为零。
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
- [ADR：本地优先的 Tauri + SQLite](docs/adr/0001-local-first-tauri-sqlite.md)
- [ADR：双计入模式](docs/adr/0002-recognition-modes.md)
- [ADR：月度自动初始化](docs/adr/0003-automatic-month-initialization.md)
- [ADR：金额、月份与舍入](docs/adr/0004-money-date-and-rounding.md)

## 技术栈

- Tauri 2、Rust、React、TypeScript、Vite
- SQLite STRICT、WAL、SQLx、版本化 SQL migrations
- React Hook Form、Zod、TanStack Query、Apache ECharts、Tailwind CSS
- Cargo tests、Vitest、Testing Library、Playwright

前端不直接访问数据库。所有权威校验、财务计算和数据写入都通过有限的 Tauri 业务命令
进入 Rust 应用层。

当前依赖已由 `Cargo.lock` 和 `pnpm-lock.yaml` 锁定。第二阶段只引入运行领域内核和最小
应用骨架所需的包；数据库、表单、查询、图表和端到端测试依赖将在对应阶段按需加入。

## 工程结构

```text
crates/pfcm-domain/   与 Tauri、SQLite、React 无关的纯 Rust 领域层
src-tauri/            Tauri 应用层、IPC DTO、稳定错误结构和桌面入口
src/                  React 最小应用壳与前端命令适配器
docs/                 产品、领域、架构、数据库与路线图基线
```

领域层已实现：

- `YearMonth`、`CurrencyCode`、四位金额、八位汇率和基点储蓄率；
- 五种固定类别及派生收支方向；
- `AMORTIZED`（按月均摊）与 `PAYMENT`（支付月确认）；
- 独立 `MonthlyItem` 快照以及未录入实际值和实际零值的区分；
- 按月均负担计算的保留预算后承载力、最大承载力、固定承诺占比和稳定收入覆盖倍数；
- 所有金额与比率通过 IPC 使用十进制字符串传输。

## 本地运行

前置条件：Node.js、pnpm、Rust stable 和 macOS Command Line Tools。安装项目依赖：

```bash
pnpm install --frozen-lockfile
```

启动桌面开发模式：

```bash
pnpm tauri dev
```

如果 Homebrew `rustup` 未加入全局 `PATH`，无需修改 shell 配置；可以只为当前命令临时提供
`/opt/homebrew/opt/rustup/bin`。这不会影响已经运行的其他任务。

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
```

最后一条命令只生成未签名的本地可执行文件，不制作或发布安装包。macOS 签名、公证、
Windows 构建和真实发布仍需在后续发布阶段单独验证。

## 第二阶段边界

本阶段明确没有实现 SQLite、SQLx、migration、Repository、计划 CRUD、月度自动初始化、
Dashboard 或真实财务数据持久化。上述能力不得在前端临时模拟；下一阶段将先实现事务化
持久化和幂等快照生成，再由后续 UI 阶段使用。

## 分支模型

- `main`：已完成目标的稳定基线。
- `develop`：已验证并合并的阶段成果。
- `feature/*`、`fix/*`：具体功能或修复。

功能分支经验证后显式合并到 `develop`；只有完整目标达成后才显式合并到 `main`。
