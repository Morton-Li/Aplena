import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { getDomainContract, type DomainContract } from "../../shared/api/domain";
import {
  createPlanItem,
  deletePlanItem,
  getSettings,
  listExchangeRates,
  listPlanItems,
  previewPlanItem,
  queryKeys,
  updatePlanItem,
  type ExchangeRate,
  type PlanItem,
  type PlanItemInput,
  type PlanPreview,
  type Settings,
} from "../../shared/api/finance";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney } from "../../shared/formatting/finance";
import { Dialog } from "../../shared/components/Dialog";
import { EmptyState } from "../../shared/components/EmptyState";
import { Select } from "../../shared/components/Select";
import {
  categoryLabel,
  flowLabel,
  recognitionLabel,
} from "../../shared/formatting/labels";

const planSchema = z
  .object({
    name: z.string().trim().min(1, "请输入项目名称"),
    category: z.string().min(1, "请选择类别"),
    plannedAmount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "金额最多保留两位小数"),
    currency: z.string().length(3, "请选择币种"),
    periodMonths: z.number().int("周期必须为整数").positive("周期必须大于 0"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择开始日期"),
    endDate: z.string(),
    recognitionMode: z.enum(["AMORTIZED", "PAYMENT"]),
    note: z.string(),
  })
  .superRefine((values, context) => {
    if (values.endDate && values.endDate < values.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "结束日期不能早于开始日期",
      });
    }
  });

type PlanValues = z.infer<typeof planSchema>;

export function RecurringRulesPanel({ targetMonth }: { targetMonth: string }) {
  const queryClient = useQueryClient();
  const contractQuery = useQuery({ queryKey: queryKeys.domain, queryFn: () => getDomainContract() });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [editor, setEditor] = useState<PlanItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<PlanItem | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (plansQuery.data ?? []).filter(
      (item) =>
        (category === "ALL" || item.category === category) &&
        (!needle ||
          item.name.toLocaleLowerCase().includes(needle) ||
          (item.note ?? "").toLocaleLowerCase().includes(needle)),
    );
  }, [category, plansQuery.data, search]);

  const refreshPlans = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.plans }),
      queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetProjection }),
    ]);
  };

  return (
    <section className="recurring-rules-panel recurring-rules-panel-open">
      <header className="recurring-rules-header">
        <div className="recurring-rules-title">
          <p className="eyebrow">可选增强</p>
          <h2>周期规则</h2>
          <p>按需定义可复用的收入与支出规则，用于预估 {targetMonth}；保存不会改动本月或历史月。</p>
        </div>
        <div className="recurring-rules-header-actions">
          <span className="recurring-rules-summary">{plansQuery.data?.length ?? 0} 项规则</span>
          <button className="button button-primary" type="button" onClick={() => setEditor("new")}>新建周期规则</button>
        </div>
      </header>

      <div className="recurring-rules-body">
      {feedback && <div className="success-banner" role="status">{feedback}</div>}

      {plansQuery.isSuccess && plansQuery.data.length > 0 && <section className="toolbar recurring-rules-toolbar" aria-label="周期规则筛选">
        <label className="search-field">
          <span className="sr-only">搜索周期规则</span>
          <input
            type="search"
            placeholder="搜索名称或备注"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">按类别筛选</span>
          <Select
            ariaLabel="按类别筛选"
            value={category}
            onChange={setCategory}
            options={[
              { value: "ALL", label: "全部类别" },
              ...(contractQuery.data?.categories ?? []).map((option) => ({ value: option.code, label: option.label })),
            ]}
          />
        </label>
        <span className="result-count">显示 {filtered.length} / {plansQuery.data.length} 项</span>
      </section>}

      {(plansQuery.isPending || contractQuery.isPending) && <StatePanel>正在读取周期规则…</StatePanel>}
      {(plansQuery.isError || contractQuery.isError) && <StatePanel error={plansQuery.error ?? contractQuery.error} />}
      {plansQuery.isSuccess && filtered.length === 0 && (
        plansQuery.data.length === 0
          ? <EmptyState eyebrow="按需启用" title="暂未配置周期规则" description="这不会影响本月实际录入和历史报表。只有需要自动生成后续月份计划基准时才需要配置。" action={<button className="button button-secondary" type="button" onClick={() => setEditor("new")}>创建周期规则</button>} />
          : <EmptyState compact eyebrow="没有匹配项" title="换一个筛选条件试试" description="当前搜索词与类别组合没有匹配任何规则，已有规则没有被删除。" action={<button className="button button-secondary" type="button" onClick={() => { setSearch(""); setCategory("ALL"); }}>清除筛选</button>} />
      )}
      {filtered.length > 0 && (
        <div className="table-scroll recurring-rules-table-scroll">
          <table className="data-table recurring-rules-table">
            <caption className="sr-only">周期规则</caption>
            <thead>
              <tr>
                <th className="recurring-rule-identity" scope="col">规则</th>
                <th className="recurring-rule-amount" scope="col">计划金额</th>
                <th className="recurring-rule-schedule" scope="col">周期 / 计入方式</th>
                <th className="recurring-rule-period" scope="col">有效期间</th>
                <th className="recurring-rule-optional recurring-rule-history" scope="col">历史快照</th>
                <th className="recurring-rule-actions-heading" scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <th className="recurring-rule-identity" scope="row">
                    <strong>{item.name}</strong>
                    <span className="recurring-rule-labels">
                      <span className={`category-pill category-${item.flow_type.toLowerCase()}`}>
                        {categoryLabel(item.category)}
                      </span>
                      <span>{flowLabel(item.flow_type)}</span>
                    </span>
                    {item.note && <small title={item.note}>{item.note}</small>}
                  </th>
                  <td className="recurring-rule-amount">
                    <strong>{formatMoney(item.planned_amount, item.currency)}</strong>
                    <small>原币金额</small>
                  </td>
                  <td className="recurring-rule-schedule">
                    <strong>{item.period_months} 个月</strong>
                    <small>{recognitionLabel(item.recognition_mode)}</small>
                  </td>
                  <td className="recurring-rule-period">
                    <time dateTime={item.start_date}>{item.start_date}</time>
                    <small>至 {item.end_date ?? "长期有效"}</small>
                  </td>
                  <td className="recurring-rule-optional recurring-rule-history">
                    <strong>{item.history_month_count}</strong>
                    <small>个月</small>
                  </td>
                  <td>
                    <div className="recurring-rule-actions">
                      <button className="button button-quiet" type="button" onClick={() => setEditor(item)}>编辑</button>
                      <button className="button button-danger-quiet" type="button" onClick={() => setDeleting(item)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && contractQuery.data && settingsQuery.data && ratesQuery.data && (
        <PlanEditor
          contract={contractQuery.data}
          targetMonth={targetMonth}
          existing={editor === "new" ? null : editor}
          rates={ratesQuery.data}
          settings={settingsQuery.data}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null);
            setFeedback(message);
            await refreshPlans();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            setFeedback("周期规则已删除，关联历史快照已保留。");
            await refreshPlans();
          }}
        />
      )}
      </div>
    </section>
  );
}

function PlanEditor({
  contract,
  targetMonth,
  existing,
  rates,
  settings,
  onClose,
  onSaved,
}: {
  contract: DomainContract;
  targetMonth: string;
  existing: PlanItem | null;
  rates: ExchangeRate[];
  settings: Settings;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const defaults: PlanValues = existing
    ? {
        name: existing.name,
        category: existing.category,
        plannedAmount: existing.planned_amount,
        currency: existing.currency,
        periodMonths: existing.period_months,
        startDate: existing.start_date,
        endDate: existing.end_date ?? "",
        recognitionMode: existing.recognition_mode as "AMORTIZED" | "PAYMENT",
        note: existing.note ?? "",
      }
    : {
        name: "",
        category: "FIXED_INCOME",
        plannedAmount: "",
        currency: settings.base_currency,
        periodMonths: 1,
        startDate: targetMonth + "-01",
        endDate: "",
        recognitionMode: "AMORTIZED",
        note: "",
      };
  const form = useForm<PlanValues>({ resolver: zodResolver(planSchema), defaultValues: defaults });
  const values = useWatch({ control: form.control });
  const signature = JSON.stringify(values);
  const [preview, setPreview] = useState<{ signature: string; data: PlanPreview } | null>(null);

  const toInput = (value: PlanValues): PlanItemInput => ({
    id: existing?.id,
    name: value.name,
    category: value.category,
    plannedAmount: value.plannedAmount,
    currency: value.currency,
    periodMonths: value.periodMonths,
    startDate: value.startDate,
    endDate: value.endDate || undefined,
    recognitionMode: value.recognitionMode,
    note: value.note || undefined,
  });
  const previewMutation = useMutation<
    PlanPreview,
    Error,
    { value: PlanValues; signature: string }
  >({
    mutationFn: ({ value }) =>
      previewPlanItem(contract, settings, rates, targetMonth, toInput(value)),
    onSuccess: (data, variables) => setPreview({ signature: variables.signature, data }),
  });
  const saveMutation = useMutation<PlanItem, Error, PlanValues>({
    mutationFn: (value: PlanValues) =>
      existing ? updatePlanItem(toInput(value)) : createPlanItem(toInput(value)),
    onSuccess: async () => onSaved("周期规则已保存，仅用于下月预估；本月与历史快照未作修改。"),
  });
  const category = contract.categories.find((item) => item.code === values.category);
  const derivedFlow = ["FIXED_INCOME", "VARIABLE_INCOME"].includes(values.category ?? "")
    ? "收入"
    : "支出";
  const previewIsCurrent = preview?.signature === signature;
  const previewCurrentValues = form.handleSubmit((value) => {
    previewMutation.mutate({ value, signature: JSON.stringify(form.getValues()) });
  });

  return (
      <Dialog
        eyebrow={existing ? "编辑周期规则" : "新建周期规则"}
        title={existing?.name ?? "新的周期性收入或支出"}
        onClose={onClose}
        size="wide"
        footer={(
          <>
            <button className="button button-quiet" type="button" onClick={onClose}>取消</button>
            {previewIsCurrent ? (
              <button className="button button-primary" disabled={saveMutation.isPending} form="plan-editor-form" type="submit">
                {saveMutation.isPending ? "保存中…" : "确认保存"}
              </button>
            ) : (
              <button className="button button-primary" disabled={previewMutation.isPending} type="button" onClick={previewCurrentValues}>
                {previewMutation.isPending ? "计算中…" : "预览并检查"}
              </button>
            )}
          </>
        )}
      >
        <form className="plan-form" id="plan-editor-form" onSubmit={form.handleSubmit((value) => saveMutation.mutate(value))}>
          <div className="field-grid">
            <label className="field-span-2">项目名称<input autoFocus data-dialog-initial-focus {...form.register("name")} />{form.formState.errors.name && <em>{form.formState.errors.name.message}</em>}</label>
            <label>类别<Controller control={form.control} name="category" render={({ field, fieldState }) => <Select ariaLabel="类别" invalid={fieldState.invalid} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} options={contract.categories.map((option) => ({ value: option.code, label: option.label }))} />} /></label>
            <label>交易类型<input readOnly value={derivedFlow} aria-label="交易类型（自动）" /><small>由“{category?.label}”自动决定</small></label>
            <label>计划金额<input inputMode="decimal" {...form.register("plannedAmount")} />{form.formState.errors.plannedAmount && <em>{form.formState.errors.plannedAmount.message}</em>}</label>
            <label>币种<Controller control={form.control} name="currency" render={({ field, fieldState }) => <Select ariaLabel="币种" invalid={fieldState.invalid} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} options={rates.map((rate) => ({ value: rate.currency, label: rate.currency, description: rate.is_base_currency ? "本位币" : `1 ${rate.currency} = ${rate.rate} ${settings.base_currency}` }))} />} /></label>
            <label>周期（月）<input type="number" min="1" step="1" {...form.register("periodMonths", { valueAsNumber: true })} />{form.formState.errors.periodMonths && <em>{form.formState.errors.periodMonths.message}</em>}</label>
            <label>开始日期<input type="date" {...form.register("startDate")} /></label>
            <label>结束日期（可选）<input type="date" {...form.register("endDate")} />{form.formState.errors.endDate && <em>{form.formState.errors.endDate.message}</em>}</label>
          </div>
          <fieldset className="mode-options">
            <legend>确认模式</legend>
            <label className={values.recognitionMode === "AMORTIZED" ? "mode-option selected" : "mode-option"}>
              <input type="radio" value="AMORTIZED" {...form.register("recognitionMode")} />
              <span><strong>按月均摊</strong><small>每个有效月份计入月均金额。</small></span>
            </label>
            <label className={values.recognitionMode === "PAYMENT" ? "mode-option selected" : "mode-option"}>
              <input type="radio" value="PAYMENT" {...form.register("recognitionMode")} />
              <span><strong>按支付月份确认</strong><small>只在以开始日期为锚点的支付月计入完整金额。</small></span>
            </label>
            <p>无论哪种模式，下月预算概览都按月均等价金额计算。</p>
          </fieldset>
          <label>备注<textarea rows={3} {...form.register("note")} /></label>

          {previewIsCurrent && preview && (
            <div className="preview-card" aria-live="polite">
              <div><span>预览月份</span><strong>{targetMonth}</strong></div>
              <div><span>生效状态</span><strong>{preview.data.effective ? "有效" : "未生效"}</strong></div>
              <div><span>生成月度项目</span><strong>{preview.data.recognized_in_target_month ? "会" : "不会"}</strong></div>
              <div><span>月度等价金额</span><strong>{formatMoney(preview.data.monthly_equivalent, preview.data.base_currency)}</strong></div>
              <div><span>当月确认金额</span><strong>{formatMoney(preview.data.recognized_amount, preview.data.base_currency)}</strong></div>
              <div><span>计划支付日</span><strong>{preview.data.scheduled_date ?? "—"}</strong></div>
            </div>
          )}
          {(previewMutation.isError || saveMutation.isError) && (
            <div className="inline-error" role="alert">{describeError(previewMutation.error ?? saveMutation.error)}</div>
          )}
        </form>
      </Dialog>
  );
}

function DeleteDialog({ item, onClose, onDeleted }: { item: PlanItem; onClose: () => void; onDeleted: () => Promise<void> }) {
  const mutation = useMutation({ mutationFn: () => deletePlanItem(item.id), onSuccess: onDeleted });
  return (
    <ConfirmDialog title={`删除“${item.name}”`} onClose={onClose}>
      <p>这项规则关联 <strong>{item.history_month_count}</strong> 个月度快照。删除规则后，这些历史事实仍会保留。</p>
      {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
      <button className="button button-danger" disabled={mutation.isPending} type="button" onClick={() => mutation.mutate()}>确认删除周期规则</button>
    </ConfirmDialog>
  );
}

function ConfirmDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog title={title} onClose={onClose}>{children}</Dialog>;
}

function StatePanel({ children, error }: { children?: React.ReactNode; error?: unknown }) {
  return <section className="state-card">{error ? <span role="alert">{describeError(error)}</span> : children}</section>;
}
