-- Long-term plans remain available as an automation and capacity-planning
-- enhancement, while manual monthly items can receive actual entries directly.

ALTER TABLE monthly_items
ADD COLUMN item_origin TEXT NOT NULL DEFAULT 'PLAN_LINKED'
  CHECK (item_origin IN ('PLAN_LINKED', 'MANUAL'));

CREATE TRIGGER monthly_item_manual_origin_insert
BEFORE INSERT ON monthly_items
WHEN NEW.item_origin = 'MANUAL' AND (
  NEW.source_plan_item_id IS NOT NULL OR NEW.item_source != 'ACTUAL_ONLY'
)
BEGIN
  SELECT RAISE(ABORT, 'manual monthly items must be unlinked actual-only items');
END;

CREATE TRIGGER monthly_item_manual_origin_update
BEFORE UPDATE OF source_plan_item_id, item_source, item_origin ON monthly_items
WHEN NEW.item_origin = 'MANUAL' AND (
  NEW.source_plan_item_id IS NOT NULL OR NEW.item_source != 'ACTUAL_ONLY'
)
BEGIN
  SELECT RAISE(ABORT, 'manual monthly items must be unlinked actual-only items');
END;
