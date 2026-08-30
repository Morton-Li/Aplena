import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  confirmMonthlyActuals,
  createActualEntry,
  createManualMonthlyItem,
  ensureActualOnlyMonthlyItem,
  getStartupStatus,
  importReferenceRates,
  initializeMonth,
  listExchangeRates,
  listMonthlyItems,
  listPlanItems,
  previewMonth,
  queryKeys,
  updateActualEntry,
  type ActualEntry,
  type ExchangeRate,
  type MonthPreview,
  type MonthlyItem,
  type PlanItem,
  type RateOverrideInput,
} from "../../shared/api/finance";
import { deriveReferenceRate, fetchEcbReferenceRates } from "../../shared/api/referenceRates";
import { getDomainContract } from "../../shared/api/domain";
import { describeError } from "../../shared/formatting/errors";
import { currencyName, monthLabel } from "../../shared/formatting/finance";
import { Dialog } from "../../shared/components/Dialog";
import { EmptyState } from "../../shared/components/EmptyState";
import { Select } from "../../shared/components/Select";
import { categoryLabel } from "../../shared/formatting/labels";
import { MonthlyDetailDrawer } from "./MonthlyDetailDrawer";
import { MonthlyWorkspace } from "./MonthlyWorkspaceView";
import {
  defaultMonthlyWorkspaceFilters,
  filterAndSortMonthlyItems,
  type MonthlyWorkspaceFilters,
} from "./monthlyWorkspace";

type EntryDialogRequest = { item?: MonthlyItem; existing?: ActualEntry } | null;

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
  const [filters, setFilters] = useState<MonthlyWorkspaceFilters>(defaultMonthlyWorkspaceFilters);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [entryDialog, setEntryDialog] = useState<EntryDialogRequest>(null);

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
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const visibleItems = useMemo(() => filterAndSortMonthlyItems(items, filters), [filters, items]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;

  return (
    <div className="monthly-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">月度执行</p>
          <h1>{month ? monthLabel(month) : "正在读取本月"}</h1>
          <p>只处理当前自然月：查看本月数据、增加实际条目并完成月末确认。</p>
        </div>
        <div className="header-actions"><button className="button button-primary" type="button" onClick={() => setEntryDialog({})}>添加实际条目</button></div>
      </header>

      {startupQuery.data?.error && (
        <div className="inline-error" role="alert">
          当前自然月自动初始化失败：{describeError(startupQuery.data.error)}
        </div>
      )}
      {startupQuery.data?.initialization && startupQuery.data.initialization.created_count > 0 && month === startupQuery.data.current_month && (
        <div className="success-banner" role="status">
          当前月已自动检查：新增 {startupQuery.data.initialization.created_count} 项，保留 {startupQuery.data.initialization.skipped_existing_count} 项。
        </div>
      )}

      {previewQuery.data && (previewQuery.data.candidate_count > 0 || previewQuery.data.missing_currencies.length > 0) && (
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
          <MonthlyWorkspace
            batchCategory={batchCategory}
            batchPending={batchMutation.isPending}
            filters={filters}
            items={itemsQuery.data}
            onBatchCategoryChange={setBatchCategory}
            onBatchConfirm={() => batchMutation.mutate()}
            onFiltersChange={setFilters}
            onSelectItem={setSelectedItemId}
            selectedItemId={selectedItemId}
            visibleItems={visibleItems}
          />
          {batchMutation.isSuccess && <div className="inline-success" role="status">已将 {batchMutation.data.updated_count} 项标记为最终确认。</div>}
          {batchMutation.isError && <div className="inline-error" role="alert">{describeError(batchMutation.error)}</div>}
        </>
      )}

      {itemsQuery.data?.length === 0 && previewQuery.data?.candidate_count === 0 && previewQuery.data.missing_currencies.length === 0 && (
        <EmptyState eyebrow="本月还没有数据" title="直接记录第一项收入或支出" description="本月实际可以独立录入。下月目标与周期规则不是开始使用 Aplena 的前置条件。" action={<div className="empty-actions"><button className="button button-primary" type="button" onClick={() => setEntryDialog({})}>录入本月实际</button><Link className="button button-secondary" to="/goals">设置下月目标（可选）</Link></div>} />
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
      {entryDialog && plansQuery.data && ratesQuery.data && (
        <EntryDialog
          month={month}
          plans={plansQuery.data}
          monthlyItems={itemsQuery.data ?? []}
          rates={ratesQuery.data}
          existing={entryDialog.existing}
          fixedItem={entryDialog.item}
          onClose={() => setEntryDialog(null)}
          onSaved={async () => {
            if (entryDialog.item) {
              await queryClient.invalidateQueries({ queryKey: queryKeys.actualEntries(entryDialog.item.id) });
            }
            setEntryDialog(null);
            await invalidateMonth();
          }}
        />
      )}
      {selectedItem && !entryDialog && (
        <MonthlyDetailDrawer
          item={selectedItem}
          key={selectedItem.id}
          onAddEntry={(item) => setEntryDialog({ item })}
          onClose={() => setSelectedItemId(null)}
          onEditEntry={(item, existing) => setEntryDialog({ item, existing })}
          onSaved={invalidateMonth}
        />
      )}
    </div>
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

function EntryDialog({ month, plans, monthlyItems, rates, fixedItem, existing, onClose, onSaved }: { month: string; plans: PlanItem[]; monthlyItems: MonthlyItem[]; rates: ExchangeRate[]; fixedItem?: MonthlyItem; existing?: ActualEntry; onClose: () => void; onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
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
  const baseCurrency = rates.find((rate) => rate.is_base_currency)?.currency ?? fixedItem?.currency ?? "CNY";
  const [currency, setCurrency] = useState(existing?.source_currency ?? baseCurrency);
  const referenceQuery = useQuery({
    queryKey: ["ecb-reference-rates"],
    queryFn: () => fetchEcbReferenceRates(),
    enabled: !existing && currency !== baseCurrency,
    retry: false,
    staleTime: 0,
  });
  const [amount, setAmount] = useState(existing?.source_amount ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const cachedRate = rates.find((rate) => rate.currency === currency);
  const officialRate = useMemo(
    () => deriveReferenceRate(referenceQuery.data ?? [], currency, baseCurrency),
    [baseCurrency, currency, referenceQuery.data],
  );
  const ratePreview = existing
    ? { rate: existing.exchange_rate, observedOn: existing.exchange_rate_observed_on, source: existing.exchange_rate_source }
    : currency === baseCurrency
      ? { rate: "1.00000000", observedOn: occurredOn, source: "BASE_CURRENCY" }
      : officialRate
        ? { ...officialRate, source: "ECB_REFERENCE" }
        : cachedRate
          ? { rate: cachedRate.rate, observedOn: cachedRate.observed_on ?? occurredOn, source: cachedRate.source }
          : null;
  const currencyOptions = useMemo(() => Array.from(new Set([
    baseCurrency,
    ...rates.map((rate) => rate.currency),
    ...(referenceQuery.data ?? []).map((rate) => rate.currency),
  ])).sort().map((code) => ({ value: code, label: currencyName(code), description: code })), [baseCurrency, rates, referenceQuery.data]);
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
      let exchangeRate = ratePreview;
      if (!existing && currency !== baseCurrency) {
        try {
          const refreshed = await referenceQuery.refetch();
          if (refreshed.error) throw refreshed.error;
          const observations = refreshed.data ?? await fetchEcbReferenceRates();
          const updatedRates = await importReferenceRates({ observations, currencies: [currency] });
          queryClient.setQueryData(queryKeys.rates, updatedRates);
          const imported = updatedRates.find((rate) => rate.currency === currency);
          if (imported) exchangeRate = { rate: imported.rate, observedOn: imported.observed_on ?? occurredOn, source: imported.source };
        } catch (error) {
          if (!cachedRate) throw error;
        }
      }
      if (!exchangeRate) throw new Error(`缺少 ${currency} 可用汇率，请先更新官方汇率。`);
      const source = exchangeRate.source === "MIGRATED_BASE" ? "BASE_CURRENCY" : exchangeRate.source;
      const input = {
        id: existing?.id,
        monthlyItemId: item.id,
        occurredOn,
        effect,
        amount,
        currency,
        exchangeRate: exchangeRate.rate,
        exchangeRateSource: source as "BASE_CURRENCY" | "ECB_REFERENCE" | "MANUAL",
        exchangeRateObservedOn: exchangeRate.observedOn,
        note: note.trim() || undefined,
      };
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
    footer={<><button className="button button-quiet" type="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={mutation.isPending || (!fixedItem && entryMode === "MANUAL" ? !manualName.trim() || !manualCategory : !planId) || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !ratePreview || (!existing && currency !== baseCurrency && referenceQuery.isFetching)} type="button" onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存条目"}</button></>}
  >
    {!fixedItem && <>
      <div className="entry-mode-switch" role="group" aria-label="录入方式">
        <button className={entryMode === "MANUAL" ? "active" : ""} type="button" onClick={() => setEntryMode("MANUAL")}><strong>本月项目</strong><span>直接记录，不需要计划</span></button>
        <button className={entryMode === "PLAN_LINKED" ? "active" : ""} disabled={plans.length === 0} type="button" onClick={() => setEntryMode("PLAN_LINKED")}><strong>关联周期规则</strong><span>{plans.length === 0 ? "尚未配置，可稍后启用" : "沿用本月计划基准"}</span></button>
      </div>
      {entryMode === "MANUAL" ? <>
        <label>项目名称<input autoFocus data-dialog-initial-focus placeholder="例如：工资、房租、日常餐饮" value={manualName} onChange={(event) => setManualName(event.target.value)} /></label>
        <label>财务类别<Select ariaLabel="财务类别" value={manualCategory} onChange={setManualCategory} options={(contractQuery.data?.categories ?? []).map((category) => ({ value: category.code, label: category.label, description: flowForCategory(category.code) === "INCOME" ? "收入" : "支出" }))} /></label>
      </> : <label>周期规则<Select ariaLabel="周期规则" value={planId} onChange={setPlanId} placeholder="选择周期规则" options={plans.map((plan) => ({ value: plan.id, label: plan.name, description: categoryLabel(plan.category) }))} /></label>}
    </>}
    {entryMode === "PLAN_LINKED" && selectedPlan?.end_date && selectedPlan.end_date < `${month}-01` && <div className="notice notice-warning">该周期规则已经结束；本条记录仍可作为迟到退款或冲减归入本月项目。</div>}
    <div className="entry-detail-grid">
      <label>日期<input type="date" min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()}`} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
      <label>类型<Select ariaLabel="类型" value={effect} onChange={(value) => setEffect(value as "INCREASE" | "DECREASE")} options={[{ value: "INCREASE", label: increaseLabel }, { value: "DECREASE", label: decreaseLabel }]} /></label>
    </div>
    <div className="entry-money-grid">
      <label>币种<Select ariaLabel="实际条目币种" disabled={Boolean(existing)} value={currency} onChange={setCurrency} options={currencyOptions} /></label>
      <label>原币金额<input autoFocus={Boolean(fixedItem)} data-dialog-initial-focus={fixedItem ? true : undefined} inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    </div>
    <div className="entry-rate-snapshot" aria-live="polite">
      <span>本次换算基准</span>
      {ratePreview ? <><strong>1 {currency} = {ratePreview.rate} {baseCurrency}</strong><small>{ratePreview.source === "ECB_REFERENCE" ? `欧洲央行每日参考汇率 · ${ratePreview.observedOn}` : ratePreview.source === "MANUAL" ? `备用手动汇率 · ${ratePreview.observedOn}` : "本位币 1:1"}{existing ? " · 编辑仍沿用原快照" : " · 保存后固定"}</small></> : <><strong>{referenceQuery.isPending ? "正在获取欧洲央行每日参考汇率…" : "暂无可用汇率"}</strong><small>无法获取时可使用设置页中已经保存的备用汇率。</small></>}
    </div>
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
