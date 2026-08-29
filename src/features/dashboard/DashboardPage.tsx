import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { CapacityPanel } from "../analytics/CapacityPanel";
import {
  getFinancialCapacity,
  getMonthAnalytics,
  getSettings,
  queryKeys,
  type AmountComparison,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { describeError } from "../../shared/formatting/errors";
import { categoryLabel } from "../../shared/formatting/labels";

export function DashboardPage() {
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const month = settingsQuery.data?.target_month ?? "";
  const analyticsQuery = useQuery({
    queryKey: queryKeys.monthAnalytics(month),
    queryFn: () => getMonthAnalytics(month),
    enabled: Boolean(month),
  });
  const capacityQuery = useQuery({
    queryKey: queryKeys.capacity(month),
    queryFn: () => getFinancialCapacity(month),
    enabled: Boolean(month),
  });
  const comparisonOption = useMemo(() => {
    const data = analyticsQuery.data;
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["计划", "当前实际"] },
      grid: { left: 54, right: 18, top: 42, bottom: 35 },
      xAxis: { type: "category", data: ["总收入", "总支出", "净结余"] },
      yAxis: { type: "value" },
      series: [
        {
          name: "计划",
          type: "bar",
          data: data ? [data.income.planned, data.expense.planned, data.net_balance.planned] : [],
          itemStyle: { color: "#8ca795" },
        },
        {
          name: "当前实际",
          type: "bar",
          data: data
            ? [
                data.income.actual_to_date,
                data.expense.actual_to_date,
                data.net_balance.actual_to_date,
              ]
            : [],
          itemStyle: { color: "#c79c58" },
        },
      ],
    };
  }, [analyticsQuery.data]);

  if (settingsQuery.isPending || analyticsQuery.isPending || capacityQuery.isPending) {
    return <section className="state-card">正在实时汇总目标月份…</section>;
  }
  if (settingsQuery.isError || analyticsQuery.isError || capacityQuery.isError) {
    return <section className="state-card"><span role="alert">{describeError(settingsQuery.error ?? analyticsQuery.error ?? capacityQuery.error)}</span></section>;
  }
  if (!analyticsQuery.data || !capacityQuery.data) {
    return <section className="state-card">尚未完成首次设置。</section>;
  }
  const analytics = analyticsQuery.data;
  const actualQualifier = analytics.actual_status === "COMPLETE" ? "最终实际" : analytics.actual_status === "PARTIAL" ? "当前已录" : "暂无实际";

  return (
    <>
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">Dashboard · {analytics.month}</p>
          <h1>本月计划执行到哪里了？</h1>
          <p>所有数字直接来自月度快照；实际未完整时明确标记为“当前已录”。</p>
        </div>
        <div className={"completeness-card status-" + analytics.actual_status.toLowerCase()}>
          <span>实际数据完整度</span>
          <strong>{analytics.completeness_percent ? analytics.completeness_percent + "%" : "N/A"}</strong>
          <small>{analytics.recorded_item_count} / {analytics.total_item_count} 项 · {actualQualifier}</small>
        </div>
      </header>

      <section className="metric-grid" aria-label="目标月份总览">
        <MetricCard title="总收入" comparison={analytics.income} currency={analytics.currency} actualQualifier={actualQualifier} kind="income" isComplete={analytics.actual_status === "COMPLETE"} />
        <MetricCard title="总支出" comparison={analytics.expense} currency={analytics.currency} actualQualifier={actualQualifier} kind="expense" isComplete={analytics.actual_status === "COMPLETE"} />
        <MetricCard title="净结余" comparison={analytics.net_balance} currency={analytics.currency} actualQualifier={actualQualifier} kind="balance" isComplete={analytics.actual_status === "COMPLETE"} />
        <article className="metric-card">
          <span className="section-label">储蓄率</span>
          <div className="metric-pair"><div><small>计划</small><strong>{analytics.planned_savings_rate_percent ? analytics.planned_savings_rate_percent + "%" : "N/A"}</strong></div><div><small>{actualQualifier}</small><strong>{analytics.actual_savings_rate_percent ? analytics.actual_savings_rate_percent + "%" : "N/A"}</strong></div></div>
          <p>{analytics.savings_rate_percentage_point_variance ? "相差 " + analytics.savings_rate_percentage_point_variance + " 个百分点" : "收入为 0 或实际尚不可计算"}</p>
          <div className="submetrics"><span>计划目标完成率 <b>{analytics.savings_rate_target_completion_percent ? analytics.savings_rate_target_completion_percent + "%" : "N/A"}</b></span><span>相对偏离 <b>{analytics.savings_rate_relative_deviation_percent ? analytics.savings_rate_relative_deviation_percent + "%" : "N/A"}</b></span></div>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="analysis-card">
          <header><div><p className="section-label">Plan vs Actual</p><h2>收支与结余对照</h2></div><span>{actualQualifier}</span></header>
          <AnalyticsChart option={comparisonOption} label={analytics.month + " 计划与当前实际的收入、支出和净结余柱状图"} />
          <table className="data-table">
            <caption className="sr-only">图表对应数值</caption>
            <thead><tr><th>指标</th><th>计划</th><th>{actualQualifier}</th></tr></thead>
            <tbody>
              {[["总收入", analytics.income], ["总支出", analytics.expense], ["净结余", analytics.net_balance]].map(([label, comparison]) => {
                const value = comparison as AmountComparison;
                return <tr key={label as string}><th>{label as string}</th><td>{value.planned}</td><td>{value.actual_to_date ?? "N/A"}</td></tr>;
              })}
            </tbody>
          </table>
        </section>
        <section className="analysis-card variance-list">
          <header><div><p className="section-label">重要偏差</p><h2>先看最值得处理的项目</h2></div></header>
          {analytics.important_variances.length === 0 && <p className="empty-copy">尚无已录入偏差。</p>}
          {analytics.important_variances.map((item) => (
            <article key={item.monthly_item_id}>
              <div><strong>{item.name}</strong><small>{categoryLabel(item.category)}</small></div>
              <div className={"variance-value variance-" + item.variance_effect.toLowerCase()}>
                <strong>{item.variance_amount === null ? "尚不可比较" : `${item.variance_amount} ${analytics.currency}`}</strong>
                <small>{varianceCopy(item.variance_effect, item.flow_type)}</small>
              </div>
            </article>
          ))}
        </section>
      </div>
      <CapacityPanel capacity={capacityQuery.data} />
    </>
  );
}

function MetricCard({ title, comparison, currency, actualQualifier, kind, isComplete }: { title: string; comparison: AmountComparison; currency: string; actualQualifier: string; kind: "income" | "expense" | "balance"; isComplete: boolean }) {
  const flowType = kind === "income" ? "INCOME" : kind === "expense" ? "EXPENSE" : "BALANCE";
  const comparisonCopy = isComplete
    ? varianceCopy(comparison.variance_effect, flowType)
    : partialVarianceCopy(comparison.variance_effect, flowType);
  return (
    <article className="metric-card">
      <span className="section-label">{title}</span>
      <div className="metric-pair"><div><small>计划</small><strong>{comparison.planned}</strong></div><div><small>{actualQualifier}</small><strong>{comparison.actual_to_date ?? "N/A"}</strong></div></div>
      <p>{comparison.variance ? comparisonCopy + " · " + comparison.variance + " " + currency : "实际尚不可比较"}</p>
    </article>
  );
}

function partialVarianceCopy(effect: string, flowType: string) {
  if (effect === "ON_PLAN") return "当前已录与计划一致";
  if (effect === "UNKNOWN") return "尚未录入";
  const actualIsHigher = flowType === "EXPENSE" ? effect === "UNFAVORABLE" : effect === "FAVORABLE";
  return actualIsHigher ? "当前已录高于计划" : "当前已录低于计划";
}

function varianceCopy(effect: string, flowType: string) {
  if (effect === "ON_PLAN") return "与计划一致";
  if (effect === "UNKNOWN") return "尚未录入";
  if (flowType === "INCOME") return effect === "FAVORABLE" ? "多收入" : "少收入";
  if (flowType === "EXPENSE") return effect === "FAVORABLE" ? "节省" : "超支";
  return effect === "FAVORABLE" ? "结余改善" : "结余下降";
}
