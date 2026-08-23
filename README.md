# Aplena — Personal Financial Capacity

Aplena 是一款本地优先的个人财务规划桌面软件。PFCM（Personal Financial
Capacity Model）是它的内部领域模型与计算引擎。

Aplena 不是逐笔记账软件。它维护长期计划，将计划冻结为独立的月度快照，让用户只在
项目层更新实际金额，并实时回答计划执行情况与长期财务承载能力。

> 维护计划，而不是维护流水；跟踪结果，而不是记录每一次交易。

## 当前阶段

目标 B 的本地候选闭环已经落地：除计划、月度执行、Dashboard、历史、分析和财务承载能力
外，Aplena 现在还提供 WAL 一致完整备份、安全恢复、迁移前恢复点和四表 CSV 导出。生产
CSP、文件选择边界、归档防护和失败回滚均由 Rust 控制，前端没有任意文件系统能力。

当前只定位为无 Developer ID 签名（构建产物仅为 ad-hoc/linker-signed）、未加密的本地 macOS 候选版。SQLCipher 跨平台验证、macOS Developer
ID 签名/公证和真实 Windows 安装仍是公开发布门禁，不能由本地构建或模拟测试替代。

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
- [本地候选与外部门禁](docs/07-release-readiness.md)
- [ADR：本地优先的 Tauri + SQLite](docs/adr/0001-local-first-tauri-sqlite.md)
- [ADR：双计入模式](docs/adr/0002-recognition-modes.md)
- [ADR：月度自动初始化](docs/adr/0003-automatic-month-initialization.md)
- [ADR：金额、月份与舍入](docs/adr/0004-money-date-and-rounding.md)
- [ADR：版本化备份、安全恢复与迁移保护](docs/adr/0005-versioned-backup-restore-and-migration-protection.md)
- [ADR：数据库静态加密发布门禁](docs/adr/0006-database-encryption-release-gate.md)

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

- `YearMonth`、`CurrencyCode`、四位金额、八位汇率和基点储蓄率；
- 五种固定类别及派生收支方向；
- `AMORTIZED`（按月均摊）与 `PAYMENT`（支付月确认）；
- 独立 `MonthlyItem` 快照以及未录入实际值和实际零值的区分；
- 按月均负担计算的保留预算后承载力、最大承载力、固定承诺占比和稳定收入覆盖倍数；
- 所有金额与比率通过 IPC 使用十进制字符串传输。

应用层已实现：

- 仅含 `settings`、`exchange_rates`、`plan_items`、`monthly_items` 四张业务表的 SQLite
  STRICT schema，启用外键、WAL、约束、索引和版本化迁移；
- 启动和新建计划后幂等补齐当前自然月，历史/未来月份只在用户确认后创建；
- 汇率与计划事实在月度快照创建时冻结，后续修改或删除来源不污染历史；
- `NULL`、已确认零值和正实际金额三种状态，以及不覆盖已有实际的批量确认；
- 动态 Dashboard、历史时间序列、分类结构、项目排名和重要偏差；
- 以稳定收入和长期月均负担计算的保留预算后承载力与最大承载力，`PAYMENT` 项目在
  非支付月份仍计入长期负担。
- `.aplena` 完整备份清单、SHA-256、临时迁移与完整性检查、替换前恢复点、原子替换及
  失败回滚；迁移只在一致恢复点成功后执行；
- `settings`、`exchange_rates`、`plan_items`、`monthly_items` 四表 CSV，保留固定精度、
  NULL/0 语义、稳定枚举代码和中文标签，并防止电子表格公式注入。

主要页面：`总览`、`月度计划`、`长期计划`、`历史`、`分析`、`设置`。图表均有 ARIA
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
- 不记录逐笔交易，也不新增持久化报表或派生统计表。
- Scenario 模式和数据库静态加密尚未实现；备份与 CSV 也明确未加密。
- `bundle.active` 仍为 `false`，只在本地门禁显式请求 macOS `app` bundle；当前构建不能
  视为已签名、公证、Windows 验证或公开发布产品。

## 分支模型

- `main`：已完成目标的稳定基线。
- `develop`：已验证并合并的阶段成果。
- `feature/*`、`fix/*`：具体功能或修复。

功能分支经验证后显式合并到 `develop`；只有完整目标达成后才显式合并到 `main`。
