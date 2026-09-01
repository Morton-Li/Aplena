import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type {
  AmountComparison,
  CategoryBreakdown,
  MonthAnalytics,
  ProjectBreakdown,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel } from "../../shared/formatting/labels";

type FlowFilter = "INCOME" | "EXPENSE";
type ProjectTableSort = "PLANNED" | "ACTUAL";

export function MonthReportDetail({ analytics }: { analytics: MonthAnalytics }) {
  const hasPlanBaseline = analytics.planned_item_count > 0;
  const actualLabel = "实际记录";

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
            ? `冻结计划 ${formatPercent(analytics.planned_savings_rate_percent)}`
            : `${actualLabel} · 无计划基准`}
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
              <td>{hasPlanBaseline ? formatPercent(analytics.savings_rate_plan_completion_percent) : "—"}</td>
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
            <thead><tr><th>类别</th><th>计划金额</th><th>计划占比</th><th>{actualLabel}</th><th>实际占比</th></tr></thead>
            <tbody>{categories.map((item) => <tr key={item.category}><th>{categoryLabel(item.category)}</th><td>{hasPlanBaseline ? formatMoney(item.planned_amount, analytics.currency) : "—"}</td><td>{hasPlanBaseline ? formatPercent(item.planned_share_percent) : "—"}</td><td>{formatMoney(item.actual_to_date, analytics.currency)}</td><td>{formatPercent(item.actual_share_percent)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function ProjectRanking({ analytics, hasPlanBaseline }: { analytics: MonthAnalytics; hasPlanBaseline: boolean }) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const [tableSort, setTableSort] = useState<ProjectTableSort>("ACTUAL");
  const flowProjects = analytics.projects.filter((project) => project.flow_type === flow);
  const hasFlowPlan = hasPlanBaseline && flowProjects.some(projectHasPlan);
  const tableProjects = [...flowProjects].sort(tableSort === "PLANNED" && hasFlowPlan
    ? compareByPlannedRank
    : compareByActualRank);

  return (
    <section className="analysis-section">
      <header className="section-heading ranking-heading">
        <div><p className="section-label">Item Ranking</p><h2>项目占比与排名</h2></div>
        <div className="segmented-control" aria-label="项目方向" role="group">
          <button aria-pressed={flow === "EXPENSE"} className={flow === "EXPENSE" ? "segment-active" : ""} onClick={() => setFlow("EXPENSE")} type="button">支出项目</button>
          <button aria-pressed={flow === "INCOME"} className={flow === "INCOME" ? "segment-active" : ""} onClick={() => setFlow("INCOME")} type="button">收入项目</button>
        </div>
      </header>
      <section className="analysis-card ranking-card">
        <header className="ranking-card-header">
          <div><h3>{flowLabel(flow)}项目对照</h3><span>计划、实际、占比与排名同屏</span></div>
          {flowProjects.length > 0 && <small>共 {flowProjects.length} 项 · 默认按实际金额排序</small>}
        </header>
        {flowProjects.length === 0 ? <p className="empty-copy">该月份没有{flowLabel(flow)}项目。</p> : <>
          <div className="table-scroll ranking-table-scroll">
            <table className="data-table ranking-comparison-table">
              <caption className="sr-only">项目计划与实际对照数据</caption>
              <thead><tr>
                <th>实际排名</th>
                <th>项目 / 类别</th>
                {hasFlowPlan && <th><button aria-pressed={tableSort === "PLANNED"} className="table-sort-button" onClick={() => setTableSort("PLANNED")} type="button">计划金额</button></th>}
                <th><button aria-pressed={tableSort === "ACTUAL" || !hasFlowPlan} className="table-sort-button" onClick={() => setTableSort("ACTUAL")} type="button">实际金额</button></th>
                {hasFlowPlan && <th>偏差</th>}
                <th><span className="sr-only">操作</span></th>
              </tr></thead>
              <tbody>{tableProjects.map((project) => (
                <ProjectComparisonRow
                  currency={analytics.currency}
                  hasFlowPlan={hasFlowPlan}
                  key={project.monthly_item_id}
                  month={analytics.month}
                  project={project}
                />
              ))}</tbody>
            </table>
          </div>
        </>}
      </section>
    </section>
  );
}

function ProjectComparisonRow({
  project,
  currency,
  hasFlowPlan,
  month,
}: {
  project: ProjectBreakdown;
  currency: string;
  hasFlowPlan: boolean;
  month: string;
}) {
  const hasPlan = projectHasPlan(project);
  return (
    <tr>
      <td className="ranking-rank-cell">
        <strong>{project.actual_rank === null ? "—" : `#${project.actual_rank}`}</strong>
        {hasFlowPlan && <small>{rankComparisonLabel(project, hasPlan)}</small>}
      </td>
      <th className="ranking-project-cell" scope="row"><strong>{project.name}</strong><small>{categoryLabel(project.category)}</small></th>
      {hasFlowPlan && <td className="ranking-value-cell">
        {hasPlan
          ? <><strong>{formatMoney(project.planned_amount, currency)}</strong><small>{formatPercent(project.planned_share_percent)}</small></>
          : <><strong>计划外</strong><small>无计划基准</small></>}
      </td>}
      <td className={`ranking-value-cell${project.actual_amount === null ? " ranking-value-missing" : ""}`}>
        {project.actual_amount === null
          ? <><strong>未录入</strong><small>不按零参与排名</small></>
          : <><strong>{formatMoney(project.actual_amount, currency)}</strong><small>{formatPercent(project.actual_share_percent)}</small></>}
      </td>
      {hasFlowPlan && <td className="ranking-value-cell">
        <strong>{hasPlan && project.actual_amount !== null ? formatMoney(project.variance_amount, currency) : "—"}</strong>
        <small>{hasPlan ? varianceLabel(project.variance_effect, project.actual_amount) : "计划外项目"}</small>
      </td>}
      <td><Link className="history-row-action" to={`/monthly?month=${month}&item=${project.monthly_item_id}`}>调整条目</Link></td>
    </tr>
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

function projectHasPlan(project: ProjectBreakdown) {
  return !/^0(?:\.0+)?$/.test(project.planned_amount);
}

function compareByActualRank(left: ProjectBreakdown, right: ProjectBreakdown) {
  return (left.actual_rank ?? Number.MAX_SAFE_INTEGER) - (right.actual_rank ?? Number.MAX_SAFE_INTEGER)
    || left.planned_rank - right.planned_rank
    || left.name.localeCompare(right.name, "zh-CN");
}

function compareByPlannedRank(left: ProjectBreakdown, right: ProjectBreakdown) {
  return left.planned_rank - right.planned_rank
    || (left.actual_rank ?? Number.MAX_SAFE_INTEGER) - (right.actual_rank ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name, "zh-CN");
}

function rankComparisonLabel(project: ProjectBreakdown, hasPlan: boolean) {
  if (!hasPlan) return project.actual_rank === null ? "计划外 · 未录入" : "计划外新增";
  if (project.actual_rank === null) return `计划 #${project.planned_rank} · 未录入`;
  const movement = project.planned_rank - project.actual_rank;
  if (movement > 0) return `计划 #${project.planned_rank} · ↑${movement}`;
  if (movement < 0) return `计划 #${project.planned_rank} · ↓${Math.abs(movement)}`;
  return `计划 #${project.planned_rank} · 持平`;
}

function varianceLabel(effect: ProjectBreakdown["variance_effect"], actualAmount: string | null) {
  if (actualAmount === null) return "等待实际数据";
  return effect === "FAVORABLE"
    ? "有利"
    : effect === "UNFAVORABLE"
      ? "需关注"
      : effect === "ON_PLAN"
        ? "符合计划"
        : "无计划基准";
}

const chartLegendText = { color: "#64748b", fontSize: 11 };
