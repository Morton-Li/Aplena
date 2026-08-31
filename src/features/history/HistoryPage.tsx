import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getHistoryAnalytics, queryKeys, type MonthAnalytics } from "../../shared/api/finance";
import { EmptyState } from "../../shared/components/EmptyState";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent, monthLabel } from "../../shared/formatting/finance";
import { MonthReportDetail } from "./MonthReportDetail";
import {
  defaultExpandedHistoryYears,
  groupHistoryByYear,
  type HistoryYearGroup,
} from "./historyYearGroups";

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
    return <EmptyState eyebrow="历史保持只读" title="还没有可查看的月份" description="录入第一个月份的实际数据后，月度详细报告会自动出现在这里；浏览历史不会创建或修改数据。" action={<Link className="button button-primary" to="/monthly">录入本月实际</Link>} />;
  }
  return <HistoryIndex months={months} />;
}

function HistoryIndex({ months }: { months: MonthAnalytics[] }) {
  const groups = useMemo(() => groupHistoryByYear(months), [months]);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(
    () => new Set(defaultExpandedHistoryYears(groups)),
  );
  const toggleYear = (year: string) => {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">历史归档</p>
          <h1>历史报表</h1>
          <p>按年份浏览月度财务结果，再进入某个月查看完整分析；所有历史数据保持只读。</p>
        </div>
        <span className="context-chip">{groups.length} 个年度 · {months.length} 个月份</span>
      </header>

      <section className="history-year-index" aria-labelledby="history-year-index-title">
        <header className="section-heading history-index-heading">
          <div><p className="section-label">Monthly Reports</p><h2 id="history-year-index-title">按月份查看详细报告</h2></div>
          <span className="report-context">年份与月份均按最近优先</span>
        </header>
        <div className="history-year-groups">
          {groups.map((group) => (
            <HistoryYearSection
              expanded={expandedYears.has(group.year)}
              group={group}
              key={group.year}
              onToggle={() => toggleYear(group.year)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function HistoryYearSection({ group, expanded, onToggle }: { group: HistoryYearGroup; expanded: boolean; onToggle: () => void }) {
  const panelId = `history-year-${group.year}`;
  return (
    <section className={`history-year-group${expanded ? " history-year-expanded" : ""}`}>
      <header className="history-year-header">
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} ${group.year} 年报表`}
          className="history-year-toggle"
          onClick={onToggle}
          type="button"
        >
          <span aria-hidden="true" className="history-year-chevron" />
          <span><strong>{group.year} 年</strong><small>{group.monthCount} 个月度报告</small></span>
        </button>
        <dl className="history-year-summary" aria-label={`${group.year} 年度汇总`}>
          <YearMetric label="实际收入" value={formatMoney(group.actualIncome, group.currency)} />
          <YearMetric label="实际支出" value={formatMoney(group.actualExpense, group.currency)} />
          <YearMetric label="净结余" value={formatMoney(group.actualNetBalance, group.currency)} />
          <YearMetric label="年度储蓄率" value={formatPercent(group.actualSavingsRatePercent)} />
        </dl>
      </header>
      {expanded && (
        <div className="history-year-table-frame" id={panelId}>
          <table className="history-year-table">
            <caption className="sr-only">{group.year} 年月度详细报告</caption>
            <thead><tr><th>月份</th><th className="numeric-column history-secondary-column">实际收入</th><th className="numeric-column history-secondary-column">实际支出</th><th className="numeric-column">实际净结余</th><th className="numeric-column history-secondary-column">储蓄率</th><th className="history-plan-column">数据基准</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{group.months.map((item) => <HistoryMonthRow analytics={item} key={item.month} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function YearMetric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function HistoryMonthRow({ analytics }: { analytics: MonthAnalytics }) {
  const reportPath = `/history/${analytics.month}`;
  return (
    <tr>
      <th scope="row"><Link className="table-link history-month-link" to={reportPath}>{monthLabel(analytics.month)}</Link></th>
      <td className="numeric-column history-secondary-column">{formatMoney(analytics.income.actual_to_date, analytics.currency)}</td>
      <td className="numeric-column history-secondary-column">{formatMoney(analytics.expense.actual_to_date, analytics.currency)}</td>
      <td className="numeric-column history-net-value">{formatMoney(analytics.net_balance.actual_to_date, analytics.currency)}</td>
      <td className="numeric-column history-secondary-column">{formatPercent(analytics.actual_savings_rate_percent)}</td>
      <td className="history-plan-column"><span className="history-plan-state">{analytics.planned_item_count > 0 ? "有计划基准" : "仅实际"}</span><small>{analytics.total_item_count} 个类目</small></td>
      <td><Link aria-label={`查看 ${monthLabel(analytics.month)} 详细报告`} className="history-row-action" to={reportPath}>查看报告</Link></td>
    </tr>
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
          <span className="context-chip">{selected.planned_item_count > 0 ? "有计划基准" : "仅实际"}</span>
          <strong>{selected.total_item_count} 个类目</strong>
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
