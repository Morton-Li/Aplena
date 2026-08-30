# Aplena 发布就绪检查

本文件是本地发布候选门禁清单，不授权推送、标签、签名、公证或分发。

## 1. 候选范围

当前候选包含：

- 分精度权威金额与八位汇率；
- 日级计划开始/结束日期；
- AMORTIZED 月区间交集与 PAYMENT 原始日锚点；
- 项目关联实际条目、退款/冲减和四种确认状态；
- `ACTUAL_ONLY` 与事务内原位提升；
- 从旧聚合实际和四位金额到 schema 3 的前向迁移；
- 条目驱动的 Dashboard、历史、分析与承载能力。

不包含 Scenario、云同步、交易导入、数据库加密发布门或线上发布。

## 2. 自动门禁

Rust 使用项目本地 Cargo 缓存和命令级 rustup 路径，不改变全局环境：

```sh
CARGO_HOME="$PWD/.cargo-home" \
PATH=/opt/homebrew/opt/rustup/bin:/usr/bin:/bin:/usr/sbin:/sbin \
/opt/homebrew/opt/rustup/bin/cargo fmt --all -- --check

CARGO_HOME="$PWD/.cargo-home" \
PATH=/opt/homebrew/opt/rustup/bin:/usr/bin:/bin:/usr/sbin:/sbin \
/opt/homebrew/opt/rustup/bin/cargo check --workspace --offline

CARGO_HOME="$PWD/.cargo-home" \
PATH=/opt/homebrew/opt/rustup/bin:/usr/bin:/bin:/usr/sbin:/sbin \
/opt/homebrew/opt/rustup/bin/cargo test --workspace --offline

CARGO_HOME="$PWD/.cargo-home" \
PATH=/opt/homebrew/opt/rustup/bin:/usr/bin:/bin:/usr/sbin:/sbin \
/opt/homebrew/opt/rustup/bin/cargo clippy --workspace --all-targets --offline -- -D warnings
```

前端：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

发布构建：

```sh
CARGO_HOME="$PWD/.cargo-home" \
PATH=/opt/homebrew/opt/rustup/bin:/usr/bin:/bin:/usr/sbin:/sbin \
pnpm tauri build --bundles app
```

## 3. 测试覆盖门

### 3.1 领域

- [x] 两位金额、第三位拒绝、边界溢出；
- [x] 闰年和日级区间交集；
- [x] 1 月 31 日 PAYMENT 短月夹取与长月恢复；
- [x] 结束日早于计划支付日时不生成；
- [x] 退款/冲减允许派生负净额；
- [x] 四种完整状态。

### 3.2 数据库与应用

- [x] 六张 STRICT 业务表、外键、索引和触发器；
- [x] 初始化幂等、并发安全、缺汇率整体回滚；
- [x] 快照不受计划、汇率和计划删除影响；
- [x] 实际条目 CRUD、跨月拒绝、确认自动重开；
- [x] 已结束计划迟到事实与已删除计划拒绝；
- [x] `ACTUAL_ONLY` 原位提升保持 ID 和条目；
- [x] schema 2 旧库分精度、日级日期和旧实际迁移。

### 3.3 前端

- [x] 首次设置与日级计划预览；
- [x] 月度净额只读，支出/退款、收入/冲减条目录入；
- [x] 无计划快照时创建仅实际项目；
- [x] 确认零、记录中、最终确认和重新打开；
- [x] 历史/未来浏览无隐式写入；
- [x] 分析与仅下月承载能力 UI；
- [x] 下月目标与当前月、历史月报表隔离。

完成发布验证后把上述项改为 `[x]`，并在第 7 节记录命令和结果。

## 4. 真实应用隔离冒烟

必须使用 release `.app`，且数据目录满足：

- 由 `mktemp -d` 创建在 macOS 系统临时根目录下；
- 启动前目录已存在；
- 只通过本进程的 `APLENA_SMOKE_DATA_DIR` 传入；
- 路径不是用户正式应用支持目录；
- 测试结束后报告目录位置和清理状态。

发布候选的实际旅程：

1. 启动并验证默认人民币直接进入总览；
2. 在“配置预算”页设置下月储蓄率并创建日级 AMORTIZED 周期规则，验证当前月不被自动回填；
3. 添加支出和退款，核对派生净额与偏差；
4. 最终确认后再编辑条目，核对状态重开；
5. 切换无正式快照月份并建立仅实际退款；
6. 显式初始化该未来月，核对仅实际标签消失、计划金额补齐且条目保留；
7. 检查总览与历史报表实时刷新，并验证下月目标不会出现在两者口径中；
8. 退出并重启同一隔离目录，核对持久化；
9. 正常退出，不触碰真实数据库。

月末 PAYMENT 支付日由领域测试和前端预览测试覆盖；真实应用冒烟验证日级控件、预览与保存链路，不重复自动测试的全部日期组合。

## 5. 安全与依赖检查

- Tauri capability 与 CSP 无新增宽权限；
- 无网络、shell 或任意路径访问能力；
- `cargo audit` / `pnpm audit --prod` 在工具和索引可用时执行并记录；
- Rust/前端直接依赖许可证清单无禁止许可证；
- UI 错误不泄露路径、SQL 或内部诊断；
- release 包只包含预期 `.app`，未签名候选不对外分发。

数据库加密仍受 ADR 0006 约束，不得把当前候选描述为静态加密完成。

## 6. Git 门

- [x] 功能分支工作已提交；
- [x] 显式合并至 `develop`；
- [x] `develop` 合并结果通过必要复核；
- [x] 显式合并至 `main`；
- [x] `main` 工作树干净；
- [x] 未 push、未 tag、未发布。

## 7. 当前验证记录

验证日期：2026-08-23

- 前端：类型检查、ESLint、生产构建通过；Vitest 2 个文件、18 项通过；
- Rust：格式、workspace check、Clippy `-D warnings` 通过；31 项应用/数据库测试与 8 项领域测试通过；
- 安全与许可证：`pnpm audit --prod --audit-level high` 无已知漏洞；前端生产依赖许可证为 MIT、Apache-2.0、0BSD、BSD-3-Clause；Rust 依赖树许可证已列出，无禁止许可证；本机未安装 `cargo-audit`，未为此改变环境；
- release：`target/release/bundle/macos/Aplena.app` 构建成功；
- 真实应用：使用 `/private/var/folders/62/f1367xwj2f1glbw1b_d8zxd40000gn/T/aplena-smoke.HOYyAQ`；首次设置、自动快照、支出/退款、确认重开、仅实际原位提升、实时分析和重启持久化通过；验证后隔离目录及一次失败启动产生的空目录均已删除；
- 隔离库：`PRAGMA integrity_check = ok`、外键检查为空；1 个计划、2 个月度快照、3 条实际条目；两个快照均为 `PLANNED`，证明原位提升完成；
- Git：功能分支按后端、前端、文档拆分提交，并显式合并到 `develop` 与 `main`；最终 `main` 工作树干净；未 push、未 tag、未发布。
