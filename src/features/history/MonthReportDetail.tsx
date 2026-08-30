import { useMemo, useState } from "react";

import type {
  AmountComparison,
  CategoryBreakdown,
  MonthAnalytics,
  ProjectBreakdown,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { Select } from "../../shared/components/Select";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel } from "../../shared/formatting/labels";

type FlowFilter = "INCOME" | "EXPENSE";
type RankingMode = "PLANNED" | "ACTUAL";

export function MonthReportDetail({ analytics }: { analytics: MonthAnalytics }) {
  const hasPlanBaseline = analytics.planned_item_count > 0;
  const actualLabel = analytics.actual_status === "COMPLETE" ? "最终实际" : "当前已录";

  return (
    <div className="month-report-detail">
      <MonthSummary analytics={analytics} actualLabel={actualLabel} hasPlanBaseline={hasPlanBaseline} />
      <ExecutionTable analytics={analytics} actualLabel={actualLabel} hasPlanBaseline={hasPlanBaseline} />
      <CategoryAnalysis analytics={analytics} actualLabel={actualLabel} hasPlanBaseline={hasPlanBaseline} />
      <ProjectRanking analytics={analytics} hasPlanBaseline={hasPlanBaseline} />
      <VarianceSection analytics={analytics} hasPlanBaseline={hasPlanBaseline} />
    </div>
  );
}

function MonthSummary({
  analytics,
  actualLabel,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  actualLabel: string;
  hasPlanBaseline: boolean;
}) {
  const rows: Array<[string, AmountComparison]> = [
    ["总收入", analytics.income],
    ["总支出", analytics.expense],
    ["净结余", analytics.net_balance],
  ];
  return (
    <section className="history-summary" aria-label={`${analytics.month} 核心指标`}>
      {rows.map(([label, metric]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{formatMoney(metric.actual_to_date, analytics.currency)}</strong>
          <small>
            {hasPlanBaseline
              ? `计划 ${formatMoney(metric.planned, analytics.currency)} · 差额 ${formatMoney(metric.variance, analytics.currency)}`
              : `${actualLabel} · 无计划基准`}
          </small>
        </article>
      ))}
      <article>
        <span>储蓄率</span>
        <strong>{formatPercent(analytics.actual_savings_rate_percent)}</strong>
        <small>
          {hasPlanBaseline
            ? `计划 ${formatPercent(analytics.planned_savings_rate_percent)} · 目标 ${formatPercent(analytics.minimum_savings_rate_percent)}`
            : `目标 ${formatPercent(analytics.minimum_savings_rate_percent)}`}
        </small>
      </article>
    </section>
  );
}

function ExecutionTable({
  analytics,
  actualLabel,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  actualLabel: string;
  hasPlanBaseline: boolean;
}) {
  const rows: Array<[string, AmountComparison]> = [
    ["总收入", analytics.income],
    ["总支出", analytics.expense],
    ["净结余", analytics.net_balance],
  ];
  return (
    <section className="analysis-card history-execution-card">
      <header>
        <div><p className="section-label">Monthly Statement</p><h2>月度执行结果</h2></div>
        <span>{actualLabel}</span>
      </header>
      <div className="table-scroll">
        <table className="data-table financial-table">
          <caption className="sr-only">{analytics.month} 月度执行结果</caption>
          <thead><tr><th>指标</th><th>计划</th><th>{actualLabel}</th><th>差额</th><th>完成率</th></tr></thead>
          <tbody>
            {rows.map(([label, metric]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{hasPlanBaseline ? formatMoney(metric.planned, analytics.currency) : "—"}</td>
                <td>{formatMoney(metric.actual_to_date, analytics.currency)}</td>
                <td>{hasPlanBaseline ? formatMoney(metric.variance, analytics.currency) : "—"}</td>
                <td>{hasPlanBaseline ? formatPercent(metric.completion_percent) : "—"}</td>
              </tr>
            ))}
            <tr>
              <th>储蓄率</th>
              <td>{hasPlanBaseline ? formatPercent(analytics.planned_savings_rate_percent) : "—"}</td>
              <td>{formatPercent(analytics.actual_savings_rate_percent)}</td>
              <td>{hasPlanBaseline ? `${analytics.savings_rate_percentage_point_variance ?? "—"} 个百分点` : "—"}</td>
              <td>{hasPlanBaseline ? formatPercent(analytics.savings_rate_target_completion_percent) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryAnalysis({
  analytics,
  actualLabel,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  actualLabel: string;
  hasPlanBaseline: boolean;
}) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const categories = analytics.categories.filter((item) => item.flow_type === flow);
  const option = useMemo(
    () => categoryStructureOption(categories, hasPlanBaseline),
    [categories, hasPlanBaseline],
  );

  return (
    <section className="analysis-section">
      <header className="section-heading">
        <div><p className="section-label">Category Structure</p><h2>分类结构</h2></div>
        <div className="segmented-control" aria-label="结构方向" role="group">
          <button aria-pressed={flow === "INCOME"} className={flow === "INCOME" ? "segment-active" : ""} onClick={() => setFlow("INCOME")} type="button">收入结构</button>
          <button aria-pressed={flow === "EXPENSE"} className={flow === "EXPENSE" ? "segment-active" : ""} onClick={() => setFlow("EXPENSE")} type="button">支出结构</button>
        </div>
      </header>
      <section className="analysis-card history-category-card">
        <header><h3>{flowLabel(flow)}分类金额与占比</h3><span>{actualLabel}</span></header>
        <AnalyticsChart option={option} label={`${analytics.month}${flowLabel(flow)}分类${hasPlanBaseline ? "计划与实际" : "实际"}占比图`} height={300} />
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">分类结构图对应数据</caption>
            <thead><tr><th>类别</th><th>计划金额</th><th>计划占比</th><th>{actualLabel}</th><th>实际占比</th><th>未录入</th></tr></thead>
            <tbody>{categories.map((item) => <tr key={item.category}><th>{categoryLabel(item.category)}</th><td>{hasPlanBaseline ? formatMoney(item.planned_amount, analytics.currency) : "—"}</td><td>{hasPlanBaseline ? formatPercent(item.planned_share_percent) : "—"}</td><td>{formatMoney(item.actual_to_date, analytics.currency)}</td><td>{formatPercent(item.actual_share_percent)}</td><td>{item.missing_actual_count}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function ProjectRanking({ analytics, hasPlanBaseline }: { analytics: MonthAnalytics; hasPlanBaseline: boolean }) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const [mode, setMode] = useState<RankingMode>(hasPlanBaseline ? "PLANNED" : "ACTUAL");
  const effectiveMode = hasPlanBaseline ? mode : "ACTUAL";
  const projects = analytics.projects
    .filter((project) => project.flow_type === flow)
    .filter((project) => effectiveMode === "PLANNED" || project.actual_rank !== null)
    .sort((left, right) => effectiveMode === "PLANNED"
      ? left.planned_rank - right.planned_rank
      : (left.actual_rank ?? Number.MAX_SAFE_INTEGER) - (right.actual_rank ?? Number.MAX_SAFE_INTEGER));
  const option = useMemo(() => projectRankingOption(projects, effectiveMode), [effectiveMode, projects]);
  const amountLabel = effectiveMode === "PLANNED" ? "计划金额" : "实际金额";

  return (
    <section className="analysis-section">
      <header className="section-heading ranking-heading">
        <div><p className="section-label">Item Ranking</p><h2>项目占比与排名</h2></div>
        <div className="ranking-controls">
          <label>方向<Select ariaLabel="方向" value={flow} onChange={(value) => setFlow(value as FlowFilter)} options={[{ value: "EXPENSE", label: "支出项目" }, { value: "INCOME", label: "收入项目" }]} /></label>
          <label>排名依据<Select ariaLabel="排名依据" value={effectiveMode} onChange={(value) => setMode(value as RankingMode)} options={hasPlanBaseline ? [{ value: "PLANNED", label: "计划金额" }, { value: "ACTUAL", label: "实际金额" }] : [{ value: "ACTUAL", label: "实际金额" }]} /></label>
        </div>
      </header>
      <section className="analysis-card ranking-card">
        {projects.length === 0 ? <p className="empty-copy">当前筛选没有可排名项目；未录入的实际金额不会按零参与排名。</p> : <>
          <AnalyticsChart option={option} label={`${analytics.month}${flowLabel(flow)}项目按${amountLabel}排名图`} height={Math.max(300, projects.length * 44)} />
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">项目排名图对应数据</caption><thead><tr><th>排名</th><th>项目</th><th>类别</th><th>{amountLabel}</th><th>占比</th><th>偏差</th></tr></thead><tbody>{projects.map((project) => <tr key={project.monthly_item_id}><td>{effectiveMode === "PLANNED" ? project.planned_rank : project.actual_rank}</td><th>{project.name}</th><td>{categoryLabel(project.category)}</td><td>{formatMoney(effectiveMode === "PLANNED" ? project.planned_amount : project.actual_amount, analytics.currency)}</td><td>{formatPercent(effectiveMode === "PLANNED" ? project.planned_share_percent : project.actual_share_percent)}</td><td>{hasPlanBaseline ? formatMoney(project.variance_amount, analytics.currency) : "—"}</td></tr>)}</tbody></table></div>
        </>}
      </section>
    </section>
  );
}

function VarianceSection({ analytics, hasPlanBaseline }: { analytics: MonthAnalytics; hasPlanBaseline: boolean }) {
  if (!hasPlanBaseline) return null;
  return (
    <section className="analysis-card history-variance-card">
      <header><div><p className="section-label">Variance Review</p><h2>重要偏差</h2></div><span>{analytics.important_variances.length} 项</span></header>
      {analytics.important_variances.length === 0 ? <p className="empty-copy">该月份没有需要重点关注的已录入偏差。</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>项目</th><th>类别</th><th>计划</th><th>实际</th><th>差额</th></tr></thead><tbody>{analytics.important_variances.map((item) => <tr key={item.monthly_item_id}><th>{item.name}</th><td>{categoryLabel(item.category)}</td><td>{formatMoney(item.planned_amount, analytics.currency)}</td><td>{formatMoney(item.actual_amount, analytics.currency)}</td><td>{formatMoney(item.variance_amount, analytics.currency)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

function categoryStructureOption(categories: CategoryBreakdown[], hasPlanBaseline: boolean) {
  const actualSeries = { name: "实际占比", type: "bar", data: categories.map((item) => item.actual_share_percent), itemStyle: { color: "#2563eb" } };
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: hasPlanBaseline ? ["计划占比", "实际占比"] : ["实际占比"], textStyle: chartLegendText },
    grid: { left: 48, right: 18, top: 50, bottom: 70 },
    xAxis: { type: "category", data: categories.map((item) => categoryLabel(item.category)), axisLabel: { interval: 0, rotate: 18 } },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: hasPlanBaseline ? [{ name: "计划占比", type: "bar", data: categories.map((item) => item.planned_share_percent), itemStyle: { color: "#94a3b8" } }, actualSeries] : [actualSeries],
  };
}

function projectRankingOption(projects: ProjectBreakdown[], mode: RankingMode) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 105, right: 24, top: 25, bottom: 35 },
    xAxis: { type: "value" },
    yAxis: { type: "category", inverse: true, data: projects.map((item) => item.name) },
    series: [{ name: mode === "PLANNED" ? "计划金额" : "实际金额", type: "bar", data: projects.map((item) => mode === "PLANNED" ? item.planned_amount : item.actual_amount), itemStyle: { color: mode === "PLANNED" ? "#94a3b8" : "#2563eb" } }],
  };
}

const chartLegendText = { color: "#64748b", fontSize: 11 };
