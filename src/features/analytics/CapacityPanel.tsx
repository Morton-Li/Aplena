import type { FinancialCapacity } from "../../shared/api/finance";
import { formatMoney, formatPercent } from "../../shared/formatting/finance";

export function CapacityPanel({ capacity }: { capacity: FinancialCapacity }) {
  return (
    <section className="capacity-panel">
      <header>
        <div>
          <p className="section-label">Financial Capacity</p>
          <h2>还能承担多少新的长期支出？</h2>
        </div>
        <span className="context-chip">{capacity.target_month} · {capacity.base_currency}</span>
      </header>
      <div className="capacity-primary">
        <article>
          <span>保留现有自主预算</span>
          <strong>{formatMoney(capacity.preserved_capacity, capacity.base_currency)}</strong>
          <small>在最低储蓄率 {capacity.minimum_savings_rate_percent}% 之后</small>
        </article>
        <article>
          <span>压缩自主预算后的极限</span>
          <strong>{formatMoney(capacity.maximum_capacity, capacity.base_currency)}</strong>
          <small>不把浮动收入作为固定承诺支撑</small>
        </article>
      </div>
      <dl className="capacity-breakdown">
        <div><dt>稳定收入</dt><dd>{formatMoney(capacity.stable_income, capacity.base_currency)}</dd></div>
        <div><dt>浮动收入上行</dt><dd>{formatMoney(capacity.variable_income, capacity.base_currency)}</dd></div>
        <div><dt>必要支出</dt><dd>{formatMoney(capacity.essential_expenses, capacity.base_currency)}</dd></div>
        <div><dt>固定承诺</dt><dd>{formatMoney(capacity.fixed_commitments, capacity.base_currency)}</dd></div>
        <div><dt>最低储蓄</dt><dd>{formatMoney(capacity.minimum_savings_amount, capacity.base_currency)}</dd></div>
        <div><dt>自主性预算</dt><dd>{formatMoney(capacity.discretionary_budget, capacity.base_currency)}</dd></div>
        <div><dt>固定承诺率</dt><dd>{formatPercent(capacity.fixed_commitment_ratio_percent)}</dd></div>
        <div><dt>稳定收入责任覆盖</dt><dd>{capacity.stable_income_coverage_ratio ? capacity.stable_income_coverage_ratio + " 倍" : "—"}</dd></div>
      </dl>
      <details className="explanation">
        <summary>为什么 PAYMENT 项目在非支付月份仍计入？</summary>
        <p>月度计划描述现金在哪个月确认；财务承载能力描述长期平均负担。年付、季付等 PAYMENT 项目会按周期换算成月均金额，因此不会因为本月没有付款就被忽略。</p>
      </details>
    </section>
  );
}
