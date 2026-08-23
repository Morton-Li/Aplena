import type { AppError } from "../api/domain";

function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AppError>;
  return typeof candidate.error_code === "string" && typeof candidate.message_key === "string";
}
export function describeError(value: unknown): string {
  if (isAppError(value)) {
    const currency = value.params?.currency;
    const descriptions: Record<string, string> = {
      BASE_CURRENCY_LOCKED: "已有月度数据，本位币已锁定。",
      DUPLICATE_PLAN_ITEM_NAME: "已有同名长期计划，请使用不同名称。",
      MISSING_EXCHANGE_RATE: currency ? `缺少 ${currency} 汇率，请先到设置中补充。` : "缺少必要汇率。",
      MONTH_INITIALIZATION_CONFIRMATION_REQUIRED: "该月份需要明确确认后才能初始化。",
      RECORD_IS_REFERENCED: "该汇率仍被设置、计划或历史快照引用，不能删除。",
      SETUP_REQUIRED: "请先完成首次设置。",
      BACKUP_INVALID: "所选文件不是有效的 Aplena 备份，或归档结构不安全。",
      BACKUP_VERSION_TOO_NEW: "该备份由更高版本的 Aplena 创建，当前版本不能安全恢复。",
      BACKUP_CHECKSUM_MISMATCH: "备份内容与校验清单不一致，文件可能已损坏或被修改。",
      BACKUP_INTEGRITY_FAILED: "备份数据库未通过 SQLite 完整性检查。",
      BACKUP_DOMAIN_VALIDATION_FAILED: "备份数据不符合 Aplena 的领域约束。",
      BACKUP_SIZE_LIMIT_EXCEEDED: "备份文件或解压内容超过安全大小限制。",
      BACKUP_MIGRATION_FAILED: "备份无法在临时副本中安全升级到当前数据库版本。",
      BACKUP_CHANGED_AFTER_INSPECTION: "备份在检查后发生变化，请重新选择并检查。",
      RESTORE_CONFIRMATION_REQUIRED: "请完成勾选并输入“恢复”后再继续。",
      RESTORE_TOKEN_EXPIRED: "恢复检查已过期，请重新选择并检查备份。",
      RESTORE_ROLLBACK_FAILED: "恢复失败，且数据库连接未能自动重开；请保留恢复点并重新启动 Aplena。",
      EXPORT_DESTINATION_EXISTS: "目标文件已存在；为避免覆盖，请选择新的名称或位置。",
      INVALID_SELECTED_PATH: "系统没有返回可用的本地文件路径。",
      DATABASE_CHECKPOINT_FAILED: "无法安全收拢数据库写前日志，当前数据未被替换。",
      DATABASE_STORAGE_PERMISSIONS_FAILED: "无法安全设置本地数据库权限；Aplena 已停止打开数据。",
      DATA_PROTECTION_OPERATION_FAILED: "数据保护操作失败；当前数据库未被替换。",
    };
    return descriptions[value.error_code] ?? `本地服务返回错误（${value.error_code}）`;
  }
  if (value instanceof Error && value.message) {
    return value.message;
  }
  return "暂时无法连接本地领域服务";
}
