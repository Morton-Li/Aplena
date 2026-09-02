import { useId, useState, type CSSProperties, type ReactNode } from "react";

export function ChartDataFlip({
  front,
  back,
  height = 278,
  dataLabel = "精确数据",
}: {
  front: ReactNode;
  back: ReactNode;
  height?: number;
  dataLabel?: string;
}) {
  const [showData, setShowData] = useState(false);
  const panelId = useId();
  const style = { "--chart-data-flip-height": `${height}px` } as CSSProperties;

  return (
    <div className={`chart-data-flip${showData ? " chart-data-flip-active" : ""}`} style={style}>
      <div className="chart-data-flip-stage" id={panelId}>
        <div className="chart-data-flip-inner">
          <div
            className="chart-data-flip-face chart-data-flip-front"
            aria-hidden={showData}
            inert={showData}
          >
            {front}
          </div>
          <div
            className="chart-data-flip-face chart-data-flip-back"
            aria-hidden={!showData}
            aria-label={dataLabel}
            inert={!showData}
          >
            <div className="chart-data-flip-scroll">{back}</div>
          </div>
        </div>
      </div>
      <button
        className="chart-data-flip-toggle"
        type="button"
        aria-controls={panelId}
        aria-pressed={showData}
        onClick={() => setShowData((value) => !value)}
      >
        {showData ? "返回图表" : "查看精确数据"}
      </button>
    </div>
  );
}
