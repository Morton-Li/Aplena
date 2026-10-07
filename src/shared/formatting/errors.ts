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
      BASE_CURRENCY_LOCKED: "已有月度数据或专项预算，本位币已锁定。",
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
      EMPTY_SPECIAL_PROJECT_NAME: "请输入专项名称。",
      SPECIAL_ALLOCATION_REPARENT_FORBIDDEN: "月分配不能改挂到其他专项。",
      HISTORICAL_SPECIAL_ALLOCATION_FORBIDDEN: "不能为历史月份新增预算分配；可以补录实际支出或退款。",
      SPECIAL_ALLOCATION_ALREADY_EXISTS: "该专项在所选月份和分类已有分配，请编辑现有分配。",
      SPECIAL_BUDGET_EXCEEDED_BY_ALLOCATIONS: "月分配合计超过专项总预算，请调整分配或总预算。",
      SPECIAL_PROJECT_ARCHIVED: "专项已归档；恢复后才能调整月分配。",
      SPECIAL_EXPENSE_CATEGORY_REQUIRED: "专项只能选择现有的三类支出。",
      SPECIAL_ALLOCATION_FROZEN: "该月分配已形成快照，不能调整或删除。",
      SPECIAL_ALLOCATION_MISMATCH: "月度快照与专项分配不一致，本次操作未保存。",
      BASE_CURRENCY_MISMATCH: "记录币种与账本本位币不一致，本次操作未保存。",
      NOT_FOUND: "记录已不存在，请刷新后重试。",
      DATABASE_OPERATION_FAILED: "本地数据操作未完成，请重试。",
      DATABASE_CONSTRAINT_FAILED: "本次操作不符合记录约束，未保存。",
      AUTOMATIC_FIRST_DATE_REQUIRED: "请明确这项规则的首次自动支付日期。",
      AUTOMATIC_FIRST_DATE_OUTSIDE_RULE: "首次自动支付日期必须在规则有效日期内。",
      AUTOMATIC_POLICY_VERSION_MISSING: "缺少可用的自动规则版本，请重新保存自动设置。",
      AUTOMATIC_POLICY_VERSION_FROZEN: "已经生效的自动规则保持冻结，请配置下月规则。",
      INVALID_AUTOMATIC_CONFLICT_ACTION: "请选择关联、跳过或另建一笔。",
      AUTOMATIC_ACTUAL_ENTRY_REQUIRED: "请先选择要关联的已有实际记录。",
      AUTOMATIC_LINK_ENTRY_MISMATCH: "所选记录不属于该规则的同月用户实际，不能关联。",
      AUTOMATIC_ENTRY_ALREADY_LINKED: "该实际已关联其他自动记录，请选择另一条。",
      AUTOMATIC_OCCURRENCE_ALREADY_RESOLVED: "该自动记录已处理，请刷新后查看结果。",
      AUTOMATIC_OCCURRENCE_NOT_DUE: "这次自动记录尚未到期，不能提前处理。",
      AUTOMATIC_RULE_SNAPSHOT_MISMATCH: "本月冻结分类与自动规则不同，不能另建自动实际。请跳过本次，再在合适类目中手动记录。",
      AUTOMATIC_MANUAL_ENTRY_CONFLICT: "该类目已有手动实际，请明确关联、跳过或另建一笔。",
      AUTOMATIC_EXCHANGE_RATE_DATE_REQUIRED: "自动入账需要带观察日期的有效汇率，请先补充汇率。",
      AUTOMATIC_EXCHANGE_RATE_DATE_IN_FUTURE: "汇率观察日晚于当前日期，请先修正汇率。",
      ZERO_ACTUAL_ENTRY_AMOUNT: "实际金额必须大于零，零预算不会生成实际条目。",
      RECORD_IS_REFERENCED: "该汇率仍被设置、计划或历史快照引用，不能删除。",
      SETUP_REQUIRED: "请先完成首次设置。",
      DATABASE_STORAGE_PERMISSIONS_FAILED: "无法安全设置本地数据库权限；Aplena 已停止打开数据。",
      UPDATE_OPERATION_IN_PROGRESS: "已有软件更新操作正在进行，请稍候。",
      UPDATE_PREFERENCES_FAILED: "无法保存软件更新偏好，请重试。",
      UPDATE_CHECK_FAILED: "无法检查软件更新，请确认网络可用后重试。",
      UPDATE_CHECK_TIMEOUT: "检查软件更新超时；Aplena 可继续离线使用，请稍后重试。",
      UPDATE_CHECK_NETWORK_FAILED: "无法连接更新服务；Aplena 可继续离线使用，请稍后重试。",
      UPDATE_MANIFEST_INVALID: "更新服务返回了无效的版本清单；Aplena 未下载或安装任何内容。",
      UPDATE_ARCHITECTURE_UNSUPPORTED: "此更新没有适用于当前 Mac 架构的安装包。",
      UPDATE_CONFIGURATION_INVALID: "软件更新配置无效；Aplena 未下载或安装任何内容。",
      UPDATE_SIGNATURE_INVALID: "更新包未通过独立更新签名验证；现有应用未被修改。",
      UPDATE_DOWNLOAD_TIMEOUT: "下载更新超时；现有应用未被修改，请稍后重试。",
      UPDATE_DOWNLOAD_FAILED: "更新包下载失败；现有应用未被修改，请稍后重试。",
      UPDATE_DOWNLOAD_CANCELLED: "更新下载已取消；现有应用未被修改。",
      UPDATE_SIGNING_KEY_NOT_CONFIGURED: "当前构建未配置可信的更新签名公钥，不能安装更新。",
      UPDATE_INSTALL_FAILED: "更新安装失败；现有应用仍保留在原位置，请重新检查后重试。",
      UPDATE_NOT_READY_TO_RESTART: "更新尚未完成安装，暂时不能重启到新版本。",
    };
    return descriptions[value.error_code] ?? `本地服务返回错误（${value.error_code}）`;
  }
  if (value instanceof Error && value.message) {
    return value.message;
  }
  return "暂时无法连接本地领域服务";
}
