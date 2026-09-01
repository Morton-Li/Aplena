import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  getFinancialCapacity,
  getNextMonthGoal,
  listPlanItems,
  queryKeys,
  saveNextMonthGoal,
  type FinancialCapacity,
  type NextMonthGoal,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { PieAnalyticsChart } from "../../shared/components/PieAnalyticsChart";
import { describeError } from "../../shared/formatting/errors";
import {
  compactMoney,
  decimalValue,
  formatMoney,
  formatPercent,
  monthLabel,
} from "../../shared/formatting/finance";
import { categoryLabel } from "../../shared/formatting/labels";
import { RecurringRulesPanel } from "./RecurringRulesPanel";

const goalSchema = z.object({
  savingsRatePercent: z.number().min(0, "目标不能低于 0%").max(100, "目标不能高于 100%"),
});

type GoalValues = z.infer<typeof goalSchema>;

export function GoalsPage() {
  const goalQuery = useQuery({ queryKey: queryKeys.nextMonthGoal, queryFn: () => getNextMonthGoal() });
  const capacityQuery = useQuery({ queryKey: queryKeys.capacity, queryFn: () => getFinancialCapacity() });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });

  if (goalQuery.isPending || capacityQuery.isPending || plansQuery.isPending) {
    return <GoalLoading />;
  }
  if (goalQuery.isError || capacityQuery.isError || plansQuery.isError) {
    return <section className="state-card state-card-error"><span role="alert">{describeError(goalQuery.error ?? capacityQuery.error ?? plansQuery.error)}</span></section>;
  }

  const goal = goalQuery.data;
  const capacity = capacityQuery.data;
  const hasRules = plansQuery.data.length > 0;

  return (
    <>
      <header className="page-header compact-header goal-page-header">
        <div>
          <p className="eyebrow">下月规划</p>
          <h1>配置预算</h1>
          <p>为 {monthLabel(goal.target_month)} 设定储蓄目标并评估承载能力。</p>
        </div>
        <div className="goal-month-badge"><span>目标期间</span><strong>{goal.target_month}</strong><small>由系统自动推进</small></div>
      </header>

      <div className="goal-overview-grid">
        <GoalSettings goal={goal} />
        <CapacitySummary capacity={capacity} hasRules={hasRules} />
      </div>

      <BudgetCategorySummary capacity={capacity} hasRules={hasRules} />
      <RecurringRulesPanel targetMonth={goal.target_month} />
    </>
  );
}

interface BudgetCategorySlice {
  code: string;
  label: string;
  amount: string;
  value: number;
  color: string;
}

function BudgetCategorySummary({ capacity, hasRules }: { capacity: FinancialCapacity; hasRules: boolean }) {
  const slices = useMemo(() => budgetCategorySlices(capacity), [capacity]);
  const option = useMemo(
    () => budgetCategoryOption(slices, capacity.base_currency),
    [capacity.base_currency, slices],
  );

  return (
    <section className="report-card goal-category-card">
      <header>
        <div><p className="section-label">Budget Mix</p><h2>预算类型占比</h2></div>
        <span className="report-context">{monthLabel(capacity.target_month)} · {capacity.base_currency}</span>
      </header>
      {slices.length > 0 ? (
        <>
          <PieAnalyticsChart option={option} label={`${capacity.target_month}预算类型金额占比饼图`} height={300} />
          <p className="chart-note">按目标月份的月度等价金额和本位币汇总；图中仅展示金额大于 0 的预算类型。</p>
          <BudgetCategoryDataTable slices={slices} currency={capacity.base_currency} />
        </>
      ) : (
        <div className="chart-empty goal-category-empty">
          <p>{hasRules ? "现有周期规则在目标月份没有可计入的预算金额。" : "添加周期规则后，这里会按预算类型展示金额占比。"}</p>
        </div>
      )}
    </section>
  );
}

function BudgetCategoryDataTable({ slices, currency }: { slices: BudgetCategorySlice[]; currency: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <details className="chart-data-details">
      <summary>查看类型明细</summary>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="sr-only">预算类型占比明细</caption>
          <thead><tr><th>预算类型</th><th>月度等价金额</th><th>占比</th></tr></thead>
          <tbody>{slices.map((slice) => (
            <tr key={slice.code}>
              <th>{slice.label}</th>
              <td>{formatMoney(slice.amount, currency)}</td>
              <td>{formatPercent(((slice.value / total) * 100).toFixed(2))}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

function budgetCategorySlices(capacity: FinancialCapacity): BudgetCategorySlice[] {
  const categories = [
    { code: "FIXED_INCOME", amount: capacity.stable_income, color: "#2563eb" },
    { code: "VARIABLE_INCOME", amount: capacity.variable_income, color: "#60a5fa" },
    { code: "ESSENTIAL_EXPENSE", amount: capacity.essential_expenses, color: "#64748b" },
    { code: "FIXED_COMMITMENT_EXPENSE", amount: capacity.fixed_commitments, color: "#4f46e5" },
    { code: "DISCRETIONARY_BUDGET", amount: capacity.discretionary_budget, color: "#a78bfa" },
  ];

  return categories.flatMap((category) => {
    const value = decimalValue(category.amount) ?? 0;
    return value > 0 ? [{ ...category, label: categoryLabel(category.code), value }] : [];
  });
}

function budgetCategoryOption(slices: BudgetCategorySlice[], currency: string) {
  return {
    tooltip: {
      trigger: "item",
      valueFormatter: (value: number | string) => formatMoney(String(value), currency),
    },
    legend: {
      type: "scroll",
      bottom: 0,
      left: "center",
      textStyle: { color: "#64748b", fontSize: 11 },
    },
    series: [{
      name: "预算类型",
      type: "pie",
      radius: ["42%", "70%"],
      center: ["50%", "45%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 4 },
      label: { color: "#475569", fontSize: 11, formatter: "{b}\n{d}%" },
      labelLine: { length: 12, length2: 8 },
      data: slices.map((slice) => ({
        name: slice.label,
        value: slice.value,
        itemStyle: { color: slice.color },
      })),
    }],
  };
}

function GoalSettings({ goal }: { goal: NextMonthGoal }) {
  const queryClient = useQueryClient();
  const form = useForm<GoalValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: { savingsRatePercent: goal.minimum_savings_rate_basis_points / 100 },
  });
  const mutation = useMutation({
    mutationFn: (values: GoalValues) => saveNextMonthGoal(Math.round(values.savingsRatePercent * 100)),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.nextMonthGoal, updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.capacity });
    },
  });

  return (
    <form className="settings-card goal-settings-card" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <div><p className="section-label">Target Policy</p><h2>储蓄目标</h2></div>
      <p className="card-copy">目标只参与 {goal.target_month} 的前瞻测算，不会成为当前月或历史月的报表口径。</p>
      <label>下月目标储蓄率
        <span className="input-with-suffix">
          <input aria-label="下月目标储蓄率" type="number" min="0" max="100" step="0.01" {...form.register("savingsRatePercent", { valueAsNumber: true })} />
          <span>%</span>
        </span>
        {form.formState.errors.savingsRatePercent && <em>{form.formState.errors.savingsRatePercent.message}</em>}
      </label>
      <div className="goal-policy-note"><span>当前值</span><strong>{formatPercent(String(goal.minimum_savings_rate_basis_points / 100))}</strong><small>适用于 {monthLabel(goal.target_month)}</small></div>
      {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
      {mutation.isSuccess && <div className="inline-success" role="status">下月目标已保存，本月与历史数据未作修改。</div>}
      <button className="button button-primary" disabled={mutation.isPending} type="submit">{mutation.isPending ? "保存中…" : "保存下月目标"}</button>
    </form>
  );
}

function CapacitySummary({ capacity, hasRules }: { capacity: FinancialCapacity; hasRules: boolean }) {
  const option = useMemo(() => capacityWaterfallOption(capacity), [capacity]);
  return (
    <section className="report-card goal-capacity-card">
      <header><div><p className="section-label">Forward Capacity</p><h2>下月财务承载力</h2></div><span className="report-context">目标储蓄率 {formatPercent(capacity.minimum_savings_rate_percent)}</span></header>
      <div className="goal-capacity-metrics">
        <div><span>保留自主预算后</span><strong>{hasRules ? formatMoney(capacity.preserved_capacity, capacity.base_currency) : "—"}</strong><small>可继续承担的月度负担</small></div>
        <div><span>极限承载能力</span><strong>{hasRules ? formatMoney(capacity.maximum_capacity, capacity.base_currency) : "—"}</strong><small>不保留自主预算</small></div>
        <div><span>最低储蓄金额</span><strong>{hasRules ? formatMoney(capacity.minimum_savings_amount, capacity.base_currency) : "—"}</strong><small>按稳定收入测算</small></div>
      </div>
      {hasRules ? (
        <>
          <AnalyticsChart option={option} label={`${capacity.target_month}稳定收入分配与剩余承载力瀑布图`} height={300} />
          <CapacityDataTable capacity={capacity} />
        </>
      ) : (
        <div className="chart-empty goal-chart-empty"><p>添加周期规则后，这里会按下月收入、支出与储蓄目标计算承载力。</p></div>
      )}
    </section>
  );
}

function CapacityDataTable({ capacity }: { capacity: FinancialCapacity }) {
  const rows = [
    ["稳定收入", capacity.stable_income],
    ["浮动收入", capacity.variable_income],
    ["必要支出", capacity.essential_expenses],
    ["固定承诺", capacity.fixed_commitments],
    ["最低储蓄", capacity.minimum_savings_amount],
    ["自主预算", capacity.discretionary_budget],
    ["剩余承载能力", capacity.preserved_capacity],
  ];
  return <details className="chart-data-details"><summary>查看测算明细</summary><div className="table-scroll"><table className="data-table"><tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{formatMoney(value, capacity.base_currency)}</td></tr>)}</tbody></table></div></details>;
}

function capacityWaterfallOption(capacity: FinancialCapacity) {
  const values = [decimalValue(capacity.stable_income) ?? 0, -(decimalValue(capacity.essential_expenses) ?? 0), -(decimalValue(capacity.fixed_commitments) ?? 0), -(decimalValue(capacity.minimum_savings_amount) ?? 0), -(decimalValue(capacity.discretionary_budget) ?? 0)];
  const base: number[] = [];
  const visible: number[] = [];
  let running = 0;
  values.forEach((value, index) => {
    if (index === 0) { base.push(0); visible.push(value); running = value; return; }
    const next = Math.max(0, running + value);
    base.push(next);
    visible.push(running - next);
    running = next;
  });
  base.push(0);
  visible.push(decimalValue(capacity.preserved_capacity) ?? running);
  const chartText = { color: "#64748b", fontSize: 11 };
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), capacity.base_currency) },
    grid: { left: 72, right: 16, top: 28, bottom: 52 },
    xAxis: { type: "category", data: ["稳定收入", "必要支出", "固定承诺", "最低储蓄", "自主预算", "剩余能力"], axisLabel: { ...chartText, interval: 0, rotate: 18 }, axisLine: { lineStyle: { color: "#d8dee8" } } },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, capacity.base_currency) }, splitLine: { lineStyle: { color: "#e8edf3" } } },
    series: [
      { name: "辅助", type: "bar", stack: "capacity", silent: true, data: base, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } } },
      { name: "金额", type: "bar", stack: "capacity", barMaxWidth: 34, data: visible, itemStyle: { color: (params: { dataIndex: number }) => params.dataIndex === 0 ? "#2563eb" : params.dataIndex === 5 ? "#4f46e5" : "#94a3b8", borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

function GoalLoading() {
  return <><header className="page-header compact-header"><div><p className="eyebrow">下月规划</p><h1>配置预算</h1></div></header><section className="dashboard-loading" aria-label="正在加载配置预算页面"><div className="workspace-skeleton workspace-skeleton-wide" /><div className="workspace-skeleton-grid"><div className="workspace-skeleton" /><div className="workspace-skeleton" /></div></section></>;
}
