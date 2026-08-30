import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  getHistoryAnalytics,
  getMonthAnalytics,
  getStartupStatus,
  queryKeys,
  type AmountComparison,
  type CategoryBreakdown,
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
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const month = startupQuery.data?.current_month ?? "";
  const analyticsQuery = useQuery({
    queryKey: queryKeys.monthAnalytics(month),
    queryFn: () => getMonthAnalytics(month),
    enabled: Boolean(month),
  });
  const historyQuery = useQuery({
    queryKey: queryKeys.historyAnalytics,
    queryFn: () => getHistoryAnalytics(),
  });
  if (
    startupQuery.isPending ||
    analyticsQuery.isPending ||
    historyQuery.isPending
  ) {
    return <DashboardLoading />;
  }
  if (
    startupQuery.isError ||
    analyticsQuery.isError ||
    historyQuery.isError
  ) {
    return (
      <section className="state-card state-card-error">
        <span role="alert">
          {describeError(
            startupQuery.error ??
              analyticsQuery.error ??
              historyQuery.error,
          )}
        </span>
      </section>
    );
  }
  if (!startupQuery.data || !analyticsQuery.data) {
    return <section className="state-card">当前月份的财务数据尚未完成初始化。</section>;
  }

  const analytics = analyticsQuery.data;
  const actualQualifier = actualStatusLabel(analytics.actual_status);
  const hasPlanBaseline = analytics.planned_item_count > 0;

  return (
    <>
      <DashboardHeader analytics={analytics} hasPlanBaseline={hasPlanBaseline} />
      {analytics.total_item_count === 0 ? (
        <EmptyDashboard month={analytics.month} currency={analytics.currency} />
      ) : (
        <>
          <KpiGrid analytics={analytics} actualQualifier={actualQualifier} hasPlanBaseline={hasPlanBaseline} />
          <DashboardCharts
            analytics={analytics}
            history={historyQuery.data?.months ?? []}
            hasPlanBaseline={hasPlanBaseline}
          />
          <ExecutionReport analytics={analytics} actualQualifier={actualQualifier} hasPlanBaseline={hasPlanBaseline} />
          <VarianceReport analytics={analytics} />
        </>
      )}
    </>
  );
}

function DashboardHeader({ analytics, hasPlanBaseline }: { analytics: MonthAnalytics; hasPlanBaseline: boolean }) {
  return (
    <header className="page-header compact-header dashboard-header">
      <div>
        <p className="eyebrow">财务总览</p>
        <h1>{monthLabel(analytics.month)}</h1>
        <p>{currencyName(analytics.currency)} · {hasPlanBaseline ? "本月冻结计划与实际数据汇总" : "本月实际收支与财务报表汇总"}</p>
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
        <div><span>报表状态</span><strong>等待本月数据</strong></div>
      </section>
      <EmptyState
        eyebrow="财务报表尚未建立"
        title="从本月第一项收入或支出开始"
        description="直接录入本月实际后，收入、支出、净结余、分类结构与趋势图会自动生成。周期规则仅在需要自动生成后续月份基准时使用。"
        action={
          <div className="empty-actions">
            <Link className="button button-primary" to="/monthly">录入本月实际</Link>
            <Link className="button button-secondary" to="/goals">设置下月目标（可选）</Link>
          </div>
        }
      />
    </div>
  );
}

function KpiGrid({
  analytics,
  actualQualifier,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  actualQualifier: string;
  hasPlanBaseline: boolean;
}) {
  return (
    <section className="kpi-grid" aria-label="核心财务指标">
      <KpiCard
        className="kpi-card-primary"
        label="本月净结余"
        value={formatMoney(analytics.net_balance.actual_to_date, analytics.currency)}
        supporting={hasPlanBaseline ? `计划 ${formatMoney(analytics.net_balance.planned, analytics.currency)}` : "未启用计划基准"}
        detail={hasPlanBaseline ? comparisonDetail(analytics.net_balance, analytics.currency, actualQualifier) : `${actualQualifier}实际净额`}
        effect={hasPlanBaseline ? analytics.net_balance.variance_effect : "UNKNOWN"}
      />
      <KpiCard
        label="总收入"
        value={formatMoney(analytics.income.actual_to_date, analytics.currency)}
        supporting={hasPlanBaseline ? `计划 ${formatMoney(analytics.income.planned, analytics.currency)}` : "按实际条目汇总"}
        detail={hasPlanBaseline ? completionDetail(analytics.income, actualQualifier) : `${actualQualifier}实际收入`}
        effect={hasPlanBaseline ? analytics.income.variance_effect : "UNKNOWN"}
      />
      <KpiCard
        label="总支出"
        value={formatMoney(analytics.expense.actual_to_date, analytics.currency)}
        supporting={hasPlanBaseline ? `计划 ${formatMoney(analytics.expense.planned, analytics.currency)}` : "按实际条目汇总"}
        detail={hasPlanBaseline ? comparisonDetail(analytics.expense, analytics.currency, actualQualifier) : `${actualQualifier}实际支出`}
        effect={hasPlanBaseline ? analytics.expense.variance_effect : "UNKNOWN"}
      />
      <KpiCard
        label="储蓄率"
        value={formatPercent(analytics.actual_savings_rate_percent)}
        supporting={hasPlanBaseline ? `计划 ${formatPercent(analytics.planned_savings_rate_percent)}` : "按本月实际计算"}
        detail={
          !hasPlanBaseline
            ? analytics.actual_savings_rate_percent ? "基于当前实际收入与净结余" : `${actualQualifier}尚不可计算`
            : analytics.savings_rate_plan_completion_percent
            ? `计划完成 ${analytics.savings_rate_plan_completion_percent}%`
            : `${actualQualifier}尚不可计算`
        }
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
  history,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  history: MonthAnalytics[];
  hasPlanBaseline: boolean;
}) {
  const recentHistory = useMemo(() => history.slice(-8), [history]);
  const trendOption = useMemo(
    () => financialTrendOption(recentHistory, analytics.currency),
    [analytics.currency, recentHistory],
  );
  const comparisonOption = useMemo(() => planActualOption(analytics, hasPlanBaseline), [analytics, hasPlanBaseline]);
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
    () => expenseStructureOption(expenses, analytics.currency, hasPlanBaseline),
    [analytics.currency, expenses, hasPlanBaseline],
  );

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
        <ReportCard eyebrow="本月执行" title={hasPlanBaseline ? "计划与实际" : "实际收支概览"}>
          <AnalyticsChart option={comparisonOption} label={`${analytics.month}收入、支出与净结余${hasPlanBaseline ? "计划实际分组" : "实际"}柱状图`} height={300} />
          <p className="chart-note">{hasPlanBaseline ? "灰蓝代表计划，蓝色代表当前实际；缺失实际不会按 0 绘制。" : "当前仅展示实际数据；配置周期规则后可增加计划对比。"}</p>
        </ReportCard>
      </div>
      <div className="dashboard-chart-grid">
        <ReportCard eyebrow="支出结构" title="分类金额与占比">
          {expenses.length > 0 ? (
            <>
              <AnalyticsChart option={expenseOption} label={`${analytics.month}支出分类${hasPlanBaseline ? "计划与实际" : "实际"}横向条形图`} height={Math.max(260, expenses.length * 54)} />
              <CategoryDataTable categories={expenses} currency={analytics.currency} hasPlanBaseline={hasPlanBaseline} />
            </>
          ) : (
            <ChartEmpty message="当前月份没有可绘制的支出分类。" />
          )}
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

function ExecutionReport({ analytics, actualQualifier, hasPlanBaseline }: { analytics: MonthAnalytics; actualQualifier: string; hasPlanBaseline: boolean }) {
  const rows: Array<[string, AmountComparison]> = [
    ["总收入", analytics.income],
    ["总支出", analytics.expense],
    ["净结余", analytics.net_balance],
  ];
  return (
    <section className="report-card dashboard-table-card">
      <header>
        <div><p className="section-label">月度报表</p><h2>{hasPlanBaseline ? "本月计划执行表" : "本月实际收支表"}</h2></div>
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
                <td>{hasPlanBaseline ? formatMoney(comparison.planned, analytics.currency) : "—"}</td>
                <td>{formatMoney(comparison.actual_to_date, analytics.currency)}</td>
                <td>{hasPlanBaseline ? formatMoney(comparison.variance, analytics.currency) : "—"}</td>
                <td>{hasPlanBaseline ? formatPercent(comparison.completion_percent) : "—"}</td>
                <td>{hasPlanBaseline ? <VarianceBadge comparison={comparison} /> : <span className="status-badge status-neutral">仅实际</span>}</td>
              </tr>
            ))}
            <tr>
              <th>储蓄率</th>
              <td>{hasPlanBaseline ? formatPercent(analytics.planned_savings_rate_percent) : "—"}</td>
              <td>{formatPercent(analytics.actual_savings_rate_percent)}</td>
              <td>{formatPercentagePoints(analytics.savings_rate_percentage_point_variance)}</td>
              <td>{formatPercent(analytics.savings_rate_plan_completion_percent)}</td>
              <td><span className="status-badge status-neutral">对比本月计划</span></td>
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
    <details className="chart-data-details"><summary>查看精确数据</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>净结余</th></tr></thead><tbody>{months.map((month) => <tr key={month.month}><th><Link className="table-link" to={`/history/${month.month}`}>{month.month}</Link></th><td>{formatMoney(month.income.actual_to_date, currency)}</td><td>{formatMoney(month.expense.actual_to_date, currency)}</td><td>{formatMoney(month.net_balance.actual_to_date, currency)}</td></tr>)}</tbody></table></div></details>
  );
}

function CategoryDataTable({ categories, currency, hasPlanBaseline }: { categories: CategoryBreakdown[]; currency: string; hasPlanBaseline: boolean }) {
  return (
    <details className="chart-data-details"><summary>查看精确数据</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>分类</th><th>计划</th><th>实际</th><th>实际占比</th></tr></thead><tbody>{categories.map((item) => <tr key={item.category}><th>{categoryLabel(item.category)}</th><td>{hasPlanBaseline ? formatMoney(item.planned_amount, currency) : "—"}</td><td>{formatMoney(item.actual_to_date, currency)}</td><td>{formatPercent(item.actual_share_percent)}</td></tr>)}</tbody></table></div></details>
  );
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

function planActualOption(analytics: MonthAnalytics, hasPlanBaseline: boolean) {
  const actualSeries = { name: "实际", type: "bar", barMaxWidth: 34, data: [analytics.income.actual_to_date, analytics.expense.actual_to_date, analytics.net_balance.actual_to_date].map(decimalValue), itemStyle: { color: "#2563eb", borderRadius: [3, 3, 0, 0] } };
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), analytics.currency) },
    legend: { top: 0, data: hasPlanBaseline ? ["计划", "实际"] : ["实际"], textStyle: chartText },
    grid: { left: 70, right: 16, top: 48, bottom: 36 },
    xAxis: { type: "category", data: ["收入", "支出", "净结余"], axisLabel: chartText, axisLine },
    yAxis: { type: "value", axisLabel: { ...chartText, formatter: (value: number) => compactMoney(value, analytics.currency) }, splitLine },
    series: hasPlanBaseline ? [
      { name: "计划", type: "bar", barMaxWidth: 34, data: [analytics.income.planned, analytics.expense.planned, analytics.net_balance.planned].map(decimalValue), itemStyle: { color: "#94a3b8", borderRadius: [3, 3, 0, 0] } },
      actualSeries,
    ] : [actualSeries],
  };
}

function expenseStructureOption(categories: CategoryBreakdown[], currency: string, hasPlanBaseline: boolean) {
  const actualSeries = { name: "实际", type: "bar", barMaxWidth: 18, data: categories.map((item) => decimalValue(item.actual_to_date)), itemStyle: { color: "#2563eb", borderRadius: [0, 3, 3, 0] } };
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => formatMoney(String(value), currency) },
    legend: { top: 0, data: hasPlanBaseline ? ["计划", "实际"] : ["实际"], textStyle: chartText },
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
    series: hasPlanBaseline ? [
      { name: "计划", type: "bar", barMaxWidth: 18, data: categories.map((item) => decimalValue(item.planned_amount)), itemStyle: { color: "#94a3b8", borderRadius: [0, 3, 3, 0] } },
      actualSeries,
    ] : [actualSeries],
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
