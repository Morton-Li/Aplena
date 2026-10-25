import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import {
  createLoan, loanFrequencyLabels, previewLoanPayment, previewLoanSchedule, saveLoanPayment, saveLoanSchedule, updateLoanMetadata,
  type Loan, type LoanAllocation, type LoanDetail, type LoanDirection, type LoanFrequency, type LoanPayment,
  type LoanPaymentInput, type LoanScheduleInput, type LoanSchedulePreview, type LoanScheduleRow,
} from "../../shared/api/loans";
import { Dialog } from "../../shared/components/Dialog";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney } from "../../shared/formatting/finance";

function localToday() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

const amountPattern = "[0-9]+([.][0-9]{1,2})?";
function ErrorMessage({ error }: { error: unknown }) {
  return error ? <div className="inline-error" role="alert">{describeError(error)}</div> : null;
}

export function LoanEditor({ loan, direction, currency, onClose, onSaved }: {
  loan?: Loan; direction: LoanDirection; currency: string; onClose: () => void; onSaved: (loan?: Loan) => Promise<void>;
}) {
  const form = useId();
  const [id] = useState(() => crypto.randomUUID());
  const lock = useRef(false);
  const [name, setName] = useState(loan?.name ?? "");
  const [counterparty, setCounterparty] = useState(loan?.counterparty ?? "");
  const [selectedDirection, setDirection] = useState<LoanDirection>(loan?.direction ?? direction);
  const [principal, setPrincipal] = useState("");
  const [started, setStarted] = useState(localToday);
  const [openingOnly, setOpeningOnly] = useState(true);
  const [note, setNote] = useState(loan?.note ?? "");
  const mutation = useMutation({
    mutationFn: async () => {
      if (loan) { await updateLoanMetadata({ id: loan.id, name, counterparty, note: note || undefined, archived: loan.archived }); return undefined; }
      return createLoan({ id, name, counterparty, direction: selectedDirection, principal, startedOn: started, openingOnly, note: note || undefined });
    },
    onSuccess: onSaved,
    onSettled: () => { lock.current = false; },
  });
  const close = () => { if (!lock.current) onClose(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!lock.current) { lock.current = true; mutation.mutate(); } };
  return <Dialog title={loan ? "编辑借贷资料" : "新建借贷"} onClose={close} footer={<><button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">取消</button><button className="button button-primary" disabled={mutation.isPending} form={form} type="submit">{mutation.isPending ? "保存中…" : "保存"}</button></>}>
    <form id={form} className="loan-form" onSubmit={submit}><fieldset disabled={mutation.isPending}>
      {!loan && <label>借贷方向<Select ariaLabel="借贷方向" value={selectedDirection} onChange={(value) => setDirection(value as LoanDirection)} options={[{ value: "BORROWED", label: "我向别人或银行借款" }, { value: "LENT", label: "我借给别人" }]} /></label>}
      <label>名称<input autoFocus data-dialog-initial-focus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如住房贷款、借给张三" /></label>
      <label>{selectedDirection === "BORROWED" ? "贷款方 / 出借人" : "借款人"}<input required maxLength={200} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} /></label>
      {!loan && <>
        <label>记录起点<Select ariaLabel="记录起点" value={openingOnly ? "OPENING" : "FULL"} onChange={(value) => setOpeningOnly(value === "OPENING")} options={[{ value: "OPENING", label: "从现有剩余本金开始" }, { value: "FULL", label: "从借款发生日完整记录" }]} /></label>
        <label>{openingOnly ? "期初剩余本金" : "实际借款本金"}（{currency}）<input required inputMode="decimal" pattern={amountPattern} value={principal} onChange={(event) => setPrincipal(event.target.value)} /><small>本金大于零，最多两位小数。</small></label>
        <label>{openingOnly ? "开始跟踪日期" : "借款发生日期"}<input required type="date" max={localToday()} value={started} onChange={(event) => setStarted(event.target.value)} /></label>
        <p className="dialog-intro">{openingOnly ? "只建立期初余额，不计入当月现金流。之后录入的还款从该余额继续计算。" : "借款本金计入发生月的借贷现金流，不计入收入或支出。"}</p>
      </>}
      <label>备注（可选）<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {loan && <p className="dialog-intro">本金、方向与起始日期保留为建档事实。还款和后续分期请在详情中调整。</p>}
    </fieldset></form>
    <ErrorMessage error={mutation.error} />
  </Dialog>;
}

export function LoanScheduleEditor({ detail, onClose, onSaved }: { detail: LoanDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const form = useId();
  const lock = useRef(false);
  const today = localToday();
  const [frequency, setFrequency] = useState<LoanFrequency>(detail.versions[0]?.frequency ?? "MONTH");
  const [interval, setInterval] = useState(String(detail.versions[0]?.interval_count ?? 1));
  const [first, setFirst] = useState(today > detail.loan.started_on ? today : detail.loan.started_on);
  const [count, setCount] = useState("12");
  const [method, setMethod] = useState<LoanScheduleInput["method"]>("EQUAL_PRINCIPAL");
  const [rate, setRate] = useState("0");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<LoanScheduleRow[]>(() => detail.installments.filter((row) => !row.superseded && row.due_on >= today).map((row) => ({ due_on: row.due_on, principal: row.remaining_principal, interest: row.remaining_interest, fees: row.remaining_fees })));
  const [preview, setPreview] = useState<LoanSchedulePreview | null>(null);
  const [page, setPage] = useState(0);
  const input = (): LoanScheduleInput => ({ loanId: detail.loan.id, frequency, intervalCount: Number(interval), firstDate: first, count: Number(count), method, periodRatePercent: rate, note: note || undefined, rows });
  const mutation = useMutation({ mutationFn: () => saveLoanSchedule(input()), onSuccess: onSaved, onSettled: () => { lock.current = false; } });
  const checking = useMutation({ mutationFn: () => previewLoanSchedule(input()), onSuccess: (value) => { setPreview(value); setPage(0); } });
  const busy = mutation.isPending || checking.isPending;
  const close = () => { if (!busy && !lock.current) onClose(); };
  const invalidate = () => { setPreview(null); checking.reset(); mutation.reset(); };
  const changeRow = (index: number, field: keyof LoanScheduleRow, value: string) => { setRows((current) => current.map((row, position) => position === index ? { ...row, [field]: value } : row)); invalidate(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!busy) checking.mutate(); };
  const save = () => { if (!preview || lock.current) return; lock.current = true; mutation.mutate(); };
  const visibleRows = method === "MANUAL" ? rows : preview?.rows ?? [];
  const pages = Math.max(1, Math.ceil(visibleRows.length / 40));
  const currentPage = Math.min(page, pages - 1);
  return <Dialog title={detail.versions.length ? "调整后续还款计划" : "建立还款计划"} size="wide" className="loan-plan-dialog" onClose={close} footer={<><button className="button button-quiet" disabled={busy} onClick={close} type="button">取消</button><button className="button button-secondary" disabled={busy} form={form} type="submit">{checking.isPending ? "核对中…" : "预览并核对"}</button><button className="button button-primary" disabled={busy || !preview} onClick={save} type="button">{mutation.isPending ? "保存中…" : "保存计划"}</button></>}>
    <p className="dialog-intro">支持日、月、季度、年。短月取月末，后续恢复原始日；不自动顺延节假日。已过去的期次保留，未来计划按新版本接续，实际收付不会删除。</p>
    <form id={form} className="loan-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="loan-form-grid">
        <label>周期单位<Select ariaLabel="周期单位" value={frequency} onChange={(value) => { setFrequency(value as LoanFrequency); invalidate(); }} options={Object.entries(loanFrequencyLabels).map(([value, label]) => ({ value, label }))} /></label>
        <label>每隔几个周期<input type="number" required min="1" max="10000" step="1" value={interval} onChange={(event) => { setInterval(event.target.value); invalidate(); }} /></label>
        <label>生成方式<Select ariaLabel="生成方式" value={method} onChange={(value) => { setMethod(value as LoanScheduleInput["method"]); invalidate(); }} options={[{ value: "EQUAL_PRINCIPAL", label: "等额本金（0 利率可用于无息分期）" }, { value: "ANNUITY", label: "等额本息" }, { value: "MANUAL", label: "手动逐期指定" }]} /></label>
        {method !== "MANUAL" && <>
          <label>首次还款日<input type="date" required value={first} min={detail.versions.length ? today : detail.loan.started_on} onChange={(event) => { setFirst(event.target.value); invalidate(); }} /></label>
          <label>期数<input type="number" required min="1" max="10000" step="1" value={count} onChange={(event) => { setCount(event.target.value); invalidate(); }} /></label>
          <label>每期利率（%）<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,8})?" value={rate} onChange={(event) => { setRate(event.target.value); invalidate(); }} /><small>对应每 {interval} {loanFrequencyLabels[frequency]}，不是年利率。按实际天数计息时使用手动计划。</small></label>
        </>}
      </div>
      <label>变更说明（可选）<input value={note} onChange={(event) => { setNote(event.target.value); invalidate(); }} placeholder="例如提前还款后重排、约定延期" /></label>
    </fieldset></form>
    {preview && <div className="success-banner" role="status">本次安排本金 {formatMoney(preview.principal_to_schedule, detail.loan.currency)}；保留 {preview.preserved_count} 个历史期次，生成 {preview.rows.length} 个后续期次。</div>}
    {method === "MANUAL" && <div className="special-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => { setRows((value) => [...value, { due_on: first, principal: "0.00", interest: "0.00", fees: "0.00" }]); setPage(Math.floor(rows.length / 40)); invalidate(); }}>添加一期</button><small>按日期递增排列；本金合计须与本次可安排本金一致。提前结清后可清空未来未履行的计划。</small></div>}
    {visibleRows.length > 0 && <div className="table-scroll loan-table-scroll"><table className="data-table loan-edit-table"><caption className="sr-only">待保存的还款计划</caption><thead><tr><th>期次</th><th>还款日期</th><th>本金</th><th>利息</th><th>费用</th>{method === "MANUAL" && <th>操作</th>}</tr></thead><tbody>{visibleRows.slice(currentPage * 40, currentPage * 40 + 40).map((row, index) => {
      const position = currentPage * 40 + index;
      return <tr key={position}><th>{position + 1}</th>{(["due_on", "principal", "interest", "fees"] as const).map((field) => <td key={field}>{method === "MANUAL" ? <input aria-label={"第" + (position + 1) + "期" + ({ due_on: "日期", principal: "本金", interest: "利息", fees: "费用" })[field]} disabled={busy} type={field === "due_on" ? "date" : "text"} inputMode={field === "due_on" ? undefined : "decimal"} value={row[field]} onChange={(event) => changeRow(position, field, event.target.value)} /> : field === "due_on" ? row[field] : formatMoney(row[field], detail.loan.currency)}</td>)}{method === "MANUAL" && <td><button className="text-button danger-text" type="button" disabled={busy} onClick={() => { setRows((value) => value.filter((_, index) => index !== position)); invalidate(); }}>移除此期</button></td>}</tr>;
    })}</tbody></table></div>}
    {pages > 1 && <div className="loan-pagination"><button className="button button-quiet" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pages}</span><button className="button button-quiet" type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    {preview && method !== "MANUAL" && <button className="text-button" type="button" disabled={busy} onClick={() => { setRows(preview.rows); setMethod("MANUAL"); invalidate(); }}>在此结果上手动调整本金、利息或日期</button>}
    <ErrorMessage error={checking.error ?? mutation.error} />
  </Dialog>;
}

export function LoanPaymentEditor({ detail, payment, onClose, onSaved }: { detail: LoanDetail; payment?: LoanPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const form = useId();
  const [id] = useState(() => payment?.id ?? crypto.randomUUID());
  const lock = useRef(false);
  const [occurred, setOccurred] = useState(payment?.occurred_on ?? localToday());
  const [principal, setPrincipal] = useState(payment?.principal ?? "0.00");
  const [interest, setInterest] = useState(payment?.interest ?? "0.00");
  const [fees, setFees] = useState(payment?.fees ?? "0.00");
  const [note, setNote] = useState(payment?.note ?? "");
  const [allocations, setAllocations] = useState<LoanAllocation[] | null>(payment?.allocations ?? null);
  const input = (): LoanPaymentInput => ({ id, loanId: detail.loan.id, expectedUpdatedAt: payment?.updated_at, occurredOn: occurred, principal, interest, fees, note: note || undefined, allocations: allocations ?? [] });
  const mutation = useMutation({ mutationFn: () => saveLoanPayment(input()), onSuccess: onSaved, onSettled: () => { lock.current = false; } });
  const preview = useMutation({ mutationFn: () => previewLoanPayment(input()), onSuccess: setAllocations });
  const busy = mutation.isPending || preview.isPending;
  const close = () => { if (!busy && !lock.current) onClose(); };
  const invalidate = () => { setAllocations(null); preview.reset(); mutation.reset(); };
  const save = () => { if (!allocations || lock.current) return; lock.current = true; mutation.mutate(); };
  const changeAllocation = (index: number, field: keyof LoanAllocation, value: string) => setAllocations((current) => current?.map((row, position) => position === index ? { ...row, [field]: field === "installmentId" ? value || null : value } : row) ?? null);
  const eligible = detail.installments.filter((row) => !row.superseded || payment?.allocations.some((a) => a.installmentId === row.id));
  return <Dialog title={(payment ? "编辑" : "记录") + (detail.loan.direction === "BORROWED" ? "还款" : "回款")} size="wide" onClose={close} footer={<><button className="button button-quiet" disabled={busy} onClick={close} type="button">取消</button><button className="button button-secondary" disabled={busy} form={form} type="submit">{preview.isPending ? "分配中…" : "预览分配"}</button><button className="button button-primary" disabled={busy || !allocations} onClick={save} type="button">{mutation.isPending ? "保存中…" : "保存实际收付"}</button></>}>
    <p className="dialog-intro">按实际金额分别填写本金、利息和费用。预览默认分配到最早期次，也可调整到其他期次；未约定的额外收付单独保留。提前还款后，可调整后续计划。</p>
    <form id={form} className="loan-form" onSubmit={(event) => { event.preventDefault(); if (!busy) preview.mutate(); }}><fieldset disabled={busy}>
      {!payment && <label>按一期待还金额填入（可选）<Select ariaLabel="按一期待还金额填入" value="" onChange={(id) => {
        const row = detail.installments.find((row) => row.id === id);
        if (row) { setPrincipal(row.remaining_principal); setInterest(row.remaining_interest); setFees(row.remaining_fees); invalidate(); }
      }} options={[{ value: "", label: "选择一期，或直接填写实际金额" }, ...detail.installments.filter((row) => !row.superseded && row.remaining_total !== "0.00").map((row) => ({ value: row.id, label: row.due_on + " · 第" + row.position + "期" }))]} /></label>}
      <label>实际发生日期<input type="date" required min={detail.loan.started_on} max={localToday()} value={occurred} onChange={(event) => { setOccurred(event.target.value); invalidate(); }} /></label>
      <div className="loan-form-grid">{[{ label: "本金", value: principal, set: setPrincipal }, { label: "利息", value: interest, set: setInterest }, { label: "费用", value: fees, set: setFees }].map((field) => <label key={field.label}>{field.label}（{detail.loan.currency}）<input required inputMode="decimal" pattern={amountPattern} value={field.value} onChange={(event) => { field.set(event.target.value); invalidate(); }} /></label>)}</div>
      <label>备注（可选）<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </fieldset></form>
    {allocations && <section className="loan-allocation-preview"><h3>本次还款分配</h3><p className="chart-note">分配的各项合计须分别等于上面的本金、利息和费用。</p><div className="table-scroll"><table className="data-table loan-edit-table"><caption className="sr-only">本次还款分配</caption><thead><tr><th>对应期次</th><th>本金</th><th>利息</th><th>费用</th><th>操作</th></tr></thead><tbody>{allocations.map((allocation, index) => <tr key={index}><td><Select ariaLabel={"第" + (index + 1) + "条分配期次"} disabled={busy} value={allocation.installmentId ?? ""} onChange={(value) => changeAllocation(index, "installmentId", value)} options={[{ value: "", label: "未约定 / 额外收付" }, ...eligible.map((row) => ({ value: row.id, label: row.due_on + " · 第" + row.position + "期" + (row.superseded ? "（旧版）" : "") }))]} /></td>{(["principal", "interest", "fees"] as const).map((field) => <td key={field}><input aria-label={"第" + (index + 1) + "条分配" + ({ principal: "本金", interest: "利息", fees: "费用" })[field]} disabled={busy} inputMode="decimal" value={allocation[field]} onChange={(event) => changeAllocation(index, field, event.target.value)} /></td>)}<td><button className="text-button danger-text" type="button" disabled={busy} onClick={() => setAllocations((current) => current?.filter((_, position) => position !== index) ?? null)}>移除</button></td></tr>)}</tbody></table></div><button className="text-button" type="button" disabled={busy} onClick={() => setAllocations((current) => [...current ?? [], { installmentId: null, principal: "0.00", interest: "0.00", fees: "0.00" }])}>添加分配</button></section>}
    <ErrorMessage error={preview.error ?? mutation.error} />
  </Dialog>;
}
