# ADR-0001：采用本地优先的 Tauri 2 + SQLite 架构

- 状态：Accepted
- 日期：2026-08-23

## 背景

Aplena MVP 是单用户个人财务规划软件，没有协作、账户或跨设备同步需求。财务计划、实际
金额和备注具有隐私性。产品需要 macOS 首发，并希望后续兼容 Windows。

## 决策

采用：

- Tauri 2 作为桌面外壳；
- React + TypeScript + Vite 作为 UI；
- Rust 作为应用服务和 PFCM 领域实现；
- SQLite STRICT + WAL 作为本地数据库；
- SQLx 和显式版本化 SQL migrations 作为数据访问；
- React 只能调用白名单 Tauri 业务命令，不能直接执行 SQL；
- 默认不启用网络、Shell 或广泛文件系统权限。

应用不运行本地 HTTP 服务，也不建立云端后端。

## 理由

- 本地数据库与单用户离线模型匹配，不需要运营服务器；
- Rust 可以集中实现精确金额、月份和事务规则；
- Tauri capabilities 可以形成 UI 与本机能力之间的明确权限边界；
- SQLite 提供事务、成熟文件格式和 STRICT 表；
- React 适合数据表格、表单和图表密集的桌面界面；
- 架构仍保留 Windows 构建路径。

## 后果

正面：

- 默认离线、维护成本低；
- 没有网络服务成为第二攻击面；
- 领域逻辑可以脱离 UI 和数据库测试；
- 数据查询与窗口运行在同一设备，延迟低。

代价：

- Rust 和各平台 WebView 增加工程技能要求；
- 同步、协作和移动端未来需要新的架构决策；
- SQLCipher、签名和 Windows 安装必须做真实平台验证；
- 数据库迁移和崩溃恢复必须正确处理 WAL。

## 被拒绝的方案

- 云端 Web + PostgreSQL：MVP 不需要账户和同步，复杂度与风险不成比例。
- Electron：当前优先减少捆绑运行时并使用 Rust 安全边界；若 Tauri 平台验证失败再重审。
- React 直接使用 SQL 插件：权限过宽，容易绕过或复制领域规则。
- 原生 SwiftUI：macOS 体验优秀，但会显著提高后续 Windows 重写成本。

## 发布门禁

本决策不把“可构建”当成“可发布”。公开发布前必须分别证明：

- macOS 签名与公证；
- Windows 构建与安装；
- 数据库静态加密；
- 数据库迁移与崩溃恢复；
- 最小 capabilities 与 CSP。

## 参考

- [Tauri 2](https://v2.tauri.app/start/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [SQLite STRICT Tables](https://www.sqlite.org/stricttables.html)
- [SQLite WAL](https://www.sqlite.org/fileformat.html#the_write_ahead_log)
