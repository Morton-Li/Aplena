import { PieChart } from "echarts/charts";
import { use as registerEChartsModules, type EChartsCoreOption } from "echarts/core";

import { AnalyticsChart } from "./AnalyticsChart";

registerEChartsModules([PieChart]);

export function PieAnalyticsChart({
  option,
  label,
  height = 300,
}: {
  option: EChartsCoreOption;
  label: string;
  height?: number;
}) {
  return <AnalyticsChart option={option} label={label} height={height} />;
}
