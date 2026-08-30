import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  getFinancialCapacity,
  getHistoryAnalytics,
  getMonthAnalytics,
  getSettings,
  listPlanItems,
  queryKeys,
  type CategoryBreakdown,
  type MonthAnalytics,
  type ProjectBreakdown,
} from "../../shared/api/finance";
import { AnalyticsChart } from "../../shared/components/AnalyticsChart";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel } from "../../shared/formatting/labels";
import { CapacityPanel } from "./CapacityPanel";

type FlowFilter = "INCOME" | "EXPENSE";
type RankingMode = "PLANNED" | "ACTUAL";

export function AnalysisPage() {
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
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });

  if (
    settingsQuery.isPending ||
    analyticsQuery.isPending ||
    historyQuery.isPending ||
    capacityQuery.isPending ||
    plansQuery.isPending
  ) {
    return <section className="state-card">正在计算分类、项目与财务承载能力…</section>;
  }
  if (
    settingsQuery.isError ||
    analyticsQuery.isError ||
    historyQuery.isError ||
    capacityQuery.isError ||
    plansQuery.isError
  ) {
    return (
      <section className="state-card">
        <span role="alert">
          {describeError(
            settingsQuery.error ??
              analyticsQuery.error ??
              historyQuery.error ??
              capacityQuery.error ??
              plansQuery.error,
          )}
        </span>
      </section>
    );
  }
  if (!analyticsQuery.data || !capacityQuery.data) {
    return <section className="state-card">尚未完成首次设置。</section>;
  }

  const hasPlanBaseline = analyticsQuery.data.planned_item_count > 0;
  const hasLongTermPlans = (plansQuery.data?.length ?? 0) > 0;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">财务分析 · {analyticsQuery.data.month}</p>
          <h1>{hasLongTermPlans ? "结构与承载能力" : "收支结构分析"}</h1>
          <p>{hasLongTermPlans ? "分类、占比、项目排名和承载能力均由月度数据实时派生。" : "分类、占比和项目排名均由月度实际实时派生；长期规划分析可按需启用。"}</p>
        </div>
        <span className="context-chip">
          实际完整度 {percent(analyticsQuery.data.completeness_percent)}
        </span>
      </header>

      <StructureSection analytics={analyticsQuery.data} history={historyQuery.data.months} hasPlanBaseline={hasPlanBaseline} />
      <ProjectRanking analytics={analyticsQuery.data} hasPlanBaseline={hasPlanBaseline} />
      {hasLongTermPlans ? <CapacityPanel capacity={capacityQuery.data} /> : <section className="capacity-panel capacity-panel-optional"><header><div><p className="section-label">可选增强</p><h2>财务承载能力尚未启用</h2></div></header><p>设置长期收入与支出后，Aplena 才会计算可承担的新长期支出；当前月度实际和结构分析不受影响。</p><Link className="button button-secondary" to="/plans">设置长期计划</Link></section>}
    </>
  );
}

function StructureSection({
  analytics,
  history,
  hasPlanBaseline,
}: {
  analytics: MonthAnalytics;
  history: MonthAnalytics[];
  hasPlanBaseline: boolean;
}) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const categories = analytics.categories.filter((item) => item.flow_type === flow);
  const structureOption = useMemo(() => categoryStructureOption(categories, hasPlanBaseline), [categories, hasPlanBaseline]);
  const historyHasPlanBaseline = history.some((month) => month.planned_item_count > 0);
  const historyOption = useMemo(() => categoryHistoryOption(history, flow, historyHasPlanBaseline), [history, flow, historyHasPlanBaseline]);
  const actualLabel = analytics.actual_status === "COMPLETE" ? "最终实际" : "当前已录";

  return (
    <section className="analysis-section">
      <header className="section-heading">
        <div>
          <p className="section-label">Category Structure</p>
          <h2>分类结构</h2>
        </div>
        <div className="segmented-control" aria-label="结构方向" role="group">
          <button
            aria-pressed={flow === "INCOME"}
            className={flow === "INCOME" ? "segment-active" : ""}
            onClick={() => setFlow("INCOME")}
            type="button"
          >
            收入结构
          </button>
          <button
            aria-pressed={flow === "EXPENSE"}
            className={flow === "EXPENSE" ? "segment-active" : ""}
            onClick={() => setFlow("EXPENSE")}
            type="button"
          >
            支出结构
          </button>
        </div>
      </header>

      <div className="structure-grid">
        <section className="analysis-card">
          <header>
            <h3>{flowLabel(flow)}分类占比</h3>
            <span>{actualLabel}</span>
          </header>
          <AnalyticsChart
            option={structureOption}
            label={`${analytics.month}${flowLabel(flow)}分类${hasPlanBaseline ? "计划与实际" : "实际"}占比柱状图`}
          />
          <CategoryTable categories={categories} actualLabel={actualLabel} currency={analytics.currency} hasPlanBaseline={hasPlanBaseline} />
        </section>
        <section className="analysis-card">
          <header>
            <h3>历史结构变化</h3>
            <span>{historyHasPlanBaseline ? "计划基准" : "月度实际"}</span>
          </header>
          <AnalyticsChart
            option={historyOption}
            label={`各月${flowLabel(flow)}分类${historyHasPlanBaseline ? "计划" : "实际"}金额变化趋势图`}
          />
          <CategoryHistoryTable history={history} flow={flow} usePlan={historyHasPlanBaseline} />
        </section>
      </div>
    </section>
  );
}

function ProjectRanking({ analytics, hasPlanBaseline }: { analytics: MonthAnalytics; hasPlanBaseline: boolean }) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const [mode, setMode] = useState<RankingMode>(hasPlanBaseline ? "PLANNED" : "ACTUAL");
  const projects = analytics.projects
    .filter((project) => project.flow_type === flow)
    .filter((project) => mode === "PLANNED" || project.actual_rank !== null)
    .sort((left, right) =>
      mode === "PLANNED"
        ? left.planned_rank - right.planned_rank
        : (left.actual_rank ?? Number.MAX_SAFE_INTEGER) -
          (right.actual_rank ?? Number.MAX_SAFE_INTEGER),
    );
  const option = useMemo(() => projectRankingOption(projects, mode), [projects, mode]);
  const amountLabel = mode === "PLANNED" ? "计划金额" : "当前实际";

  return (
    <section className="analysis-section">
      <header className="section-heading ranking-heading">
        <div>
          <p className="section-label">Item Ranking</p>
          <h2>项目占比与排名</h2>
        </div>
        <div className="ranking-controls">
          <label>
            方向
            <Select
              ariaLabel="方向"
              value={flow}
              onChange={(value) => setFlow(value as FlowFilter)}
              options={[
                { value: "EXPENSE", label: "支出项目" },
                { value: "INCOME", label: "收入项目" },
              ]}
            />
          </label>
          <label>
            排名依据
            <Select
              ariaLabel="排名依据"
              value={mode}
              onChange={(value) => setMode(value as RankingMode)}
              options={hasPlanBaseline ? [
                { value: "PLANNED", label: "计划金额" },
                { value: "ACTUAL", label: "实际金额" },
              ] : [{ value: "ACTUAL", label: "实际金额" }]}
            />
          </label>
        </div>
      </header>
      <section className="analysis-card ranking-card">
        {projects.length === 0 ? (
          <p className="empty-copy">当前筛选没有可排名项目；未录入的实际金额不会当作 0 参与排名。</p>
        ) : (
          <>
            <AnalyticsChart
              option={option}
              label={`${analytics.month}${flowLabel(flow)}项目按${amountLabel}排序的横向条形图`}
              height={Math.max(300, projects.length * 44)}
            />
            <table className="data-table">
              <caption className="sr-only">项目排名图对应数值</caption>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>项目</th>
                  <th>类别</th>
                  <th>{amountLabel}</th>
                  <th>占比</th>
                  <th>偏差</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.monthly_item_id}>
                    <td>{mode === "PLANNED" ? project.planned_rank : project.actual_rank}</td>
                    <th>{project.name}</th>
                    <td>{categoryLabel(project.category)}</td>
                    <td>{formatMoney(mode === "PLANNED" ? project.planned_amount : project.actual_amount, analytics.currency)}</td>
                    <td>
                      {(mode === "PLANNED"
                        ? project.planned_share_percent
                        : project.actual_share_percent) ?? "—"}
                      {(mode === "PLANNED"
                        ? project.planned_share_percent
                        : project.actual_share_percent) === null
                        ? ""
                        : "%"}
                    </td>
                    <td>{formatMoney(project.variance_amount, analytics.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </section>
  );
}

function CategoryTable({
  categories,
  actualLabel,
  currency,
  hasPlanBaseline,
}: {
  categories: CategoryBreakdown[];
  actualLabel: string;
  currency: string;
  hasPlanBaseline: boolean;
}) {
  return (
    <table className="data-table">
      <caption className="sr-only">分类结构图对应数值</caption>
      <thead>
        <tr>
          <th>类别</th>
          <th>计划金额</th>
          <th>计划占比</th>
          <th>{actualLabel}</th>
          <th>实际占比</th>
        </tr>
      </thead>
      <tbody>
        {categories.map((item) => (
          <tr key={item.category}>
            <th>{categoryLabel(item.category)}</th>
            <td>{hasPlanBaseline ? formatMoney(item.planned_amount, currency) : "—"}</td>
            <td>{hasPlanBaseline ? percent(item.planned_share_percent) : "—"}</td>
            <td>{formatMoney(item.actual_to_date, currency)}</td>
            <td>{percent(item.actual_share_percent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CategoryHistoryTable({
  history,
  flow,
  usePlan,
}: {
  history: MonthAnalytics[];
  flow: FlowFilter;
  usePlan: boolean;
}) {
  const categoryCodes = flow === "INCOME"
    ? ["FIXED_INCOME", "VARIABLE_INCOME"]
    : ["ESSENTIAL_EXPENSE", "FIXED_COMMITMENT_EXPENSE", "DISCRETIONARY_BUDGET"];
  return (
    <table className="data-table">
      <caption className="sr-only">分类历史趋势图对应数值</caption>
      <thead>
        <tr>
          <th>月份</th>
          {categoryCodes.map((category) => <th key={category}>{categoryLabel(category)}</th>)}
        </tr>
      </thead>
      <tbody>
        {history.map((month) => (
          <tr key={month.month}>
            <th>{month.month}</th>
            {categoryCodes.map((category) => (
              <td key={category}>
                {formatMoney(usePlan ? month.categories.find((item) => item.category === category)?.planned_amount ?? null : month.categories.find((item) => item.category === category)?.actual_to_date ?? null, month.currency)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function categoryStructureOption(categories: CategoryBreakdown[], hasPlanBaseline: boolean) {
  const actualSeries = {
    name: "实际占比",
    type: "bar",
    data: categories.map((item) => item.actual_share_percent),
    itemStyle: { color: "#2563eb" },
  };
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: hasPlanBaseline ? ["计划占比", "实际占比"] : ["实际占比"], textStyle: chartLegendText },
    grid: { left: 48, right: 18, top: 50, bottom: 70 },
    xAxis: {
      type: "category",
      data: categories.map((item) => categoryLabel(item.category)),
      axisLabel: { interval: 0, rotate: 18 },
    },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: hasPlanBaseline ? [
      {
        name: "计划占比",
        type: "bar",
        data: categories.map((item) => item.planned_share_percent),
        itemStyle: { color: "#94a3b8" },
      },
      actualSeries,
    ] : [actualSeries],
  };
}

function categoryHistoryOption(history: MonthAnalytics[], flow: FlowFilter, usePlan: boolean) {
  const categories = flow === "INCOME"
    ? ["FIXED_INCOME", "VARIABLE_INCOME"]
    : ["ESSENTIAL_EXPENSE", "FIXED_COMMITMENT_EXPENSE", "DISCRETIONARY_BUDGET"];
  const colors = ["#2563eb", "#4f46e5", "#64748b"];
  return {
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", top: 0, left: 0, right: 0, data: categories.map(categoryLabel), textStyle: chartLegendText },
    grid: { left: 55, right: 18, top: 62, bottom: 40 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: history.map((month) => month.month),
      axisLabel: compactMonthLabels(history.length),
    },
    yAxis: { type: "value" },
    series: categories.map((category, index) => ({
      name: categoryLabel(category),
      type: "line",
      data: history.map(
        (month) =>
          usePlan
            ? month.categories.find((item) => item.category === category)?.planned_amount ?? null
            : month.categories.find((item) => item.category === category)?.actual_to_date ?? null,
      ),
      itemStyle: { color: colors[index] },
      lineStyle: { color: colors[index] },
    })),
  };
}

const chartLegendText = { color: "#64748b", fontSize: 11 };

function compactMonthLabels(count: number) {
  return {
    hideOverlap: true,
    interval: count > 6 ? 1 : 0,
    formatter: (value: string) => value.slice(2),
  };
}

function projectRankingOption(projects: ProjectBreakdown[], mode: RankingMode) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 105, right: 24, top: 25, bottom: 35 },
    xAxis: { type: "value" },
    yAxis: {
      type: "category",
      inverse: true,
      data: projects.map((item) => item.name),
    },
    series: [
      {
        name: mode === "PLANNED" ? "计划金额" : "实际金额",
        type: "bar",
        data: projects.map((item) =>
          mode === "PLANNED" ? item.planned_amount : item.actual_amount,
        ),
        itemStyle: { color: mode === "PLANNED" ? "#94a3b8" : "#2563eb" },
      },
    ],
  };
}

function percent(value: string | null) {
  return formatPercent(value);
}
