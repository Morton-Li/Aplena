import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  confirmMonthlyActuals,
  confirmMonthlyItem,
  createActualEntry,
  deleteActualEntry,
  ensureActualOnlyMonthlyItem,
  getSettings,
  getStartupStatus,
  initializeMonth,
  listActualEntries,
  listExchangeRates,
  listExistingMonths,
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
import { describeError } from "../../shared/formatting/errors";
import {
  categoryLabel,
  flowLabel,
  recognitionLabel,
} from "../../shared/formatting/labels";

export function MonthlyPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });
  const monthsQuery = useQuery({ queryKey: queryKeys.existingMonths, queryFn: () => listExistingMonths() });
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<RateOverrideInput[]>([]);
  const month = selectedMonth ?? settingsQuery.data?.target_month ?? "";
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
          <p className="eyebrow">月度计划</p>
          <h1>{month || "选择月份"} 的计划执行</h1>
          <p>逐笔记录项目实际结果；计划金额和月度净额均为只读事实。</p>
        </div>
        <div className="header-actions"><button className="button button-primary" type="button" onClick={() => setAddingEntry(true)}>添加实际条目</button><label className="month-picker">
          查看月份
          <input
            type="month"
            list="existing-months"
            value={month}
            onChange={(event) => {
              setSelectedMonth(event.target.value);
              setPreviewOverrides([]);
            }}
          />
          <datalist id="existing-months">
            {monthsQuery.data?.map((value) => <option key={value} value={value} />)}
          </datalist>
        </label></div>
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
              <select aria-label="批量确认范围" value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)}>
                <option value="ALL">整月全部类别</option>
                {categories.map((code) => <option key={code} value={code}>{categoryLabel(code)}</option>)}
              </select>
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
        <section className="state-card">这个月份没有需要确认的有效计划。PAYMENT 项目只会在支付月份生成。</section>
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
  const context = {
    CURRENT: { title: "当前自然月", copy: "系统会在启动和新建计划后自动补齐当前月缺失快照。" },
    FUTURE: { title: "未来月份预览", copy: "浏览不会写入。确认初始化后，计划与汇率将冻结为独立快照。" },
    HISTORICAL: { title: "历史月份查看", copy: "浏览不会写入。缺失月份只能在说明汇率语义后显式补录。" },
  }[preview.direction];
  const canInitialize = preview.candidate_count > 0 || preview.missing_currencies.length > 0;
  return (
    <section className={"month-context context-" + preview.direction.toLowerCase()}>
      <div><span className="section-label">{context.title}</span><strong>{context.copy}</strong></div>
      <dl>
        <div><dt>已存在</dt><dd>{preview.existing_count}</dd></div>
        <div><dt>可新增</dt><dd>{preview.candidate_count}</dd></div>
        <div><dt>本月不计入</dt><dd>{preview.excluded_count}</dd></div>
      </dl>
      {preview.missing_currencies.length > 0 && <p className="warning-text">缺少汇率：{preview.missing_currencies.join("、")}</p>}
      {canInitialize && (
        <button className="button button-primary" type="button" onClick={onInitialize}>
          {preview.direction === "FUTURE" ? "确认并初始化未来月份" : preview.direction === "HISTORICAL" ? "补录这个历史月份" : hasItems ? "补齐当前月新增计划" : "初始化当前月"}
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
  const entriesQuery = useQuery({
    queryKey: queryKeys.actualEntries(item.id),
    queryFn: () => listActualEntries(item.id),
    enabled: expanded,
  });
  const confirmMutation = useMutation({ mutationFn: () => confirmMonthlyItem(item.id), onSuccess: onSaved });
  const noteMutation = useMutation({
    mutationFn: () => updateMonthlyNote({ id: item.id, note: note.trim() || null }),
    onSuccess: onSaved,
  });
  const varianceCopy =
    item.variance_effect === "UNKNOWN"
      ? "尚无偏差"
      : item.variance_effect === "ON_PLAN"
        ? "与计划一致"
        : item.variance_effect === "FAVORABLE"
          ? item.flow_type === "INCOME" ? "收入高于计划" : "支出低于计划"
          : item.flow_type === "INCOME" ? "收入低于计划" : "支出超过计划";
  return (
    <article className="monthly-card">
      <header>
        <div><span className={"status-dot status-" + item.data_status.toLowerCase()} aria-hidden="true" /><h2>{item.item_name}</h2>{item.item_source === "ACTUAL_ONLY" && <span className="category-pill">仅实际</span>}</div>
        <span className={"variance-badge variance-" + item.variance_effect.toLowerCase()}>{varianceCopy}</span>
      </header>
      <div className="monthly-facts">
        <div><span>计划金额</span><strong>{item.planned_amount} {item.currency}</strong></div>
        <div><span>实际净额（条目汇总）</span><strong>{item.actual_amount ?? "尚无条目"} {item.actual_amount ? item.currency : ""}</strong></div>
        <div><span>偏差</span><strong>{item.variance_amount ?? "N/A"}</strong></div>
        <div><span>完成率</span><strong>{item.completion_rate_percent ? item.completion_rate_percent + "%" : "N/A"}</strong></div>
      </div>
      <div className="monthly-meta">{categoryLabel(item.category)} · {flowLabel(item.flow_type)} · {recognitionLabel(item.recognition_mode)}{item.scheduled_date ? ` · 计划支付 ${item.scheduled_date}` : ""} · {statusLabel(item.data_status)} · {item.actual_entry_count} 条</div>
      <div className="monthly-editors">
        <button className="button button-secondary" type="button" onClick={() => setAdding(true)}>添加{item.flow_type === "EXPENSE" ? "支出或退款" : "收入或冲减"}</button>
        <button className="button button-quiet" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起条目" : "查看条目"}</button>
        <button className="button button-quiet" disabled={confirmMutation.isPending || ["FINAL", "CONFIRMED_ZERO"].includes(item.data_status)} type="button" onClick={() => confirmMutation.mutate()}>确认项目已完成</button>
      </div>
      {expanded && <EntryList item={item} entries={entriesQuery.data ?? []} pending={entriesQuery.isPending} error={entriesQuery.error} onSaved={onSaved} />}
      <div className="monthly-editors note-editor">
        <label>月度备注<textarea aria-label={item.item_name + " 月度备注"} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="button button-quiet" disabled={noteMutation.isPending} type="button" onClick={() => noteMutation.mutate()}>保存备注</button>
      </div>
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
      <span>{entry.occurred_on}</span><strong>{entry.effect === "INCREASE" ? "+" : "−"}{entry.amount} {item.currency}</strong>
      <span>{entry.note ?? (entry.origin === "MIGRATED_AGGREGATE" ? "旧版实际总额迁移" : "无备注")}</span>
      {entry.origin === "USER" && <><button className="button button-quiet" type="button" onClick={() => setEditing(entry)}>编辑</button><button className="button button-danger-quiet" type="button" onClick={() => { if (window.confirm("删除这条实际记录？项目会重新变为待确认。")) deleteMutation.mutate(entry.id); }}>删除</button></>}
    </div>)}
    {editing && <EntryDialog month={item.month} plans={[]} monthlyItems={[item]} fixedItem={item} existing={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(item.id) }); await onSaved(); }} />}
  </div>;
}

function EntryDialog({ month, plans, monthlyItems, fixedItem, existing, onClose, onSaved }: { month: string; plans: PlanItem[]; monthlyItems: MonthlyItem[]; fixedItem?: MonthlyItem; existing?: ActualEntry; onClose: () => void; onSaved: () => Promise<void> }) {
  const defaultPlanId = fixedItem?.source_plan_item_id ?? plans[0]?.id ?? "";
  const [planId, setPlanId] = useState(defaultPlanId);
  const selectedItem = fixedItem ?? monthlyItems.find((item) => item.source_plan_item_id === planId);
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const flow = selectedItem?.flow_type ?? selectedPlan?.flow_type ?? "EXPENSE";
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? `${month}-01`);
  const [effect, setEffect] = useState<"INCREASE" | "DECREASE">(existing?.effect ?? "INCREASE");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const mutation = useMutation({
    mutationFn: async () => {
      let item = selectedItem;
      if (!item) item = await ensureActualOnlyMonthlyItem({ planItemId: planId, month });
      const input = { id: existing?.id, monthlyItemId: item.id, occurredOn, effect, amount, note: note.trim() || undefined };
      return existing ? updateActualEntry({ ...input, id: existing.id }) : createActualEntry(input);
    },
    onSuccess: onSaved,
  });
  const increaseLabel = flow === "EXPENSE" ? "支出" : "收入";
  const decreaseLabel = flow === "EXPENSE" ? "退款" : "冲减";
  return <div className="modal-backdrop"><section className="confirm-dialog entry-dialog" role="dialog" aria-modal="true" aria-labelledby="entry-title">
    <header className="dialog-header"><h2 id="entry-title">{existing ? "编辑实际条目" : "添加实际条目"}</h2><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button></header>
    {!fixedItem && <label>所属项目<select value={planId} onChange={(event) => setPlanId(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {categoryLabel(plan.category)}</option>)}</select></label>}
    {selectedPlan?.end_date && selectedPlan.end_date < `${month}-01` && <div className="notice notice-warning">该长期计划已经结束；本条记录仍可作为迟到退款或冲减归入历史项目。</div>}
    <label>日期<input type="date" min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()}`} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
    <label>类型<select value={effect} onChange={(event) => setEffect(event.target.value as "INCREASE" | "DECREASE")}><option value="INCREASE">{increaseLabel}</option><option value="DECREASE">{decreaseLabel}</option></select></label>
    <label>金额<input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    <label>备注（可选）<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
    <footer className="dialog-actions"><button className="button button-quiet" type="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={mutation.isPending || !planId || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0} type="button" onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存条目"}</button></footer>
  </section></div>;
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
    <div className="modal-backdrop">
      <section className="confirm-dialog initialization-dialog" role="dialog" aria-modal="true" aria-labelledby="initialize-title">
        <header className="dialog-header"><div><p className="section-label">{preview.direction === "HISTORICAL" ? "历史补录" : "冻结快照"}</p><h2 id="initialize-title">初始化 {month}</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="notice notice-warning">
          {preview.direction === "HISTORICAL"
            ? "当前汇率不一定代表当时汇率。你可以为本次补录临时覆盖汇率；覆盖值不会保存到汇率设置。"
            : "初始化后，本月计划金额不会随长期计划或今后汇率变化。已有快照不会被覆盖。"}
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
        <footer className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={!understood || mutation.isPending || preview.missing_currencies.some((currency) => !overrides[currency]?.trim())} type="button" onClick={() => mutation.mutate()}>
            {mutation.isPending ? "初始化中…" : "确认创建月度快照"}
          </button>
        </footer>
      </section>
    </div>
  );
}
