export const categoryLabels: Record<string, string> = {
  FIXED_INCOME: "固定收入",
  VARIABLE_INCOME: "浮动收入",
  ESSENTIAL_EXPENSE: "必要支出",
  FIXED_COMMITMENT_EXPENSE: "固定承诺支出",
  DISCRETIONARY_BUDGET: "自主性预算",
};

export const flowLabels: Record<string, string> = {
  INCOME: "收入",
  EXPENSE: "支出",
};

export const recognitionLabels: Record<string, string> = {
  AMORTIZED: "按月均摊",
  PAYMENT: "按支付月份确认",
};

export function categoryLabel(code: string) {
  return categoryLabels[code] ?? code;
}

export function flowLabel(code: string) {
  return flowLabels[code] ?? code;
}

export function recognitionLabel(code: string) {
  return recognitionLabels[code] ?? code;
}
