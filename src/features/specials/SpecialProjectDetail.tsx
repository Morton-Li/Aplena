import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { SpecialActualEntry, SpecialAllocation, SpecialProjectDetail as ProjectDetail } from "../../shared/api/specials";
import { Select } from "../../shared/components/Select";
import { formatExchangeRate, formatMoney, monthLabel } from "../../shared/formatting/finance";
import { categoryLabel } from "../../shared/formatting/labels";
import { canEditSpecialAllocation } from "./specialForms";

interface SpecialProjectDetailProps {
  detail: ProjectDetail;
  currentMonth: string;
  archiving: boolean;
  onEditProject: () => void;
  onArchive: () => void;
  onAddAllocation: () => void;
  onEditAllocation: (allocation: SpecialAllocation) => void;
  onDeleteAllocation: (allocation: SpecialAllocation) => void;
  onAddEntry: () => void;
  onEditEntry: (entry: SpecialActualEntry) => void;
  onDeleteEntry: (entry: SpecialActualEntry) => void;
}

export function SpecialProjectDetail({ detail, currentMonth, archiving, onEditProject, onArchive, onAddAllocation, onEditAllocation, onDeleteAllocation, onAddEntry, onEditEntry, onDeleteEntry }: SpecialProjectDetailProps) {
  const { project, allocations, entries } = detail;
  const [monthFilter, setMonthFilter] = useState("ALL");
  const [groupFilter, setGroupFilter] = useState("ALL");
  const months = useMemo(() => Array.from(new Set(entries.map((entry) => entry.month))).sort().reverse(), [entries]);
  const groups = useMemo(() => Array.from(new Set(entries.map((entry) => entry.detail_group ?? ""))).sort(), [entries]);
  const filteredEntries = entries.filter((entry) =>
    (monthFilter === "ALL" || entry.month === monthFilter) &&
    (groupFilter === "ALL" || `GROUP:${entry.detail_group ?? ""}` === groupFilter),
  );

  return <article className="special-project-detail" aria-label={`${project.name} 专项详情`}>
    <header className="special-detail-header">
      <div>
        <p className="section-label">专项{project.archived ? " · 已归档" : " · 进行中"}</p>
        <h2>{project.name}</h2>
        {project.note && <p className="special-project-note">{project.note}</p>}
      </div>
      <div className="special-actions">
        <button className="button button-secondary" onClick={onEditProject} type="button">编辑专项</button>
        <button className="button button-quiet" disabled={archiving} onClick={onArchive} type="button">{archiving ? "更新中…" : project.archived ? "恢复专项" : "归档专项"}</button>
      </div>
    </header>

    {project.archived && <p className="special-archive-notice" role="status">专项已归档。已有月分配仍计入预算；可补录晚到支出或退款，也可调整实际条目。</p>}

    <section className="special-budget-grid" aria-label="专项预算摘要">
      <BudgetMetric label="总预算" amount={project.total_budget} currency={project.currency} note="专项预算上限" />
      <BudgetMetric label="已分配预算" amount={project.allocated_budget} currency={project.currency} note="所有月份分配合计" />
      <BudgetMetric label="未分配预算" amount={project.unallocated_budget} currency={project.currency} note="总预算减去已分配预算" />
      <BudgetMetric label="实际净支出" amount={project.actual_net_amount} currency={project.currency} note="支出减去退款" />
      <BudgetMetric label="净剩余预算" amount={project.remaining_budget} currency={project.currency} note="总预算减去实际净支出" />
    </section>

    <section className="report-card special-section" aria-label="专项月预算分配">
      <div className="special-section-heading">
        <div><p className="section-label">Monthly Allocation</p><h3>月预算分配</h3></div>
        <button className="button button-secondary" disabled={project.archived} onClick={onAddAllocation} type="button">添加月分配</button>
      </div>
      <p className="chart-note">每个分类直接计入指定月份。已形成快照的分配保持冻结，未冻结的未来分配可以调整或删除。</p>
      {allocations.length === 0 ? <p className="special-empty-copy">尚未分配月预算。仍可添加实际支出或退款，月工作区会创建无预算基准的实际类目。</p> : <div className="table-scroll special-table-scroll">
        <table className="data-table special-allocation-table">
          <caption className="sr-only">{project.name}月预算分配</caption>
          <thead><tr><th scope="col">月份</th><th scope="col">支出分类</th><th scope="col">分配金额</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody>{allocations.map((allocation) => {
            const editable = canEditSpecialAllocation(allocation, currentMonth, project.archived);
            return <tr key={allocation.id}>
              <th scope="row">{monthLabel(allocation.month)}</th>
              <td>{categoryLabel(allocation.category)}</td>
              <td>{formatMoney(allocation.amount, project.currency)}</td>
              <td>{allocation.frozen ? "已冻结快照" : allocation.month > currentMonth ? "未来分配" : "不可调整"}</td>
              <td><div className="special-actions">
                {editable && <><button className="button button-quiet" onClick={() => onEditAllocation(allocation)} type="button">编辑分配</button><button className="button button-danger-quiet" onClick={() => onDeleteAllocation(allocation)} type="button">删除分配</button></>}
                {allocation.monthly_item_id && <Link className="text-button" to={`/monthly?month=${allocation.month}&item=${encodeURIComponent(allocation.monthly_item_id)}`}>查看月度</Link>}
                {!editable && !allocation.monthly_item_id && <span>只读</span>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>

    <section className="report-card special-section" aria-label="专项实际条目">
      <div className="special-section-heading">
        <div><p className="section-label">Actual Entries</p><h3>实际支出与退款</h3></div>
        <button className="button button-primary" onClick={onAddEntry} type="button">{project.archived ? "补录支出或退款" : "添加支出或退款"}</button>
      </div>
      <p className="chart-note">按发生月份记录；这里与月工作区展示同一条实际记录。退款计入退款发生月，可使专项净剩余增加。</p>
      {entries.length > 0 && <div className="special-entry-filters" aria-label="实际条目筛选">
        <Select ariaLabel="实际条目月份" options={[{ value: "ALL", label: "全部月份" }, ...months.map((month) => ({ value: month, label: monthLabel(month) }))]} value={monthFilter} onChange={setMonthFilter} />
        <Select ariaLabel="实际条目明细组" options={[{ value: "ALL", label: "全部明细组" }, ...groups.map((group) => ({ value: `GROUP:${group}`, label: group || "未分组" }))]} value={groupFilter} onChange={setGroupFilter} />
        <span className="result-count">{filteredEntries.length} / {entries.length} 条</span>
        {(monthFilter !== "ALL" || groupFilter !== "ALL") && <button className="text-button" onClick={() => { setMonthFilter("ALL"); setGroupFilter("ALL"); }} type="button">清除筛选</button>}
      </div>}
      {filteredEntries.length === 0 ? <p className="special-empty-copy">{entries.length === 0 ? "还没有实际条目。无需为未发生的支出创建零金额记录。" : "所选月份与明细组没有实际条目。"}</p> : <div className="table-scroll special-table-scroll">
        <table className="data-table special-entries-table">
          <caption className="sr-only">{project.name}实际支出与退款</caption>
          <thead><tr><th scope="col">日期 / 分类</th><th scope="col">明细组 / 备注</th><th scope="col">类型</th><th scope="col">原币金额</th><th scope="col">本位币金额 / 汇率快照</th><th scope="col">操作</th></tr></thead>
          <tbody>{filteredEntries.map((entry) => <tr key={entry.id}>
            <th scope="row"><time dateTime={entry.occurred_on}>{entry.occurred_on}</time><small>{categoryLabel(entry.category)}</small></th>
            <td><span>{entry.detail_group || "未分组"}</span>{entry.note && <small className="special-entry-note">{entry.note}</small>}</td>
            <td>{entry.effect === "INCREASE" ? "支出" : "退款"}</td>
            <td>{formatMoney(entry.source_amount, entry.source_currency)}</td>
            <td><strong>{formatMoney(entry.amount, project.currency)}</strong><small>1 {entry.source_currency} = {formatExchangeRate(entry.exchange_rate)} {project.currency} · {entry.exchange_rate_observed_on}</small></td>
            <td><div className="special-actions"><button className="button button-quiet" onClick={() => onEditEntry(entry)} type="button">编辑条目</button><button className="button button-danger-quiet" onClick={() => onDeleteEntry(entry)} type="button">删除条目</button></div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    <div className="special-analysis-grid">
      <section className="report-card special-section" aria-label="专项月份分析">
        <div className="special-section-heading"><div><p className="section-label">By Month</p><h3>月份分析</h3></div></div>
        {detail.monthly_totals.length === 0 ? <p className="special-empty-copy">添加月分配或实际条目后可查看月份分析。</p> : <div className="table-scroll special-table-scroll"><table className="data-table">
          <caption className="sr-only">{project.name}月份分析</caption>
          <thead><tr><th scope="col">月份</th><th scope="col">月预算</th><th scope="col">实际净支出</th></tr></thead>
          <tbody>{detail.monthly_totals.map((row) => <tr key={row.month}><th scope="row">{row.month}</th><td>{formatMoney(row.planned_amount, project.currency)}</td><td>{formatMoney(row.actual_net_amount, project.currency)}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="report-card special-section" aria-label="专项明细组分析">
        <div className="special-section-heading"><div><p className="section-label">By Detail Group</p><h3>明细组分析</h3></div></div>
        <p className="chart-note">明细组用于区分专项内的用途，支出分类仍使用现有三类。</p>
        {detail.detail_group_totals.length === 0 ? <p className="special-empty-copy">记录实际条目后可查看明细组净支出。</p> : <div className="table-scroll special-table-scroll"><table className="data-table">
          <caption className="sr-only">{project.name}明细组分析</caption>
          <thead><tr><th scope="col">明细组</th><th scope="col">条目数</th><th scope="col">实际净支出</th></tr></thead>
          <tbody>{detail.detail_group_totals.map((row) => <tr key={row.detail_group ?? ""}><th scope="row">{row.detail_group || "未分组"}</th><td>{row.entry_count}</td><td>{formatMoney(row.actual_net_amount, project.currency)}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </div>
  </article>;
}

function BudgetMetric({ label, amount, currency, note }: { label: string; amount: string | null; currency: string; note: string }) {
  return <div className={`special-budget-metric${amount?.startsWith("-") ? " special-budget-negative" : ""}`}><span>{label}</span><strong>{formatMoney(amount, currency)}</strong><small>{note}</small></div>;
}
