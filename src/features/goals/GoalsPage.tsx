import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import {
  getBudgetProjection,
  listPlanItems,
  queryKeys,
  type BudgetProjection,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { ChartDataFlip } from "../../shared/components/ChartDataFlip";
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

export function GoalsPage() {
  const projectionQuery = useQuery({
    queryKey: queryKeys.budgetProjection,
    queryFn: () => getBudgetProjection(),
  });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });

  if (projectionQuery.isPending || plansQuery.isPending) {
    return <GoalLoading />;
  }
  if (projectionQuery.isError || plansQuery.isError) {
    const error = projectionQuery.error ?? plansQuery.error;
    const reviewLoanPlan = typeof error === "object" && error !== null && "error_code" in error && error.error_code === "LOAN_PLAN_REVIEW_REQUIRED";
    return <section className="state-card state-card-error"><span role="alert">{describeError(error)}</span>{reviewLoanPlan && <Link className="button button-secondary" to="/loans">核对借贷计划</Link>}</section>;
  }

  const projection = projectionQuery.data;
  const hasRules = plansQuery.data.length > 0;
  const hasBudget = hasRules || (decimalValue(projection.special_expenses ?? "0") ?? 0) > 0
    || (decimalValue(projection.loan_interest_expenses ?? "0") ?? 0) > 0
    || (decimalValue(projection.loan_interest_income ?? "0") ?? 0) > 0;

  return (
    <>
      <header className="page-header compact-header goal-page-header">
        <div>
          <p className="eyebrow">下月规划</p>
          <h1>配置预算</h1>
          <p>汇总周期规则与专项在 {monthLabel(projection.target_month)} 的预计收支与储蓄结果。</p>
        </div>
        <div className="goal-month-badge"><span>预算期间</span><strong>{projection.target_month}</strong><small>由系统自动推进</small></div>
      </header>

      <div className="goal-overview-grid">
        <BudgetProjectionSummary projection={projection} hasRules={hasBudget} />
        <ExpenseCategorySummary projection={projection} hasRules={hasBudget} />
      </div>
      {projection.projected_cash_net !== undefined && <section className="report-card loan-month-card" aria-label="下月借贷预算">
        <div className="special-section-heading"><h2>下月借贷安排</h2><Link className="text-button" to="/loans">管理借贷计划</Link></div>
        <div className="loan-metrics">
          <ProjectionMetric label="待还本金" value={formatMoney(projection.loan_principal_due ?? "0.00", projection.base_currency)} detail="本金独立列示" />
          <ProjectionMetric label="待收本金" value={formatMoney(projection.loan_principal_receivable ?? "0.00", projection.base_currency)} detail="约定回款，尚未到账" />
          <ProjectionMetric label="预计利息及费用支出" value={formatMoney(projection.loan_interest_expenses ?? "0.00", projection.base_currency)} detail="已包含在上方预计支出" />
          <ProjectionMetric label="预计利息及费用收入" value={formatMoney(projection.loan_interest_income ?? "0.00", projection.base_currency)} detail="已包含在上方预计收入" />
          <ProjectionMetric label="含借贷的预计现金净结余" value={formatMoney(projection.projected_cash_net, projection.base_currency)} detail="预计储蓄减待还本金加待收本金" />
        </div>
        <p className="chart-note">按下月实际到期的各期剩余金额汇总，季度或年度还款不均摊。已有同一借贷的周期规则时，请调整该规则，避免重复安排预算。</p>
      </section>}

      <BudgetSourcesSummary projection={projection} />
      <RecurringRulesPanel targetMonth={projection.target_month} />
    </>
  );
}

function BudgetSourcesSummary({ projection }: { projection: BudgetProjection }) {
  return <section className="report-card goal-budget-sources" aria-label="下月支出预算来源">
    <header>
      <div><p className="section-label">Budget Sources</p><h2>下月支出预算来源</h2></div>
      <Link className="button button-secondary" to="/specials">管理专项</Link>
    </header>
    <div className="goal-budget-source-grid">
      <ProjectionMetric label="周期规则月度预算" value={formatMoney(projection.recurring_expenses ?? projection.projected_expenses, projection.base_currency)} detail="按周期规则的月均等价金额汇总" />
      <ProjectionMetric label="专项月分配" value={formatMoney(projection.special_expenses ?? "0", projection.base_currency)} detail="直接计入该月分配金额" />
      <ProjectionMetric label="借贷利息及费用" value={formatMoney(projection.loan_interest_expenses ?? "0", projection.base_currency)} detail="按下月到期期次计入" />
      <ProjectionMetric label="预计支出合计" value={formatMoney(projection.projected_expenses, projection.base_currency)} detail="周期预算、专项分配与借贷利息费用合计" />
    </div>
    <p className="chart-note">专项总预算用于项目管理；下月测算只计入 {projection.target_month} 的月分配。</p>
  </section>;
}

interface BudgetCategorySlice {
  code: string;
  label: string;
  chartLabel: string;
  amount: string;
  value: number;
  color: string;
}

function BudgetProjectionSummary({
  projection,
  hasRules,
}: {
  projection: BudgetProjection;
  hasRules: boolean;
}) {
  const option = useMemo(() => budgetProjectionOption(projection), [projection]);
  const savings = decimalValue(projection.projected_savings) ?? 0;

  return (
    <section className="report-card goal-projection-card">
      <header>
        <div><p className="section-label">Budget Outlook</p><h2>下月预算概览</h2></div>
        <span className="report-context">{monthLabel(projection.target_month)} · {projection.base_currency}</span>
      </header>
      {hasRules ? (
        <ChartDataFlip
          height={344}
          dataLabel={`${projection.target_month}预算测算明细`}
          front={(
            <>
              <div className="goal-projection-metrics">
                <ProjectionMetric label="预计收入" value={formatMoney(projection.projected_income, projection.base_currency)} detail="固定与浮动收入" />
                <ProjectionMetric label="预计支出" value={formatMoney(projection.projected_expenses, projection.base_currency)} detail="三类支出合计" />
                <ProjectionMetric label={savings < 0 ? "预计缺口" : "预计储蓄"} value={formatMoney(projection.projected_savings, projection.base_currency)} detail="收入减去支出" tone={savings < 0 ? "negative" : "positive"} />
                <ProjectionMetric label="预计储蓄率" value={formatPercent(projection.projected_savings_rate_percent)} detail={projection.projected_savings_rate_percent === null ? "预计收入为零" : "预计储蓄 ÷ 预计收入"} tone={savings < 0 ? "negative" : "positive"} />
              </div>
              <AnalyticsChart option={option} label={`${projection.target_month}预计收入、支出与储蓄柱状图`} height={202} />
            </>
          )}
          back={<BudgetProjectionDataTable projection={projection} />}
        />
      ) : (
        <div className="chart-empty goal-chart-empty"><p>添加周期规则或专项月分配后，这里会汇总下月预计收入、支出与储蓄。</p></div>
      )}
    </section>
  );
}

function ProjectionMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return <div className={`projection-metric projection-metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function BudgetProjectionDataTable({ projection }: { projection: BudgetProjection }) {
  const rows = [
    ["稳定收入", formatMoney(projection.stable_income, projection.base_currency)],
    ["浮动收入", formatMoney(projection.variable_income, projection.base_currency)],
    ["预计收入", formatMoney(projection.projected_income, projection.base_currency)],
    ["必要支出", formatMoney(projection.essential_expenses, projection.base_currency)],
    ["固定承诺支出", formatMoney(projection.fixed_commitments, projection.base_currency)],
    ["自主性预算", formatMoney(projection.discretionary_budget, projection.base_currency)],
    ["周期规则月度预算", formatMoney(projection.recurring_expenses ?? projection.projected_expenses, projection.base_currency)],
    ["专项月分配", formatMoney(projection.special_expenses ?? "0", projection.base_currency)],
    ["预计支出", formatMoney(projection.projected_expenses, projection.base_currency)],
    ["预计储蓄", formatMoney(projection.projected_savings, projection.base_currency)],
    ["预计储蓄率", formatPercent(projection.projected_savings_rate_percent)],
    ["固定承诺占稳定收入", formatPercent(projection.fixed_commitment_ratio_percent)],
    ["稳定收入覆盖倍数", projection.stable_income_coverage_ratio === null ? "—" : `${projection.stable_income_coverage_ratio} 倍`],
  ];
  return (
    <table className="data-table">
      <caption className="sr-only">{projection.target_month}预算测算明细</caption>
      <tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody>
    </table>
  );
}

function ExpenseCategorySummary({
  projection,
  hasRules,
}: {
  projection: BudgetProjection;
  hasRules: boolean;
}) {
  const slices = useMemo(() => expenseCategorySlices(projection), [projection]);
  const option = useMemo(
    () => expenseCategoryOption(slices, projection.base_currency),
    [projection.base_currency, slices],
  );

  return (
    <section className="report-card goal-category-card">
      <header>
        <div><p className="section-label">Expense Mix</p><h2>支出类型占比</h2></div>
        <span className="report-context">下月计入金额</span>
      </header>
      {slices.length > 0 ? (
        <ChartDataFlip
          height={344}
          dataLabel={`${projection.target_month}支出类型占比明细`}
          front={(
            <>
              <PieAnalyticsChart option={option} label={`${projection.target_month}支出类型金额占比饼图`} height={292} />
              <p className="chart-note">仅比较必要支出、固定承诺支出与自主性预算，不混合收入。</p>
            </>
          )}
          back={<ExpenseCategoryDataTable slices={slices} currency={projection.base_currency} />}
        />
      ) : (
        <div className="chart-empty goal-category-empty">
          <p>{hasRules ? "现有预算在下月没有可计入的支出金额。" : "添加支出周期规则或专项月分配后，这里会展示类型占比。"}</p>
        </div>
      )}
    </section>
  );
}

function ExpenseCategoryDataTable({ slices, currency }: { slices: BudgetCategorySlice[]; currency: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <table className="data-table">
      <caption className="sr-only">支出类型占比明细</caption>
      <thead><tr><th>支出类型</th><th>下月计入金额</th><th>占比</th></tr></thead>
      <tbody>{slices.map((slice) => (
        <tr key={slice.code}>
          <th>{slice.label}</th>
          <td>{formatMoney(slice.amount, currency)}</td>
          <td>{formatPercent(((slice.value / total) * 100).toFixed(2))}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function expenseCategorySlices(projection: BudgetProjection): BudgetCategorySlice[] {
  const categories = [
    { code: "ESSENTIAL_EXPENSE", chartLabel: "必要支出", amount: projection.essential_expenses, color: "#64748b" },
    { code: "FIXED_COMMITMENT_EXPENSE", chartLabel: "固定承诺", amount: projection.fixed_commitments, color: "#4f46e5" },
    { code: "DISCRETIONARY_BUDGET", chartLabel: "自主预算", amount: projection.discretionary_budget, color: "#a78bfa" },
  ];

  return categories.flatMap((category) => {
    const value = decimalValue(category.amount) ?? 0;
    return value > 0 ? [{ ...category, label: categoryLabel(category.code), value }] : [];
  });
}

function expenseCategoryOption(slices: BudgetCategorySlice[], currency: string) {
  return {
    tooltip: {
      trigger: "item",
      valueFormatter: (value: number | string) => formatMoney(String(value ?? 0), currency),
    },
    legend: {
      type: "scroll",
      bottom: 0,
      left: "center",
      textStyle: { color: "#64748b", fontSize: 11 },
    },
    series: [{
      name: "支出类型",
      type: "pie",
      radius: ["42%", "70%"],
      center: ["50%", "45%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 4 },
      label: {
        position: "inside",
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 700,
        formatter: "{d}%",
      },
      labelLine: { show: false },
      data: slices.map((slice) => ({
        name: slice.chartLabel,
        value: slice.value,
        itemStyle: { color: slice.color },
      })),
    }],
  };
}

function budgetProjectionOption(projection: BudgetProjection) {
  const values = [projection.projected_income, projection.projected_expenses, projection.projected_savings]
    .map((value) => decimalValue(value) ?? 0);
  const chartText = { color: "#64748b", fontSize: 11 };
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value ?? 0), projection.base_currency) },
    grid: { left: 72, right: 16, top: 22, bottom: 34 },
    xAxis: { type: "category", data: ["预计收入", "预计支出", "预计储蓄"], axisLabel: chartText, axisLine: { lineStyle: { color: "#d8dee8" } } },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, projection.base_currency) }, splitLine: { lineStyle: { color: "#e8edf3" } } },
    series: [{
      name: "金额",
      type: "bar",
      barMaxWidth: 42,
      data: values,
      itemStyle: {
        color: (params: { dataIndex: number; value: number }) => params.dataIndex === 0 ? "#2563eb" : params.dataIndex === 1 ? "#94a3b8" : params.value < 0 ? "#dc2626" : "#4f46e5",
        borderRadius: [3, 3, 0, 0],
      },
    }],
  };
}

function GoalLoading() {
  return <><header className="page-header compact-header"><div><p className="eyebrow">下月规划</p><h1>配置预算</h1></div></header><section className="dashboard-loading" aria-label="正在加载配置预算页面"><div className="workspace-skeleton workspace-skeleton-wide" /><div className="workspace-skeleton-grid"><div className="workspace-skeleton" /><div className="workspace-skeleton" /></div></section></>;
}
