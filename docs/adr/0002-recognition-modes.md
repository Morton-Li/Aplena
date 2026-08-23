# ADR-0002：每个长期计划选择计入模式，承载能力统一按月均口径

- 状态：Accepted
- 日期：2026-08-23

## 背景

年度保险、订阅或奖金既可以按月均负担理解，也可以按真实支付月份理解。只支持均摊会
隐藏现金支付峰值，只支持支付月则会低估非支付月份的长期承诺。

## 决策

每个 PlanItem 必须选择一种 `recognition_mode`：

- `AMORTIZED`：有效区间内每月按原币金额乘汇率再除周期计入；
- `PAYMENT`：从 `start_month` 锚定，仅在整周期月份按原币金额乘汇率计入。

`start_month` 在 AMORTIZED 模式表示首次均摊月份，在 PAYMENT 模式表示首次支付月份。
`end_month` 均为包含边界。

月度执行、Dashboard 和历史遵循项目选择的模式。MonthlyItem 复制生成时的模式，后续修改
不改变历史。

财务承载能力不遵循支付峰值，而对所有有效 PlanItem 统一计算：

```text
monthly_equivalent = amount × rate ÷ period_months
```

因此支付模式解决现金节奏，月均转换解决长期承载，两种视角不会互相替代。

## 支付月份规则

```text
effective = start_month <= month
            AND (end_month IS NULL OR month <= end_month)

PAYMENT due = effective
              AND months_between(start_month, month) % period_months = 0
```

非支付月份不创建零值 MonthlyItem。一次性项目使用 PAYMENT，开始和结束月份相同，周期为 1。

## 实际金额语义

- AMORTIZED：实际金额是同口径的月度归一化负担；
- PAYMENT：实际金额是支付月份真实发生的现金额；
- 两者都允许 NULL 表示未录，0 表示已确认没有实际金额。

UI 必须在计划表单、月度行和帮助文本中持续说明口径。

## 后果

正面：

- 用户可以选择关注平滑负担或现金支付时间；
- 年付承诺不会从财务承载能力中消失；
- 历史月度执行保留创建时的口径。

代价：

- 混合模式的 Dashboard 是用户选择的混合计入口径，需要清楚标注；
- AMORTIZED 实际不是银行现金流，需要额外引导；
- 模式切换只能影响未来，不能作为历史同步操作。

## 被拒绝的方案

- 全部强制均摊：无法表达真实支付峰值。
- 全部强制支付月：无法稳定衡量长期月度承载。
- 同一项目同时生成两套 MonthlyItem：会产生双重事实和更复杂的实际维护。
- 为现金流与承载分别建立持久化统计表：派生数据容易漂移。

## 验证

性质测试必须覆盖月付、季度、半年、年付、跨年、结束边界和一次性项目，并证明 PAYMENT
模式只改变月度生成，不改变月均承载公式。
