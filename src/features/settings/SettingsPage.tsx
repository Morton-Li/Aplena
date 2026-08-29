import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  createBackup,
  deleteExchangeRate,
  exportCsv,
  getSettings,
  inspectBackup,
  listExchangeRates,
  queryKeys,
  restoreBackup,
  saveSettings,
  upsertExchangeRate,
  type DataSummary,
  type RestoreInspection,
  type Settings,
} from "../../shared/api/finance";
import { describeError } from "../../shared/formatting/errors";
import { Select } from "../../shared/components/Select";

const settingsSchema = z.object({
  baseCurrency: z.string().length(3),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/),
  savingsRatePercent: z.number().min(0).max(100),
});
type SettingsValues = z.infer<typeof settingsSchema>;

const rateSchema = z.object({
  currency: z.string().trim().length(3, "币种代码必须为三位字母"),
  rate: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, "汇率最多保留八位小数"),
});
type RateValues = z.infer<typeof rateSchema>;

export function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">设置</p>
          <h1>共同尺度与计划上下文。</h1>
          <p>汇率只在创建月度快照时读取；更新汇率不会回算历史。</p>
        </div>
      </header>
      {(settingsQuery.isPending || ratesQuery.isPending) && <section className="state-card">正在读取设置…</section>}
      {(settingsQuery.isError || ratesQuery.isError) && (
        <section className="state-card"><span role="alert">{describeError(settingsQuery.error ?? ratesQuery.error)}</span></section>
      )}
      {settingsQuery.data && ratesQuery.data && (
        <>
          <div className="settings-grid">
            <GeneralSettings settings={settingsQuery.data} currencies={ratesQuery.data.map((rate) => rate.currency)} />
            <RateSettings baseCurrency={settingsQuery.data.base_currency} />
          </div>
          <DataProtectionPanel />
        </>
      )}
    </>
  );
}

function DataProtectionPanel() {
  const queryClient = useQueryClient();
  const [inspection, setInspection] = useState<RestoreInspection | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const backupMutation = useMutation({ mutationFn: () => createBackup() });
  const csvMutation = useMutation({ mutationFn: () => exportCsv() });
  const inspectMutation = useMutation({
    mutationFn: () => inspectBackup(),
    onSuccess: (result) => {
      setInspection(result.status === "READY" ? result : null);
      setUnderstood(false);
      setPhrase("");
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => {
      if (!inspection?.token) {
        throw new Error("尚未检查可恢复的备份");
      }
      return restoreBackup({
        token: inspection.token,
        confirmed: understood,
        confirmationPhrase: phrase,
      });
    },
    onSuccess: async () => {
      setInspection(null);
      setUnderstood(false);
      setPhrase("");
      await queryClient.cancelQueries();
      await queryClient.invalidateQueries();
    },
  });
  const operationError =
    backupMutation.error ?? csvMutation.error ?? inspectMutation.error ?? restoreMutation.error;

  return (
    <section className="settings-card data-protection-card" aria-labelledby="data-protection-title">
      <header className="data-protection-heading">
        <div>
          <p className="section-label">Data Protection</p>
          <h2 id="data-protection-title">备份、恢复与可读导出</h2>
        </div>
        <span className="context-chip">本地文件 · Rust 受控路径</span>
      </header>
      <p className="card-copy">
        完整备份用于灾难恢复，包含五张核心表、版本清单与 SHA-256 校验和；CSV 用于人工查阅，不能用于恢复。
      </p>
      <div className="notice notice-warning">
        当前本地候选版数据库与备份尚未加密。请把 <code>.aplena</code> 和 CSV 文件保存在受信任、已加密的磁盘位置。
      </div>
      <div className="protection-actions">
        <button
          className="button button-primary"
          disabled={backupMutation.isPending}
          type="button"
          onClick={() => backupMutation.mutate()}
        >
          {backupMutation.isPending ? "正在创建一致快照…" : "创建完整备份"}
        </button>
        <button
          className="button button-secondary"
          disabled={csvMutation.isPending}
          type="button"
          onClick={() => csvMutation.mutate()}
        >
          {csvMutation.isPending ? "正在导出…" : "导出五表 CSV"}
        </button>
        <button
          className="button button-quiet"
          disabled={inspectMutation.isPending || restoreMutation.isPending}
          type="button"
          onClick={() => inspectMutation.mutate()}
        >
          {inspectMutation.isPending ? "正在安全检查…" : "选择并检查备份"}
        </button>
      </div>

      {backupMutation.data?.status === "CREATED" && (
        <div className="inline-success" role="status">
          已创建 {backupMutation.data.file_name}。校验清单与数据库快照已写入同一备份。
        </div>
      )}
      {csvMutation.data?.status === "CREATED" && (
        <div className="inline-success" role="status">
          已在 {csvMutation.data.folder_name} 中导出 {csvMutation.data.file_count} 个 CSV 文件。
        </div>
      )}
      {operationError && <div className="inline-error" role="alert">{describeError(operationError)}</div>}

      {inspection?.status === "READY" && inspection.summary && (
        <section className="restore-preview" aria-labelledby="restore-preview-title">
          <header>
            <div>
              <p className="section-label">Restore Preview</p>
              <h3 id="restore-preview-title">恢复前只读检查已通过</h3>
            </div>
            <strong>{inspection.file_name}</strong>
          </header>
          <dl className="restore-metadata">
            <div><dt>备份创建时间</dt><dd>{inspection.backup_created_at}</dd></div>
            <div><dt>应用版本</dt><dd>{inspection.backup_app_version}</dd></div>
            <div><dt>数据库版本</dt><dd>schema {inspection.schema_version}</dd></div>
            <div><dt>临时迁移</dt><dd>{inspection.migrations_applied ? "已在临时副本验证升级" : "无需迁移"}</dd></div>
          </dl>
          {inspection.current_summary ? (
            <DataSummaryComparison current={inspection.current_summary} backup={inspection.summary} />
          ) : (
            <DataSummaryView summary={inspection.summary} />
          )}
          <div className="notice notice-danger">
            恢复会用此备份替换当前数据库。Aplena 会先自动创建当前数据库恢复点；任何检查或替换失败都会保留当前数据。
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            我已核对月份、设置和记录数量，并理解当前数据将被替换。
          </label>
          <label className="restore-phrase">
            输入“恢复”进行第二次确认
            <input
              autoComplete="off"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
            />
          </label>
          <button
            className="button button-danger"
            disabled={!understood || phrase.trim() !== "恢复" || restoreMutation.isPending}
            type="button"
            onClick={() => restoreMutation.mutate()}
          >
            {restoreMutation.isPending ? "正在创建恢复点并替换…" : "确认恢复此备份"}
          </button>
        </section>
      )}
      {restoreMutation.data?.restored && (
        <div className="inline-success" role="status">
          恢复完成；替换前恢复点为 {restoreMutation.data.recovery_point_name}。所有页面数据已重新读取。
        </div>
      )}
    </section>
  );
}

function DataSummaryView({ summary }: { summary: DataSummary }) {
  return (
    <div className="data-summary" aria-label="备份数据摘要">
      <div><span>设置</span><strong>{summary.settings_count}</strong></div>
      <div><span>汇率</span><strong>{summary.exchange_rate_count}</strong></div>
      <div><span>长期计划</span><strong>{summary.plan_item_count}</strong></div>
      <div><span>月度快照</span><strong>{summary.monthly_item_count}</strong></div>
      <div><span>实际条目</span><strong>{summary.actual_entry_count}</strong></div>
      <div><span>月份范围</span><strong>{summary.first_month && summary.last_month ? `${summary.first_month} — ${summary.last_month}` : "暂无月度快照"}</strong></div>
      <div><span>目标月份 / 本位币</span><strong>{summary.settings ? `${summary.settings.target_month} / ${summary.settings.base_currency}` : "尚未设置"}</strong></div>
    </div>
  );
}

function DataSummaryComparison({ current, backup }: { current: DataSummary; backup: DataSummary }) {
  const rows = [
    comparisonRow("设置", settingsSummary(current), settingsSummary(backup)),
    countComparisonRow("汇率", current.exchange_rate_count, backup.exchange_rate_count),
    countComparisonRow("长期计划", current.plan_item_count, backup.plan_item_count),
    countComparisonRow("月度快照", current.monthly_item_count, backup.monthly_item_count),
    countComparisonRow("实际条目", current.actual_entry_count, backup.actual_entry_count),
    comparisonRow("月份范围", monthRange(current), monthRange(backup)),
  ];
  return (
    <div className="restore-comparison">
      <h4>当前数据与备份差异</h4>
      <div className="table-scroll">
        <table className="restore-comparison-table" aria-label="恢复数据差异">
          <thead><tr><th>指标</th><th>当前</th><th>备份</th><th>变化</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.current}</td>
                <td>{row.backup}</td>
                <td>{row.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function countComparisonRow(label: string, current: number, backup: number) {
  const difference = backup - current;
  return {
    label,
    current: current.toString(),
    backup: backup.toString(),
    change: difference === 0 ? "不变" : `${difference > 0 ? "+" : ""}${difference}`,
  };
}

function comparisonRow(label: string, current: string, backup: string) {
  return { label, current, backup, change: current === backup ? "不变" : "将更改" };
}

function settingsSummary(summary: DataSummary): string {
  if (!summary.settings) {
    return "尚未设置";
  }
  const rate = (summary.settings.minimum_savings_rate_basis_points / 100).toFixed(2);
  return `${summary.settings.target_month} / ${summary.settings.base_currency} / ${rate}%`;
}

function monthRange(summary: DataSummary): string {
  return summary.first_month && summary.last_month
    ? `${summary.first_month} — ${summary.last_month}`
    : "暂无月度快照";
}

function GeneralSettings({ settings, currencies }: { settings: Settings; currencies: string[] }) {
  const queryClient = useQueryClient();
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      baseCurrency: settings.base_currency,
      targetMonth: settings.target_month,
      savingsRatePercent: settings.minimum_savings_rate_basis_points / 100,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: SettingsValues) =>
      saveSettings({
        baseCurrency: values.baseCurrency,
        targetMonth: values.targetMonth,
        minimumSavingsRateBasisPoints: Math.round(values.savingsRatePercent * 100),
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["monthly-items"] }),
        queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rates }),
        queryClient.invalidateQueries({ queryKey: ["financial-capacity"] }),
        queryClient.invalidateQueries({ queryKey: ["month-analytics"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.historyAnalytics }),
      ]);
    },
  });
  return (
    <form className="settings-card" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <div><p className="section-label">全局设置</p><h2>计划基准</h2></div>
      <label>本位币<Controller control={form.control} name="baseCurrency" render={({ field, fieldState }) => <Select ariaLabel="本位币" invalid={fieldState.invalid} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} options={currencies.map((currency) => ({ value: currency, label: currency }))} />} /></label>
      <div className="notice notice-warning">一旦存在任何月度快照，本位币会被锁定，避免历史趋势混入不同币种。已有数据时修改会由 Rust 拒绝。</div>
      <label>目标月份<input type="month" {...form.register("targetMonth")} /></label>
      <label>目标储蓄率<span className="input-with-suffix"><input type="number" min="0" max="100" step="0.01" {...form.register("savingsRatePercent", { valueAsNumber: true })} /><span>%</span></span></label>
      {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}</div>}
      {mutation.isSuccess && <div className="inline-success" role="status">设置已保存。</div>}
      <button className="button button-primary" disabled={mutation.isPending} type="submit">{mutation.isPending ? "保存中…" : "保存全局设置"}</button>
    </form>
  );
}

function RateSettings({ baseCurrency }: { baseCurrency: string }) {
  const queryClient = useQueryClient();
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const [editing, setEditing] = useState<string | null>(null);
  const form = useForm<RateValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: { currency: "", rate: "" },
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rates }),
      queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["financial-capacity"] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: (input: RateValues) => upsertExchangeRate(input),
    onSuccess: async () => {
      form.reset({ currency: "", rate: "" });
      setEditing(null);
      await refresh();
    },
  });
  const deleteMutation = useMutation({ mutationFn: (currency: string) => deleteExchangeRate(currency), onSuccess: refresh });
  const startEdit = (currency: string, rate: string) => {
    setEditing(currency);
    form.reset({ currency, rate });
  };

  return (
    <section className="settings-card">
      <div><p className="section-label">Exchange Rates</p><h2>当前汇率</h2></div>
      <p className="card-copy">定义为 1 单位外币等于多少 {baseCurrency}。新快照会读取当前值，历史快照不会联动。</p>
      <div className="rate-list">
        {ratesQuery.data?.map((rate) => (
          <div className="rate-row" key={rate.currency}>
            <div><strong>{rate.currency}</strong><small>{rate.is_base_currency ? "本位币 · 固定" : rate.plan_reference_count + " 个计划引用"}</small></div>
            <code>{rate.rate}</code>
            <div>
              <button className="text-button" disabled={rate.is_base_currency} type="button" onClick={() => startEdit(rate.currency, rate.rate)}>编辑</button>
              <button className="text-button danger-text" disabled={rate.is_base_currency || deleteMutation.isPending} type="button" onClick={() => deleteMutation.mutate(rate.currency)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      <form className="rate-form" onSubmit={form.handleSubmit((values) => saveMutation.mutate({ currency: values.currency.toUpperCase(), rate: values.rate }))}>
        <label>币种<input aria-label="汇率币种" disabled={editing !== null} placeholder="USD" maxLength={3} {...form.register("currency")} />{form.formState.errors.currency && <em>{form.formState.errors.currency.message}</em>}</label>
        <label>汇率<input aria-label="汇率值" inputMode="decimal" placeholder="7.25000000" {...form.register("rate")} />{form.formState.errors.rate && <em>{form.formState.errors.rate.message}</em>}</label>
        <button className="button button-secondary" disabled={saveMutation.isPending} type="submit">{editing ? "更新汇率" : "添加汇率"}</button>
        {editing && <button className="button button-quiet" type="button" onClick={() => { setEditing(null); form.reset(); }}>取消编辑</button>}
      </form>
      {(saveMutation.isError || deleteMutation.isError) && <div className="inline-error" role="alert">{describeError(saveMutation.error ?? deleteMutation.error)}</div>}
    </section>
  );
}
