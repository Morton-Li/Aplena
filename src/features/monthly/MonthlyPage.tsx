import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  confirmMonthlyActuals,
  getSettings,
  getStartupStatus,
  initializeMonth,
  listExchangeRates,
  listExistingMonths,
  listMonthlyItems,
  previewMonth,
  queryKeys,
  updateMonthlyActual,
  updateMonthlyNote,
  type ExchangeRate,
  type MonthPreview,
  type MonthlyItem,
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
  const missingCount = itemsQuery.data?.filter((item) => item.data_status === "MISSING").length ?? 0;
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
          <p>只维护项目最终实际金额。计划金额和快照系统字段不会在这里被改写。</p>
        </div>
        <label className="month-picker">
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
        </label>
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
              <strong>{missingCount === 0 ? "实际金额已完整" : missingCount + " 项尚未录入"}</strong>
              <small>确认操作只填充尚未录入项，不覆盖 0 或已有正数。</small>
            </div>
            <div className="batch-controls">
              <select aria-label="批量确认范围" value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)}>
                <option value="ALL">整月全部类别</option>
                {categories.map((code) => <option key={code} value={code}>{categoryLabel(code)}</option>)}
              </select>
              <button className="button button-secondary" disabled={batchMutation.isPending || missingCount === 0} type="button" onClick={() => batchMutation.mutate()}>
                {batchMutation.isPending ? "确认中…" : "未录入项按计划确认"}
              </button>
            </div>
          </section>
          {batchMutation.isSuccess && <div className="inline-success" role="status">已确认 {batchMutation.data.updated_count} 项，已有实际金额未被覆盖。</div>}
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
  const [actual, setActual] = useState(item.actual_amount ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const actualMutation = useMutation({
    mutationFn: (value: string | null) => updateMonthlyActual({ id: item.id, actualAmount: value }),
    onSuccess: onSaved,
  });
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
        <div><span className={"status-dot status-" + item.data_status.toLowerCase()} aria-hidden="true" /><h2>{item.item_name}</h2></div>
        <span className={"variance-badge variance-" + item.variance_effect.toLowerCase()}>{varianceCopy}</span>
      </header>
      <div className="monthly-facts">
        <div><span>计划金额</span><strong>{item.planned_amount} {item.currency}</strong></div>
        <div><span>实际金额</span><strong>{item.actual_amount ?? "尚未录入"}</strong></div>
        <div><span>偏差</span><strong>{item.variance_amount ?? "N/A"}</strong></div>
        <div><span>完成率</span><strong>{item.completion_rate_percent ? item.completion_rate_percent + "%" : "N/A"}</strong></div>
      </div>
      <div className="monthly-meta">{categoryLabel(item.category)} · {flowLabel(item.flow_type)} · {recognitionLabel(item.recognition_mode)}</div>
      <div className="monthly-editors">
        <label>实际金额<input aria-label={item.item_name + " 实际金额"} inputMode="decimal" placeholder="尚未录入" value={actual} onChange={(event) => setActual(event.target.value)} /></label>
        <button className="button button-secondary" disabled={actualMutation.isPending} type="button" onClick={() => actualMutation.mutate(actual.trim() || null)}>保存实际</button>
        <button className="button button-quiet" disabled={actualMutation.isPending} type="button" onClick={() => { setActual("0"); actualMutation.mutate("0"); }}>确认实际为 0</button>
        <button className="button button-quiet" disabled={actualMutation.isPending} type="button" onClick={() => { setActual(""); actualMutation.mutate(null); }}>恢复为尚未录入</button>
      </div>
      <div className="monthly-editors note-editor">
        <label>月度备注<textarea aria-label={item.item_name + " 月度备注"} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="button button-quiet" disabled={noteMutation.isPending} type="button" onClick={() => noteMutation.mutate()}>保存备注</button>
      </div>
      {(actualMutation.isError || noteMutation.isError) && <div className="inline-error" role="alert">{describeError(actualMutation.error ?? noteMutation.error)}</div>}
      {(actualMutation.isSuccess || noteMutation.isSuccess) && <div className="save-status" role="status">已保存</div>}
    </article>
  );
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
