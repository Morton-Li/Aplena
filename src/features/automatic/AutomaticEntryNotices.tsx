import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  automaticQueryKeys,
  listAutomaticOccurrences,
  resolveAutomaticEntryConflict,
  type AutomaticConflictAction,
  type AutomaticOccurrence,
} from "../../shared/api/automatic";
import { listActualEntries, queryKeys } from "../../shared/api/finance";
import { Dialog } from "../../shared/components/Dialog";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney } from "../../shared/formatting/finance";
import { useAutomaticEntries } from "./AutomaticEntryContext";
import { refreshFinancialQueries } from "./refreshFinancialQueries";

export function AutomaticEntryNotices({ month, currentMonth }: { month: string; currentMonth: string }) {
  const automatic = useAutomaticEntries();
  const occurrencesQuery = useQuery({
    queryKey: automaticQueryKeys.occurrences(month),
    queryFn: () => listAutomaticOccurrences(month),
    enabled: Boolean(month),
  });
  const [resolving, setResolving] = useState<AutomaticOccurrence | null>(null);
  const occurrences = occurrencesQuery.data ?? [];
  const conflicts = occurrences.filter((entry) => entry.state === "CONFLICT");
  const failures = occurrences.filter((entry) => entry.state === "FAILED");
  const isCurrent = month === currentMonth;
  const hasCheckError = isCurrent && automatic.error != null;

  if (!month || (!hasCheckError && !occurrencesQuery.isError && conflicts.length === 0 && failures.length === 0)) return null;
  return <>
    <section aria-label="自动入账待处理" className="automatic-entry-notices">
      {hasCheckError && <p className="inline-error" role="alert">自动入账检查未完成：{describeError(automatic.error)} 应用会自动重试。</p>}
      {occurrencesQuery.isError && <p className="inline-error" role="alert">自动入账记录读取失败：{describeError(occurrencesQuery.error)} <button className="text-button" disabled={occurrencesQuery.isFetching} onClick={() => void occurrencesQuery.refetch()} type="button">{occurrencesQuery.isFetching ? "正在读取…" : "重新读取"}</button></p>}
      {conflicts.length > 0 && <div className="automatic-entry-conflicts">
        <p className="warning-text">{conflicts.length} 项规则已有实际记录，请选择如何处理；系统没有另记重复条目。</p>
        {conflicts.map((occurrence) => <div className="automatic-entry-occurrence" key={occurrence.id}>
          <span><strong>{occurrence.rule_name ?? "周期规则"}</strong> · {occurrence.occurred_on}</span>
          <button className="button button-secondary" onClick={() => setResolving(occurrence)} type="button">处理重复记录</button>
        </div>)}
      </div>}
      {failures.length > 0 && <p className="warning-text" role="alert">{failures.length} 项自动入账未完成。{isCurrent
        ? "请补齐可用汇率或处理对应设置，修复后应用会自动重试。"
        : "历史月份不会自动补记，请在对应类目中手动补录实际。"}</p>}
    </section>
    {resolving && <AutomaticConflictDialog occurrence={resolving} onClose={() => setResolving(null)} />}
  </>;
}

function AutomaticConflictDialog({ occurrence, onClose }: { occurrence: AutomaticOccurrence; onClose: () => void }) {
  const queryClient = useQueryClient();
  const automatic = useAutomaticEntries();
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const submitting = useRef(false);
  const entriesQuery = useQuery({
    queryKey: queryKeys.actualEntries(occurrence.monthly_item_id ?? ""),
    queryFn: () => listActualEntries(occurrence.monthly_item_id!),
    enabled: Boolean(occurrence.monthly_item_id),
  });
  const entries = (entriesQuery.data ?? []).filter((entry) => entry.origin === "USER");
  const snapshotMismatch = occurrence.error_code === "AUTOMATIC_RULE_SNAPSHOT_MISMATCH";
  const mutation = useMutation({
    mutationFn: (action: AutomaticConflictAction) => resolveAutomaticEntryConflict({
      id: occurrence.id,
      action,
      actualEntryId: action === "LINK_EXISTING" ? selectedEntryId : undefined,
    }),
    onSuccess: async () => {
      await refreshFinancialQueries(queryClient);
      await automatic.check();
      onClose();
    },
    onSettled: () => { submitting.current = false; },
  });
  const resolve = (action: AutomaticConflictAction) => {
    if (submitting.current || (action === "LINK_EXISTING" && !selectedEntryId)) return;
    submitting.current = true;
    mutation.mutate(action);
  };
  const close = () => { if (!submitting.current) onClose(); };

  return <Dialog
    className="automatic-conflict-dialog"
    eyebrow={`${occurrence.month} · ${occurrence.occurred_on}`}
    title={`处理“${occurrence.rule_name ?? "周期规则"}”的重复记录`}
    onClose={close}
    footer={<>
      <button className="button button-quiet" disabled={mutation.isPending} onClick={close} type="button">稍后处理</button>
      <button className="button button-secondary" disabled={mutation.isPending} onClick={() => resolve("SKIP")} type="button">跳过本次自动入账</button>
      <button className="button button-secondary" disabled={mutation.isPending || !selectedEntryId} onClick={() => resolve("LINK_EXISTING")} type="button">关联所选记录</button>
      <button className="button button-primary" disabled={mutation.isPending || snapshotMismatch} onClick={() => resolve("CREATE_SEPARATE")} type="button">仍新增一笔实际</button>
    </>}
  >
    <p className="dialog-intro">如果已经手动记过这笔收支，关联已有记录即可保留一笔实际；只有确定另有一笔收支时才选择新增。</p>
    {snapshotMismatch && <p className="warning-text">本月冻结分类与自动规则不同，不能另建自动实际。可以跳过本次，再在合适类目中手动记录。</p>}
    {entriesQuery.isPending && occurrence.monthly_item_id && <p>正在读取已有实际记录…</p>}
    {entriesQuery.isError && <p className="inline-error" role="alert">{describeError(entriesQuery.error)}</p>}
    {entries.length > 0 ? <label>已有实际记录<Select
      ariaLabel="关联已有实际记录"
      disabled={mutation.isPending}
      onChange={setSelectedEntryId}
      options={[
        { value: "", label: "选择已记录的收支" },
        ...entries.map((entry) => ({
          value: entry.id,
          label: `${entry.occurred_on} · ${entry.effect === "INCREASE" ? "+" : "−"}${formatMoney(entry.source_amount, entry.source_currency)}`,
          description: entry.note ?? "无备注",
        })),
      ]}
      value={selectedEntryId}
    /></label> : entriesQuery.isSuccess && <p>没有可关联的用户记录。可以跳过本次，或明确新增一笔实际。</p>}
    {mutation.isError && <p className="inline-error" role="alert">{describeError(mutation.error)}</p>}
  </Dialog>;
}
