import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import {
  isReferenceRateStale,
  SUPPORTED_CURRENCIES,
} from "../../shared/api/referenceRates";
import { syncOfficialReferenceRates } from "../../shared/api/referenceRateSync";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { currencyName, formatEntryRateSource } from "../../shared/formatting/finance";
import { SoftwareUpdateCard } from "../software-updates/SoftwareUpdateCard";

const settingsSchema = z.object({
  baseCurrency: z.string().length(3),
});
type SettingsValues = z.infer<typeof settingsSchema>;

const rateSchema = z.object({
  currency: z.string().trim().length(3, "币种代码必须为三位字母"),
  rate: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, "汇率最多保留八位小数"),
});
type RateValues = z.infer<typeof rateSchema>;

const settingsWriteScope = { id: "finance-settings" };

export function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">本地配置</p>
          <h1>系统设置</h1>
          <p>管理本位币、当前汇率与启动更新偏好。</p>
        </div>
      </header>
      {(settingsQuery.isPending || ratesQuery.isPending) && <section className="state-card">正在读取设置…</section>}
      {(settingsQuery.isError || ratesQuery.isError) && (
        <section className="state-card"><span role="alert">{describeError(settingsQuery.error ?? ratesQuery.error)}</span></section>
      )}
      {settingsQuery.data && ratesQuery.data && <div className="settings-grid">
        <GeneralSettings settings={settingsQuery.data} currencies={Array.from(new Set([...SUPPORTED_CURRENCIES, ...ratesQuery.data.map((rate) => rate.currency)]))} />
        <RateSettings settings={settingsQuery.data} />
      </div>}
      <SoftwareUpdateCard />
    </>
  );
}

function GeneralSettings({ settings, currencies }: { settings: Settings; currencies: string[] }) {
  const queryClient = useQueryClient();
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      baseCurrency: settings.base_currency,
    },
  });
  const selectedBaseCurrency = useWatch({ control: form.control, name: "baseCurrency" });
  const mutation = useMutation({
    scope: settingsWriteScope,
    mutationFn: (values: SettingsValues) =>
      saveSettings({
        baseCurrency: values.baseCurrency,
        autoUpdateExchangeRates: (queryClient.getQueryData<Settings>(queryKeys.settings) ?? settings).auto_update_exchange_rates,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated);
      form.reset({ baseCurrency: updated.base_currency });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["monthly-items"] }),
        queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.budgetProjection }),
        queryClient.invalidateQueries({ queryKey: ["month-analytics"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.historyAnalytics }),
      ]);
    },
  });
  return (
    <form className="base-currency-setting" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <div className="base-currency-copy">
        <h2>本位币</h2>
        <p>报表与金额换算的统一计价基准</p>
      </div>
      <div className="base-currency-controls">
        <label className="base-currency-field">
          <span>币种</span>
          <Controller control={form.control} name="baseCurrency" render={({ field, fieldState }) => <Select ariaLabel="本位币" invalid={fieldState.invalid} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} options={currencies.map((currency) => ({ value: currency, label: currencyName(currency), description: currency }))} />} />
        </label>
        <button className="button button-secondary" disabled={mutation.isPending || !form.formState.isDirty} type="submit">{mutation.isPending ? "保存中…" : "保存"}</button>
      </div>
      {selectedBaseCurrency !== settings.base_currency && <p className="base-currency-feedback">切换前，请先在“当前汇率”中保存目标币相对于 {settings.base_currency} 的有效汇率（1 单位目标币 = N {settings.base_currency}）。现有汇率将按比例折算为备用汇率，记录原本位币和折算日。需要最新报价时可再更新官方汇率。</p>}
      {mutation.isError && <div className="base-currency-feedback inline-error" role="alert">{describeError(mutation.error)}</div>}
      {mutation.isSuccess && <div className="base-currency-feedback inline-success" role="status">本位币已保存。</div>}
    </form>
  );
}

function RateSettings({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const [editing, setEditing] = useState<string | null>(null);
  const [draftBase, setDraftBase] = useState<string | null>(null);
  const rateBase = draftBase ?? settings.base_currency;
  const draftBaseChanged = rateBase !== settings.base_currency;
  const form = useForm<RateValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: { currency: "", rate: "" },
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rates }),
      queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetProjection }),
    ]);
  };
  const resetRate = () => {
    form.reset();
    setEditing(null);
    setDraftBase(null);
  };
  const saveMutation = useMutation({
    scope: settingsWriteScope,
    mutationFn: ({ input, baseCurrency }: { input: RateValues; baseCurrency: string }) => {
      const currentBase = (queryClient.getQueryData<Settings>(queryKeys.settings) ?? settings).base_currency;
      if (baseCurrency !== currentBase) {
        throw new Error("本位币已更改，请按新的本位币重新输入汇率。");
      }
      return upsertExchangeRate(input);
    },
    onSuccess: async () => {
      resetRate();
      await refresh();
    },
  });
  const deleteMutation = useMutation({ mutationFn: (currency: string) => deleteExchangeRate(currency), onSuccess: refresh });
  const syncMutation = useMutation({
    mutationFn: () => syncOfficialReferenceRates(settings.base_currency),
    onSuccess: async ({ rates }) => {
      queryClient.setQueryData(queryKeys.rates, rates);
      await refresh();
    },
  });
  const autoUpdateMutation = useMutation({
    scope: settingsWriteScope,
    mutationFn: (enabled: boolean) => saveSettings({
      baseCurrency: (queryClient.getQueryData<Settings>(queryKeys.settings) ?? settings).base_currency,
      autoUpdateExchangeRates: enabled,
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated);
    },
  });
  const startEdit = (currency: string, rate: string, baseCurrency: string) => {
    setEditing(currency);
    setDraftBase(baseCurrency);
    form.reset({ currency, rate }, { keepDefaultValues: true });
  };

  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <div><p className="section-label">Exchange Rates</p><h2>当前汇率</h2></div>
        <div className="settings-rate-actions">
          <label className="settings-switch">
            <span className="settings-switch-copy"><strong>启动时自动更新</strong><small>每次打开 Aplena 时尝试获取最新官方汇率</small></span>
            <input
              aria-label="启动时自动更新汇率"
              checked={settings.auto_update_exchange_rates}
              disabled={autoUpdateMutation.isPending}
              onChange={(event) => autoUpdateMutation.mutate(event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span aria-hidden="true" className="settings-switch-track"><span /></span>
          </label>
          <button className="button button-secondary" disabled={syncMutation.isPending} type="button" onClick={() => syncMutation.mutate()}>{syncMutation.isPending ? "正在更新…" : "更新官方汇率"}</button>
        </div>
      </div>
      <p className="card-copy">欧洲央行每日参考汇率通常在工作日更新；周末及节假日沿用最近有效参考日期。录入外币费用时会固化当次汇率，后续更新不会回算已经发生的费用。</p>
      <div className="rate-list">
        {ratesQuery.data?.map((rate) => (
          <div className="rate-row" key={rate.currency}>
            <div>
              <strong>{rate.currency}</strong>
              <small>{rate.is_base_currency ? "本位币 · 固定" : <>
                {formatEntryRateSource(rate.source, rate.observed_on ?? "日期未知", rate.rebased_from_currency, rate.rebased_on)}
                {rate.source === "ECB_REFERENCE" && rate.observed_on && isReferenceRateStale(rate.observed_on) && " · 数据日期较早"}
                {" · "}{rate.plan_reference_count} 个计划引用
              </>}</small>
            </div>
            <code>{rate.rate}</code>
            <div>
              <button className="text-button" disabled={rate.is_base_currency || saveMutation.isPending} type="button" onClick={() => startEdit(rate.currency, rate.rate, rate.base_currency)}>编辑</button>
              <button className="text-button danger-text" disabled={rate.is_base_currency || deleteMutation.isPending} type="button" onClick={() => deleteMutation.mutate(rate.currency)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {syncMutation.isSuccess && <div className="inline-success" role="status">已更新 {syncMutation.data.updatedCount} 个币种的欧洲央行每日参考汇率{syncMutation.data.observedOn ? `（参考日期 ${syncMutation.data.observedOn}）` : ""}，既有费用的汇率快照未作修改。</div>}
      <form className="rate-form" onSubmit={form.handleSubmit((values) => saveMutation.mutate({ input: { currency: values.currency.toUpperCase(), rate: values.rate }, baseCurrency: rateBase }))}>
        <label>币种<input aria-label="汇率币种" disabled={editing !== null} placeholder="USD" maxLength={3} {...form.register("currency")} />{form.formState.errors.currency && <em>{form.formState.errors.currency.message}</em>}</label>
        <label>汇率（{rateBase}）<input aria-label="汇率值" inputMode="decimal" placeholder="7.25000000" {...form.register("rate", { onChange: () => setDraftBase((base) => base ?? settings.base_currency) })} />{form.formState.errors.rate && <em>{form.formState.errors.rate.message}</em>}</label>
        <button className="button button-secondary" disabled={saveMutation.isPending || draftBaseChanged} type="submit">{editing ? "更新汇率" : "添加汇率"}</button>
        {(editing || draftBaseChanged) && <button className="button button-quiet" disabled={saveMutation.isPending} type="button" onClick={() => { resetRate(); saveMutation.reset(); }}>取消编辑</button>}
      </form>
      {draftBaseChanged && <p className="settings-rate-fallback">当前草稿以 {rateBase} 报价。请取消编辑后按 {settings.base_currency} 重新输入汇率。</p>}
      <small className="settings-rate-fallback">汇率表示 1 单位所选币种可兑换多少 {settings.base_currency}。手动输入可用于补充切换本位币的兑换依据，或作为官方接口暂不可用时的备用方式。</small>
      {(saveMutation.isError || deleteMutation.isError || syncMutation.isError || autoUpdateMutation.isError) && <div className="inline-error" role="alert">{describeError(saveMutation.error ?? deleteMutation.error ?? syncMutation.error ?? autoUpdateMutation.error)}</div>}
    </section>
  );
}
