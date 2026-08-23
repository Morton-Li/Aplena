import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import type { DomainContract } from "../../shared/api/domain";
import {
  createPlanItem,
  deletePlanItem,
  getSettings,
  listExchangeRates,
  listPlanItems,
  previewPlanItem,
  queryKeys,
  stopPlanItem,
  updatePlanItem,
  type ExchangeRate,
  type PlanItem,
  type PlanItemInput,
  type PlanMutationResult,
  type PlanPreview,
  type Settings,
} from "../../shared/api/finance";
import { describeError } from "../../shared/formatting/errors";
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
      .regex(/^\d+(\.\d{1,4})?$/, "金额最多保留四位小数"),
    currency: z.string().length(3, "请选择币种"),
    periodMonths: z.number().int("周期必须为整数").positive("周期必须大于 0"),
    startMonth: z.string().regex(/^\d{4}-\d{2}$/, "请选择开始月份"),
    endMonth: z.string(),
    recognitionMode: z.enum(["AMORTIZED", "PAYMENT"]),
    note: z.string(),
  })
  .superRefine((values, context) => {
    if (values.endMonth && values.endMonth < values.startMonth) {
      context.addIssue({
        code: "custom",
        path: ["endMonth"],
        message: "结束月份不能早于开始月份",
      });
    }
  });

type PlanValues = z.infer<typeof planSchema>;

export function PlansPage({ contract }: { contract: DomainContract }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const plansQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems() });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [editor, setEditor] = useState<PlanItem | "new" | null>(null);
  const [stopping, setStopping] = useState<PlanItem | null>(null);
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
      queryClient.invalidateQueries({ queryKey: ["monthly-items"] }),
      queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.existingMonths }),
    ]);
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">长期财务计划</p>
          <h1>维护未来，而不是补录流水。</h1>
          <p>这里的修改只影响尚未生成的月份；已有月度快照保持原样。</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setEditor("new")}>
          新建计划
        </button>
      </header>

      {feedback && <div className="success-banner" role="status">{feedback}</div>}

      <section className="toolbar" aria-label="计划筛选">
        <label className="search-field">
          <span className="sr-only">搜索长期计划</span>
          <input
            type="search"
            placeholder="搜索名称或备注"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">按类别筛选</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="ALL">全部类别</option>
            {contract.categories.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </label>
        <span className="result-count">{filtered.length} 项</span>
      </section>

      {plansQuery.isPending && <StatePanel>正在读取长期计划…</StatePanel>}
      {plansQuery.isError && <StatePanel error={plansQuery.error} />}
      {plansQuery.isSuccess && filtered.length === 0 && (
        <StatePanel>
          {plansQuery.data.length === 0 ? "还没有长期计划。创建第一项收入或支出计划吧。" : "没有符合筛选条件的计划。"}
        </StatePanel>
      )}
      {filtered.length > 0 && (
        <div className="plan-list">
          {filtered.map((item) => (
            <article className="plan-card" key={item.id}>
              <div className="plan-card-main">
                <div className="plan-title-row">
                  <span className={`category-pill category-${item.flow_type.toLowerCase()}`}>
                    {categoryLabel(item.category)}
                  </span>
                  <span>{flowLabel(item.flow_type)}</span>
                </div>
                <h2>{item.name}</h2>
                <p>
                  {item.start_month} 至 {item.end_month ?? "长期有效"} · {recognitionLabel(item.recognition_mode)}
                </p>
                {item.note && <small>{item.note}</small>}
              </div>
              <dl className="plan-facts">
                <div><dt>原币金额</dt><dd>{item.planned_amount} {item.currency}</dd></div>
                <div><dt>周期</dt><dd>{item.period_months} 个月</dd></div>
                <div><dt>历史快照</dt><dd>{item.history_month_count} 个月</dd></div>
              </dl>
              <div className="card-actions">
                <button className="button button-quiet" type="button" onClick={() => setEditor(item)}>编辑</button>
                <button className="button button-quiet" type="button" onClick={() => setStopping(item)}>停止</button>
                <button className="button button-danger-quiet" type="button" onClick={() => setDeleting(item)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editor && settingsQuery.data && ratesQuery.data && (
        <PlanEditor
          contract={contract}
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
      {stopping && (
        <StopDialog
          item={stopping}
          onClose={() => setStopping(null)}
          onStopped={async () => {
            setStopping(null);
            setFeedback("计划已停止，历史月度快照未作修改。");
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
            setFeedback("长期计划已删除，关联历史快照已保留。");
            await refreshPlans();
          }}
        />
      )}
    </>
  );
}

function PlanEditor({
  contract,
  existing,
  rates,
  settings,
  onClose,
  onSaved,
}: {
  contract: DomainContract;
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
        startMonth: existing.start_month,
        endMonth: existing.end_month ?? "",
        recognitionMode: existing.recognition_mode as "AMORTIZED" | "PAYMENT",
        note: existing.note ?? "",
      }
    : {
        name: "",
        category: "FIXED_INCOME",
        plannedAmount: "",
        currency: settings.base_currency,
        periodMonths: 1,
        startMonth: settings.target_month,
        endMonth: "",
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
    startMonth: value.startMonth,
    endMonth: value.endMonth || undefined,
    recognitionMode: value.recognitionMode,
    note: value.note || undefined,
  });
  const previewMutation = useMutation({
    mutationFn: (value: PlanValues) =>
      previewPlanItem(contract, settings, rates, settings.target_month, toInput(value)),
    onSuccess: (data) => setPreview({ signature, data }),
  });
  const saveMutation = useMutation<PlanMutationResult | PlanItem, Error, PlanValues>({
    mutationFn: (value: PlanValues) =>
      existing ? updatePlanItem(toInput(value)) : createPlanItem(toInput(value)),
    onSuccess: async (result) => {
      const initialization = "current_month_initialization" in result ? result.current_month_initialization : null;
      const detail = initialization?.created_count
        ? `并已为当前月新增 ${initialization.created_count} 个快照。`
        : "当前月快照未被覆盖。";
      await onSaved(`计划已保存，${detail}`);
    },
  });
  const category = contract.categories.find((item) => item.code === values.category);
  const derivedFlow = ["FIXED_INCOME", "VARIABLE_INCOME"].includes(values.category ?? "")
    ? "收入"
    : "支出";
  const previewIsCurrent = preview?.signature === signature;

  return (
    <div className="modal-backdrop">
      <section className="side-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title">
        <header className="dialog-header">
          <div>
            <p className="section-label">{existing ? "编辑长期计划" : "新建长期计划"}</p>
            <h2 id="plan-editor-title">{existing?.name ?? "新的收入或支出计划"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <form className="plan-form" onSubmit={form.handleSubmit((value) => saveMutation.mutate(value))}>
          <div className="field-grid">
            <label className="field-span-2">项目名称<input autoFocus {...form.register("name")} />{form.formState.errors.name && <em>{form.formState.errors.name.message}</em>}</label>
            <label>类别<select {...form.register("category")}>{contract.categories.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
            <label>交易类型<input readOnly value={derivedFlow} aria-label="交易类型（自动）" /><small>由“{category?.label}”自动决定</small></label>
            <label>计划金额<input inputMode="decimal" {...form.register("plannedAmount")} />{form.formState.errors.plannedAmount && <em>{form.formState.errors.plannedAmount.message}</em>}</label>
            <label>币种<select {...form.register("currency")}>{rates.map((rate) => <option key={rate.currency} value={rate.currency}>{rate.currency}</option>)}</select></label>
            <label>周期（月）<input type="number" min="1" step="1" {...form.register("periodMonths", { valueAsNumber: true })} />{form.formState.errors.periodMonths && <em>{form.formState.errors.periodMonths.message}</em>}</label>
            <label>开始月份<input type="month" {...form.register("startMonth")} /></label>
            <label>结束月份（可选）<input type="month" {...form.register("endMonth")} />{form.formState.errors.endMonth && <em>{form.formState.errors.endMonth.message}</em>}</label>
          </div>
          <fieldset className="mode-options">
            <legend>确认模式</legend>
            <label className={values.recognitionMode === "AMORTIZED" ? "mode-option selected" : "mode-option"}>
              <input type="radio" value="AMORTIZED" {...form.register("recognitionMode")} />
              <span><strong>按月均摊</strong><small>每个有效月份计入月均金额。</small></span>
            </label>
            <label className={values.recognitionMode === "PAYMENT" ? "mode-option selected" : "mode-option"}>
              <input type="radio" value="PAYMENT" {...form.register("recognitionMode")} />
              <span><strong>按支付月份确认</strong><small>只在以开始月份为锚点的支付月计入完整金额。</small></span>
            </label>
            <p>无论哪种模式，财务承载能力都按月均负担计算。</p>
          </fieldset>
          <label>备注<textarea rows={3} {...form.register("note")} /></label>

          {previewIsCurrent && preview && (
            <div className="preview-card" aria-live="polite">
              <div><span>目标月份</span><strong>{settings.target_month}</strong></div>
              <div><span>生效状态</span><strong>{preview.data.effective ? "有效" : "未生效"}</strong></div>
              <div><span>生成月度项目</span><strong>{preview.data.recognized_in_target_month ? "会" : "不会"}</strong></div>
              <div><span>月度等价金额</span><strong>{preview.data.monthly_equivalent ?? "N/A"} {preview.data.base_currency}</strong></div>
              <div><span>当月确认金额</span><strong>{preview.data.recognized_amount ?? "N/A"} {preview.data.base_currency}</strong></div>
            </div>
          )}
          {(previewMutation.isError || saveMutation.isError) && (
            <div className="inline-error" role="alert">{describeError(previewMutation.error ?? saveMutation.error)}</div>
          )}
          <footer className="dialog-actions">
            <button className="button button-quiet" type="button" onClick={onClose}>取消</button>
            <button className="button button-secondary" disabled={previewMutation.isPending} type="button" onClick={form.handleSubmit((value) => previewMutation.mutate(value))}>
              {previewMutation.isPending ? "计算中…" : "预览并检查"}
            </button>
            <button className="button button-primary" disabled={!previewIsCurrent || saveMutation.isPending} type="submit">
              {saveMutation.isPending ? "保存中…" : "确认保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function StopDialog({ item, onClose, onStopped }: { item: PlanItem; onClose: () => void; onStopped: () => Promise<void> }) {
  const [endMonth, setEndMonth] = useState(item.end_month ?? item.start_month);
  const mutation = useMutation({ mutationFn: () => stopPlanItem({ id: item.id, endMonth }), onSuccess: onStopped });
  return (
    <ConfirmDialog title={`停止“${item.name}”`} onClose={onClose}>
      <p>停止只会设置结束月份，不会改动已经生成的月度快照。</p>
      <label>最后有效月份<input type="month" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /></label>
      {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
      <button className="button button-primary" disabled={mutation.isPending} type="button" onClick={() => mutation.mutate()}>确认停止</button>
    </ConfirmDialog>
  );
}

function DeleteDialog({ item, onClose, onDeleted }: { item: PlanItem; onClose: () => void; onDeleted: () => Promise<void> }) {
  const mutation = useMutation({ mutationFn: () => deletePlanItem(item.id), onSuccess: onDeleted });
  return (
    <ConfirmDialog title={`删除“${item.name}”`} onClose={onClose}>
      <p>这项计划关联 <strong>{item.history_month_count}</strong> 个月度快照。删除长期计划后，这些历史事实仍会保留。</p>
      {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
      <button className="button button-danger" disabled={mutation.isPending} type="button" onClick={() => mutation.mutate()}>确认删除长期计划</button>
    </ConfirmDialog>
  );
}

function ConfirmDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="dialog-header"><h2 id="confirm-title">{title}</h2><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        {children}
      </section>
    </div>
  );
}

function StatePanel({ children, error }: { children?: React.ReactNode; error?: unknown }) {
  return <section className="state-card">{error ? <span role="alert">{describeError(error)}</span> : children}</section>;
}
