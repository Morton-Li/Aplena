import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use as registerEChartsModules, type EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

registerEChartsModules([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function AnalyticsChart({
  option,
  label,
  height = 300,
}: {
  option: EChartsCoreOption;
  label: string;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) {
      return;
    }
    const chart = init(container.current, undefined, { renderer: "canvas" });
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    chart.setOption({
      animation: !reduceMotion,
      textStyle: {
        color: "#526159",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 11,
      },
      ...option,
      aria: {
        enabled: true,
        description: label,
        decal: { show: true },
      },
    });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            chart.resize();
          });
    observer?.observe(container.current);
    return () => {
      observer?.disconnect();
      chart.dispose();
    };
  }, [label, option]);

  return <div className="analytics-chart" ref={container} role="img" aria-label={label} style={{ height }} />;
}
