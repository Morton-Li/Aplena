import { loanFrequencyLabels, loanInterestModeLabels, type LoanFrequency, type LoanInterestMode } from "../../shared/api/loans";
import { Select } from "../../shared/components/Select";
import type { LoanInterestDraft } from "./loanInterest";

export function LoanInterestFields({ value, onChange, currency, started, today }: {
  value: LoanInterestDraft; onChange: (value: LoanInterestDraft) => void; currency: string; started: string; today: string;
}) {
  return <section className="loan-interest-settings" aria-label="可选利息设置">
    <label className="loan-checkbox">
      <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
      启用利息计算（可选）
    </label>
    {value.enabled && <>
      <div className="loan-form-grid">
        <label>计息模式<Select ariaLabel="计息模式" value={value.mode} onChange={(mode) => onChange({ ...value, mode: mode as LoanInterestMode })} options={Object.entries(loanInterestModeLabels).map(([mode, label]) => ({ value: mode, label }))} /></label>
        <label>计息周期<Select ariaLabel="计息周期" value={value.frequency} onChange={(frequency) => onChange({ ...value, frequency: frequency as LoanFrequency })} options={Object.entries(loanFrequencyLabels).map(([frequency, label]) => ({ value: frequency, label }))} /></label>
        {value.mode === "FIXED"
          ? <label>每{loanFrequencyLabels[value.frequency]}固定利息（{currency}）<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={value.fixed} onChange={(event) => onChange({ ...value, fixed: event.target.value })} /></label>
          : <label>每{loanFrequencyLabels[value.frequency]}利率（%）<input required type="number" min="0" max="100" step="0.00000001" value={value.rate} onChange={(event) => onChange({ ...value, rate: event.target.value })} /><small>所选周期的利率，最多八位小数。</small></label>}
        <label>起息日期<input required type="date" min={started} max={today} value={value.started || started} onChange={(event) => onChange({ ...value, started: event.target.value })} /></label>
      </div>
      <p className="chart-note">起息日计息，截至日不计息；追加和归还当日先调整本金。不足周期按该周期实际天数折算，短月取月末，后续恢复原日期。
        {value.mode === "COMPOUND" ? "每满一周期将未付利息加入下一周期计息基数。" : value.mode === "FIXED" ? "有剩余本金时收取固定利息，本金结清后停止计息。" : "按当日剩余本金计息，利息不计入本金。"}
        最终结果四舍五入到分。</p>
      <p className="chart-note">修改设置会按新规则重新估算并扣除已收付利息。估算供收付时核对，实际收付与分期计划仍按已保存的金额记录。</p>
    </>}
  </section>;
}
