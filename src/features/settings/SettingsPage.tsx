import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  deleteExchangeRate,
  getSettings,
  listExchangeRates,
  queryKeys,
  saveSettings,
  upsertExchangeRate,
  type Settings,
} from "../../shared/api/finance";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { currencyName } from "../../shared/formatting/finance";

const settingsSchema = z.object({
  baseCurrency: z.string().length(3),
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
          <p className="eyebrow">本地配置</p>
          <h1>系统设置</h1>
          <p>管理本位币、储蓄目标与汇率。</p>
        </div>
      </header>
      {(settingsQuery.isPending || ratesQuery.isPending) && <section className="state-card">正在读取设置…</section>}
      {(settingsQuery.isError || ratesQuery.isError) && (
        <section className="state-card"><span role="alert">{describeError(settingsQuery.error ?? ratesQuery.error)}</span></section>
      )}
      {settingsQuery.data && ratesQuery.data && <div className="settings-grid">
        <GeneralSettings settings={settingsQuery.data} currencies={Array.from(new Set(["CNY", "USD", "EUR", "HKD", "JPY", "GBP", ...ratesQuery.data.map((rate) => rate.currency)]))} />
        <RateSettings baseCurrency={settingsQuery.data.base_currency} />
      </div>}
    </>
  );
}

function GeneralSettings({ settings, currencies }: { settings: Settings; currencies: string[] }) {
  const queryClient = useQueryClient();
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      baseCurrency: settings.base_currency,
      savingsRatePercent: settings.minimum_savings_rate_basis_points / 100,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: SettingsValues) =>
      saveSettings({
        baseCurrency: values.baseCurrency,
        targetMonth: settings.target_month,
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
      <div><p className="section-label">全局设置</p><h2>财务基准</h2></div>
      <label>本位币<Controller control={form.control} name="baseCurrency" render={({ field, fieldState }) => <Select ariaLabel="本位币" invalid={fieldState.invalid} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} options={currencies.map((currency) => ({ value: currency, label: currencyName(currency), description: currency }))} />} /></label>
      <div className="notice notice-warning">尚无月度快照时可以直接切换。已有快照后将保持锁定，避免历史报表混入不同计算基准；后续更换需要使用保留逐月币种基准的受控迁移，而不是静默重算历史。</div>
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
