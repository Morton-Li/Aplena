import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { deleteActualEntry, getSettings, getStartupStatus, listExchangeRates, queryKeys } from "../../shared/api/finance";
import {
  archiveSpecialProject,
  deleteSpecialAllocation,
  getSpecialProject,
  listSpecialProjects,
  specialQueryKeys,
  type SpecialActualEntry,
  type SpecialAllocation,
  type SpecialProject,
} from "../../shared/api/specials";
import { Dialog } from "../../shared/components/Dialog";
import { EmptyState } from "../../shared/components/EmptyState";
import { Select } from "../../shared/components/Select";
import { describeError } from "../../shared/formatting/errors";
import { formatMoney } from "../../shared/formatting/finance";
import { categoryLabel } from "../../shared/formatting/labels";
import { SpecialActualEditor, SpecialAllocationEditor, SpecialProjectEditor } from "./SpecialEditors";
import { SpecialProjectDetail } from "./SpecialProjectDetail";

type EditorRequest =
  | { kind: "project"; project?: SpecialProject }
  | { kind: "allocation"; project: SpecialProject; existing?: SpecialAllocation }
  | { kind: "entry"; project: SpecialProject; existing?: SpecialActualEntry; detailGroups: string[] };

type DeleteRequest =
  | { kind: "allocation"; allocation: SpecialAllocation; project: SpecialProject }
  | { kind: "entry"; entry: SpecialActualEntry; project: SpecialProject };

export function SpecialsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [deletion, setDeletion] = useState<DeleteRequest | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const archiving = useRef(false);
  const deleting = useRef(false);
  const projectsQuery = useQuery({ queryKey: specialQueryKeys.projects, queryFn: () => listSpecialProjects() });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });
  const ratesQuery = useQuery({ queryKey: queryKeys.rates, queryFn: () => listExchangeRates() });
  const projects = projectsQuery.data ?? [];
  const selectedId = searchParams.get("id") ?? projects.find((project) => !project.archived)?.id ?? projects[0]?.id ?? "";
  const detailQuery = useQuery({
    queryKey: specialQueryKeys.detail(selectedId),
    queryFn: () => getSpecialProject(selectedId),
    enabled: Boolean(selectedId),
  });
  const currentMonth = startupQuery.data?.current_month ?? "";
  const baseCurrency = settingsQuery.data?.base_currency ?? "";
  const ready = Boolean(currentMonth && baseCurrency);
  const filtered = projects.filter((project) => {
    const needle = search.trim().toLocaleLowerCase();
    return (statusFilter === "ALL" || project.archived === (statusFilter === "ARCHIVED")) &&
      (!needle || `${project.name} ${project.note ?? ""}`.toLocaleLowerCase().includes(needle));
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: specialQueryKeys.projects }),
      queryClient.invalidateQueries({ queryKey: ["special-project"] }),
      queryClient.invalidateQueries({ queryKey: ["monthly-items"] }),
      queryClient.invalidateQueries({ queryKey: ["actual-entries"] }),
      queryClient.invalidateQueries({ queryKey: ["month-analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.historyAnalytics }),
      queryClient.invalidateQueries({ queryKey: queryKeys.existingMonths }),
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetProjection }),
    ]);
  };
  const selectProject = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("id", id);
    setSearchParams(next);
    setFeedback(null);
  };
  const saved = async (message: string) => {
    setEditor(null);
    setFeedback(message);
    await refresh();
  };
  const archiveMutation = useMutation({
    mutationFn: (project: SpecialProject) => archiveSpecialProject({ id: project.id, archived: !project.archived }),
    onSuccess: async (project) => {
      setFeedback(project.archived ? "专项已归档，已有预算与实际条目继续保留。" : "专项已恢复。可继续调整未冻结的未来月分配。");
      await refresh();
    },
    onSettled: () => { archiving.current = false; },
  });
  const archive = (project: SpecialProject) => {
    if (archiving.current) return;
    archiving.current = true;
    archiveMutation.mutate(project);
  };
  const deleteMutation = useMutation({
    mutationFn: (request: DeleteRequest) => request.kind === "allocation" ? deleteSpecialAllocation(request.allocation.id) : deleteActualEntry(request.entry.id),
    onSuccess: async (_, request) => {
      setDeletion(null);
      setFeedback(request.kind === "allocation" ? "未来月分配已删除。" : "实际条目已删除，月工作区与专项汇总已同步更新。");
      await refresh();
    },
    onSettled: () => { deleting.current = false; },
  });
  const openDelete = (request: DeleteRequest) => { deleteMutation.reset(); setDeletion(request); };
  const closeDelete = () => { if (!deleting.current) setDeletion(null); };
  const confirmDelete = () => {
    if (!deletion || deleting.current) return;
    deleting.current = true;
    deleteMutation.mutate(deletion);
  };
  const detail = detailQuery.data;
  const detailGroups = Array.from(new Set((detail?.entries ?? []).flatMap((entry) => entry.detail_group ? [entry.detail_group] : []))).sort();

  return <div className="specials-page">
    <header className="page-header compact-header specials-page-header">
      <div><p className="eyebrow">跨月项目管理</p><h1>专项</h1><p>为旅行、装修等专项安排总预算、月分配和实际支出；按月份或明细组查看执行结果。</p></div>
      <div className="header-actions"><button className="button button-primary" disabled={!ready} onClick={() => setEditor({ kind: "project" })} type="button">新建专项</button></div>
    </header>
    {feedback && <div className="success-banner" role="status">{feedback}</div>}
    {(settingsQuery.isError || startupQuery.isError || ratesQuery.isError) && <div className="inline-error" role="alert">{describeError(settingsQuery.error ?? startupQuery.error ?? ratesQuery.error)}<button className="text-button" onClick={() => void Promise.all([settingsQuery.refetch(), startupQuery.refetch(), ratesQuery.refetch()])} type="button">重试</button></div>}
    {archiveMutation.isError && <div className="inline-error" role="alert">{describeError(archiveMutation.error)}</div>}
    {projectsQuery.isPending && <section className="state-card">正在读取专项…</section>}
    {projectsQuery.isError && <section className="state-card state-card-error"><span role="alert">{describeError(projectsQuery.error)}</span><button className="button button-secondary" onClick={() => void projectsQuery.refetch()} type="button">重试专项列表</button></section>}
    {projectsQuery.isSuccess && projects.length === 0 && !selectedId && <EmptyState title="创建第一个专项" description="先设定总预算，按需要分配月份；实际支出与退款会同步显示在对应月工作区。" action={<button className="button button-secondary" disabled={!ready} onClick={() => setEditor({ kind: "project" })} type="button">新建专项</button>} />}

    {(projects.length > 0 || selectedId) && <div className="specials-workspace">
      <aside className="special-project-list" aria-label="专项列表">
        <div className="special-list-controls">
          <label className="search-field"><span className="sr-only">搜索专项</span><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或备注" type="search" value={search} /></label>
          <Select ariaLabel="专项状态" onChange={setStatusFilter} options={[{ value: "ALL", label: "全部专项" }, { value: "ACTIVE", label: "进行中" }, { value: "ARCHIVED", label: "已归档" }]} value={statusFilter} />
          <span className="result-count">{filtered.length} / {projects.length} 项</span>
        </div>
        {filtered.length === 0 && <p className="special-empty-copy">没有符合当前筛选的专项。</p>}
        {filtered.map((project) => <button aria-pressed={selectedId === project.id} className={`special-project-card${selectedId === project.id ? " special-project-card-selected" : ""}`} key={project.id} onClick={() => selectProject(project.id)} type="button">
          <span className="special-list-project-name">{project.name}</span><span className="special-list-project-status">{project.archived ? "已归档" : "进行中"}</span>
          <small>总预算 {formatMoney(project.total_budget, project.currency)}</small><small>净剩余 {formatMoney(project.remaining_budget, project.currency)}</small>
        </button>)}
      </aside>
      <div className="special-detail-content">
        {detailQuery.isPending && selectedId && <section className="state-card">正在读取专项详情…</section>}
        {detailQuery.isError && <section className="state-card state-card-error"><span role="alert">{describeError(detailQuery.error)}</span><button className="button button-secondary" onClick={() => void detailQuery.refetch()} type="button">重试专项详情</button></section>}
        {detail && ready && <SpecialProjectDetail
          archiving={archiveMutation.isPending}
          currentMonth={currentMonth}
          detail={detail}
          key={detail.project.id}
          onAddAllocation={() => setEditor({ kind: "allocation", project: detail.project })}
          onAddEntry={() => setEditor({ kind: "entry", project: detail.project, detailGroups })}
          onArchive={() => archive(detail.project)}
          onDeleteAllocation={(allocation) => openDelete({ kind: "allocation", allocation, project: detail.project })}
          onDeleteEntry={(entry) => openDelete({ kind: "entry", entry, project: detail.project })}
          onEditAllocation={(existing) => setEditor({ kind: "allocation", project: detail.project, existing })}
          onEditEntry={(existing) => setEditor({ kind: "entry", project: detail.project, existing, detailGroups })}
          onEditProject={() => setEditor({ kind: "project", project: detail.project })}
        />}
        {detail && !ready && !settingsQuery.isError && !startupQuery.isError && <section className="state-card">正在读取当前执行月与本位币…</section>}
      </div>
    </div>}

    {editor?.kind === "project" && <SpecialProjectEditor baseCurrency={baseCurrency} key={editor.project?.id ?? "new-project"} onClose={() => setEditor(null)} onSaved={async (project) => { selectProject(project.id); await saved("专项已保存。"); }} project={editor.project} />}
    {editor?.kind === "allocation" && <SpecialAllocationEditor currentMonth={currentMonth} existing={editor.existing} key={editor.existing?.id ?? "new-allocation"} onClose={() => setEditor(null)} onSaved={() => saved("月分配已保存，预算测算已更新。")} project={editor.project} />}
    {editor?.kind === "entry" && <SpecialActualEditor currentMonth={currentMonth} detailGroups={editor.detailGroups} existing={editor.existing} key={editor.existing?.id ?? "new-entry"} onClose={() => setEditor(null)} onSaved={() => saved("实际条目已保存，月工作区与专项汇总已同步更新。")} project={editor.project} rates={ratesQuery.data ?? []} />}
    {deletion && <Dialog className="special-delete-dialog" eyebrow={deletion.project.name} title={deletion.kind === "allocation" ? "确认删除未来月分配？" : "确认删除这条实际记录？"} onClose={closeDelete} footer={<>
      <button className="button button-quiet" disabled={deleteMutation.isPending} onClick={closeDelete} type="button">取消</button>
      <button className="button button-danger" disabled={deleteMutation.isPending} onClick={confirmDelete} type="button">{deleteMutation.isPending ? "删除中…" : "确认删除"}</button>
    </>}>
      {deletion.kind === "allocation" ? <><p>删除 {deletion.allocation.month} · {categoryLabel(deletion.allocation.category)} 的 {formatMoney(deletion.allocation.amount, deletion.project.currency)} 分配后，金额回到未分配预算。实际条目继续保留。</p></> : <><p>这条记录也会从对应月工作区删除，专项与月度汇总会同步更新。删除后无法在应用内撤销。</p><p>{deletion.entry.occurred_on} · {deletion.entry.effect === "INCREASE" ? "支出" : "退款"} · {formatMoney(deletion.entry.source_amount, deletion.entry.source_currency)}</p></>}
      {deleteMutation.isError && <div className="inline-error" role="alert">{describeError(deleteMutation.error)}</div>}
    </Dialog>}
  </div>;
}
