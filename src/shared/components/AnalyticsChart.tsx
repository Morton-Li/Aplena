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
    chart.setOption({
      // Dense financial charts should be immediately readable. Disabling entrance animation also
      // avoids WebKit resize notifications repeatedly resetting a series to its zero frame.
      animation: false,
      textStyle: {
        color: "#64748b",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 11,
      },
      ...option,
      aria: {
        enabled: true,
        description: label,
        decal: { show: false },
      },
    });
    let width = container.current.clientWidth;
    let height = container.current.clientHeight;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(([entry]) => {
            const nextWidth = Math.round(entry.contentRect.width);
            const nextHeight = Math.round(entry.contentRect.height);
            if (nextWidth === width && nextHeight === height) return;
            width = nextWidth;
            height = nextHeight;
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
