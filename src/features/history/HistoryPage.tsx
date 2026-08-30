import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import { getHistoryAnalytics, queryKeys, type MonthAnalytics } from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { EmptyState } from "../../shared/components/EmptyState";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent, monthLabel } from "../../shared/formatting/finance";
import { MonthReportDetail } from "./MonthReportDetail";

export function HistoryPage() {
  const { month } = useParams<{ month?: string }>();
  const historyQuery = useQuery({
    queryKey: queryKeys.historyAnalytics,
    queryFn: () => getHistoryAnalytics(),
  });

  if (historyQuery.isPending) return <section className="state-card">正在重算历史序列…</section>;
  if (historyQuery.isError) return <section className="state-card"><span role="alert">{describeError(historyQuery.error)}</span></section>;

  const months = historyQuery.data.months;
  if (month) return <MonthReportPage requestedMonth={month} months={months} />;
  if (months.length === 0) {
    return <EmptyState eyebrow="历史保持只读" title="还没有可查看的月份" description="录入第一个月份的实际数据后，月度趋势和详细报告会自动出现在这里；浏览历史不会创建或修改数据。" action={<Link className="button button-primary" to="/monthly">录入本月实际</Link>} />;
  }
  return <HistoryIndex months={months} />;
}

function HistoryIndex({ months }: { months: MonthAnalytics[] }) {
  const financialOption = useMemo(() => trendOption(months), [months]);
  const savingsOption = useMemo(() => savingsTrendOption(months), [months]);
  const newestFirst = useMemo(() => [...months].reverse(), [months]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">跨月聚合</p>
          <h1>历史报表</h1>
          <p>先比较月份趋势，再进入某个月查看完整财务分析；所有历史数据保持只读。</p>
        </div>
        <span className="context-chip">{months.length} 个月份</span>
      </header>

      <div className="trend-grid">
        <section className="analysis-card trend-card">
          <header><div><p className="section-label">Financial Trend</p><h2>收入、支出与净结余</h2></div></header>
          <AnalyticsChart option={financialOption} label="各月计划与实际收入、支出和净结余趋势图" height={330} />
          <FinancialTrendTable months={months} />
        </section>
        <section className="analysis-card trend-card">
          <header><div><p className="section-label">Savings Trend</p><h2>储蓄率</h2></div></header>
          <AnalyticsChart option={savingsOption} label="各月计划储蓄率与实际储蓄率趋势图" height={330} />
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">储蓄率趋势对应数值</caption><thead><tr><th>月份</th><th>状态</th><th>计划</th><th>实际</th></tr></thead><tbody>{months.map((item) => <tr key={item.month}><th><Link className="table-link" to={`/history/${item.month}`}>{item.month}</Link></th><td>{statusLabel(item.actual_status)}</td><td>{item.planned_item_count > 0 ? formatPercent(item.planned_savings_rate_percent) : "—"}</td><td>{formatPercent(item.actual_savings_rate_percent)}</td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="history-month-index" aria-labelledby="history-month-index-title">
        <header className="section-heading">
          <div><p className="section-label">Monthly Reports</p><h2 id="history-month-index-title">按月份查看详细报告</h2></div>
          <span className="report-context">最近月份优先</span>
        </header>
        <div className="history-month-grid">
          {newestFirst.map((item) => <MonthReportLink analytics={item} key={item.month} />)}
        </div>
      </section>
    </>
  );
}

function MonthReportLink({ analytics }: { analytics: MonthAnalytics }) {
  return (
    <Link className="history-month-card" to={`/history/${analytics.month}`}>
      <div><span>{monthLabel(analytics.month)}</span><small>{statusLabel(analytics.actual_status)} · {analytics.recorded_item_count}/{analytics.total_item_count} 项</small></div>
      <dl>
        <div><dt>收入</dt><dd>{formatMoney(analytics.income.actual_to_date, analytics.currency)}</dd></div>
        <div><dt>支出</dt><dd>{formatMoney(analytics.expense.actual_to_date, analytics.currency)}</dd></div>
        <div><dt>净结余</dt><dd>{formatMoney(analytics.net_balance.actual_to_date, analytics.currency)}</dd></div>
      </dl>
      <span className="history-month-card-action">查看详细报告 <span aria-hidden="true">→</span></span>
    </Link>
  );
}

function MonthReportPage({ requestedMonth, months }: { requestedMonth: string; months: MonthAnalytics[] }) {
  const selectedIndex = months.findIndex((item) => item.month === requestedMonth);
  const selected = selectedIndex >= 0 ? months[selectedIndex] : null;
  if (!selected || !/^\d{4}-\d{2}$/.test(requestedMonth)) {
    return <EmptyState eyebrow="历史报表" title="没有找到这个月份" description="该月份没有可用的月度快照或实际条目。历史浏览不会自动创建缺失数据。" action={<Link className="button button-primary" to="/history">返回历史报表</Link>} />;
  }
  const previous = months[selectedIndex - 1];
  const next = months[selectedIndex + 1];
  return (
    <>
      <header className="page-header history-report-header">
        <div>
          <Link className="back-link" to="/history">← 返回历史报表</Link>
          <p className="eyebrow">月度详细报告</p>
          <h1>{monthLabel(selected.month)}</h1>
          <p>该月份的核心指标、计划执行、分类结构、项目排名与重要偏差。</p>
        </div>
        <div className="history-report-context">
          <span className={`context-chip status-${selected.actual_status.toLowerCase()}`}>{statusLabel(selected.actual_status)}</span>
          <strong>完整度 {formatPercent(selected.completeness_percent)}</strong>
          <small>{selected.recorded_item_count}/{selected.total_item_count} 项已录入</small>
        </div>
      </header>
      {(previous || next) && <nav className="month-report-navigation" aria-label="相邻月份">
        {previous ? <Link to={`/history/${previous.month}`}>← {monthLabel(previous.month)}</Link> : <span />}
        {next ? <Link to={`/history/${next.month}`}>{monthLabel(next.month)} →</Link> : <span />}
      </nav>}
      <MonthReportDetail analytics={selected} />
    </>
  );
}

function trendOption(months: MonthAnalytics[]) {
  const series = [
    ["计划收入", "income", "planned", "#94a3b8", "dashed"],
    ["实际收入", "income", "actual_to_date", "#2563eb", "solid"],
    ["计划支出", "expense", "planned", "#cbd5e1", "dashed"],
    ["实际支出", "expense", "actual_to_date", "#64748b", "solid"],
    ["计划结余", "net_balance", "planned", "#a5b4fc", "dashed"],
    ["实际结余", "net_balance", "actual_to_date", "#4f46e5", "solid"],
  ] as const;
  return {
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0, left: 0, right: 0, data: series.map(([name]) => name), textStyle: chartLegendText },
    grid: { left: 58, right: 20, top: 70, bottom: 40 },
    xAxis: { type: "category", boundaryGap: false, data: months.map((item) => item.month), axisLabel: compactMonthLabels(months.length) },
    yAxis: { type: "value" },
    series: series.map(([name, metric, field, color, lineType]) => ({ name, type: "line", data: months.map((item) => field === "planned" && item.planned_item_count === 0 ? null : item[metric][field]), connectNulls: false, lineStyle: { color, type: lineType }, itemStyle: { color }, symbolSize: 7 })),
  };
}

function savingsTrendOption(months: MonthAnalytics[]) {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["计划储蓄率", "实际储蓄率"], textStyle: chartLegendText },
    grid: { left: 52, right: 20, top: 55, bottom: 40 },
    xAxis: { type: "category", boundaryGap: false, data: months.map((item) => item.month), axisLabel: compactMonthLabels(months.length) },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: [
      { name: "计划储蓄率", type: "line", data: months.map((item) => item.planned_item_count > 0 ? item.planned_savings_rate_percent : null), itemStyle: { color: "#94a3b8" }, lineStyle: { color: "#94a3b8", type: "dashed" } },
      { name: "实际储蓄率", type: "line", data: months.map((item) => item.actual_savings_rate_percent), itemStyle: { color: "#2563eb" }, lineStyle: { color: "#2563eb" }, connectNulls: false },
    ],
  };
}

function FinancialTrendTable({ months }: { months: MonthAnalytics[] }) {
  return <div className="table-scroll"><table className="data-table"><caption className="sr-only">财务趋势图对应数值</caption><thead><tr><th>月份</th><th>状态</th><th>计划收入</th><th>实际收入</th><th>计划支出</th><th>实际支出</th><th>计划结余</th><th>实际结余</th></tr></thead><tbody>{months.map((item) => <tr key={item.month}><th><Link className="table-link" to={`/history/${item.month}`}>{item.month}</Link></th><td>{statusLabel(item.actual_status)}</td><td>{item.planned_item_count > 0 ? formatMoney(item.income.planned, item.currency) : "—"}</td><td>{formatMoney(item.income.actual_to_date, item.currency)}</td><td>{item.planned_item_count > 0 ? formatMoney(item.expense.planned, item.currency) : "—"}</td><td>{formatMoney(item.expense.actual_to_date, item.currency)}</td><td>{item.planned_item_count > 0 ? formatMoney(item.net_balance.planned, item.currency) : "—"}</td><td>{formatMoney(item.net_balance.actual_to_date, item.currency)}</td></tr>)}</tbody></table></div>;
}

function compactMonthLabels(count: number) {
  return { hideOverlap: true, interval: count > 6 ? 1 : 0, formatter: (value: string) => value.slice(2) };
}

function statusLabel(status: MonthAnalytics["actual_status"]) {
  return status === "COMPLETE" ? "最终实际" : status === "PARTIAL" ? "当前已录" : "空月份";
}

const chartLegendText = { color: "#64748b", fontSize: 11 };
