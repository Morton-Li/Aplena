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
    };
    return descriptions[value.error_code] ?? `本地服务返回错误（${value.error_code}）`;
  }
  if (value instanceof Error && value.message) {
    return value.message;
  }
  return "暂时无法连接本地领域服务";
}
