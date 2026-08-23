# Aplena 本地发布候选与外部门禁

## 当前结论

目标 B 交付的是无 Developer ID 签名、仅由链接器 ad-hoc 签名的本地 macOS 候选版。完整备份、安全恢复、迁移前恢复点、四表 CSV、
生产 CSP、最小 capability 和自动化可靠性检查已进入本地门禁。它不是公开发布授权。

## 已实现的本地门禁

- WAL 一致 `.aplena` 备份、版本清单、SHA-256 与记录摘要；
- 恶意归档和解压大小防护；
- 临时迁移、SQLite 完整性、外键、schema 和领域不变量检查；
- 不合理记录数限制、按月分类聚合重算，以及当前数据与备份摘要差异预览；
- 双重确认、替换前恢复点、数据库独占门控、原子换名、重开复核和失败回滚；
- 待迁移数据库先备份，备份失败则不迁移；
- 四张业务表的确定性 UTF-8 CSV，稳定代码和中文标签、NULL/0 与公式注入防护；
- Rust 侧系统文件选择器，前端无任意文件系统能力；
- 生产 CSP 不包含开发 WebSocket，主窗口 capability 仍只含 `core:default`；
- 开发服务器地址和 `devCsp` 仅存在于由 `pnpm tauri:dev` 显式加载的覆盖配置，普通发布构建
  不会合并该文件；
- Unix 应用数据目录为 `0700`，SQLite/WAL/SHM 为 `0600`；
- 全局 UI 故障页不展示原始异常；`freezePrototype` 因真实 WebKit 与图表依赖不兼容而保持
  Tauri 默认的关闭状态，安全边界由严格 CSP、无远程内容和最小 capability 承担；
- 自动化测试覆盖数据往返、并发、损坏、版本、迁移、CSV 和恢复 UI。

## 每次候选构建必须执行

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
# 必须输出 `warning: nothing to print.`，否则不得使用下一行的定向例外
cargo tree -i rkyv@0.7.46 --workspace --target aarch64-apple-darwin
cargo audit --target-os macos --target-arch aarch64 --ignore RUSTSEC-2026-0235
pnpm audit --prod
pnpm licenses list --prod
pnpm tauri build --no-bundle
pnpm tauri build --bundles app
```

随后检查可执行文件架构和动态链接、`.app` 内容、生产 CSP、capability、秘密扫描和干净 Git
状态。桌面烟测必须使用隔离的测试数据库目录或测试 bundle identifier，不能触碰真实用户库。
本地自动化可先在系统临时目录创建一个专用子目录，再仅对该次进程设置
`APLENA_SMOKE_DATA_DIR`；应用会拒绝不存在的目录、临时目录根本身及其范围外的路径。
未设置该变量时仍使用正常的操作系统应用数据目录。

## 依赖审计说明（2026-08-23）

- 未带例外的 RustSec 扫描会报告 `RUSTSEC-2026-0235`：`rust_decimal 1.42.1`
  在 lockfile 中声明了可选的 `rkyv 0.7.46`。Aplena 只启用 `default`、`serde`、`std` 和
  `serde-with-str`；针对 `aarch64-apple-darwin` 的反向依赖树确认该 `rkyv` 不在实际构建图中。
  该例外只适用于这一条不可达的 lockfile 记录；一旦反向依赖树出现调用链，候选构建必须失败。
- RustSec 其余 17 条为允许的维护性或健全性警告：GTK3/proc-macro 项不在 macOS 构建图；
  Tauri 当前传递依赖中的旧 `unic-*` 项仍在构建图，但没有被报告为漏洞。应随上游 Tauri
  升级持续清理，不能把“允许警告”等同于公开发布安全证明。
- 前端生产依赖扫描没有已知漏洞；前端许可证为 MIT、Apache-2.0、BSD 或 0BSD。Rust
  依赖元数据未发现缺失许可证或强 copyleft-only 许可证；`r-efi` 的 LGPL 仅为可选许可证之一。

## 尚未满足的外部门禁

| 门禁 | 状态 | 阻塞原因 |
|---|---|---|
| SQLCipher 静态加密 | 未验证 | 需要 SQLx/底层链接、错误密钥、WAL、迁移、备份和崩溃测试 |
| macOS Developer ID 签名 | 未执行 | 需要外部证书、授权和签名身份 |
| Apple 公证与 stapling | 未执行 | 需要 Apple 凭据、网络提交和显式发布授权 |
| 真实 Windows 构建/安装/卸载 | 未执行 | 必须在真实 Windows 环境及 Credential Manager 上验证 |
| 公开分发 | 阻塞 | 以上门禁及加密 ADR 尚未 Accepted |

Docker、Linux、交叉编译、WebView mock 和无 Developer ID 签名的本地 `.app` 都不能替代这些外部证据。

## 本地 macOS 候选版实机烟测（2026-08-23）

本次烟测通过 LaunchServices 启动 release `.app`，并只为该进程设置位于系统临时目录下的
`APLENA_SMOKE_DATA_DIR`。验证结果：

- 首次设置、退出后重启、总览/图表/导航和承载力页面均能正常读取隔离数据库；
- 系统文件选择器完成 `.aplena` 备份与四表 CSV 导出，备份检查正确展示应用版本、schema、
  记录数、月份范围和设置摘要；
- 勾选确认并输入“恢复”后，真实执行数据库替换，生成替换前恢复点，恢复成功通知保持可见；
- 恢复后返回总览，查询重新读取且页面无错误；通过应用常规退出关闭；
- 应用数据目录权限为 `0700`，数据库、WAL、SHM、备份、恢复点和 CSV 文件均为 `0600`；
- 应用标准输出和标准错误均为空，隔离目录之外没有作为烟测目标的数据。

产物为 arm64 Mach-O，`LC_BUILD_VERSION` 与 `Info.plist` 的最低系统版本均为 macOS 11.0，
动态链接只指向系统库；产物中未命中开发服务器地址、开发 WebSocket 或常见秘密模式。严格
`codesign --verify --deep --strict` 会因当前候选版只有 linker ad-hoc 签名且无资源封印而失败，
这与上表的 Developer ID 外部门禁一致。
