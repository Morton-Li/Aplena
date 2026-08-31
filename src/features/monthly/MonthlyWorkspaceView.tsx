import type { KeyboardEvent } from "react";

import type { MonthlyItem } from "../../shared/api/finance";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel } from "../../shared/formatting/labels";
import { Select } from "../../shared/components/Select";
import {
  defaultMonthlyWorkspaceFilters,
  hasActiveMonthlyFilters,
  isActualOnly,
  isTemporaryItem,
  monthlyItemCounts,
  type MonthlyWorkspaceFilters,
} from "./monthlyWorkspace";

interface MonthlyWorkspaceProps {
  items: MonthlyItem[];
  visibleItems: MonthlyItem[];
  filters: MonthlyWorkspaceFilters;
  onFiltersChange: (filters: MonthlyWorkspaceFilters) => void;
  onSelectItem: (id: string) => void;
  selectedItemId: string | null;
}

const varianceLabels: Record<MonthlyItem["variance_effect"], string> = {
  UNKNOWN: "待形成",
  ON_PLAN: "符合计划",
  FAVORABLE: "有利",
  UNFAVORABLE: "需关注",
};

export function MonthlyWorkspace({
  items,
  visibleItems,
  filters,
  onFiltersChange,
  onSelectItem,
  selectedItemId,
}: MonthlyWorkspaceProps) {
  const counts = monthlyItemCounts(items);
  const categories = Array.from(new Set(items.map((item) => item.category)));

  const update = <Key extends keyof MonthlyWorkspaceFilters>(
    key: Key,
    value: MonthlyWorkspaceFilters[Key],
  ) => onFiltersChange({ ...filters, [key]: value });

  return (
    <section aria-label="本月项目工作台" className="monthly-workspace">
      <div aria-label="本月类目摘要" className="monthly-item-summary">
        <SummaryMetric label="类目总数" value={counts.total} />
        <SummaryMetric label="预算类目" value={counts.planned} />
        <SummaryMetric label="临时类目" value={counts.temporary} />
        <SummaryMetric label="实际条目" value={counts.entries} />
      </div>

      <div className="monthly-workspace-controls">
        <div className="monthly-filter-grid">
          <label className="monthly-search-field">
            <span className="sr-only">搜索项目、分类或备注</span>
            <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input
              aria-label="搜索项目、分类或备注"
              onChange={(event) => update("search", event.target.value)}
              placeholder="搜索项目、分类或备注"
              type="search"
              value={filters.search}
            />
          </label>
          <Select
            ariaLabel="财务类别筛选"
            className="monthly-filter-select"
            onChange={(value) => update("category", value)}
            options={[{ value: "ALL", label: "全部分类" }, ...categories.map((value) => ({ value, label: categoryLabel(value) }))]}
            value={filters.category}
          />
          <Select
            ariaLabel="收支类型筛选"
            className="monthly-filter-select"
            onChange={(value) => update("flow", value as MonthlyWorkspaceFilters["flow"])}
            options={[{ value: "ALL", label: "全部收支" }, { value: "INCOME", label: "收入" }, { value: "EXPENSE", label: "支出" }]}
            value={filters.flow}
          />
          <Select
            ariaLabel="偏差状态筛选"
            className="monthly-filter-select"
            onChange={(value) => update("variance", value as MonthlyWorkspaceFilters["variance"])}
            options={[
              { value: "ALL", label: "全部偏差" },
              { value: "UNFAVORABLE", label: "需关注" },
              { value: "FAVORABLE", label: "有利" },
              { value: "ON_PLAN", label: "符合计划" },
              { value: "UNKNOWN", label: "待形成" },
            ]}
            value={filters.variance}
          />
          <Select
            ariaLabel="项目排序"
            className="monthly-sort-select"
            onChange={(value) => update("sort", value as MonthlyWorkspaceFilters["sort"])}
            options={[
              { value: "UPDATED", label: "最近更新" },
              { value: "NAME", label: "项目名称" },
              { value: "ACTUAL", label: "实际金额" },
              { value: "VARIANCE", label: "偏差绝对值" },
              { value: "COMPLETION", label: "完成率" },
            ]}
            value={filters.sort}
          />
        </div>

        <div className="monthly-result-count" aria-live="polite">
          显示 <strong>{visibleItems.length}</strong> / {items.length} 项
          {hasActiveMonthlyFilters(filters) && (
            <button className="text-button" onClick={() => onFiltersChange(defaultMonthlyWorkspaceFilters)} type="button">清除筛选</button>
          )}
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="monthly-no-results">
          <strong>没有符合当前条件的项目</strong>
          <p>调整搜索或筛选条件即可返回完整项目列表。</p>
          <button className="button button-secondary" onClick={() => onFiltersChange(defaultMonthlyWorkspaceFilters)} type="button">清除筛选</button>
        </div>
      ) : (
        <div
          className="monthly-table-frame"
          style={{ overflow: "auto", overscrollBehaviorX: "contain", overscrollBehaviorY: "auto" }}
        >
          <table className="monthly-data-table">
            <caption className="sr-only">本月类目、计划金额、实际金额、偏差、完成率和实际条目数量</caption>
            <thead>
              <tr>
                <th>项目 / 分类</th>
                <th className="numeric-column">计划</th>
                <th className="numeric-column">实际</th>
                <th className="numeric-column monthly-optional-column">偏差</th>
                <th className="numeric-column monthly-optional-column">完成率</th>
                <th className="numeric-column">条目</th>
                <th><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <MonthlyTableRow
                  item={item}
                  key={item.id}
                  onSelect={() => onSelectItem(item.id)}
                  selected={selectedItemId === item.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return <div className="monthly-summary-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function MonthlyTableRow({ item, selected, onSelect }: { item: MonthlyItem; selected: boolean; onSelect: () => void }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <tr
      aria-label={`打开 ${item.item_name} 详情`}
      aria-selected={selected}
      className={selected ? "monthly-row-selected" : ""}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <th scope="row">
        <span className="monthly-item-name">{item.item_name}</span>
        <small>{categoryLabel(item.category)} · {flowLabel(item.flow_type)}{isTemporaryItem(item) ? " · 临时类目" : isActualOnly(item) ? " · 计划外预算类目" : ""}</small>
      </th>
      <td className="numeric-column">{item.item_origin === "MANUAL" ? "—" : formatMoney(item.planned_amount, item.currency)}</td>
      <td className="numeric-column monthly-actual-value">{formatMoney(item.actual_amount, item.currency)}</td>
      <td className={`numeric-column monthly-optional-column variance-${item.variance_effect.toLowerCase()}`}>
        <span>{formatMoney(item.variance_amount, item.currency)}</span>
        <small>{varianceLabels[item.variance_effect]}</small>
      </td>
      <td className="numeric-column monthly-optional-column">{formatPercent(item.completion_rate_percent)}</td>
      <td className="numeric-column">{item.actual_entry_count}</td>
      <td>
        <button
          aria-label={`查看 ${item.item_name} 详情`}
          className="monthly-row-action"
          onClick={(event) => { event.stopPropagation(); onSelect(); }}
          type="button"
        >查看</button>
      </td>
    </tr>
  );
}
