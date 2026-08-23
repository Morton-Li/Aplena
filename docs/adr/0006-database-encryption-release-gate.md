# ADR 0006：数据库静态加密作为公开发布门禁

- 状态：Proposed / Public-release blocker
- 日期：2026-08-23

## 背景

Aplena 保存高敏感度的个人财务计划。操作系统磁盘加密可以降低设备丢失风险，但不能替代
应用数据库的静态加密。目标方案不能自创密码学、把密钥硬编码在程序或配置中，也不能让
密钥进入日志、备份清单或 CSV。

## 候选设计

- 数据层采用 SQLCipher，对 SQLite 主文件、journal 和 WAL 页面进行透明加密，并保留当前
  SQLx Repository、迁移和事务边界。
- 每个账本使用随机 256 位原始密钥；不使用用户可猜测口令作为默认数据库密钥。
- macOS 通过 Keychain Services 保存密钥，并限制到 Aplena 的 bundle identifier、签名身份
  和合适的可访问性等级。
- Windows 通过 Credential Manager / DPAPI 保护同一语义的密钥材料，并绑定当前用户。
- 密钥必须在任何 schema 查询前注入每个数据库连接；错误密钥必须稳定失败，不能回退为
  明文数据库或创建新库。
- 加密备份需另行设计跨设备恢复密钥或用户口令包装方案；不能把系统秘密存储中的设备密钥
  直接写入 `.aplena`。

## 当前可行性结论

当前工程使用 SQLx 0.9 的 `sqlite-bundled`，它静态链接普通 SQLite。接入 SQLCipher 需要
替换/配置底层 SQLite 链接、固定 `libsqlite3-sys` 兼容版本，并验证 Tauri 在 macOS 和
Windows 的实际打包产物。Keychain 和 Credential Manager 也必须在真实签名身份与真实
Windows 用户会话中测试。

本阶段没有满足以下证据，因此不实现半成品加密，也不把 UI 标记为“已加密”：

1. macOS 与 Windows 均能创建、关闭、重新打开加密数据库；
2. 错误密钥、缺失密钥和被替换密钥都 fail closed；
3. WAL、迁移、备份、恢复、崩溃中断和损坏检测全部在加密数据库上通过；
4. 发布包确认链接 SQLCipher 而不是系统或普通 bundled SQLite；
5. 签名后 Keychain ACL 和 Windows Credential Manager 行为有真实机器证据；
6. 日志、崩溃报告、进程参数、环境变量、备份和 CSV 均无密钥。

## 决策

- SQLCipher + macOS Keychain + Windows Credential Manager 保留为首选方向。
- 当前只允许生成明确标注“未加密”的本地 macOS 候选版；不得公开分发。
- 数据保护 UI 必须提示数据库、`.aplena` 与 CSV 尚未加密。
- 在上述跨平台证据全部通过前，公开发布、签名公证发布和 Windows 正式安装包保持阻塞。
- 不引入自定义加密格式、硬编码密钥、日志密钥或“加密开关”占位 UI。

## 后续验证分支

单独使用 `spike/sqlcipher-cross-platform`，不得直接改变现有用户数据库。验证先使用隔离测试
标识和临时数据目录，冻结 SQLCipher/SQLx/`libsqlite3-sys` 版本，再形成迁移与回滚 ADR。
