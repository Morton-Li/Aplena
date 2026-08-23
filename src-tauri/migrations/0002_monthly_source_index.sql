-- Forward-only performance hardening for plan history and safe restore validation.
-- Existing snapshots remain immutable and no business entity is added.
CREATE INDEX idx_monthly_items_source_plan
ON monthly_items(source_plan_item_id);
