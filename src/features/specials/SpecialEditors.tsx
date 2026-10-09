import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { importReferenceRates, queryKeys, updateActualEntry, type ExchangeRate } from "../../shared/api/finance";
import { deriveReferenceRate, fetchEcbReferenceRates, isReferenceRateStale, SUPPORTED_CURRENCIES } from "../../shared/api/referenceRates";
import {
  createSpecialActualEntry,
  saveSpecialAllocation,
  saveSpecialProject,
  specialExpenseCategories,
  type SpecialActualEntry,
  type SpecialAllocation,
  type SpecialExpenseCategory,
  type SpecialProject,
} from "../../shared/api/specials";
import { Dialog } from "../../shared/components/Dialog";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { currencyName, formatExchangeRate, formatMoney } from "../../shared/formatting/finance";
import { categoryLabel } from "../../shared/formatting/labels";
import { evaluateAmountExpression } from "../monthly/amountExpression";
import { defaultActualEntryDate } from "../monthly/monthlyWorkspace";
import {
  nextSpecialMonth,
  specialActualInput,
  specialEntryRateSnapshot,
  specialEntryValidation,
  specialMonthLastDate,
  validSpecialBudget,
  validSpecialMonth,
  type EntryRateSnapshot,
  type SpecialEntryValues,
} from "./specialForms";

export function SpecialProjectEditor({ project, baseCurrency, onClose, onSaved }: { project?: SpecialProject; baseCurrency: string; onClose: () => void; onSaved: (project: SpecialProject) => Promise<void> }) {
  const formId = useId();
  const submitting = useRef(false);
  const [name, setName] = useState(project?.name ?? "");
  const [totalBudget, setTotalBudget] = useState(project?.total_budget ?? "");
  const [note, setNote] = useState(project?.note ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => saveSpecialProject({ id: project?.id, name: name.trim(), totalBudget: totalBudget.trim(), note: note.trim() || undefined }),
    onSuccess: onSaved,
    onSettled: () => { submitting.current = false; },
  });
  const close = () => { if (!submitting.current) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!name.trim()) { setValidation("请输入专项名称。"); return; }
    if (!validSpecialBudget(totalBudget)) { setValidation("总预算须为大于或等于 0 的金额，最多两位小数。"); return; }
    setValidation(null);
    submitting.current = true;
    mutation.mutate();
  };
  return <Dialog className="special-project-dialog" eyebrow="专项" title={project ? "编辑专项" : "新建专项"} onClose={close} footer={<>
    <button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">取消</button>
    <button className="button button-primary" disabled={mutation.isPending} form={formId} type="submit">{mutation.isPending ? "保存中…" : "保存项目"}</button>
  </>}>
    <p className="dialog-intro">为旅行、装修等专项设置总预算，再按需要分配到月份。实际发生额可超过预算。</p>
    <form id={formId} noValidate onSubmit={submit}>
      <label>专项名称<input autoFocus data-dialog-initial-focus disabled={mutation.isPending} maxLength={200} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <label>总预算（{project?.currency ?? baseCurrency}）<input disabled={mutation.isPending} inputMode="decimal" onChange={(event) => setTotalBudget(event.target.value)} placeholder="例如 20000.00" value={totalBudget} /><small>已分配预算须在总预算内；减少总预算不会改写实际条目。</small></label>
      <label>专项备注（可选）<textarea disabled={mutation.isPending} onChange={(event) => setNote(event.target.value)} rows={3} value={note} /></label>
    </form>
    {(validation || mutation.isError) && <div className="inline-error" role="alert">{validation ?? describeError(mutation.error)}</div>}
  </Dialog>;
}

export function SpecialAllocationEditor({ project, currentMonth, existing, onClose, onSaved }: { project: SpecialProject; currentMonth: string; existing?: SpecialAllocation; onClose: () => void; onSaved: () => Promise<void> }) {
  const formId = useId();
  const submitting = useRef(false);
  const [month, setMonth] = useState(existing?.month ?? nextSpecialMonth(currentMonth));
  const [category, setCategory] = useState<SpecialExpenseCategory>(existing?.category ?? "DISCRETIONARY_BUDGET");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => saveSpecialAllocation({ id: existing?.id, projectId: project.id, month, category, amount: amount.trim() }),
    onSuccess: onSaved,
    onSettled: () => { submitting.current = false; },
  });
  const close = () => { if (!submitting.current) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!validSpecialMonth(month) || month < currentMonth || (existing && month === currentMonth)) { setValidation(existing ? "只能调整未冻结的未来月分配。" : "请选择本月或未来月份；历史月预算保持冻结。"); return; }
    if (!validSpecialBudget(amount)) { setValidation("月分配须为大于或等于 0 的金额，最多两位小数。"); return; }
    setValidation(null);
    submitting.current = true;
    mutation.mutate();
  };
  return <Dialog className="special-allocation-dialog" eyebrow={project.name} title={existing ? "编辑月预算分配" : "添加月预算分配"} onClose={close} footer={<>
    <button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">取消</button>
    <button className="button button-primary" disabled={mutation.isPending} form={formId} type="submit">{mutation.isPending ? "保存中…" : month === currentMonth ? "保存并形成本月快照" : "保存分配"}</button>
  </>}>
    <form id={formId} noValidate onSubmit={submit}>
      <div className="entry-detail-grid">
        <label>分配月份<input autoFocus data-dialog-initial-focus disabled={mutation.isPending} min={existing ? nextSpecialMonth(currentMonth) : currentMonth} onChange={(event) => setMonth(event.target.value)} type="month" value={month} /></label>
        <label>支出分类<Select ariaLabel="月分配支出分类" disabled={mutation.isPending} onChange={(value) => setCategory(value as SpecialExpenseCategory)} options={specialExpenseCategories.map((value) => ({ value, label: categoryLabel(value) }))} value={category} /></label>
      </div>
      <label>月分配金额（{project.currency}）<input disabled={mutation.isPending} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder="例如 3000.00" value={amount} /></label>
      <p className="dialog-intro">该金额直接计入所选月份的支出预算。每个专项、月份和分类只保存一份分配。</p>
      {month === currentMonth && <p className="special-freeze-notice" role="status">保存后立即形成本月快照，该分配将不能调整或删除；已有实际条目继续保留。</p>}
    </form>
    {(validation || mutation.isError) && <div className="inline-error" role="alert">{validation ?? describeError(mutation.error)}</div>}
  </Dialog>;
}

export function SpecialActualEditor({ project, currentMonth, rates, existing, detailGroups, onClose, onSaved }: { project: SpecialProject; currentMonth: string; rates: ExchangeRate[]; existing?: SpecialActualEntry; detailGroups: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const formId = useId();
  const groupListId = useId();
  const submitting = useRef(false);
  const queryClient = useQueryClient();
  const [values, setValues] = useState<SpecialEntryValues>({
    month: existing?.month ?? currentMonth,
    category: existing?.category ?? "DISCRETIONARY_BUDGET",
    occurredOn: existing?.occurred_on ?? defaultActualEntryDate(currentMonth),
    effect: existing?.effect ?? "INCREASE",
    currency: existing?.source_currency ?? project.currency,
    detailGroup: existing?.detail_group ?? "",
    note: existing?.note ?? "",
  });
  const [amount, setAmount] = useState(existing?.source_amount ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const referenceQuery = useQuery({
    queryKey: ["ecb-reference-rates"],
    queryFn: () => fetchEcbReferenceRates(),
    enabled: !existing && values.currency !== project.currency,
    retry: false,
    staleTime: 0,
  });
  const cachedSnapshot = specialEntryRateSnapshot(values.currency, project.currency, values.occurredOn, rates, existing);
  const officialRate = deriveReferenceRate(referenceQuery.data ?? [], values.currency, project.currency);
  const preview: EntryRateSnapshot | null = !existing && values.currency !== project.currency && officialRate
    ? { rate: officialRate.rate, observedOn: officialRate.observedOn, source: "ECB_REFERENCE" }
    : cachedSnapshot;
  const currencyOptions = useMemo(() => Array.from(new Set([
    project.currency,
    ...SUPPORTED_CURRENCIES,
    ...rates.map((rate) => rate.currency),
    ...(existing ? [existing.source_currency] : []),
  ])).sort().map((value) => ({ value, label: currencyName(value) })), [existing, project.currency, rates]);
  const amountEvaluation = evaluateAmountExpression(amount);
  const mutation = useMutation({
    mutationFn: async (resolvedAmount: string) => {
      let snapshot = cachedSnapshot;
      if (!existing && values.currency !== project.currency) {
        try {
          const fresh = await referenceQuery.refetch();
          if (fresh.error) throw fresh.error;
          const observations = fresh.data ?? await fetchEcbReferenceRates();
          const updatedRates = await importReferenceRates({ observations, currencies: [values.currency] });
          queryClient.setQueryData(queryKeys.rates, updatedRates);
          snapshot = specialEntryRateSnapshot(values.currency, project.currency, values.occurredOn, updatedRates);
        } catch (error) {
          if (!cachedSnapshot) throw error;
        }
      }
      if (!snapshot) throw new Error(`缺少 ${values.currency} 可用汇率，请在设置中补充汇率后重试。`);
      const input = specialActualInput(project.id, values, resolvedAmount, snapshot);
      return existing ? updateActualEntry({
        id: existing.id,
        monthlyItemId: existing.monthly_item_id,
        occurredOn: input.occurredOn,
        effect: input.effect,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        exchangeRateSource: input.exchangeRateSource,
        exchangeRateObservedOn: input.exchangeRateObservedOn,
        note: input.note,
        detailGroup: input.detailGroup,
      }) : createSpecialActualEntry(input);
    },
    onSuccess: onSaved,
    onSettled: () => { submitting.current = false; },
  });
  const update = <Key extends keyof SpecialEntryValues>(key: Key, value: SpecialEntryValues[Key]) => setValues((current) => ({ ...current, [key]: value }));
  const close = () => { if (!submitting.current) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const error = specialEntryValidation(values);
    if (error) { setValidation(error); return; }
    if (!amountEvaluation.ok) { setValidation("请输入大于 0 的原币金额，最多两位小数；也可输入加减乘除算式。"); return; }
    setValidation(null);
    submitting.current = true;
    mutation.mutate(amountEvaluation.amount);
  };
  return <Dialog className="entry-dialog special-entry-dialog" eyebrow={project.name} title={existing ? "编辑支出或退款" : project.archived ? "补录支出或退款" : "添加支出或退款"} onClose={close} footer={<>
    <button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">取消</button>
    <button className="button button-primary" disabled={mutation.isPending} form={formId} type="submit">{mutation.isPending ? "保存中…" : "保存条目"}</button>
  </>}>
    <form id={formId} noValidate onSubmit={submit}>
      <div className="entry-detail-grid">
        <label>发生月份<input disabled={Boolean(existing) || mutation.isPending} onChange={(event) => {
          const month = event.target.value;
          setValues((current) => ({ ...current, month, occurredOn: validSpecialMonth(month) ? defaultActualEntryDate(month) : "" }));
        }} type="month" value={values.month} /></label>
        <label>支出分类<Select ariaLabel="实际条目支出分类" disabled={Boolean(existing) || mutation.isPending} onChange={(value) => update("category", value as SpecialExpenseCategory)} options={specialExpenseCategories.map((value) => ({ value, label: categoryLabel(value) }))} value={values.category} /></label>
        <label>实际日期<input disabled={mutation.isPending} max={specialMonthLastDate(values.month)} min={`${values.month}-01`} onChange={(event) => update("occurredOn", event.target.value)} type="date" value={values.occurredOn} /></label>
        <label>类型<Select ariaLabel="专项条目类型" disabled={mutation.isPending} onChange={(value) => update("effect", value as SpecialEntryValues["effect"])} options={[{ value: "INCREASE", label: "支出" }, { value: "DECREASE", label: "退款" }]} value={values.effect} /></label>
      </div>
      <div className="entry-money-grid">
        <label>币种<Select ariaLabel="专项条目币种" disabled={Boolean(existing) || mutation.isPending} onChange={(value) => update("currency", value)} options={currencyOptions} value={values.currency} /></label>
        <label>原币金额<input autoFocus data-dialog-initial-focus disabled={mutation.isPending} inputMode="text" maxLength={120} onChange={(event) => setAmount(event.target.value)} placeholder="例如 120+35.50" spellCheck={false} value={amount} /><small>{/[+\-*/×÷()（）]/.test(amount) && amountEvaluation.ok ? `计算结果：${formatMoney(amountEvaluation.amount, values.currency)}` : "支持加减乘除和括号；保存时只记录计算结果。"}</small></label>
      </div>
      <div className="entry-rate-snapshot" aria-live="polite">
        <span>本次汇率快照</span>
        {preview ? <><strong>1 {values.currency} = {formatExchangeRate(preview.rate)} {project.currency}</strong><small>{preview.source === "ECB_REFERENCE" ? "欧洲央行每日参考汇率" : preview.source === "MANUAL" ? "备用手动汇率" : "本位币"} · {preview.observedOn}{preview.source === "ECB_REFERENCE" && isReferenceRateStale(preview.observedOn) ? " · 数据日期较早" : ""}{existing ? " · 编辑沿用原快照" : " · 保存后固定"}</small></> : <><strong>{referenceQuery.isFetching ? "正在读取官方汇率…" : "暂无可用汇率"}</strong><small>可到<Link to="/settings">设置</Link>补充备用汇率，再保存条目。</small></>}
      </div>
      <label>明细组（可选）<input disabled={mutation.isPending} list={groupListId} maxLength={200} onChange={(event) => update("detailGroup", event.target.value)} placeholder="例如 住宿、材料、施工" value={values.detailGroup} /><small>同一专项可复用明细组；清空后归为未分组。</small></label>
      <datalist id={groupListId}>{detailGroups.map((group) => <option key={group} value={group} />)}</datalist>
      <label>条目备注（可选）<textarea disabled={mutation.isPending} onChange={(event) => update("note", event.target.value)} rows={2} value={values.note} /></label>
      {existing && <p className="chart-note">此条目属于 {existing.month} 的月工作区。编辑继续使用原币种和汇率快照；月份与分类保持原归属。</p>}
    </form>
    {(validation || mutation.isError) && <div className="inline-error" role="alert">{validation ?? describeError(mutation.error)}</div>}
  </Dialog>;
}
