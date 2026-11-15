import type { LoanAdvance, LoanDetail, LoanPayment } from "../../shared/api/loans";
import { formatMoney } from "../../shared/formatting/finance";

export type LoanActivity = { kind: "advance"; record: LoanAdvance } | { kind: "payment"; record: LoanPayment };

export function LoanActivityTable({ detail, onEdit, onDelete }: {
  detail: LoanDetail; onEdit: (activity: LoanActivity) => void; onDelete: (activity: LoanActivity) => void;
}) {
  const borrowed = detail.loan.direction === "BORROWED";
  const activities: LoanActivity[] = [
    ...detail.advances.map((record) => ({ kind: "advance" as const, record })),
    ...detail.payments.map((record) => ({ kind: "payment" as const, record })),
  ].sort((left, right) => right.record.occurred_on.localeCompare(left.record.occurred_on)
    || right.record.updated_at.localeCompare(left.record.updated_at) || left.record.id.localeCompare(right.record.id));
  if (activities.length === 0) return <p className="special-empty-copy">{borrowed ? "还没有借入或偿还记录。" : "还没有借出或归还记录。"}</p>;
  const currency = detail.loan.currency;
  return <div className="table-scroll loan-table-scroll"><table className="data-table">
    <caption className="sr-only">{borrowed ? "借入与偿还记录" : "借出与归还记录"}</caption>
    <thead><tr><th>日期 / 备注</th><th>类型</th><th>本金</th><th>利息</th><th>费用</th><th>合计</th><th>操作</th></tr></thead>
    <tbody>{activities.map((activity) => {
      const { record } = activity;
      const isAdvance = activity.kind === "advance";
      return <tr key={activity.kind + record.id}>
        <th scope="row">{record.occurred_on}<small>{record.note ?? "无备注"}</small></th>
        <td><span className={isAdvance ? "loan-activity-kind loan-activity-advance" : "loan-activity-kind"}>{isAdvance ? (borrowed ? "追加借入" : "追加借出") : (borrowed ? "还款" : "归还")}</span></td>
        <td>{formatMoney(record.principal, currency)}</td>
        <td>{activity.kind === "payment" ? formatMoney(activity.record.interest, currency) : "—"}</td>
        <td>{activity.kind === "payment" ? formatMoney(activity.record.fees, currency) : "—"}</td>
        <td>{formatMoney(activity.kind === "payment" ? activity.record.total : record.principal, currency)}</td>
        <td><div className="special-actions">
          <button className="text-button" onClick={() => onEdit(activity)} type="button">编辑</button>
          <button className="text-button danger-text" onClick={() => onDelete(activity)} type="button">删除</button>
        </div></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
