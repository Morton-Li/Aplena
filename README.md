# Aplena — Personal Financial Capacity

Aplena 是一款本地优先的个人财务规划桌面软件。PFCM（Personal Financial
Capacity Model）是它的内部领域模型与计算引擎。

Aplena 不是逐笔记账软件。它维护长期计划，将计划冻结为独立的月度快照，让用户只在
项目层更新实际金额，并实时回答计划执行情况与长期财务承载能力。

> 维护计划，而不是维护流水；跟踪结果，而不是记录每一次交易。

## 当前阶段

仓库目前处于产品与技术基线阶段，尚未生成应用脚手架，也没有可运行的应用代码或本地
依赖。第一阶段冻结产品边界、领域规则、数据约束、用户流程和架构决策。

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

## 预定技术栈

- Tauri 2、Rust、React、TypeScript、Vite
- SQLite STRICT、WAL、SQLx、版本化 SQL migrations
- React Hook Form、Zod、TanStack Query、Apache ECharts、Tailwind CSS
- Cargo tests、Vitest、Testing Library、Playwright

前端不直接访问数据库。所有权威校验、财务计算和数据写入都通过有限的 Tauri 业务命令
进入 Rust 应用层。

## 分支模型

- `main`：已完成目标的稳定基线。
- `develop`：已验证并合并的阶段成果。
- `feature/*`、`fix/*`：具体功能或修复。

功能分支经验证后显式合并到 `develop`；只有完整目标达成后才显式合并到 `main`。
