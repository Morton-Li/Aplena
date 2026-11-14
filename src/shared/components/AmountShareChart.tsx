import { useMemo } from "react";

import { decimalValue, formatMoney } from "../formatting/finance";
import { PieAnalyticsChart } from "./PieAnalyticsChart";

export function AmountShareChart({ items, currency, label }: {
  items: Array<{ id: string; name: string; amount: string | null }>;
  currency: string;
  label: string;
}) {
  const data = useMemo(() => items.flatMap((item) => {
    const amount = decimalValue(item.amount);
    return amount !== null && amount > 0 ? [{ id: item.id, name: item.name, value: amount }] : [];
  }), [items]);
  const option = useMemo(() => ({
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      valueFormatter: (value: unknown) => formatMoney(String(value), currency),
    },
    legend: { type: "scroll", bottom: 0, textStyle: { color: "#64748b", fontSize: 11 } },
    series: [{
      type: "pie",
      radius: "65%",
      center: ["50%", "43%"],
      label: { show: true, position: "inside", formatter: "{d}%", fontSize: 11 },
      itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
      data,
    }],
  }), [currency, data]);

  return <>
    {data.length > 0
      ? <PieAnalyticsChart option={option} label={label} height={300} />
      : <p className="share-chart-empty" role="status">暂无可绘制的正金额数据。</p>}
    <p className="chart-note">饼图按正金额合计计算占比；未录入、零金额及负金额不参与，完整数据见明细表。</p>
  </>;
}
