# Aplena 发布就绪检查

本文件记录 2026-09-07 在 `feature/github-auto-updater` 上完成的本地证据。它证明自动更新实现和本地发行链达到可提交状态，但不授权合并、推送、打标签或发布，也不能替代远程 GitHub Actions、生产自签名证书和 Intel Runner 的实际结果。

## 1. 当前结论

- `LOCAL_AUTO_UPDATE_IMPLEMENTATION = PASS`
- `LOCAL_RELEASE_CANDIDATE = CONDITIONAL`
- `REMOTE_SIGNED_RELEASE = PENDING_STRICT_TAG_PIPELINE`
- `PUBLIC_RELEASE = NOT_ATTEMPTED`

本地实现、数据库迁移、前后端测试、真实应用隔离冒烟和真实 updater 归档签名均已通过。正式发行仍以严格 `vMAJOR.MINOR.PATCH` 标签触发的双架构流水线为硬门；本轮未推送、未打标签、未创建或修改 GitHub Release。

## 2. 产品与信任边界

自动更新只处理高于当前版本的稳定 SemVer：

1. 财务启动完成后，根据独立偏好执行一次后台检查；默认开启，离线、超时或坏清单不阻塞应用。
2. 手动检查显示明确结果；发现版本后以全局非阻断提示和设置页卡片展示说明与大小。
3. 下载和安装必须二次确认；仅下载阶段允许取消，进入验签后不可取消。
4. `tauri-plugin-updater = 2.11.0` 只负责下载和 minisign 验证，不调用其 macOS 安装函数。
5. 自有安装器限制 tar 路径、链接、条目数与大小，验证 Bundle ID、版本、当前单一架构、严格代码签名和固定自签名证书指纹，随后只允许同卷 `RENAME_SWAP` 原子交换。
6. 原子交换失败不做两段 rename、删除、AppleScript 或提权回退；安装成功后由用户决定何时重启。

Updater minisign 与 macOS 代码签名是两条独立信任链。生产应用固定要求证书 SHA-256 指纹 `FEEE897C91F36CAFE6AE34CD4AD50F701C89D688DF68DD22D09E0FFD77635FEB`；updater 公钥由标签流水线校验并同时提供给运行时和 Tauri 打包器。自签名本身不会让 updater 必然失败，但不提供 Developer ID、公证、stapling 或 Apple 信任链，更新后仍可能触发系统安全提示。

## 3. 数据库证据

- 当前 schema 为 5；schema 3 已直接删除旧储蓄目标表和数据，不保留兼容读取。
- `software_update_preferences` 是独立 STRICT 单行表，默认 `auto_check_updates = 1`，最近检查时间与结果同时为空或同时存在。
- 自动更新偏好和检查结果不修改财务 `settings` 或五张财务业务表。
- 自动测试覆盖 schema 1 至 5、迁移重开、预发布库拒绝、偏好持久化、未知状态约束和财务设置不受影响。
- 隔离真实应用中新库记录 migration 1 至 5；关闭自动检查后保存 `FAILED` 检查结果，重启后开关仍关闭，`PRAGMA integrity_check = ok`。

冒烟数据库位于系统临时目录，验收结束后已连同 WAL/SHM 删除；没有读取、复制或修改生产应用数据目录。

## 4. 自动化门禁

验证日期：2026-09-07。

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test`：8 个文件、73 项测试通过；
- `pnpm test:release`：9 项发行脚本测试通过；
- `pnpm build`：771 个模块构建通过；
- `cargo fmt --all -- --check`：通过；
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`：通过；
- `cargo test --workspace --locked`：应用 49 项、领域 9 项，共 58 项通过；
- `pnpm audit --prod --audit-level high`：未发现已知漏洞；
- GitHub Actions YAML 解析：通过；
- `git diff --check`：通过。

Updater 专项测试覆盖双架构清单选择、相同版本和预发布版本拒绝、真实 minisign 正向与篡改反例、清单错误和检查超时分类、公钥解析、下载阶段与验签阶段边界、归档路径/链接限制、元数据/架构/代码签名/证书校验、交换失败保持旧应用、备份清理，以及用户重命名本机 `.app` 后仍可原子更新。

## 5. UI 与真实应用冒烟

前端组件测试覆盖：

- React StrictMode 下启动只检查一次，异步建立的全部事件监听均被释放；
- 启动失败静默、手动失败可见、已是最新提示；
- 全局可用版本提示、二次安装确认、下载进度和取消；
- 验签/安装阶段取消入口消失；
- 未嵌入合法生产公钥时禁止安装；
- 安装完成对话框默认焦点为“稍后”，重启失败可反馈。

应用内浏览器使用当前前端和隔离 Tauri IPC 模拟完成窄窗口视觉验收：可用版本、25% 下载、验签、安装完成四个状态无重叠或闪烁，重启对话框的“稍后”获得焦点，控制台无警告或错误。

真实 Tauri 冒烟使用带独立 Bundle ID 的临时 `.app`，通过 `LSEnvironment` 把数据库限定到系统临时目录。已验证：

- 当前前端资源正确嵌入，设置页包含软件更新卡片；
- 首次默认开启自动检查；当前公开版本没有 `latest.json` 时，启动只记录“检查失败”，不弹出阻断错误；
- 手动检查显示“无效版本清单”的安全错误，未下载或安装内容；
- 关闭自动检查后错误提示被清除，跨应用重启保持关闭；
- 既有财务页面仍可正常进入，隔离数据库完整性正常。

临时 `.app` 和隔离数据库均已删除或留在 Git 忽略的可再生 `target` 中，不构成生产安装。

## 6. 本地打包证据

使用一次性临时 minisign 密钥和与 CI 相同的生成配置流程，Tauri 成功生成：

- `target/release/bundle/macos/Aplena.app`；
- `target/release/bundle/macos/Aplena.app.tar.gz`；
- `target/release/bundle/macos/Aplena.app.tar.gz.sig`。

归档根目录为固定的 `Aplena.app`，Bundle ID 为 `li.morton.aplena`，开发基线版本为 `0.1.0`，架构为 `arm64`。仓库内 Rust 验证器使用同一临时公钥对真实归档验签成功；其单元测试确认任意字节篡改会失败。临时私钥、公钥、生成配置和测试数据库已删除，不进入提交。

本机没有固定生产自签名证书对应的可用私钥 identity，因此本地 `.app` 只有 linker ad-hoc 签名，严格 bundle `codesign --verify --deep --strict` 失败是预期边界，不能作为生产证书证据。优化构建还报告本机 Rust 工具链缺少 `libLLVM.dylib`，导致 `rust-objcopy` 无法剥离调试信息；构建和 updater 签名仍成功，正式产物以干净远程 Runner 为准。

## 7. 严格标签流水线

`.github/workflows/release.yml` 对严格标签执行以下顺序：

1. 要求标签提交位于 `origin/main` 历史，并同步全部版本字段。
2. 校验 updater 公钥、私钥和密码，生成不入库的 `tauri.release.generated.conf.json`；缺失、占位、格式错误或公私钥不匹配均失败。
3. 导入 “Morton Li” P12 到临时 keychain，验证可用私钥 identity 和固定 SHA-256 指纹。
4. 在 Apple Silicon 与 Intel Runner 分别完成全量门禁，构建 DMG、`.app.tar.gz` 与 `.sig`。
5. 对应用包和归档内应用重复验证签名、证书、Bundle ID、版本及精确架构；用仓库内验证器对真实 updater 归档做密码学验签。
6. 聚合任务要求六个二进制资产 exact-set，再生成只含 `darwin-aarch64` 与 `darwin-x86_64` 的确定性 `latest.json`。
7. 先上传草稿 Release，再校验七个远端资产的名称、状态、大小、GitHub SHA-256 digest，并逐个下载与本地字节比较。
8. 全部通过后才公开草稿、设为最新稳定版，并复核 `/releases/latest/download/latest.json` 与本地清单逐字节一致。

普通 `main` 推送和 `workflow_dispatch` 只构建开发 DMG，不生成 updater 归档，也不创建 Release。

## 8. 剩余发布门

- 尚未运行远程双架构标签流水线；Intel 包、固定生产证书和 GitHub 最新端点没有本轮实证。
- GitHub `codesign` environment 仍需配置 `CODESIGN_CERTIFICATE_P12_BASE64`、`CODESIGN_CERTIFICATE_PASSWORD`、`APLENA_UPDATER_PUBLIC_KEY`、`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 当前公开 `v1.1.3` 只有手动下载资产，没有 updater 清单；现有用户仍需手动安装一次包含 updater 的桥接版本。
- 生产 updater 私钥必须独立备份。丢失后不能直接让已安装客户端信任新密钥，只能先用旧私钥签署轮换桥接版；若旧私钥已丢失，则必须再次手动安装。
- Windows、Developer ID、公证和静态数据库加密不在本目标范围。

## 9. Git 边界

- 当前分支：`feature/github-auto-updater`；
- 本目标要求并只授权本地提交；
- 未合并至 `develop` 或 `main`；
- 未推送、未打标签、未创建 Release；
- 未修改 GitHub secrets、variables、environment 或仓库设置。

因此，本地实现可以提交，但对外发布仍必须等待生产密钥配置和严格标签流水线实际成功。
