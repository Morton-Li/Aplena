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
        <FlipViewIcon showData={showData} />
        {showData ? "返回图表" : "查看精确数据"}
      </button>
    </div>
  );
}

function FlipViewIcon({ showData }: { showData: boolean }) {
  return (
    <svg aria-hidden="true" className="chart-data-flip-icon" fill="none" viewBox="0 0 20 20">
      {showData ? (
        <>
          <path d="M3.5 16.5h13" />
          <path d="M5 14V9.5h2.5V14M8.75 14V5.5h2.5V14M12.5 14V8h2.5v6" />
        </>
      ) : (
        <>
          <rect height="11" rx="1.5" width="14" x="3" y="4.5" />
          <path d="M3 8.25h14M7.5 4.5v11M12.5 4.5v11" />
        </>
      )}
    </svg>
  );
}
