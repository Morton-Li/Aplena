import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  getHistoryAnalytics,
  queryKeys,
  type MonthAnalytics,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { describeError } from "../../shared/formatting/errors";
import { categoryLabel, flowLabel, recognitionLabel } from "../../shared/formatting/labels";

export function HistoryPage() {
  const historyQuery = useQuery({
    queryKey: queryKeys.historyAnalytics,
    queryFn: () => getHistoryAnalytics(),
  });
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const historyData = historyQuery.data;
  const months = useMemo(() => historyData?.months ?? [], [historyData]);
  const selectedMonth = selectedState ?? months.at(-1)?.month ?? "";
  const selected = months.find((month) => month.month === selectedMonth);
  const financialOption = useMemo(() => trendOption(months), [months]);
  const savingsOption = useMemo(() => savingsTrendOption(months), [months]);

  if (historyQuery.isPending) return <section className="state-card">正在重算历史序列…</section>;
  if (historyQuery.isError) return <section className="state-card"><span role="alert">{describeError(historyQuery.error)}</span></section>;
  if (months.length === 0) return <section className="state-card">还没有已生成的月份。历史页不会因为浏览而创建数据。</section>;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">历史与趋势</p>
          <h1>计划与结果如何随时间变化？</h1>
          <p>未完整月份只显示“当前已录”，不会被标记为最终实际结果。</p>
        </div>
        <label className="month-picker">查看月份<select value={selectedMonth} onChange={(event) => setSelectedState(event.target.value)}>{months.map((month) => <option key={month.month}>{month.month}</option>)}</select></label>
      </header>

      <div className="trend-grid">
        <section className="analysis-card trend-card">
          <header><div><p className="section-label">Financial Trend</p><h2>收入、支出与结余</h2></div></header>
          <AnalyticsChart option={financialOption} label="各月计划与实际收入、支出和结余趋势图；未完整月份是当前已录值" height={330} />
          <FinancialTrendTable months={months} />
        </section>
        <section className="analysis-card trend-card">
          <header><div><p className="section-label">Savings Trend</p><h2>储蓄率</h2></div></header>
          <AnalyticsChart option={savingsOption} label="各月计划储蓄率与实际储蓄率趋势图；零收入显示为空" height={330} />
          <table className="data-table">
            <caption className="sr-only">储蓄率趋势对应数值</caption>
            <thead><tr><th>月份</th><th>状态</th><th>计划</th><th>实际</th></tr></thead>
            <tbody>{months.map((month) => <tr key={month.month}><th>{month.month}</th><td>{statusLabel(month.actual_status)}</td><td>{percent(month.planned_savings_rate_percent)}</td><td>{percent(month.actual_savings_rate_percent)}</td></tr>)}</tbody>
          </table>
        </section>
      </div>

      {selected && <MonthHistoryDetail analytics={selected} />}
    </>
  );
}

function MonthHistoryDetail({ analytics }: { analytics: MonthAnalytics }) {
  const actualLabel = analytics.actual_status === "COMPLETE" ? "最终实际" : "当前已录";
  return (
    <section className="history-detail">
      <header>
        <div><p className="section-label">{analytics.month} 月度总览</p><h2>快照、分类与项目明细</h2></div>
        <span className={"context-chip status-" + analytics.actual_status.toLowerCase()}>{statusLabel(analytics.actual_status)} · {analytics.recorded_item_count}/{analytics.total_item_count}</span>
      </header>
      <div className="history-summary">
        {[["总收入", analytics.income], ["总支出", analytics.expense], ["净结余", analytics.net_balance]].map(([label, value]) => {
          const metric = value as MonthAnalytics["income"];
          return <article key={label as string}><span>{label as string}</span><strong>{metric.planned}</strong><small>{actualLabel} {metric.actual_to_date ?? "N/A"}</small></article>;
        })}
        <article><span>储蓄率</span><strong>{percent(analytics.planned_savings_rate_percent)}</strong><small>{actualLabel} {percent(analytics.actual_savings_rate_percent)}</small></article>
      </div>
      <div className="history-tables">
        <section className="analysis-card">
          <header><h3>分类汇总</h3></header>
          <table className="data-table"><thead><tr><th>类别</th><th>方向</th><th>计划</th><th>{actualLabel}</th><th>未录入</th></tr></thead><tbody>{analytics.categories.map((item) => <tr key={item.category}><th>{categoryLabel(item.category)}</th><td>{flowLabel(item.flow_type)}</td><td>{item.planned_amount}</td><td>{item.actual_to_date ?? "N/A"}</td><td>{item.missing_actual_count}</td></tr>)}</tbody></table>
        </section>
        <section className="analysis-card">
          <header><h3>项目明细</h3></header>
          <table className="data-table"><thead><tr><th>项目</th><th>类别</th><th>计划</th><th>{actualLabel}</th><th>偏差</th></tr></thead><tbody>{analytics.projects.map((item) => <tr key={item.monthly_item_id}><th>{item.name}</th><td>{categoryLabel(item.category)}</td><td>{item.planned_amount}</td><td>{item.actual_amount ?? "N/A"}</td><td>{item.variance_amount ?? "N/A"}</td></tr>)}</tbody></table>
          <p className="table-note">模式信息保留在月度计划中：{recognitionLabel("AMORTIZED")}与{recognitionLabel("PAYMENT")}均不会被历史查询重算。</p>
        </section>
      </div>
    </section>
  );
}

function trendOption(months: MonthAnalytics[]) {
  const series = [
    ["计划收入", "income", "planned", "#6f917b", "solid"],
    ["实际收入", "income", "actual_to_date", "#315f48", "solid"],
    ["计划支出", "expense", "planned", "#d0aa6c", "dashed"],
    ["实际支出", "expense", "actual_to_date", "#a86c43", "solid"],
    ["计划结余", "net_balance", "planned", "#8296a5", "dashed"],
    ["实际结余", "net_balance", "actual_to_date", "#465e72", "solid"],
  ] as const;
  return {
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", data: series.map(([name]) => name) },
    grid: { left: 58, right: 20, top: 70, bottom: 40 },
    xAxis: { type: "category", data: months.map((month) => month.month) },
    yAxis: { type: "value" },
    series: series.map(([name, metric, field, color, type]) => ({
      name,
      type: "line",
      data: months.map((month) => month[metric][field]),
      connectNulls: false,
      lineStyle: { color, type },
      itemStyle: { color },
      symbolSize: 7,
    })),
  };
}

function savingsTrendOption(months: MonthAnalytics[]) {
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ["计划储蓄率", "实际储蓄率"] },
    grid: { left: 52, right: 20, top: 55, bottom: 40 },
    xAxis: { type: "category", data: months.map((month) => month.month) },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: [
      { name: "计划储蓄率", type: "line", data: months.map((month) => month.planned_savings_rate_percent), itemStyle: { color: "#8ca795" } },
      { name: "实际储蓄率", type: "line", data: months.map((month) => month.actual_savings_rate_percent), itemStyle: { color: "#c79c58" }, connectNulls: false },
    ],
  };
}

function FinancialTrendTable({ months }: { months: MonthAnalytics[] }) {
  return (
    <table className="data-table">
      <caption className="sr-only">财务趋势图对应数值</caption>
      <thead><tr><th>月份</th><th>状态</th><th>计划收入</th><th>实际收入</th><th>计划支出</th><th>实际支出</th><th>计划结余</th><th>实际结余</th></tr></thead>
      <tbody>{months.map((month) => <tr key={month.month}><th>{month.month}</th><td>{statusLabel(month.actual_status)}</td><td>{month.income.planned}</td><td>{month.income.actual_to_date ?? "N/A"}</td><td>{month.expense.planned}</td><td>{month.expense.actual_to_date ?? "N/A"}</td><td>{month.net_balance.planned}</td><td>{month.net_balance.actual_to_date ?? "N/A"}</td></tr>)}</tbody>
    </table>
  );
}

function statusLabel(status: MonthAnalytics["actual_status"]) {
  return status === "COMPLETE" ? "最终实际" : status === "PARTIAL" ? "当前已录" : "空月份";
}

function percent(value: string | null) {
  return value === null ? "N/A" : value + "%";
}
