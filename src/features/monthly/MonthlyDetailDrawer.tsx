import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import {
  deleteActualEntry,
  deleteManualMonthlyItem,
  listActualEntries,
  queryKeys,
  updateMonthlyNote,
  type ActualEntry,
  type MonthlyItem,
} from "../../shared/api/finance";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";
import { categoryLabel, flowLabel, recognitionLabel } from "../../shared/formatting/labels";
import { Dialog } from "../../shared/components/Dialog";
import { isActualOnly, isTemporaryItem } from "./monthlyWorkspace";

interface MonthlyDetailDrawerProps {
  item: MonthlyItem;
  onClose: () => void;
  onDeleted: () => Promise<void>;
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

export function MonthlyDetailDrawer({ item, onClose, onDeleted, onSaved, onAddEntry, onEditEntry }: MonthlyDetailDrawerProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [note, setNote] = useState(item.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [entryPendingDeletion, setEntryPendingDeletion] = useState<ActualEntry | null>(null);
  const [categoryPendingDeletion, setCategoryPendingDeletion] = useState(false);
  const deletingEntry = useRef(false);
  const entriesQuery = useQuery({
    queryKey: queryKeys.actualEntries(item.id),
    queryFn: () => listActualEntries(item.id),
  });
  const noteMutation = useMutation({
    mutationFn: () => updateMonthlyNote({ id: item.id, note: note.trim() || null }),
    onSuccess: async () => { setEditingNote(false); await onSaved(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteActualEntry(id),
    onSuccess: async () => {
      setEntryPendingDeletion(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) });
      await onSaved();
    },
    onSettled: () => { deletingEntry.current = false; },
  });
  const deleteCategoryMutation = useMutation({
    mutationFn: () => deleteManualMonthlyItem(item.id),
    onSuccess: onDeleted,
  });

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    const initial = drawerRef.current?.querySelector<HTMLElement>("[data-drawer-initial-focus]");
    (initial ?? drawerRef.current)?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const closeDrawer = () => { if (!deletingEntry.current) onClose(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
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

  const closeDeleteDialog = () => {
    if (!deletingEntry.current) setEntryPendingDeletion(null);
  };
  const confirmDeleteEntry = () => {
    if (deletingEntry.current || !entryPendingDeletion) return;
    deletingEntry.current = true;
    deleteMutation.mutate(entryPendingDeletion.id);
  };

  return <>
    {createPortal(
    <div className="monthly-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDrawer()}>
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
            <p>{categoryLabel(item.category)} · {flowLabel(item.flow_type)}{item.item_origin === "PLAN_LINKED" ? ` · ${recognitionLabel(item.recognition_mode)}` : item.item_origin === "SPECIAL_PROJECT" ? " · 专项" : " · 本月项目"}</p>
          </div>
          <button aria-label="关闭项目详情" className="icon-button" data-drawer-initial-focus onClick={closeDrawer} type="button">×</button>
        </header>

        <div className="monthly-drawer-body">
          <section aria-label="项目执行摘要" className="monthly-drawer-metrics">
            <DrawerMetric label="计划金额" value={item.item_origin === "MANUAL" || (item.item_origin === "SPECIAL_PROJECT" && isActualOnly(item)) ? "—" : formatMoney(item.planned_amount, item.currency)} />
            <DrawerMetric label="实际净额" value={formatMoney(item.actual_amount, item.currency)} />
            <DrawerMetric label="偏差" value={formatMoney(item.variance_amount, item.currency)} />
            <DrawerMetric label="完成率" value={formatPercent(item.completion_rate_percent)} />
          </section>

          <div className="monthly-drawer-context">
            <span>{item.actual_entry_count} 条实际记录</span>
            <span>{item.item_origin === "SPECIAL_PROJECT" ? isActualOnly(item) ? "专项计划外实际" : "专项月度预算" : isTemporaryItem(item) ? "临时类目" : isActualOnly(item) ? "计划外预算类目" : "预算类目"}</span>
            {item.scheduled_date && <span>计划支付 {item.scheduled_date}</span>}
            {item.source_special_project_id && <Link className="text-button" to={`/specials?id=${encodeURIComponent(item.source_special_project_id)}`}>查看专项</Link>}
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
              onDelete={setEntryPendingDeletion}
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

          {(noteMutation.isError || deleteMutation.isError || deleteCategoryMutation.isError) && (
            <div className="inline-error" role="alert">{describeError(noteMutation.error ?? deleteMutation.error ?? deleteCategoryMutation.error)}</div>
          )}
        </div>

        {isTemporaryItem(item) && <footer className="monthly-drawer-footer">
          <span>临时类目只属于本月，可连同其中的实际条目一起删除。</span>
          <button className="button button-danger" onClick={() => setCategoryPendingDeletion(true)} type="button">删除临时类目</button>
        </footer>}
      </aside>
    </div>,
      document.body,
    )}
    {entryPendingDeletion && <Dialog
      className="delete-entry-dialog"
      eyebrow="删除实际条目"
      title="确认删除这条记录？"
      onClose={closeDeleteDialog}
      footer={<>
        <button className="button button-quiet" disabled={deleteMutation.isPending} onClick={closeDeleteDialog} type="button">取消</button>
        <button className="button button-danger" disabled={deleteMutation.isPending} onClick={confirmDeleteEntry} type="button">
          {deleteMutation.isPending ? "删除中…" : "确认删除"}
        </button>
      </>}
    >
      <p>删除后无法在应用内撤销，但不会影响该类目的其他实际条目。</p>
      {entryPendingDeletion.origin === "AUTOMATIC" && <p>这是自动入账记录；删除后本次记录不会在再次检查或重启时重新生成。</p>}
      <dl className="delete-entry-summary">
        <div><dt>日期</dt><dd>{entryPendingDeletion.occurred_on}</dd></div>
        <div><dt>类型</dt><dd>{entryPendingDeletion.effect === "INCREASE" ? (item.flow_type === "EXPENSE" ? "支出" : "收入") : (item.flow_type === "EXPENSE" ? "退款" : "冲减")}</dd></div>
        <div><dt>金额</dt><dd>{formatMoney(entryPendingDeletion.source_amount, entryPendingDeletion.source_currency)}</dd></div>
      </dl>
      {deleteMutation.isError && <div className="inline-error" role="alert">{describeError(deleteMutation.error)}</div>}
    </Dialog>}
    {categoryPendingDeletion && <Dialog
      className="delete-category-dialog"
      eyebrow="删除临时类目"
      title={`确认删除“${item.item_name}”？`}
      onClose={() => !deleteCategoryMutation.isPending && setCategoryPendingDeletion(false)}
      footer={<>
        <button className="button button-quiet" disabled={deleteCategoryMutation.isPending} onClick={() => setCategoryPendingDeletion(false)} type="button">取消</button>
        <button className="button button-danger" disabled={deleteCategoryMutation.isPending} onClick={() => deleteCategoryMutation.mutate()} type="button">{deleteCategoryMutation.isPending ? "删除中…" : "确认删除临时类目"}</button>
      </>}
    >
      <p>该临时类目及其中 <strong>{item.actual_entry_count}</strong> 条实际记录会被永久删除，预算类目和周期规则不会受到影响。</p>
      {deleteCategoryMutation.isError && <div className="inline-error" role="alert">{describeError(deleteCategoryMutation.error)}</div>}
    </Dialog>}
  </>;
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
  if (entries.length === 0) return <div className="monthly-drawer-empty"><strong>还没有实际条目</strong><p>没有发生额时无需创建零金额条目。</p></div>;
  return <div className="monthly-drawer-entry-list">{entries.map((entry) => (
    <article className="monthly-drawer-entry" key={entry.id}>
      <div><time dateTime={entry.occurred_on}>{entry.occurred_on}</time><strong>{formatMoney(`${entry.effect === "INCREASE" ? "+" : "-"}${entry.source_amount}`, entry.source_currency)}</strong></div>
      {entry.source_currency !== item.currency && <small className="monthly-entry-conversion">折合 {formatMoney(entry.amount, item.currency)} · 1 {entry.source_currency} = {entry.exchange_rate} {item.currency} · {entry.exchange_rate_source === "ECB_REFERENCE" ? "欧洲央行每日参考汇率" : "备用手动汇率"} · {entry.exchange_rate_observed_on}</small>}
      <p>{entry.note ?? (entry.origin === "MIGRATED_AGGREGATE" ? "旧版实际总额迁移" : "无备注")}</p>
      {entry.origin === "AUTOMATIC" && <span className="automatic-entry-badge">自动入账</span>}
      {entry.detail_group && <small className="special-entry-group">分组：{entry.detail_group}</small>}
      {(entry.origin === "USER" || entry.origin === "AUTOMATIC") && <div><button className="text-button" onClick={() => onEdit(entry)} type="button">编辑</button><button className="text-button danger-text" onClick={() => onDelete(entry)} type="button">删除</button></div>}
    </article>
  ))}</div>;
}
