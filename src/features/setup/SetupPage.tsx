import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { queryKeys, saveSettings } from "../../shared/api/finance";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";

const schema = z.object({
  baseCurrency: z.string().length(3, "请选择三位币种代码"),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/, "请选择有效月份"),
  savingsRatePercent: z.number().min(0, "不能低于 0%").max(100, "不能高于 100%"),
});

type SetupValues = z.infer<typeof schema>;

function naturalMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function SetupPage() {
  const queryClient = useQueryClient();
  const form = useForm<SetupValues>({
    resolver: zodResolver(schema),
    defaultValues: { baseCurrency: "CNY", targetMonth: naturalMonth(), savingsRatePercent: 20 },
  });
  const mutation = useMutation({
    mutationFn: (values: SetupValues) =>
      saveSettings({
        baseCurrency: values.baseCurrency,
        targetMonth: values.targetMonth,
        minimumSavingsRateBasisPoints: Math.round(values.savingsRatePercent * 100),
      }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      await queryClient.invalidateQueries({ queryKey: queryKeys.startup });
    },
  });

  return (
    <main className="setup-screen">
      <section className="setup-intro">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <p className="eyebrow">欢迎使用 Aplena</p>
        <h1>先确定衡量财务能力的共同尺度。</h1>
        <p>这里只设置计划基准，不需要导入交易流水。所有数据保存在这台设备的应用数据目录中。</p>
        <ul>
          <li>本位币汇率将自动设为 1</li>
          <li>目标储蓄率用于评估长期支出承载能力</li>
          <li>目标月份决定进入应用后首先查看的计划</li>
        </ul>
      </section>
      <form
        className="form-card setup-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div>
          <p className="section-label">首次设置</p>
          <h2>建立你的财务基准</h2>
        </div>
        <label>
          本位币
          <Controller
            control={form.control}
            name="baseCurrency"
            render={({ field, fieldState }) => (
              <Select
                ariaLabel="本位币"
                invalid={fieldState.invalid}
                onBlur={field.onBlur}
                onChange={field.onChange}
                options={["CNY", "USD", "EUR", "HKD", "JPY", "GBP"].map((currency) => ({
                  value: currency,
                  label: currency,
                }))}
                ref={field.ref}
                value={field.value}
              />
            )}
          />
          <small>创建后汇率固定为 1；产生月度数据后不能再更换。</small>
        </label>
        <label>
          目标储蓄率
          <span className="input-with-suffix">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              {...form.register("savingsRatePercent", { valueAsNumber: true })}
            />
            <span>%</span>
          </span>
          {form.formState.errors.savingsRatePercent && (
            <em>{form.formState.errors.savingsRatePercent.message}</em>
          )}
        </label>
        <label>
          当前目标月份
          <input type="month" {...form.register("targetMonth")} />
          {form.formState.errors.targetMonth && <em>{form.formState.errors.targetMonth.message}</em>}
        </label>
        {mutation.isError && (
          <div className="inline-error" role="alert">
            {describeError(mutation.error)}
          </div>
        )}
        <button className="button button-primary" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? "正在创建…" : "完成设置并进入 Aplena"}
        </button>
      </form>
    </main>
  );
}
