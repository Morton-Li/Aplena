import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getStartupStatus, queryKeys } from "../../shared/api/finance";
import { Dialog } from "../../shared/components/Dialog";
import { describeError } from "../../shared/formatting/errors";
import { isValidMonth } from "../../shared/formatting/finance";

export function HistoricalMonthEntry({ month }: { month?: string }) {
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const [choosing, setChoosing] = useState(false);
  const currentMonth = startupQuery.data?.current_month;

  if (month !== undefined) {
    return isValidMonth(month) && currentMonth && month < currentMonth
      ? <Link className="button button-primary" to={`/monthly?month=${month}`}>补录这个历史月份</Link>
      : null;
  }
  return <>
    <button className="button button-secondary" disabled={!currentMonth} onClick={() => setChoosing(true)} type="button">补录历史月份</button>
    {startupQuery.isError && <span className="inline-error" role="alert">{describeError(startupQuery.error)}<button className="text-button" onClick={() => void startupQuery.refetch()} type="button">重试</button></span>}
    {choosing && currentMonth && <HistoricalMonthDialog currentMonth={currentMonth} onClose={() => setChoosing(false)} />}
  </>;
}

function HistoricalMonthDialog({ currentMonth, onClose }: { currentMonth: string; onClose: () => void }) {
  const navigate = useNavigate();
  const formId = useId();
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const year = Number(currentMonth.slice(0, 4));
  const currentNumber = Number(currentMonth.slice(5, 7));
  const lastHistoricalMonth = currentNumber === 1 ? `${String(year - 1).padStart(4, "0")}-12` : `${year}-${String(currentNumber - 1).padStart(2, "0")}`;
  return <Dialog
    title="补录历史月份"
    eyebrow="历史补录"
    onClose={onClose}
    footer={<>
      <button className="button button-quiet" onClick={onClose} type="button">取消</button>
      <button className="button button-primary" form={formId} type="submit">补录这个历史月份</button>
    </>}
  >
    <p className="dialog-intro">选择月份后进入月度执行，可补录普通收入、支出、退款或冲减。已有月份也可在此进入调整。</p>
    <p className="notice notice-warning">当前汇率不一定代表当时汇率。生成历史计划快照时，可提供只对本次初始化有效的临时汇率，并需明确确认。</p>
    <form id={formId} noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!isValidMonth(month) || month >= currentMonth) {
        setError("请选择当前自然月之前的有效月份。");
        return;
      }
      navigate(`/monthly?month=${month}`);
    }}>
      <label>补录月份<input autoFocus data-dialog-initial-focus max={lastHistoricalMonth} min="0001-01" onChange={(event) => { setMonth(event.target.value); setError(null); }} type="month" value={month} /></label>
      <small>打开月份只读取预览；保存条目或确认初始化时才会写入数据。</small>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>
  </Dialog>;
}
