import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  confirmMonthlyActuals,
  confirmMonthlyItem,
  createActualEntry,
  createManualMonthlyItem,
  deleteActualEntry,
  ensureActualOnlyMonthlyItem,
  getStartupStatus,
  initializeMonth,
  listActualEntries,
  listExchangeRates,
  listMonthlyItems,
  listPlanItems,
  previewMonth,
  queryKeys,
  updateActualEntry,
  updateMonthlyNote,
  type ActualEntry,
  type ExchangeRate,
  type MonthPreview,
  type MonthlyItem,
  type PlanItem,
  type RateOverrideInput,
} from "../../shared/api/finance";
import { getDomainContract } from "../../shared/api/domain";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney, formatPercent, monthLabel } from "../../shared/formatting/finance";
import { Dialog } from "../../shared/components/Dialog";
import { EmptyState } from "../../shared/components/EmptyState";
import { Select } from "../../shared/components/Select";
import {
  categoryLabel,
  flowLabel,
  recognitionLabel,
} from "../../shared/formatting/labels";
export function MonthlyPage() {
  const queryClient = useQueryClient();
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });
  const [previewOverrides, setPreviewOverrides] = useState<RateOverrideInput[]>([]);
  const month = startupQuery.data?.current_month ?? "";
  const itemsQuery = useQuery({
    queryKey: queryKeys.monthly(month),
    queryFn: () => listMonthlyItems(month),
    enabled: Boolean(month),
  });
  const previewQuery = useQuery({
    queryKey: queryKeys.monthPreview(month, previewOverrides),
    queryFn: () => previewMonth({ month, rateOverrides: previewOverrides }),
    enabled: Boolean(month),
  });
  const [initializing, setInitializing] = useState(false);
  const [batchCategory, setBatchCategory] = useState("ALL");
  const [addingEntry, setAddingEntry] = useState(false);

  const invalidateMonth = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.monthly(month) }),
      queryClient.invalidateQueries({ queryKey: ["month-preview", month] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.existingMonths }),
      queryClient.invalidateQueries({ queryKey: queryKeys.monthAnalytics(month) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.historyAnalytics }),
    ]);
  };
  const batchMutation = useMutation({
    mutationFn: () =>
      confirmMonthlyActuals({
        month,
        category: batchCategory === "ALL" ? null : batchCategory,
      }),
    onSuccess: invalidateMonth,
  });
  const missingCount = itemsQuery.data?.filter((item) => !["FINAL", "CONFIRMED_ZERO"].includes(item.data_status)).length ?? 0;
  const categories = useMemo(
    () => Array.from(new Set((itemsQuery.data ?? []).map((item) => item.category))),
    [itemsQuery.data],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">月度执行</p>
          <h1>{month ? monthLabel(month) : "正在读取本月"}</h1>
          <p>只处理当前自然月：查看本月数据、增加实际条目并完成月末确认。</p>
        </div>
        <div className="header-actions"><button className="button button-primary" type="button" onClick={() => setAddingEntry(true)}>添加实际条目</button></div>
      </header>

      {startupQuery.data?.error && (
        <div className="inline-error" role="alert">
          当前自然月自动初始化失败：{describeError(startupQuery.data.error)}
        </div>
      )}
      {startupQuery.data?.initialization && month === startupQuery.data.current_month && (
        <div className="success-banner" role="status">
          当前月已自动检查：新增 {startupQuery.data.initialization.created_count} 项，保留 {startupQuery.data.initialization.skipped_existing_count} 项。
        </div>
      )}

      {previewQuery.data && (
        <MonthContext
          preview={previewQuery.data}
          hasItems={(itemsQuery.data?.length ?? 0) > 0}
          onInitialize={() => setInitializing(true)}
        />
      )}
      {(itemsQuery.isError || previewQuery.isError) && (
        <section className="state-card"><span role="alert">{describeError(itemsQuery.error ?? previewQuery.error)}</span></section>
      )}
      {(itemsQuery.isPending || previewQuery.isPending) && <section className="state-card">正在读取这个月份的快照…</section>}

      {itemsQuery.data && itemsQuery.data.length > 0 && (
        <>
          <section className="month-operations">
            <div>
              <span className="section-label">数据完整状态</span>
              <strong>{missingCount === 0 ? "本月实际已确认" : missingCount + " 项尚未最终确认"}</strong>
              <small>确认只标记条目已核对，不会补写计划金额或创建虚假实际。</small>
            </div>
            <div className="batch-controls">
              <Select
                ariaLabel="批量确认范围"
                value={batchCategory}
                onChange={setBatchCategory}
                options={[
                  { value: "ALL", label: "整月全部类别" },
                  ...categories.map((code) => ({ value: code, label: categoryLabel(code) })),
                ]}
              />
              <button className="button button-secondary" disabled={batchMutation.isPending || missingCount === 0} type="button" onClick={() => batchMutation.mutate()}>
                {batchMutation.isPending ? "确认中…" : "确认所选范围已完成"}
              </button>
            </div>
          </section>
          {batchMutation.isSuccess && <div className="inline-success" role="status">已将 {batchMutation.data.updated_count} 项标记为最终确认。</div>}
          {batchMutation.isError && <div className="inline-error" role="alert">{describeError(batchMutation.error)}</div>}

          <div className="monthly-list">
            {itemsQuery.data.map((item) => (
              <MonthlyRow item={item} key={item.id + ":" + item.updated_at} onSaved={invalidateMonth} />
            ))}
          </div>
        </>
      )}

      {itemsQuery.data?.length === 0 && previewQuery.data?.candidate_count === 0 && previewQuery.data.missing_currencies.length === 0 && (
        <EmptyState eyebrow="本月还没有数据" title="直接记录第一项收入或支出" description="本月实际可以独立录入。下月目标与周期规则不是开始使用 Aplena 的前置条件。" action={<div className="empty-actions"><button className="button button-primary" type="button" onClick={() => setAddingEntry(true)}>录入本月实际</button><Link className="button button-secondary" to="/goals">设置下月目标（可选）</Link></div>} />
      )}

      {initializing && previewQuery.data && ratesQuery.data && (
        <InitializationDialog
          month={month}
          preview={previewQuery.data}
          rates={ratesQuery.data}
          onClose={() => setInitializing(false)}
          onInitialized={async (overrides) => {
            setPreviewOverrides(overrides);
            setInitializing(false);
            await invalidateMonth();
          }}
        />
      )}
      {addingEntry && plansQuery.data && (
        <EntryDialog
          month={month}
          plans={plansQuery.data}
          monthlyItems={itemsQuery.data ?? []}
          onClose={() => setAddingEntry(false)}
          onSaved={async () => { setAddingEntry(false); await invalidateMonth(); }}
        />
      )}
    </>
  );
}

function MonthContext({ preview, hasItems, onInitialize }: { preview: MonthPreview; hasItems: boolean; onInitialize: () => void }) {
  const canInitialize = preview.candidate_count > 0 || preview.missing_currencies.length > 0;
  return (
    <section className="month-context context-current">
      <div><span className="section-label">当前自然月</span><strong>本月计划快照在生成后保持冻结，不随下月目标变化。</strong></div>
      <dl>
        <div><dt>已存在</dt><dd>{preview.existing_count}</dd></div>
        <div><dt>可新增</dt><dd>{preview.candidate_count}</dd></div>
        <div><dt>本月不计入</dt><dd>{preview.excluded_count}</dd></div>
      </dl>
      {preview.missing_currencies.length > 0 && <p className="warning-text">缺少汇率：{preview.missing_currencies.join("、")}</p>}
      {canInitialize && (
        <button className="button button-primary" type="button" onClick={onInitialize}>
          {hasItems ? "补齐符合本月的规则" : "初始化本月"}
        </button>
      )}
    </section>
  );
}

function MonthlyRow({ item, onSaved }: { item: MonthlyItem; onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(item.note ?? "");
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const entriesQuery = useQuery({
    queryKey: queryKeys.actualEntries(item.id),
    queryFn: () => listActualEntries(item.id),
    enabled: expanded,
  });
  const confirmMutation = useMutation({ mutationFn: () => confirmMonthlyItem(item.id), onSuccess: onSaved });
  const noteMutation = useMutation({
    mutationFn: () => updateMonthlyNote({ id: item.id, note: note.trim() || null }),
    onSuccess: async () => { setEditingNote(false); await onSaved(); },
  });
  const varianceCopy =
    item.item_origin === "MANUAL"
      ? "无计划基准"
      : item.variance_effect === "UNKNOWN"
      ? "尚无偏差"
      : item.variance_effect === "ON_PLAN"
        ? "与计划一致"
        : item.variance_effect === "FAVORABLE"
          ? item.flow_type === "INCOME" ? "收入高于计划" : "支出低于计划"
          : item.flow_type === "INCOME" ? "收入低于计划" : "支出超过计划";
  return (
    <article className="monthly-card">
      <header>
        <div><span className={"status-dot status-" + item.data_status.toLowerCase()} aria-hidden="true" /><h2>{item.item_name}</h2>{item.item_origin === "MANUAL" ? <span className="category-pill">本月项目</span> : item.item_source === "ACTUAL_ONLY" ? <span className="category-pill">计划外实际</span> : null}</div>
        <span className={"variance-badge variance-" + item.variance_effect.toLowerCase()}>{varianceCopy}</span>
      </header>
      <div className="monthly-facts">
        <div><span>计划金额</span><strong>{item.item_origin === "MANUAL" ? "—" : formatMoney(item.planned_amount, item.currency)}</strong></div>
        <div><span>实际净额（条目汇总）</span><strong>{formatMoney(item.actual_amount, item.currency, "尚无条目")}</strong></div>
        <div><span>偏差</span><strong>{formatMoney(item.variance_amount, item.currency)}</strong></div>
        <div><span>完成率</span><strong>{formatPercent(item.completion_rate_percent)}</strong></div>
      </div>
      <div className="monthly-meta">{categoryLabel(item.category)} · {flowLabel(item.flow_type)}{item.item_origin === "MANUAL" ? "" : ` · ${recognitionLabel(item.recognition_mode)}`}{item.scheduled_date ? ` · 计划支付 ${item.scheduled_date}` : ""} · {statusLabel(item.data_status)} · {item.actual_entry_count} 条</div>
      <div className="monthly-actions">
        <button className="button button-secondary" type="button" onClick={() => setAdding(true)}>添加{item.flow_type === "EXPENSE" ? "支出或退款" : "收入或冲减"}</button>
        <button className="button button-quiet" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起条目" : "查看条目"}</button>
        <button className="button button-quiet" disabled={confirmMutation.isPending || ["FINAL", "CONFIRMED_ZERO"].includes(item.data_status)} type="button" onClick={() => confirmMutation.mutate()}>确认项目已完成</button>
      </div>
      {expanded && <EntryList item={item} entries={entriesQuery.data ?? []} pending={entriesQuery.isPending} error={entriesQuery.error} onSaved={onSaved} />}
      {!editingNote && <div className="monthly-note-summary"><span>月度备注</span><p>{item.note ?? "没有备注"}</p><button className="text-button" type="button" onClick={() => setEditingNote(true)}>{item.note ? "编辑" : "添加"}</button></div>}
      {editingNote && <div className="note-editor"><label>月度备注<textarea autoFocus aria-label={item.item_name + " 月度备注"} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="button button-quiet" type="button" onClick={() => { setNote(item.note ?? ""); setEditingNote(false); }}>取消</button><button className="button button-secondary" disabled={noteMutation.isPending} type="button" onClick={() => noteMutation.mutate()}>保存备注</button></div>}
      {(confirmMutation.isError || noteMutation.isError) && <div className="inline-error" role="alert">{describeError(confirmMutation.error ?? noteMutation.error)}</div>}
      {(confirmMutation.isSuccess || noteMutation.isSuccess) && <div className="save-status" role="status">已保存</div>}
      {adding && <EntryDialog month={item.month} plans={[]} monthlyItems={[item]} fixedItem={item} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); setExpanded(true); await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) }); await onSaved(); }} />}
    </article>
  );
}

function statusLabel(status: MonthlyItem["data_status"]) {
  return { MISSING: "尚未开始", IN_PROGRESS: "记录中", CONFIRMED_ZERO: "已确认零", FINAL: "最终确认" }[status];
}

function EntryList({ item, entries, pending, error, onSaved }: { item: MonthlyItem; entries: ActualEntry[]; pending: boolean; error: unknown; onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ActualEntry | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteActualEntry(id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) }); await onSaved(); },
  });
  if (pending) return <div className="state-card">正在读取实际条目…</div>;
  if (error) return <div className="inline-error" role="alert">{describeError(error)}</div>;
  return <div className="entry-list">
    {entries.length === 0 && <p>还没有实际条目；最终确认为零时无需创建虚假条目。</p>}
    {entries.map((entry) => <div className="entry-row" key={entry.id}>
      <span>{entry.occurred_on}</span><strong>{formatMoney(`${entry.effect === "INCREASE" ? "+" : "-"}${entry.amount}`, item.currency)}</strong>
      <span>{entry.note ?? (entry.origin === "MIGRATED_AGGREGATE" ? "旧版实际总额迁移" : "无备注")}</span>
      {entry.origin === "USER" && <><button className="button button-quiet" type="button" onClick={() => setEditing(entry)}>编辑</button><button className="button button-danger-quiet" type="button" onClick={() => { if (window.confirm("删除这条实际记录？项目会重新变为待确认。")) deleteMutation.mutate(entry.id); }}>删除</button></>}
    </div>)}
    {editing && <EntryDialog month={item.month} plans={[]} monthlyItems={[item]} fixedItem={item} existing={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) }); await onSaved(); }} />}
  </div>;
}

function EntryDialog({ month, plans, monthlyItems, fixedItem, existing, onClose, onSaved }: { month: string; plans: PlanItem[]; monthlyItems: MonthlyItem[]; fixedItem?: MonthlyItem; existing?: ActualEntry; onClose: () => void; onSaved: () => Promise<void> }) {
  const contractQuery = useQuery({ queryKey: queryKeys.domain, queryFn: () => getDomainContract() });
  const [entryMode, setEntryMode] = useState<"MANUAL" | "PLAN_LINKED">("MANUAL");
  const defaultPlanId = fixedItem?.source_plan_item_id ?? plans[0]?.id ?? "";
  const [planId, setPlanId] = useState(defaultPlanId);
  const selectedItem = fixedItem ?? monthlyItems.find((item) => item.source_plan_item_id === planId);
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState("ESSENTIAL_EXPENSE");
  const manualItemRef = useRef<MonthlyItem | null>(null);
  const flow = selectedItem?.flow_type ?? selectedPlan?.flow_type ?? flowForCategory(manualCategory);
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? `${month}-01`);
  const [effect, setEffect] = useState<"INCREASE" | "DECREASE">(existing?.effect ?? "INCREASE");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const mutation = useMutation({
    mutationFn: async () => {
      let item = selectedItem;
      if (!item && entryMode === "PLAN_LINKED") {
        item = await ensureActualOnlyMonthlyItem({ planItemId: planId, month });
      }
      if (!item) {
        manualItemRef.current ??= await createManualMonthlyItem({
          name: manualName.trim(),
          month,
          category: manualCategory,
        });
        item = manualItemRef.current;
      }
      const input = { id: existing?.id, monthlyItemId: item.id, occurredOn, effect, amount, note: note.trim() || undefined };
      return existing ? updateActualEntry({ ...input, id: existing.id }) : createActualEntry(input);
    },
    onSuccess: onSaved,
  });
  const increaseLabel = flow === "EXPENSE" ? "支出" : "收入";
  const decreaseLabel = flow === "EXPENSE" ? "退款" : "冲减";
  return <Dialog
    className="entry-dialog"
    title={existing ? "编辑实际条目" : "添加实际条目"}
    onClose={onClose}
    footer={<><button className="button button-quiet" type="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={mutation.isPending || (!fixedItem && entryMode === "MANUAL" ? !manualName.trim() || !manualCategory : !planId) || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0} type="button" onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存条目"}</button></>}
  >
    {!fixedItem && <>
      <div className="entry-mode-switch" role="group" aria-label="录入方式">
        <button className={entryMode === "MANUAL" ? "active" : ""} type="button" onClick={() => setEntryMode("MANUAL")}><strong>本月项目</strong><span>直接记录，不需要计划</span></button>
        <button className={entryMode === "PLAN_LINKED" ? "active" : ""} disabled={plans.length === 0} type="button" onClick={() => setEntryMode("PLAN_LINKED")}><strong>关联周期规则</strong><span>{plans.length === 0 ? "尚未配置，可稍后启用" : "沿用本月计划基准"}</span></button>
      </div>
      {entryMode === "MANUAL" ? <>
        <label>项目名称<input autoFocus data-dialog-initial-focus placeholder="例如：工资、房租、日常餐饮" value={manualName} onChange={(event) => setManualName(event.target.value)} /></label>
        <label>财务类别<Select ariaLabel="财务类别" value={manualCategory} onChange={setManualCategory} options={(contractQuery.data?.categories ?? []).map((category) => ({ value: category.code, label: category.label, description: flowForCategory(category.code) === "INCOME" ? "收入" : "支出" }))} /></label>
        <div className="notice">这是独立的本月项目，不会自动创建周期规则，也不会产生虚假的计划偏差。</div>
      </> : <label>周期规则<Select ariaLabel="周期规则" value={planId} onChange={setPlanId} placeholder="选择周期规则" options={plans.map((plan) => ({ value: plan.id, label: plan.name, description: categoryLabel(plan.category) }))} /></label>}
    </>}
    {entryMode === "PLAN_LINKED" && selectedPlan?.end_date && selectedPlan.end_date < `${month}-01` && <div className="notice notice-warning">该周期规则已经结束；本条记录仍可作为迟到退款或冲减归入本月项目。</div>}
    <label>日期<input type="date" min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()}`} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
    <label>类型<Select ariaLabel="类型" value={effect} onChange={(value) => setEffect(value as "INCREASE" | "DECREASE")} options={[{ value: "INCREASE", label: increaseLabel }, { value: "DECREASE", label: decreaseLabel }]} /></label>
    <label>金额<input autoFocus={Boolean(fixedItem)} data-dialog-initial-focus={fixedItem ? true : undefined} inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    <label>备注（可选）<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
  </Dialog>;
}

function flowForCategory(category: string): "INCOME" | "EXPENSE" {
  return ["FIXED_INCOME", "VARIABLE_INCOME"].includes(category) ? "INCOME" : "EXPENSE";
}

function InitializationDialog({
  month,
  preview,
  rates,
  onClose,
  onInitialized,
}: {
  month: string;
  preview: MonthPreview;
  rates: ExchangeRate[];
  onClose: () => void;
  onInitialized: (overrides: RateOverrideInput[]) => Promise<void>;
}) {
  const [understood, setUnderstood] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: () => {
      const rateOverrides = Object.entries(overrides)
        .filter(([, rate]) => rate.trim())
        .map(([currency, rate]) => ({ currency, rate: rate.trim() }));
      return initializeMonth({ month, confirmed: true, rateOverrides }).then((result) => ({ result, rateOverrides }));
    },
    onSuccess: ({ rateOverrides }) => onInitialized(rateOverrides),
  });
  return (
      <Dialog
        className="initialization-dialog"
        eyebrow={preview.direction === "HISTORICAL" ? "历史补录" : "冻结快照"}
        title={`初始化 ${month}`}
        onClose={onClose}
        footer={<><button className="button button-quiet" type="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={!understood || mutation.isPending || preview.missing_currencies.some((currency) => !overrides[currency]?.trim())} type="button" onClick={() => mutation.mutate()}>{mutation.isPending ? "初始化中…" : "确认创建月度快照"}</button></>}
      >
        <div className="notice notice-warning">
          {preview.direction === "HISTORICAL"
            ? "当前汇率不一定代表当时汇率。你可以为本次补录临时覆盖汇率；覆盖值不会保存到汇率设置。"
            : "初始化后，本月计划金额不会随周期规则或今后汇率变化。已有快照不会被覆盖。"}
        </div>
        {rates.filter((rate) => !rate.is_base_currency).length > 0 && (
          <details>
            <summary>本次临时汇率覆盖（可选）</summary>
            <div className="override-grid">
              {rates.filter((rate) => !rate.is_base_currency).map((rate) => (
                <label key={rate.currency}>{rate.currency}<input inputMode="decimal" placeholder={"当前 " + rate.rate} value={overrides[rate.currency] ?? ""} onChange={(event) => setOverrides((current) => ({ ...current, [rate.currency]: event.target.value }))} /></label>
              ))}
            </div>
          </details>
        )}
        {preview.missing_currencies.map((currency) => (
          <label key={currency}>{currency} 临时汇率（必填）<input inputMode="decimal" value={overrides[currency] ?? ""} onChange={(event) => setOverrides((current) => ({ ...current, [currency]: event.target.value }))} /></label>
        ))}
        <label className="check-row"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />我理解这会创建不可被未来配置自动改写的月度快照。</label>
        {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
        {mutation.isSuccess && <div className="inline-success" role="status">月份已初始化。</div>}
      </Dialog>
  );
}
