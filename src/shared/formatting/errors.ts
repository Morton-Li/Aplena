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
