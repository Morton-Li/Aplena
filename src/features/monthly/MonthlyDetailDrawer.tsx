import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import {
  confirmMonthlyItem,
  deleteActualEntry,
  listActualEntries,
  queryKeys,
  updateMonthlyNote,
  type ActualEntry,
  type MonthlyItem,
} from "../../shared/api/finance";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel, recognitionLabel } from "../../shared/formatting/labels";
import { isActualOnly, isConfirmed } from "./monthlyWorkspace";

interface MonthlyDetailDrawerProps {
  item: MonthlyItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAddEntry: (item: MonthlyItem) => void;
  onEditEntry: (item: MonthlyItem, entry: ActualEntry) => void;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function MonthlyDetailDrawer({ item, onClose, onSaved, onAddEntry, onEditEntry }: MonthlyDetailDrawerProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [note, setNote] = useState(item.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const entriesQuery = useQuery({
    queryKey: queryKeys.actualEntries(item.id),
    queryFn: () => listActualEntries(item.id),
  });
  const confirmMutation = useMutation({ mutationFn: () => confirmMonthlyItem(item.id), onSuccess: onSaved });
  const noteMutation = useMutation({
    mutationFn: () => updateMonthlyNote({ id: item.id, note: note.trim() || null }),
    onSuccess: async () => { setEditingNote(false); await onSaved(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteActualEntry(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) });
      await onSaved();
    },
  });

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    const initial = drawerRef.current?.querySelector<HTMLElement>("[data-drawer-initial-focus]");
    (initial ?? drawerRef.current)?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      drawerRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="monthly-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        aria-labelledby={titleId}
        aria-modal="true"
        className="monthly-detail-drawer"
        onKeyDown={handleKeyDown}
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="monthly-drawer-header">
          <div>
            <p className="section-label">项目详情</p>
            <h2 id={titleId}>{item.item_name}</h2>
            <p>{categoryLabel(item.category)} · {flowLabel(item.flow_type)}{item.item_origin === "PLAN_LINKED" ? ` · ${recognitionLabel(item.recognition_mode)}` : " · 本月项目"}</p>
          </div>
          <button aria-label="关闭项目详情" className="icon-button" data-drawer-initial-focus onClick={onClose} type="button">×</button>
        </header>

        <div className="monthly-drawer-body">
          <section aria-label="项目执行摘要" className="monthly-drawer-metrics">
            <DrawerMetric label="计划金额" value={item.item_origin === "MANUAL" ? "—" : formatMoney(item.planned_amount, item.currency)} />
            <DrawerMetric label="实际净额" value={formatMoney(item.actual_amount, item.currency)} />
            <DrawerMetric label="偏差" value={formatMoney(item.variance_amount, item.currency)} />
            <DrawerMetric label="完成率" value={formatPercent(item.completion_rate_percent)} />
          </section>

          <div className="monthly-drawer-context">
            <span className={`monthly-status-badge monthly-status-${item.data_status.toLowerCase()}`}><i aria-hidden="true" />{statusLabel(item.data_status)}</span>
            <span>{item.actual_entry_count} 条实际记录</span>
            {isActualOnly(item) && <span>计划外项目</span>}
            {item.scheduled_date && <span>计划支付 {item.scheduled_date}</span>}
          </div>

          <section className="monthly-drawer-section">
            <div className="monthly-drawer-section-heading">
              <div><p className="section-label">ACTUAL ENTRIES</p><h3>实际条目</h3></div>
              <button className="button button-primary" onClick={() => onAddEntry(item)} type="button">添加{item.flow_type === "EXPENSE" ? "支出或退款" : "收入或冲减"}</button>
            </div>
            <ActualEntryList
              entries={entriesQuery.data ?? []}
              error={entriesQuery.error}
              item={item}
              onDelete={(entry) => {
                if (window.confirm("删除这条实际记录？项目会重新变为待确认。")) deleteMutation.mutate(entry.id);
              }}
              onEdit={(entry) => onEditEntry(item, entry)}
              pending={entriesQuery.isPending}
            />
          </section>

          <section className="monthly-drawer-section">
            <div className="monthly-drawer-section-heading">
              <div><p className="section-label">MONTHLY NOTE</p><h3>月度备注</h3></div>
              {!editingNote && <button className="text-button" onClick={() => setEditingNote(true)} type="button">{item.note ? "编辑" : "添加"}</button>}
            </div>
            {editingNote ? (
              <div className="monthly-drawer-note-editor">
                <textarea aria-label={`${item.item_name} 月度备注`} autoFocus onChange={(event) => setNote(event.target.value)} rows={4} value={note} />
                <div><button className="button button-quiet" onClick={() => { setNote(item.note ?? ""); setEditingNote(false); }} type="button">取消</button><button className="button button-secondary" disabled={noteMutation.isPending} onClick={() => noteMutation.mutate()} type="button">保存备注</button></div>
              </div>
            ) : <p className={item.note ? "monthly-drawer-note" : "monthly-drawer-note monthly-drawer-note-empty"}>{item.note ?? "尚未添加月度备注。"}</p>}
          </section>

          {(confirmMutation.isError || noteMutation.isError || deleteMutation.isError) && (
            <div className="inline-error" role="alert">{describeError(confirmMutation.error ?? noteMutation.error ?? deleteMutation.error)}</div>
          )}
        </div>

        <footer className="monthly-drawer-footer">
          <span>{isConfirmed(item) ? "该项目已完成核对" : "确认后仍可通过编辑实际条目重新打开状态"}</span>
          <button className="button button-secondary" disabled={confirmMutation.isPending || isConfirmed(item)} onClick={() => confirmMutation.mutate()} type="button">
            {confirmMutation.isPending ? "确认中…" : "确认项目已完成"}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ActualEntryList({ item, entries, pending, error, onEdit, onDelete }: {
  item: MonthlyItem;
  entries: ActualEntry[];
  pending: boolean;
  error: unknown;
  onEdit: (entry: ActualEntry) => void;
  onDelete: (entry: ActualEntry) => void;
}) {
  if (pending) return <div className="monthly-drawer-loading">正在读取实际条目…</div>;
  if (error) return <div className="inline-error" role="alert">{describeError(error)}</div>;
  if (entries.length === 0) return <div className="monthly-drawer-empty"><strong>还没有实际条目</strong><p>最终确认为零时无需创建虚假条目。</p></div>;
  return <div className="monthly-drawer-entry-list">{entries.map((entry) => (
    <article className="monthly-drawer-entry" key={entry.id}>
      <div><time dateTime={entry.occurred_on}>{entry.occurred_on}</time><strong>{formatMoney(`${entry.effect === "INCREASE" ? "+" : "-"}${entry.source_amount}`, entry.source_currency)}</strong></div>
      {entry.source_currency !== item.currency && <small className="monthly-entry-conversion">折合 {formatMoney(entry.amount, item.currency)} · 1 {entry.source_currency} = {entry.exchange_rate} {item.currency} · {entry.exchange_rate_source === "ECB_REFERENCE" ? "欧洲央行每日参考汇率" : "备用手动汇率"} · {entry.exchange_rate_observed_on}</small>}
      <p>{entry.note ?? (entry.origin === "MIGRATED_AGGREGATE" ? "旧版实际总额迁移" : "无备注")}</p>
      {entry.origin === "USER" && <div><button className="text-button" onClick={() => onEdit(entry)} type="button">编辑</button><button className="text-button danger-text" onClick={() => onDelete(entry)} type="button">删除</button></div>}
    </article>
  ))}</div>;
}

function statusLabel(status: MonthlyItem["data_status"]) {
  return { MISSING: "待录入", IN_PROGRESS: "记录中", CONFIRMED_ZERO: "已确认零", FINAL: "已确认" }[status];
}
