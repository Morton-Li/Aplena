import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  getFinancialCapacity,
  getHistoryAnalytics,
  getMonthAnalytics,
  getSettings,
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

  if (
    settingsQuery.isPending ||
    analyticsQuery.isPending ||
    historyQuery.isPending ||
    capacityQuery.isPending
  ) {
    return <section className="state-card">正在计算分类、项目与财务承载能力…</section>;
  }
  if (
    settingsQuery.isError ||
    analyticsQuery.isError ||
    historyQuery.isError ||
    capacityQuery.isError
  ) {
    return (
      <section className="state-card">
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
  if (!analyticsQuery.data || !capacityQuery.data) {
    return <section className="state-card">尚未完成首次设置。</section>;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">财务分析 · {analyticsQuery.data.month}</p>
          <h1>结构与承载能力</h1>
          <p>分类、占比、项目排名和承载能力均由月度快照实时派生。</p>
        </div>
        <span className="context-chip">
          实际完整度 {percent(analyticsQuery.data.completeness_percent)}
        </span>
      </header>

      <StructureSection analytics={analyticsQuery.data} history={historyQuery.data.months} />
      <ProjectRanking analytics={analyticsQuery.data} />
      <CapacityPanel capacity={capacityQuery.data} />
    </>
  );
}

function StructureSection({
  analytics,
  history,
}: {
  analytics: MonthAnalytics;
  history: MonthAnalytics[];
}) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const categories = analytics.categories.filter((item) => item.flow_type === flow);
  const structureOption = useMemo(() => categoryStructureOption(categories), [categories]);
  const historyOption = useMemo(() => categoryHistoryOption(history, flow), [history, flow]);
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
            label={`${analytics.month}${flowLabel(flow)}分类计划与实际占比柱状图`}
          />
          <CategoryTable categories={categories} actualLabel={actualLabel} currency={analytics.currency} />
        </section>
        <section className="analysis-card">
          <header>
            <h3>历史结构变化</h3>
            <span>按月快照</span>
          </header>
          <AnalyticsChart
            option={historyOption}
            label={`各月${flowLabel(flow)}分类计划金额变化趋势图`}
          />
          <CategoryHistoryTable history={history} flow={flow} />
        </section>
      </div>
    </section>
  );
}

function ProjectRanking({ analytics }: { analytics: MonthAnalytics }) {
  const [flow, setFlow] = useState<FlowFilter>("EXPENSE");
  const [mode, setMode] = useState<RankingMode>("PLANNED");
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
              options={[
                { value: "PLANNED", label: "计划金额" },
                { value: "ACTUAL", label: "实际金额" },
              ]}
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
}: {
  categories: CategoryBreakdown[];
  actualLabel: string;
  currency: string;
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
            <td>{formatMoney(item.planned_amount, currency)}</td>
            <td>{percent(item.planned_share_percent)}</td>
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
}: {
  history: MonthAnalytics[];
  flow: FlowFilter;
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
                {formatMoney(month.categories.find((item) => item.category === category)?.planned_amount ?? null, month.currency)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function categoryStructureOption(categories: CategoryBreakdown[]) {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["计划占比", "实际占比"], textStyle: chartLegendText },
    grid: { left: 48, right: 18, top: 50, bottom: 70 },
    xAxis: {
      type: "category",
      data: categories.map((item) => categoryLabel(item.category)),
      axisLabel: { interval: 0, rotate: 18 },
    },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: [
      {
        name: "计划占比",
        type: "bar",
        data: categories.map((item) => item.planned_share_percent),
        itemStyle: { color: "#94a3b8" },
      },
      {
        name: "实际占比",
        type: "bar",
        data: categories.map((item) => item.actual_share_percent),
        itemStyle: { color: "#2563eb" },
      },
    ],
  };
}

function categoryHistoryOption(history: MonthAnalytics[], flow: FlowFilter) {
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
          month.categories.find((item) => item.category === category)?.planned_amount ?? "0.00",
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
