import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getLoanMonthSummary, loanQueryKeys } from "../../shared/api/loans";
import { formatMoney } from "../../shared/formatting/finance";
import { describeError } from "../../shared/formatting/errors";

export function LoanMonthCard({ month }: { month: string }) {
  const query = useQuery({ queryKey: loanQueryKeys.month(month), queryFn: () => getLoanMonthSummary(month), enabled: Boolean(month) });
  if (query.isPending) return <section className="state-card">正在读取借贷现金流…</section>;
  if (query.isError) return <div className="inline-error" role="alert">{describeError(query.error)}<button className="text-button" onClick={() => void query.refetch()} type="button">重试借贷汇总</button></div>;
  if (!query.data.has_loans) return null;
  const summary = query.data;
  return <section className="report-card loan-month-card" aria-label={month + " 借贷与现金流"}>
    <div className="special-section-heading"><div><p className="section-label">借贷与现金流 · {month}</p><h2>本金往来独立统计</h2></div><Link className="text-button" to="/loans">查看借贷</Link></div>
    {summary.plan_review_required_count > 0 && <p className="inline-error" role="alert">有借贷计划本金与剩余本金不一致。请在借贷详情核对还款分配或调整后续计划；待还与待收计划汇总暂不显示，实际现金流保留。</p>}
    <div className="loan-metrics">
      <LoanMetric label="本月计划尚待偿还" value={summary.plan_review_required_count > 0 ? null : summary.planned_borrow_total} currency={summary.currency} />
      <LoanMetric label="本月约定尚待收回" value={summary.plan_review_required_count > 0 ? null : summary.planned_lent_total} currency={summary.currency} />
      <LoanMetric label="实际本金流入" value={summary.actual_principal_in} currency={summary.currency} />
      <LoanMetric label="实际本金流出" value={summary.actual_principal_out} currency={summary.currency} />
      <LoanMetric label="含借贷的现金净结余" value={summary.actual_cash_net} currency={summary.currency} />
    </div>
    <p className="chart-note">现金净结余按已录入收支加本金净流入计算，包含利息及费用一次。期初余额不产生现金流；这不是账户余额。待还与待收按当前计划和已录入还款计算。</p>
  </section>;
}

export function LoanMetric({ label, value, currency }: { label: string; value: string | null; currency: string }) {
  return <div className="loan-metric"><span>{label}</span><strong>{formatMoney(value, currency)}</strong></div>;
}
