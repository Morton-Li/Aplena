import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ensureActualOnlyMonthlyItem, listPlanItems, queryKeys, type MonthlyItem } from "../../shared/api/finance";
import { Dialog } from "../../shared/components/Dialog";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { categoryLabel } from "../../shared/formatting/labels";

export function LinkedActualDialog({ month, onClose, onLinked }: {
  month: string;
  onClose: () => void;
  onLinked: (item: MonthlyItem) => Promise<void>;
}) {
  // Include ended rules, and re-read on opening so deleted rules do not remain
  // selectable just because the budget page populated a fresh query cache.
  const rulesQuery = useQuery({ queryKey: queryKeys.plans, queryFn: () => listPlanItems(), staleTime: 0 });
  const [planItemId, setPlanItemId] = useState("");
  const linking = useRef(false);
  const selectedRule = rulesQuery.data?.find((rule) => rule.id === planItemId);
  const endedBeforeMonth = Boolean(selectedRule?.end_date && selectedRule.end_date < `${month}-01`);
  const mutation = useMutation({
    mutationFn: () => ensureActualOnlyMonthlyItem({ planItemId, month }),
    onSuccess: onLinked,
    onSettled: () => { linking.current = false; },
  });
  const close = () => { if (!linking.current) onClose(); };
  const confirm = () => {
    if (!selectedRule || linking.current) return;
    linking.current = true;
    mutation.mutate();
  };

  return <Dialog
    title="关联规则录入实际"
    eyebrow={`${month} · 关联周期规则`}
    onClose={close}
    footer={<>
      <button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">取消</button>
      <button className="button button-primary" disabled={!selectedRule || mutation.isPending || rulesQuery.isFetching || rulesQuery.isError} onClick={confirm} type="button">{mutation.isPending ? "关联中…" : "关联并录入实际"}</button>
    </>}
  >
    <p className="dialog-intro">为 {month} 选择仍存在的周期规则，继续记录收入、支出、退款或冲减。没有正式计划快照时，将建立计划金额为 0 的“计划外实际”类目；已有同规则同月份类目会直接复用。</p>
    <p className="chart-note">此操作保留规则关联。独立的一次性事项可使用“添加临时类目”。选择或浏览规则不会创建数据，确认关联后仍需另行保存实际条目。</p>
    {rulesQuery.isPending && <p role="status">正在读取周期规则…</p>}
    {rulesQuery.isSuccess && rulesQuery.data.length === 0 && <p>还没有可关联的周期规则。可到<Link to="/goals">配置预算</Link>添加规则，或直接添加临时类目。</p>}
    <label>周期规则<Select
      ariaLabel="关联规则"
      disabled={mutation.isPending || rulesQuery.isPending || rulesQuery.isError || !rulesQuery.data?.length}
      onChange={(id) => { setPlanItemId(id); mutation.reset(); }}
      options={(rulesQuery.data ?? []).map((rule) => ({
        value: rule.id,
        label: rule.name,
        description: `${categoryLabel(rule.category)} · ${rule.currency}${rule.end_date ? ` · 结束日期 ${rule.end_date}` : ""}`,
      }))}
      value={planItemId}
    /></label>
    {endedBeforeMonth && <p className="notice notice-warning">该规则已结束（{selectedRule?.end_date}），仍可补录迟到退款或冲减。关联不会恢复规则，也不会强行生成该月正式计划。</p>}
    {rulesQuery.isError && <div className="inline-error" role="alert">{describeError(rulesQuery.error)}<button className="text-button" onClick={() => void rulesQuery.refetch()} type="button">重试读取规则</button></div>}
    {mutation.isError && <div className="inline-error" role="alert">{describeError(mutation.error)}<button className="text-button" onClick={() => void rulesQuery.refetch()} type="button">刷新规则列表</button></div>}
  </Dialog>;
}
