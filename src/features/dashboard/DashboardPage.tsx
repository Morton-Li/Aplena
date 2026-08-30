import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  getFinancialCapacity,
  getHistoryAnalytics,
  getMonthAnalytics,
  getSettings,
  queryKeys,
  type AmountComparison,
  type CategoryBreakdown,
  type FinancialCapacity,
  type MonthAnalytics,
  type ProjectBreakdown,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { EmptyState } from "../../shared/components/EmptyState";
import { describeError } from "../../shared/formatting/errors";
import {
  compactMoney,
  currencyName,
  decimalValue,
  formatMoney,
  formatPercentagePoints,
  formatPercent,
  monthLabel,
} from "../../shared/formatting/finance";
import { categoryLabel } from "../../shared/formatting/labels";

const chartText = { color: "#64748b", fontSize: 11 };
const axisLine = { lineStyle: { color: "#d8dee8" } };
const splitLine = { lineStyle: { color: "#e8edf3" } };

export function DashboardPage() {
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const month = settingsQuery.data?.target_month ?? "";
  const analyticsQuery = useQuery({
    queryKey: queryKeys.monthAnalytics(month),
    queryFn: () => getMonthAnalytics(month),
    enabled: Boolean(month),
  });
  const historyQuery = useQuery({
    queryKey: queryKeys.historyAnalytics,
    queryFn: () => getHistoryAnalytics(),
  });
  const capacityQuery = useQuery({
    queryKey: queryKeys.capacity(month),
    queryFn: () => getFinancialCapacity(month),
    enabled: Boolean(month),
  });

  if (
    settingsQuery.isPending ||
    analyticsQuery.isPending ||
    historyQuery.isPending ||
    capacityQuery.isPending
  ) {
    return <DashboardLoading />;
  }
  if (
    settingsQuery.isError ||
    analyticsQuery.isError ||
    historyQuery.isError ||
    capacityQuery.isError
  ) {
    return (
      <section className="state-card state-card-error">
        <span role="alert">
          {describeError(
            settingsQuery.error ??
              analyticsQuery.error ??
              historyQuery.error ??
              capacityQuery.error,
          )}
        </span>
      </section>
    );
  }
  if (!settingsQuery.data || !analyticsQuery.data || !capacityQuery.data) {
    return <section className="state-card">默认财务基准尚未完成初始化。</section>;
  }

  const analytics = analyticsQuery.data;
  const capacity = capacityQuery.data;
  const actualQualifier = actualStatusLabel(analytics.actual_status);

  return (
    <>
      <DashboardHeader analytics={analytics} />
      {analytics.total_item_count === 0 ? (
        <EmptyDashboard month={analytics.month} currency={analytics.currency} />
      ) : (
        <>
          <KpiGrid analytics={analytics} capacity={capacity} actualQualifier={actualQualifier} />
          <DashboardCharts
            analytics={analytics}
            capacity={capacity}
            history={historyQuery.data?.months ?? []}
          />
          <ExecutionReport analytics={analytics} actualQualifier={actualQualifier} />
          <VarianceReport analytics={analytics} />
        </>
      )}
    </>
  );
}

function DashboardHeader({ analytics }: { analytics: MonthAnalytics }) {
  return (
    <header className="page-header compact-header dashboard-header">
      <div>
        <p className="eyebrow">财务总览</p>
        <h1>{monthLabel(analytics.month)}</h1>
        <p>{currencyName(analytics.currency)} · 计划、实际与财务承载能力实时汇总</p>
      </div>
      <div className={`data-status status-${analytics.actual_status.toLowerCase()}`}>
        <span className="data-status-indicator" aria-hidden="true" />
        <div>
          <span>实际数据完成度</span>
          <strong>{formatPercent(analytics.completeness_percent)}</strong>
          <small>
            {analytics.recorded_item_count}/{analytics.total_item_count} 项 · {actualStatusLabel(analytics.actual_status)}
          </small>
        </div>
      </div>
    </header>
  );
}

function EmptyDashboard({ month, currency }: { month: string; currency: string }) {
  return (
    <div className="dashboard-empty-workspace">
      <section className="empty-ledger-header" aria-label="当前财务上下文">
        <div><span>期间</span><strong>{monthLabel(month)}</strong></div>
        <div><span>本位币</span><strong>{currencyName(currency)}</strong></div>
        <div><span>报表状态</span><strong>等待计划数据</strong></div>
      </section>
      <EmptyState
        eyebrow="财务报表尚未建立"
        title="添加首个长期计划后，报表与图表会自动生成"
        description="Aplena 不会用缺失数据伪造 0.00。收入、支出、净结余、分类结构与承载能力将在计划进入当前月份后开始汇总。"
        action={
          <div className="empty-actions">
            <Link className="button button-primary" to="/plans">添加长期计划</Link>
            <Link className="button button-secondary" to="/monthly">查看月度执行</Link>
          </div>
        }
      />
    </div>
  );
}

function KpiGrid({
  analytics,
  capacity,
  actualQualifier,
}: {
  analytics: MonthAnalytics;
  capacity: FinancialCapacity;
  actualQualifier: string;
}) {
  return (
    <section className="kpi-grid" aria-label="核心财务指标">
      <KpiCard
        className="kpi-card-primary"
        label="本月净结余"
        value={formatMoney(analytics.net_balance.actual_to_date, analytics.currency)}
        supporting={`计划 ${formatMoney(analytics.net_balance.planned, analytics.currency)}`}
        detail={comparisonDetail(analytics.net_balance, analytics.currency, actualQualifier)}
        effect={analytics.net_balance.variance_effect}
      />
      <KpiCard
        label="总收入"
        value={formatMoney(analytics.income.actual_to_date, analytics.currency)}
        supporting={`计划 ${formatMoney(analytics.income.planned, analytics.currency)}`}
        detail={completionDetail(analytics.income, actualQualifier)}
        effect={analytics.income.variance_effect}
      />
      <KpiCard
        label="总支出"
        value={formatMoney(analytics.expense.actual_to_date, analytics.currency)}
        supporting={`计划 ${formatMoney(analytics.expense.planned, analytics.currency)}`}
        detail={comparisonDetail(analytics.expense, analytics.currency, actualQualifier)}
        effect={analytics.expense.variance_effect}
      />
      <KpiCard
        label="储蓄率"
        value={formatPercent(analytics.actual_savings_rate_percent)}
        supporting={`计划 ${formatPercent(analytics.planned_savings_rate_percent)} · 目标 ${analytics.minimum_savings_rate_percent}%`}
        detail={
          analytics.savings_rate_target_completion_percent
            ? `目标完成 ${analytics.savings_rate_target_completion_percent}%`
            : `${actualQualifier}尚不可计算`
        }
      />
      <KpiCard
        label="可承载长期支出"
        value={formatMoney(capacity.preserved_capacity, capacity.base_currency)}
        supporting="保留当前自主预算"
        detail={`极限 ${formatMoney(capacity.maximum_capacity, capacity.base_currency)}`}
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  supporting,
  detail,
  effect = "UNKNOWN",
  className = "",
}: {
  label: string;
  value: string;
  supporting: string;
  detail: string;
  effect?: AmountComparison["variance_effect"];
  className?: string;
}) {
  return (
    <article className={`kpi-card ${className} effect-${effect.toLowerCase()}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{supporting}</small>
      <p>{detail}</p>
    </article>
  );
}

function DashboardCharts({
  analytics,
  capacity,
  history,
}: {
  analytics: MonthAnalytics;
  capacity: FinancialCapacity;
  history: MonthAnalytics[];
}) {
  const recentHistory = useMemo(() => history.slice(-8), [history]);
  const trendOption = useMemo(
    () => financialTrendOption(recentHistory, analytics.currency),
    [analytics.currency, recentHistory],
  );
  const comparisonOption = useMemo(() => planActualOption(analytics), [analytics]);
  const expenses = useMemo(
    () =>
      analytics.categories.filter(
        (category) =>
          category.flow_type === "EXPENSE" &&
          ((decimalValue(category.planned_amount) ?? 0) !== 0 || category.actual_to_date !== null),
      ),
    [analytics.categories],
  );
  const expenseOption = useMemo(
    () => expenseStructureOption(expenses, analytics.currency),
    [analytics.currency, expenses],
  );
  const capacityOption = useMemo(() => capacityWaterfallOption(capacity), [capacity]);

  return (
    <section className="dashboard-chart-section" aria-label="财务图表">
      <div className="dashboard-chart-grid dashboard-chart-grid-primary">
        <ReportCard eyebrow="历史趋势" title="收入、支出与净结余">
          {hasActualHistory(recentHistory) ? (
            <>
              <AnalyticsChart option={trendOption} label="近八个月实际收入、支出与净结余趋势图" height={300} />
              <TrendDataTable months={recentHistory} currency={analytics.currency} />
            </>
          ) : (
            <ChartEmpty message="至少录入一个月份的实际数据后显示趋势图。" />
          )}
        </ReportCard>
        <ReportCard eyebrow="本月执行" title="计划与实际">
          <AnalyticsChart option={comparisonOption} label={`${analytics.month}收入、支出与净结余计划实际分组柱状图`} height={300} />
          <p className="chart-note">灰蓝代表计划，蓝色代表当前实际；缺失实际不会按 0 绘制。</p>
        </ReportCard>
      </div>
      <div className="dashboard-chart-grid">
        <ReportCard eyebrow="支出结构" title="分类金额与占比">
          {expenses.length > 0 ? (
            <>
              <AnalyticsChart option={expenseOption} label={`${analytics.month}支出分类计划与实际横向条形图`} height={Math.max(260, expenses.length * 54)} />
              <CategoryDataTable categories={expenses} currency={analytics.currency} />
            </>
          ) : (
            <ChartEmpty message="当前月份没有可绘制的支出分类。" />
          )}
        </ReportCard>
        <ReportCard eyebrow="财务承载能力" title="稳定收入的分配路径">
          <AnalyticsChart option={capacityOption} label="稳定收入扣除必要支出、固定承诺、最低储蓄和自主预算后的剩余承载能力瀑布图" height={300} />
          <CapacityDataTable capacity={capacity} />
        </ReportCard>
      </div>
    </section>
  );
}

function ReportCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="report-card">
      <header><div><p className="section-label">{eyebrow}</p><h2>{title}</h2></div></header>
      {children}
    </section>
  );
}

function ExecutionReport({ analytics, actualQualifier }: { analytics: MonthAnalytics; actualQualifier: string }) {
  const rows: Array<[string, AmountComparison]> = [
    ["总收入", analytics.income],
    ["总支出", analytics.expense],
    ["净结余", analytics.net_balance],
  ];
  return (
    <section className="report-card dashboard-table-card">
      <header>
        <div><p className="section-label">月度报表</p><h2>本月计划执行表</h2></div>
        <span className="report-context">{actualQualifier}</span>
      </header>
      <div className="table-scroll">
        <table className="data-table financial-table">
          <caption className="sr-only">本月计划执行表</caption>
          <thead><tr><th>指标</th><th>计划</th><th>实际</th><th>差额</th><th>完成率</th><th>状态</th></tr></thead>
          <tbody>
            {rows.map(([label, comparison]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{formatMoney(comparison.planned, analytics.currency)}</td>
                <td>{formatMoney(comparison.actual_to_date, analytics.currency)}</td>
                <td>{formatMoney(comparison.variance, analytics.currency)}</td>
                <td>{formatPercent(comparison.completion_percent)}</td>
                <td><VarianceBadge comparison={comparison} /></td>
              </tr>
            ))}
            <tr>
              <th>储蓄率</th>
              <td>{formatPercent(analytics.planned_savings_rate_percent)}</td>
              <td>{formatPercent(analytics.actual_savings_rate_percent)}</td>
              <td>{formatPercentagePoints(analytics.savings_rate_percentage_point_variance)}</td>
              <td>{formatPercent(analytics.savings_rate_target_completion_percent)}</td>
              <td><span className="status-badge status-neutral">目标 {analytics.minimum_savings_rate_percent}%</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VarianceReport({ analytics }: { analytics: MonthAnalytics }) {
  return (
    <section className="report-card dashboard-table-card">
      <header>
        <div><p className="section-label">关注事项</p><h2>重要偏差与待处理项目</h2></div>
        <Link className="text-link" to="/monthly">进入月度执行</Link>
      </header>
      {analytics.important_variances.length === 0 ? (
        <p className="report-empty">当前没有需要重点处理的已录入偏差。</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table financial-table">
            <caption className="sr-only">重要偏差与待处理项目</caption>
            <thead><tr><th>项目</th><th>分类</th><th>计划</th><th>实际</th><th>差额</th><th>状态</th></tr></thead>
            <tbody>{analytics.important_variances.map((item) => <VarianceRow currency={analytics.currency} item={item} key={item.monthly_item_id} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VarianceRow({ item, currency }: { item: ProjectBreakdown; currency: string }) {
  return <tr><th>{item.name}</th><td>{categoryLabel(item.category)}</td><td>{formatMoney(item.planned_amount, currency)}</td><td>{formatMoney(item.actual_amount, currency)}</td><td>{formatMoney(item.variance_amount, currency)}</td><td><VarianceBadge comparison={item} /></td></tr>;
}

function VarianceBadge({ comparison }: { comparison: Pick<AmountComparison, "variance_effect"> }) {
  const labels = { FAVORABLE: "有利", UNFAVORABLE: "需关注", ON_PLAN: "符合计划", UNKNOWN: "待录入" } as const;
  return <span className={`status-badge status-${comparison.variance_effect.toLowerCase()}`}>{labels[comparison.variance_effect]}</span>;
}

function TrendDataTable({ months, currency }: { months: MonthAnalytics[]; currency: string }) {
  return (
    <details className="chart-data-details"><summary>查看精确数据</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>净结余</th></tr></thead><tbody>{months.map((month) => <tr key={month.month}><th>{month.month}</th><td>{formatMoney(month.income.actual_to_date, currency)}</td><td>{formatMoney(month.expense.actual_to_date, currency)}</td><td>{formatMoney(month.net_balance.actual_to_date, currency)}</td></tr>)}</tbody></table></div></details>
  );
}

function CategoryDataTable({ categories, currency }: { categories: CategoryBreakdown[]; currency: string }) {
  return (
    <details className="chart-data-details"><summary>查看精确数据</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>分类</th><th>计划</th><th>实际</th><th>实际占比</th></tr></thead><tbody>{categories.map((item) => <tr key={item.category}><th>{categoryLabel(item.category)}</th><td>{formatMoney(item.planned_amount, currency)}</td><td>{formatMoney(item.actual_to_date, currency)}</td><td>{formatPercent(item.actual_share_percent)}</td></tr>)}</tbody></table></div></details>
  );
}

function CapacityDataTable({ capacity }: { capacity: FinancialCapacity }) {
  const rows = [["稳定收入", capacity.stable_income], ["必要支出", capacity.essential_expenses], ["固定承诺", capacity.fixed_commitments], ["最低储蓄", capacity.minimum_savings_amount], ["自主预算", capacity.discretionary_budget], ["剩余承载能力", capacity.preserved_capacity]];
  return <details className="chart-data-details"><summary>查看计算明细</summary><table className="data-table"><tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{formatMoney(value, capacity.base_currency)}</td></tr>)}</tbody></table></details>;
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="chart-empty"><span aria-hidden="true" /><p>{message}</p></div>;
}

function DashboardLoading() {
  return <><header className="page-header compact-header"><div><p className="eyebrow">财务总览</p><h1>正在汇总本月报表</h1></div></header><section className="dashboard-loading" aria-label="正在加载财务总览"><div className="workspace-skeleton workspace-skeleton-wide" /><div className="workspace-skeleton-grid"><div className="workspace-skeleton" /><div className="workspace-skeleton" /><div className="workspace-skeleton" /></div></section></>;
}

function financialTrendOption(months: MonthAnalytics[], currency: string) {
  const visible = months.slice(-8);
  return {
    tooltip: { trigger: "axis", valueFormatter: (value: number | string) => formatMoney(String(value), currency) },
    legend: { top: 0, left: 0, data: ["收入", "支出", "净结余"], textStyle: chartText },
    grid: { left: 72, right: 18, top: 48, bottom: 36 },
    xAxis: { type: "category", boundaryGap: false, data: visible.map((month) => month.month.slice(2)), axisLabel: chartText, axisLine },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, currency) }, splitLine },
    series: [
      { name: "收入", type: "line", data: visible.map((month) => decimalValue(month.income.actual_to_date)), symbolSize: 6, itemStyle: { color: "#2563eb" }, lineStyle: { width: 2, color: "#2563eb" }, connectNulls: false },
      { name: "支出", type: "line", data: visible.map((month) => decimalValue(month.expense.actual_to_date)), symbolSize: 6, itemStyle: { color: "#64748b" }, lineStyle: { width: 2, color: "#64748b" }, connectNulls: false },
      { name: "净结余", type: "line", data: visible.map((month) => decimalValue(month.net_balance.actual_to_date)), symbolSize: 6, itemStyle: { color: "#4f46e5" }, lineStyle: { width: 2, color: "#4f46e5" }, connectNulls: false },
    ],
  };
}

function planActualOption(analytics: MonthAnalytics) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), analytics.currency) },
    legend: { top: 0, data: ["计划", "实际"], textStyle: chartText },
    grid: { left: 70, right: 16, top: 48, bottom: 36 },
    xAxis: { type: "category", data: ["收入", "支出", "净结余"], axisLabel: chartText, axisLine },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, analytics.currency) }, splitLine },
    series: [
      { name: "计划", type: "bar", barMaxWidth: 34, data: [analytics.income.planned, analytics.expense.planned, analytics.net_balance.planned].map(decimalValue), itemStyle: { color: "#94a3b8", borderRadius: [3, 3, 0, 0] } },
      { name: "实际", type: "bar", barMaxWidth: 34, data: [analytics.income.actual_to_date, analytics.expense.actual_to_date, analytics.net_balance.actual_to_date].map(decimalValue), itemStyle: { color: "#2563eb", borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

function expenseStructureOption(categories: CategoryBreakdown[], currency: string) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), currency) },
    legend: { top: 0, data: ["计划", "实际"], textStyle: chartText },
    grid: { left: 92, right: 28, top: 48, bottom: 24 },
    xAxis: {
      type: "value",
      splitNumber: 4,
      axisLabel: {
        ...chartText,
        hideOverlap: true,
        formatter: (value: number) => compactMoney(value, currency),
      },
      splitLine,
    },
    yAxis: { type: "category", data: categories.map((item) => categoryLabel(item.category)), axisLabel: chartText, axisLine },
    series: [
      { name: "计划", type: "bar", barMaxWidth: 18, data: categories.map((item) => decimalValue(item.planned_amount)), itemStyle: { color: "#94a3b8", borderRadius: [0, 3, 3, 0] } },
      { name: "实际", type: "bar", barMaxWidth: 18, data: categories.map((item) => decimalValue(item.actual_to_date)), itemStyle: { color: "#2563eb", borderRadius: [0, 3, 3, 0] } },
    ],
  };
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
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), capacity.base_currency) },
    grid: { left: 70, right: 16, top: 24, bottom: 48 },
    xAxis: { type: "category", data: ["稳定收入", "必要支出", "固定承诺", "最低储蓄", "自主预算", "剩余能力"], axisLabel: { ...chartText, interval: 0, rotate: 20 }, axisLine },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, capacity.base_currency) }, splitLine },
    series: [
      { name: "辅助", type: "bar", stack: "capacity", silent: true, data: base, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } } },
      { name: "金额", type: "bar", stack: "capacity", barMaxWidth: 34, data: visible, itemStyle: { color: (params: { dataIndex: number }) => params.dataIndex === 0 ? "#2563eb" : params.dataIndex === 5 ? "#4f46e5" : "#94a3b8", borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

function hasActualHistory(months: MonthAnalytics[]) {
  return months.some((month) => month.income.actual_to_date !== null || month.expense.actual_to_date !== null || month.net_balance.actual_to_date !== null);
}

function comparisonDetail(comparison: AmountComparison, currency: string, actualQualifier: string) {
  return comparison.variance === null ? `${actualQualifier}尚不可比较` : `差额 ${formatMoney(comparison.variance, currency)}`;
}

function completionDetail(comparison: AmountComparison, actualQualifier: string) {
  return comparison.completion_percent ? `计划完成 ${comparison.completion_percent}%` : `${actualQualifier}尚不可计算`;
}

function actualStatusLabel(status: MonthAnalytics["actual_status"]) {
  return status === "COMPLETE" ? "最终实际" : status === "PARTIAL" ? "当前已录" : "尚未录入";
}
