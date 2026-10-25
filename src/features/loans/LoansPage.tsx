import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getSettings, getStartupStatus, queryKeys } from "../../shared/api/finance";
import { deleteLoanPayment, getLoan, listLoans, loanFrequencyLabels, loanQueryKeys, updateLoanMetadata, type Loan, type LoanDirection, type LoanPayment } from "../../shared/api/loans";
import { Dialog } from "../../shared/components/Dialog";
import { EmptyState } from "../../shared/components/EmptyState";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney } from "../../shared/formatting/finance";
import { refreshFinancialQueries } from "../automatic/refreshFinancialQueries";
import { LoanEditor, LoanPaymentEditor, LoanScheduleEditor } from "./LoanEditors";
import { LoanMetric, LoanMonthCard } from "./LoanMonthCard";

type Editor = { kind: "loan"; loan?: Loan } | { kind: "schedule" } | { kind: "payment"; payment?: LoanPayment };
const installmentStates: Record<string, string> = { PENDING: "待还", PARTIAL: "部分归还", OVERDUE: "逾期未还清", PAID: "已还清", SUPERSEDED: "旧版计划" };

export function LoansPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [direction, setDirection] = useState<LoanDirection>("BORROWED");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<LoanPayment | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [schedulePage, setSchedulePage] = useState(0);
  const [feedback, setFeedback] = useState("");
  const list = useQuery({ queryKey: loanQueryKeys.list, queryFn: () => listLoans() });
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const startup = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const explicitId = params.get("id");
  const explicitLoan = list.data?.find((loan) => loan.id === explicitId);
  const activeDirection = explicitLoan?.direction ?? direction;
  const filtered = (list.data ?? []).filter((loan) => loan.direction === activeDirection && (status === "ALL" || (status === "ARCHIVED" ? loan.archived : !loan.archived)) && (loan.name + loan.counterparty + (loan.note ?? "")).toLowerCase().includes(search.toLowerCase()));
  const id = explicitId ?? filtered[0]?.id ?? "";
  const detail = useQuery({ queryKey: loanQueryKeys.detail(id), queryFn: () => getLoan(id), enabled: Boolean(id) });
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: loanQueryKeys.list }), client.invalidateQueries({ queryKey: ["loan"] }), refreshFinancialQueries(client)]);
  };
  const saved = async () => { setEditor(null); setFeedback("借贷记录已保存，余额和月度统计已同步更新。"); await refresh(); };
  const archive = useMutation({
    mutationFn: (loan: Loan) => updateLoanMetadata({ id: loan.id, name: loan.name, counterparty: loan.counterparty, note: loan.note ?? undefined, archived: !loan.archived }),
    onSuccess: async () => { setParams({}); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (payment: LoanPayment) => deleteLoanPayment({ id: payment.id, expectedUpdatedAt: payment.updated_at }),
    onSuccess: async () => { setDeletion(null); setFeedback("实际收付已删除，本金余额和关联月度收支已同步更新。"); await refresh(); },
  });
  const loan = detail.data?.loan;
  const scheduleRows = (detail.data?.installments ?? []).filter((row) => showOld || !row.superseded);
  const schedulePages = Math.max(1, Math.ceil(scheduleRows.length / 40));
  const currentSchedulePage = Math.min(schedulePage, schedulePages - 1);
  const ready = Boolean(settings.data && startup.data);
  return <div className="loans-page">
    <header className="page-header compact-header"><div><p className="eyebrow">贷款与借款跟踪</p><h1>借贷</h1><p>安排还款日期，核对每笔实还与回款；本金往来独立统计，利息及费用计入月度收支。</p></div><button className="button button-primary" disabled={!ready} onClick={() => setEditor({ kind: "loan" })} type="button">新建借贷</button></header>
    {feedback && <div className="success-banner" role="status">{feedback}</div>}
    {(list.isError || settings.isError || startup.isError) && <div className="inline-error" role="alert">{describeError(list.error ?? settings.error ?? startup.error)}<button className="text-button" onClick={() => void Promise.all([list.refetch(), settings.refetch(), startup.refetch()])} type="button">重试</button></div>}
    {startup.data && <LoanMonthCard month={startup.data.current_month} />}
    <div className="loan-toolbar">
      <div className="loan-direction-tabs" aria-label="借贷方向">{(["BORROWED", "LENT"] as const).map((value) => <button aria-pressed={activeDirection === value} className={activeDirection === value ? "button button-primary" : "button button-secondary"} key={value} onClick={() => { setDirection(value); setParams({}); setShowOld(false); }} type="button">{value === "BORROWED" ? "我需偿还" : "待他人归还"}</button>)}</div>
      <input aria-label="搜索借贷" type="search" placeholder="搜索名称或对方" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select ariaLabel="借贷状态" value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "未归档" }, { value: "ARCHIVED", label: "已归档" }, { value: "ALL", label: "全部" }]} />
    </div>
    {list.isPending && <section className="state-card">正在读取借贷…</section>}
    {list.isSuccess && filtered.length === 0 && !explicitId && <EmptyState title={activeDirection === "BORROWED" ? "记录一笔需要偿还的借款" : "记录一笔借给他人的款项"} description="可从借款发生日完整记录，也可从已有剩余本金开始跟踪。" action={<button className="button button-secondary" disabled={!ready} type="button" onClick={() => setEditor({ kind: "loan" })}>新建借贷</button>} />}
    {(filtered.length > 0 || explicitId) && <div className="loan-workspace">
      <aside className="loan-list" aria-label="借贷列表">{filtered.map((item) => <button className={id === item.id ? "loan-list-item selected" : "loan-list-item"} aria-pressed={id === item.id} key={item.id} type="button" onClick={() => { setParams({ id: item.id }); setShowOld(false); }}><strong>{item.name}</strong><span>{item.counterparty} · {item.plan_review_required ? "计划待核对" : item.status === "SETTLED" ? "已结清" : item.overdue_total !== "0.00" ? "有逾期" : "进行中"}</span><small>剩余本金 {formatMoney(item.remaining_principal, item.currency)}</small><small>{item.next_due_on ? "最近待还 " + item.next_due_on : "未安排后续还款"}</small></button>)}</aside>
      <div className="loan-detail">
        {detail.isPending && id && <section className="state-card">正在读取借贷详情…</section>}
        {detail.isError && <div className="inline-error" role="alert">{describeError(detail.error)}<button className="text-button" onClick={() => void detail.refetch()} type="button">重试详情</button></div>}
        {detail.data && loan && <>
          <header className="loan-detail-heading"><div><p className="section-label">{loan.direction === "BORROWED" ? "我需偿还" : "待他人归还"} · {loan.status === "SETTLED" ? "已结清" : "进行中"}{loan.archived ? " · 已归档" : ""}</p><h2>{loan.name}</h2><p>{loan.counterparty} · {loan.opening_only ? "期初剩余本金" : "借款发生日"} {loan.started_on}</p>{loan.note && <p>{loan.note}</p>}</div><div className="special-actions"><button className="button button-secondary" type="button" onClick={() => setEditor({ kind: "loan", loan })}>编辑资料</button><button className="button button-quiet" type="button" disabled={archive.isPending || (!loan.archived && loan.status !== "SETTLED")} onClick={() => archive.mutate(loan)}>{loan.archived ? "恢复" : "归档"}</button></div></header>
          {archive.isError && <div className="inline-error" role="alert">{describeError(archive.error)}</div>}
          {loan.plan_review_required && <div className="inline-error" role="alert">当前计划未还本金 {formatMoney(loan.scheduled_remaining_principal, loan.currency)} 与剩余本金 {formatMoney(loan.remaining_principal, loan.currency)} 不一致。请核对实际还款的期次分配，或调整后续计划；核对前暂停预算预测。</div>}
          <section className="loan-metrics" aria-label="借贷余额">
            <LoanMetric label={loan.opening_only ? "期初本金" : "借款本金"} value={loan.principal} currency={loan.currency} />
            <LoanMetric label="已归还本金" value={loan.paid_principal} currency={loan.currency} />
            <LoanMetric label="剩余本金" value={loan.remaining_principal} currency={loan.currency} />
            <LoanMetric label="计划剩余利息及费用" value={loan.remaining_charges} currency={loan.currency} />
            <LoanMetric label="逾期未还清" value={loan.plan_review_required ? null : loan.overdue_total} currency={loan.currency} />
          </section>
          <section className="report-card loan-section">
            <div className="special-section-heading"><h3>分期还款计划</h3><button className="button button-secondary" disabled={loan.archived} onClick={() => setEditor({ kind: "schedule" })} type="button">{detail.data.versions.length ? "调整后续计划" : "建立还款计划"}</button></div>
            <p className="chart-note">到期不会自动记为已还。调整保留历史期次和全部实际收付，未来期次以新版本接续。未约定日期时不判定逾期。</p>
            {detail.data.installments.length === 0 ? <p className="special-empty-copy">尚未约定分期。仍可记录不定期还款或回款。</p> : <>
              <label className="loan-checkbox"><input type="checkbox" checked={showOld} onChange={(event) => { setShowOld(event.target.checked); setSchedulePage(0); }} />显示旧版计划</label>
              <div className="table-scroll loan-table-scroll"><table className="data-table"><caption className="sr-only">分期还款明细</caption><thead><tr><th>期次 / 到期日</th><th>本金</th><th>利息</th><th>费用</th><th>尚未归还合计</th><th>状态</th></tr></thead><tbody>{scheduleRows.slice(currentSchedulePage * 40, currentSchedulePage * 40 + 40).map((row) => <tr key={row.id} className={row.superseded ? "loan-superseded" : ""}><th><span>第 {row.position} 期</span><small>{row.due_on}</small></th><td>{formatMoney(row.principal, loan.currency)}</td><td>{formatMoney(row.interest, loan.currency)}</td><td>{formatMoney(row.fees, loan.currency)}</td><td>{row.superseded ? "—" : formatMoney(row.remaining_total, loan.currency)}</td><td><span className={row.state === "OVERDUE" ? "danger-text" : ""}>{installmentStates[row.state]}</span></td></tr>)}</tbody></table></div>
              {schedulePages > 1 && <div className="loan-pagination"><button className="button button-quiet" type="button" disabled={currentSchedulePage === 0} onClick={() => setSchedulePage(currentSchedulePage - 1)}>上一页</button><span>{currentSchedulePage + 1} / {schedulePages}</span><button className="button button-quiet" type="button" disabled={currentSchedulePage === schedulePages - 1} onClick={() => setSchedulePage(currentSchedulePage + 1)}>下一页</button></div>}
            </>}
          </section>
          <section className="report-card loan-section">
            <div className="special-section-heading"><h3>实际{loan.direction === "BORROWED" ? "还款" : "回款"}</h3><button className="button button-primary" onClick={() => setEditor({ kind: "payment" })} type="button">{loan.direction === "BORROWED" ? "记录还款" : "记录回款"}</button></div>
            <p className="chart-note">按实际发生日期计入现金流。利息及费用与月度执行共用关联记录；编辑或删除会同步更新。</p>
            {detail.data.payments.length === 0 ? <p className="special-empty-copy">还没有实际收付记录。</p> : <div className="table-scroll loan-table-scroll"><table className="data-table"><caption className="sr-only">实际还款及回款记录</caption><thead><tr><th>日期 / 备注</th><th>本金</th><th>利息</th><th>费用</th><th>合计</th><th>操作</th></tr></thead><tbody>{detail.data.payments.map((payment) => <tr key={payment.id}><th>{payment.occurred_on}<small>{payment.note ?? "无备注"}</small></th><td>{formatMoney(payment.principal, loan.currency)}</td><td>{formatMoney(payment.interest, loan.currency)}</td><td>{formatMoney(payment.fees, loan.currency)}</td><td>{formatMoney(payment.total, loan.currency)}</td><td><div className="special-actions"><button className="text-button" onClick={() => setEditor({ kind: "payment", payment })} type="button">编辑</button><button className="text-button danger-text" onClick={() => { remove.reset(); setDeletion(payment); }} type="button">删除</button></div></td></tr>)}</tbody></table></div>}
          </section>
          {detail.data.versions.length > 0 && <details className="report-card loan-section"><summary>计划变更记录（{detail.data.versions.length}）</summary>{detail.data.versions.map((version) => <p key={version.id}>{version.created_at.slice(0, 10)} · 每 {version.interval_count} {loanFrequencyLabels[version.frequency]} · {version.method === "MANUAL" ? "手动计划" : version.method === "ANNUITY" ? "等额本息" : "等额本金"} · 每期利率 {version.period_rate_percent}%{version.note ? " · " + version.note : ""}</p>)}</details>}
        </>}
      </div>
    </div>}
    {editor?.kind === "loan" && <LoanEditor loan={editor.loan} direction={activeDirection} currency={settings.data?.base_currency ?? "CNY"} onClose={() => setEditor(null)} onSaved={async (created) => { if (created) { setDirection(created.direction); setParams({ id: created.id }); } await saved(); }} />}
    {editor?.kind === "schedule" && detail.data && <LoanScheduleEditor detail={detail.data} onClose={() => setEditor(null)} onSaved={saved} />}
    {editor?.kind === "payment" && detail.data && <LoanPaymentEditor detail={detail.data} payment={editor.payment} onClose={() => setEditor(null)} onSaved={saved} />}
    {deletion && <Dialog title="删除这笔实际收付？" onClose={() => { if (!remove.isPending) setDeletion(null); }} footer={<><button className="button button-quiet" disabled={remove.isPending} onClick={() => setDeletion(null)} type="button">取消</button><button className="button button-danger" disabled={remove.isPending} onClick={() => remove.mutate(deletion)} type="button">确认删除</button></>}><p>{deletion.occurred_on}，合计 {formatMoney(deletion.total, loan?.currency ?? "CNY")}。删除会撤销本次还款分配并同步移除关联的月度利息及费用，剩余本金会重新计算。</p>{remove.isError && <div className="inline-error" role="alert">{describeError(remove.error)}</div>}</Dialog>}
  </div>;
}
