import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AmountShareChart } from "../../shared/components/AmountShareChart";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { ChartDataFlip } from "../../shared/components/ChartDataFlip";
import { decimalValue, formatMoney, formatPercent, monthLabel } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel } from "../../shared/formatting/labels";
import type { HistoryYearGroup } from "./historyYearGroups";

export function YearReportDetail({ group }: { group: HistoryYearGroup }) {
  const hasPlan = group.plannedMonthCount > 0;
  const metrics = [
    { name: "总收入", actual: formatMoney(group.actualIncome, group.currency), planned: formatMoney(group.plannedIncome, group.currency) },
    { name: "总支出", actual: formatMoney(group.actualExpense, group.currency), planned: formatMoney(group.plannedExpense, group.currency) },
    { name: "净结余", actual: formatMoney(group.actualNetBalance, group.currency), planned: formatMoney(group.plannedNetBalance, group.currency) },
    { name: "储蓄率", actual: formatPercent(group.actualSavingsRatePercent), planned: formatPercent(group.plannedSavingsRatePercent) },
  ];
  return <div className="year-report-detail">
    <p className="history-report-note">已收录 {group.monthCount} 个月，其中 {group.actualMonthCount} 个月有实际记录、{group.plannedMonthCount} 个月有计划基准。全年指标仅汇总已收录月份，未录入数据保留为空；储蓄率按全年净结余 ÷ 全年收入计算。</p>
    <section className="history-summary" aria-label={`${group.year} 年核心指标`}>
      {metrics.map((metric) => <article key={metric.name}>
        <span>{metric.name}</span><strong>{metric.actual}</strong>
        <small>{hasPlan ? `计划 ${metric.planned}` : "无计划基准"}</small>
      </article>)}
    </section>
    <AnnualTrend group={group} />
    <section className="analysis-card history-execution-card">
      <header><div><p className="section-label">Annual Statement</p><h2>年度执行结果</h2></div><span>{group.monthCount} 个月汇总</span></header>
      <div className="table-scroll"><table className="data-table financial-table">
        <caption className="sr-only">{group.year} 年度执行结果</caption>
        <thead><tr><th>指标</th><th>计划合计</th><th>实际合计</th></tr></thead>
        <tbody>{metrics.map((metric) => <tr key={metric.name}><th>{metric.name}</th><td>{hasPlan ? metric.planned : "—"}</td><td>{metric.actual}</td></tr>)}</tbody>
      </table></div>
    </section>
    <AnnualCategories group={group} />
    <section className="analysis-card history-execution-card">
      <header><div><p className="section-label">Monthly Statements</p><h2>各月执行明细</h2></div><span>点击月份查看月度报告</span></header>
      <AnnualMonthTable group={group} />
    </section>
  </div>;
}

function AnnualTrend({ group }: { group: HistoryYearGroup }) {
  const option = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, index) => `${group.year}-${String(index + 1).padStart(2, "0")}`);
    const byMonth = new Map(group.months.map((month) => [month.month, month]));
    return {
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => formatMoney(value == null ? null : String(value), group.currency) },
      legend: { top: 0, data: ["实际收入", "实际支出", "实际净结余"] },
      grid: { left: 72, right: 20, top: 42, bottom: 32 },
      xAxis: { type: "category", data: months.map((_, index) => `${index + 1}月`) },
      yAxis: { type: "value" },
      series: ([
        ["实际收入", "income", "#2563eb"],
        ["实际支出", "expense", "#e59945"],
        ["实际净结余", "net_balance", "#0f9f78"],
      ] as const).map(([name, key, color]) => ({
        name, type: "line", connectNulls: false, itemStyle: { color },
        data: months.map((month) => decimalValue(byMonth.get(month)?.[key].actual_to_date ?? null)),
      })),
    };
  }, [group]);
  return <section className="analysis-card history-execution-card">
    <header><div><p className="section-label">Annual Trend</p><h2>全年收支趋势</h2></div><span>{group.currency}</span></header>
    {group.actualMonthCount > 0 ? <ChartDataFlip
      height={260}
      dataLabel={`${group.year} 年收支趋势精确数据`}
      front={<AnalyticsChart option={option} label={`${group.year} 年收入、支出与净结余趋势图`} height={260} />}
      back={<AnnualMonthTable group={group} />}
    /> : <p className="empty-copy">该年度尚无实际记录，录入后显示全年收支趋势。</p>}
  </section>;
}

function AnnualCategories({ group }: { group: HistoryYearGroup }) {
  const [flow, setFlow] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [basis, setBasis] = useState<"ACTUAL" | "PLANNED">("ACTUAL");
  const hasPlan = group.plannedMonthCount > 0;
  const categories = group.categories.filter((category) => category.flow_type === flow);
  const items = categories.map((category) => ({
    id: category.category, name: categoryLabel(category.category),
    amount: basis === "ACTUAL" ? category.actual_to_date : category.planned_amount,
  }));
  return <section className="analysis-section">
    <header className="section-heading">
      <div><p className="section-label">Annual Structure</p><h2>年度分类结构</h2></div>
      <div className="segmented-control" role="group" aria-label="年度结构方向">
        <button type="button" aria-pressed={flow === "INCOME"} className={flow === "INCOME" ? "segment-active" : ""} onClick={() => setFlow("INCOME")}>收入结构</button>
        <button type="button" aria-pressed={flow === "EXPENSE"} className={flow === "EXPENSE" ? "segment-active" : ""} onClick={() => setFlow("EXPENSE")}>支出结构</button>
      </div>
    </header>
    <section className="analysis-card history-category-card">
      <header><h3>{flowLabel(flow)}分类金额与占比</h3>
        {hasPlan && <div className="segmented-control" role="group" aria-label="年度分类占比口径">
          <button type="button" aria-pressed={basis === "ACTUAL"} className={basis === "ACTUAL" ? "segment-active" : ""} onClick={() => setBasis("ACTUAL")}>实际占比</button>
          <button type="button" aria-pressed={basis === "PLANNED"} className={basis === "PLANNED" ? "segment-active" : ""} onClick={() => setBasis("PLANNED")}>计划占比</button>
        </div>}
      </header>
      <AmountShareChart items={items} currency={group.currency} label={`${group.year} 年${flowLabel(flow)}分类${basis === "ACTUAL" ? "实际" : "计划"}占比饼图`} />
      <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">年度分类结构对应数据</caption>
        <thead><tr><th>类别</th><th>计划金额</th><th>计划占比</th><th>实际金额</th><th>实际占比</th></tr></thead>
        <tbody>{categories.map((category) => <tr key={category.category}>
          <th>{categoryLabel(category.category)}</th>
          <td>{hasPlan ? formatMoney(category.planned_amount, group.currency) : "—"}</td>
          <td>{hasPlan ? formatPercent(category.planned_share_percent) : "—"}</td>
          <td>{formatMoney(category.actual_to_date, group.currency)}</td><td>{formatPercent(category.actual_share_percent)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </section>;
}

function AnnualMonthTable({ group }: { group: HistoryYearGroup }) {
  return <div className="table-scroll"><table className="data-table financial-table">
    <caption className="sr-only">{group.year} 年各月执行明细</caption>
    <thead><tr><th>月份</th><th>计划收入</th><th>实际收入</th><th>计划支出</th><th>实际支出</th><th>实际净结余</th><th>储蓄率</th></tr></thead>
    <tbody>{[...group.months].reverse().map((month) => <tr key={month.month}>
      <th><Link className="table-link" to={`/history/${month.month}`}>{monthLabel(month.month)}</Link></th>
      <td>{month.planned_item_count > 0 ? formatMoney(month.income.planned, group.currency) : "—"}</td>
      <td>{formatMoney(month.income.actual_to_date, group.currency)}</td>
      <td>{month.planned_item_count > 0 ? formatMoney(month.expense.planned, group.currency) : "—"}</td>
      <td>{formatMoney(month.expense.actual_to_date, group.currency)}</td>
      <td>{formatMoney(month.net_balance.actual_to_date, group.currency)}</td><td>{formatPercent(month.actual_savings_rate_percent)}</td>
    </tr>)}</tbody>
  </table></div>;
}
