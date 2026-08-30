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
      DUPLICATE_PLAN_ITEM_NAME: "已有同名周期规则，请使用不同名称。",
      MISSING_EXCHANGE_RATE: currency ? `缺少 ${currency} 汇率，请先到设置中补充。` : "缺少必要汇率。",
      INVALID_REFERENCE_RATE: "欧洲央行返回了无法识别的参考汇率。",
      REFERENCE_RATES_EMPTY: "欧洲央行未返回可用的每日参考汇率。",
      REFERENCE_BASE_UNAVAILABLE: "欧洲央行未覆盖当前本位币，请保留或使用备用手动汇率。",
      REFERENCE_BASE_STALE: "本位币参考日期与最新观察日期不一致，本次更新未写入。",
      REFERENCE_CURRENCY_UNAVAILABLE: "欧洲央行未覆盖所选币种，请使用备用手动汇率。",
      REFERENCE_CURRENCY_STALE: "所选币种参考日期与最新观察日期不一致，本次更新未写入。",
      INVALID_EXCHANGE_RATE_SOURCE: "汇率来源无效，本次费用未保存。",
      MONTH_INITIALIZATION_CONFIRMATION_REQUIRED: "该月份需要明确确认后才能初始化。",
      RECORD_IS_REFERENCED: "该汇率仍被设置、计划或历史快照引用，不能删除。",
      SETUP_REQUIRED: "请先完成首次设置。",
      DATABASE_STORAGE_PERMISSIONS_FAILED: "无法安全设置本地数据库权限；Aplena 已停止打开数据。",
    };
    return descriptions[value.error_code] ?? `本地服务返回错误（${value.error_code}）`;
  }
  if (value instanceof Error && value.message) {
    return value.message;
  }
  return "暂时无法连接本地领域服务";
}
