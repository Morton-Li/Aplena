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
    return `领域服务返回错误（${value.error_code}）`;
  }
  if (value instanceof Error && value.message) {
    return value.message;
  }
  return "暂时无法连接本地领域服务";
}
