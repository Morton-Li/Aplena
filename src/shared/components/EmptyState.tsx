import type { ReactNode } from "react";

export function EmptyState({
  eyebrow = "当前没有内容",
  title,
  description,
  action,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "empty-state empty-state-compact" : "empty-state"}>
      <div className="empty-state-mark" aria-hidden="true"><span /></div>
      <div className="empty-state-copy">
        <p className="section-label">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className="empty-state-action">{action}</div>}
    </section>
  );
}
