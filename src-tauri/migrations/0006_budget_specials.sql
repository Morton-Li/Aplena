-- Rebuild both financial child tables together so all schema-5 facts survive
-- while SQLite foreign keys remain enabled throughout this transactional migration.
CREATE TABLE special_projects (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  total_budget_scaled INTEGER NOT NULL CHECK (total_budget_scaled >= 0),
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE special_allocations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  project_id TEXT NOT NULL REFERENCES special_projects(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  month TEXT NOT NULL CHECK (
    date(month) = month AND substr(month, 9, 2) = '01'
  ),
  category TEXT NOT NULL CHECK (category IN (
    'ESSENTIAL_EXPENSE', 'FIXED_COMMITMENT_EXPENSE', 'DISCRETIONARY_BUDGET'
  )),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, month, category)
) STRICT;

CREATE TABLE monthly_items_v6 (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  source_plan_item_id TEXT REFERENCES plan_items(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  month TEXT NOT NULL CHECK (
    date(month) = month AND substr(month, 9, 2) = '01'
  ),
  snapshot_name TEXT NOT NULL CHECK (length(trim(snapshot_name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME', 'VARIABLE_INCOME', 'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE', 'DISCRETIONARY_BUDGET'
  )),
  flow_type TEXT NOT NULL CHECK (flow_type IN ('INCOME', 'EXPENSE')),
  recognition_mode TEXT NOT NULL CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  item_source TEXT NOT NULL CHECK (item_source IN ('PLANNED', 'ACTUAL_ONLY')),
  scheduled_date TEXT CHECK (
    scheduled_date IS NULL OR (
      date(scheduled_date) = scheduled_date
      AND substr(scheduled_date, 1, 7) = substr(month, 1, 7)
    )
  ),
  planned_amount_scaled INTEGER NOT NULL CHECK (planned_amount_scaled >= 0),
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item_origin TEXT NOT NULL DEFAULT 'PLAN_LINKED'
    CHECK (item_origin IN ('PLAN_LINKED', 'MANUAL', 'SPECIAL_PROJECT')),
  source_special_project_id TEXT REFERENCES special_projects(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_special_allocation_id TEXT REFERENCES special_allocations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (source_plan_item_id, month),
  UNIQUE (source_special_project_id, month, category),
  UNIQUE (source_special_allocation_id),
  CHECK (
    (item_origin = 'SPECIAL_PROJECT' AND source_special_project_id IS NOT NULL
      AND source_plan_item_id IS NULL AND flow_type = 'EXPENSE'
      AND recognition_mode = 'AMORTIZED' AND scheduled_date IS NULL
      AND ((item_source = 'PLANNED' AND source_special_allocation_id IS NOT NULL)
        OR (item_source = 'ACTUAL_ONLY' AND source_special_allocation_id IS NULL)))
    OR (item_origin != 'SPECIAL_PROJECT' AND source_special_project_id IS NULL
      AND source_special_allocation_id IS NULL)
  ),
  CHECK (
    (category IN ('FIXED_INCOME', 'VARIABLE_INCOME') AND flow_type = 'INCOME') OR
    (category IN ('ESSENTIAL_EXPENSE', 'FIXED_COMMITMENT_EXPENSE', 'DISCRETIONARY_BUDGET')
      AND flow_type = 'EXPENSE')
  ),
  CHECK (
    (item_source = 'ACTUAL_ONLY' AND planned_amount_scaled = 0 AND scheduled_date IS NULL) OR
    (item_source = 'PLANNED' AND (
      (recognition_mode = 'AMORTIZED' AND scheduled_date IS NULL) OR
      (recognition_mode = 'PAYMENT' AND scheduled_date IS NOT NULL)
    ))
  )
) STRICT;

CREATE TABLE actual_entries_v6 (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  monthly_item_id TEXT NOT NULL REFERENCES monthly_items_v6(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) = occurred_on),
  effect TEXT NOT NULL CHECK (effect IN ('INCREASE', 'DECREASE')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
  source_amount_scaled INTEGER NOT NULL CHECK (source_amount_scaled > 0),
  source_currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  exchange_rate_scaled INTEGER NOT NULL CHECK (exchange_rate_scaled > 0),
  exchange_rate_source TEXT NOT NULL
    CHECK (exchange_rate_source IN (
      'BASE_CURRENCY', 'ECB_REFERENCE', 'MANUAL', 'MIGRATED_BASE'
    )),
  exchange_rate_observed_on TEXT NOT NULL
    CHECK (date(exchange_rate_observed_on) = exchange_rate_observed_on),
  origin TEXT NOT NULL CHECK (origin IN ('USER', 'MIGRATED_AGGREGATE', 'AUTOMATIC')),
  note TEXT,
  detail_group TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO monthly_items_v6 (
  id, source_plan_item_id, month, snapshot_name, category, flow_type,
  recognition_mode, item_source, scheduled_date, planned_amount_scaled,
  currency_code, note, created_at, updated_at, item_origin
)
SELECT id, source_plan_item_id, month, snapshot_name, category, flow_type,
  recognition_mode, item_source, scheduled_date, planned_amount_scaled,
  currency_code, note, created_at, updated_at, item_origin
FROM monthly_items;

INSERT INTO actual_entries_v6 (
  id, monthly_item_id, occurred_on, effect, amount_scaled, source_amount_scaled,
  source_currency_code, exchange_rate_scaled, exchange_rate_source,
  exchange_rate_observed_on, origin, note, created_at, updated_at
)
SELECT id, monthly_item_id, occurred_on, effect, amount_scaled, source_amount_scaled,
  source_currency_code, exchange_rate_scaled, exchange_rate_source,
  exchange_rate_observed_on, origin, note, created_at, updated_at
FROM actual_entries;

DROP TRIGGER settings_base_currency_lock;
DROP TABLE actual_entries;
DROP TABLE monthly_items;
ALTER TABLE monthly_items_v6 RENAME TO monthly_items;
ALTER TABLE actual_entries_v6 RENAME TO actual_entries;

CREATE INDEX idx_monthly_items_month ON monthly_items(month);
CREATE INDEX idx_monthly_items_month_category_flow
  ON monthly_items(month, category, flow_type);
CREATE INDEX idx_monthly_items_source_plan ON monthly_items(source_plan_item_id);
CREATE INDEX idx_monthly_items_source_special ON monthly_items(source_special_project_id, month);
CREATE INDEX idx_actual_entries_monthly_item ON actual_entries(monthly_item_id, occurred_on, id);
CREATE INDEX idx_actual_entries_occurred_on ON actual_entries(occurred_on);
CREATE INDEX idx_special_allocations_month ON special_allocations(month, project_id);

CREATE TRIGGER settings_base_currency_lock
BEFORE UPDATE OF base_currency_code ON settings FOR EACH ROW
WHEN NEW.base_currency_code != OLD.base_currency_code
  AND (EXISTS (SELECT 1 FROM monthly_items LIMIT 1)
    OR EXISTS (SELECT 1 FROM special_projects LIMIT 1))
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_CURRENCY_LOCKED');
END;

CREATE TRIGGER monthly_item_currency_matches_settings
BEFORE INSERT ON monthly_items FOR EACH ROW
WHEN NEW.currency_code != COALESCE((
  SELECT base_currency_code FROM settings WHERE id = 1
), '')
BEGIN
  SELECT RAISE(ABORT, 'APLENA_MONTHLY_CURRENCY_MISMATCH');
END;

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

CREATE TRIGGER actual_entry_month_insert
BEFORE INSERT ON actual_entries FOR EACH ROW
WHEN substr(NEW.occurred_on, 1, 7) != COALESCE((
  SELECT substr(month, 1, 7) FROM monthly_items WHERE id = NEW.monthly_item_id
), '')
BEGIN
  SELECT RAISE(ABORT, 'APLENA_ACTUAL_ENTRY_MONTH_MISMATCH');
END;

CREATE TRIGGER actual_entry_month_update
BEFORE UPDATE OF monthly_item_id, occurred_on ON actual_entries FOR EACH ROW
WHEN substr(NEW.occurred_on, 1, 7) != COALESCE((
  SELECT substr(month, 1, 7) FROM monthly_items WHERE id = NEW.monthly_item_id
), '')
BEGIN
  SELECT RAISE(ABORT, 'APLENA_ACTUAL_ENTRY_MONTH_MISMATCH');
END;

CREATE TRIGGER special_project_currency_matches_settings
BEFORE INSERT ON special_projects FOR EACH ROW
WHEN NEW.currency_code != COALESCE((
  SELECT base_currency_code FROM settings WHERE id = 1
), '')
BEGIN
  SELECT RAISE(ABORT, 'APLENA_MONTHLY_CURRENCY_MISMATCH');
END;

CREATE TRIGGER monthly_special_allocation_matches_insert
BEFORE INSERT ON monthly_items FOR EACH ROW
WHEN NEW.source_special_allocation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM special_allocations a
  WHERE a.id = NEW.source_special_allocation_id
    AND a.project_id = NEW.source_special_project_id
    AND a.month = NEW.month AND a.category = NEW.category
    AND a.amount_scaled = NEW.planned_amount_scaled
)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_SPECIAL_ALLOCATION_MISMATCH');
END;

CREATE TRIGGER monthly_special_allocation_matches_update
BEFORE UPDATE OF source_special_allocation_id, source_special_project_id,
  month, category, planned_amount_scaled ON monthly_items FOR EACH ROW
WHEN NEW.source_special_allocation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM special_allocations a
  WHERE a.id = NEW.source_special_allocation_id
    AND a.project_id = NEW.source_special_project_id
    AND a.month = NEW.month AND a.category = NEW.category
    AND a.amount_scaled = NEW.planned_amount_scaled
)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_SPECIAL_ALLOCATION_MISMATCH');
END;

CREATE TRIGGER monthly_special_snapshot_frozen
BEFORE UPDATE OF source_special_project_id, source_special_allocation_id,
  month, category, flow_type, recognition_mode, item_source, item_origin,
  planned_amount_scaled, currency_code, snapshot_name, scheduled_date ON monthly_items
FOR EACH ROW
WHEN OLD.item_origin = 'SPECIAL_PROJECT' AND OLD.item_source = 'PLANNED'
  AND (NEW.source_special_project_id IS NOT OLD.source_special_project_id
    OR NEW.source_special_allocation_id IS NOT OLD.source_special_allocation_id
    OR NEW.month IS NOT OLD.month OR NEW.category IS NOT OLD.category
    OR NEW.flow_type IS NOT OLD.flow_type OR NEW.recognition_mode IS NOT OLD.recognition_mode
    OR NEW.item_source IS NOT OLD.item_source OR NEW.item_origin IS NOT OLD.item_origin
    OR NEW.planned_amount_scaled IS NOT OLD.planned_amount_scaled
    OR NEW.currency_code IS NOT OLD.currency_code OR NEW.snapshot_name IS NOT OLD.snapshot_name
    OR NEW.scheduled_date IS NOT OLD.scheduled_date)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_SPECIAL_SNAPSHOT_FROZEN');
END;

CREATE TRIGGER special_allocation_frozen_update
BEFORE UPDATE OF project_id, month, category, amount_scaled ON special_allocations
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM monthly_items m WHERE m.source_special_allocation_id = OLD.id)
  AND (NEW.project_id IS NOT OLD.project_id OR NEW.month IS NOT OLD.month
    OR NEW.category IS NOT OLD.category OR NEW.amount_scaled IS NOT OLD.amount_scaled)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_SPECIAL_SNAPSHOT_FROZEN');
END;

CREATE TABLE automatic_entry_policies (
  plan_item_id TEXT PRIMARY KEY REFERENCES plan_items(id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  enabled_from_month TEXT CHECK (enabled_from_month IS NULL OR (
    date(enabled_from_month) = enabled_from_month AND substr(enabled_from_month, 9, 2) = '01'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (enabled = 0 OR enabled_from_month IS NOT NULL)
) STRICT;

CREATE TABLE automatic_policy_versions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  plan_item_id TEXT REFERENCES plan_items(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  rule_key TEXT NOT NULL CHECK (length(rule_key) = 36),
  effective_month TEXT NOT NULL CHECK (
    date(effective_month) = effective_month AND substr(effective_month, 9, 2) = '01'
  ),
  snapshot_name TEXT NOT NULL CHECK (length(trim(snapshot_name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME', 'VARIABLE_INCOME', 'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE', 'DISCRETIONARY_BUDGET'
  )),
  recognition_mode TEXT NOT NULL CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  start_date TEXT NOT NULL CHECK (date(start_date) = start_date),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled >= 0),
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  period_months INTEGER NOT NULL CHECK (period_months > 0),
  first_date TEXT NOT NULL CHECK (date(first_date) = first_date),
  end_date TEXT CHECK (end_date IS NULL OR (date(end_date) = end_date AND end_date >= start_date)),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (rule_key, effective_month)
) STRICT;

CREATE TABLE automatic_occurrences (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  rule_key TEXT NOT NULL CHECK (length(rule_key) = 36),
  month TEXT NOT NULL CHECK (
    date(month) = month AND substr(month, 9, 2) = '01'
  ),
  state TEXT NOT NULL CHECK (state IN ('POSTED', 'CONFLICT', 'SKIPPED', 'DELETED', 'FAILED')),
  policy_version_id TEXT NOT NULL REFERENCES automatic_policy_versions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (
    date(occurred_on) = occurred_on AND substr(occurred_on, 1, 7) = substr(month, 1, 7)
  ),
  actual_entry_id TEXT UNIQUE REFERENCES actual_entries(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  monthly_item_id TEXT REFERENCES monthly_items(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (rule_key, month)
) STRICT;

CREATE INDEX idx_automatic_policy_versions_current
  ON automatic_policy_versions(rule_key, effective_month);
CREATE INDEX idx_automatic_occurrences_month_state ON automatic_occurrences(month, state);

-- Deleting a linked actual permanently consumes this occurrence even for a linked
-- user entry. The application also performs this transition in its deletion transaction.
CREATE TRIGGER automatic_actual_deletion_tombstone
BEFORE DELETE ON actual_entries FOR EACH ROW
BEGIN
  UPDATE automatic_occurrences
  SET state = 'DELETED', actual_entry_id = NULL, error_code = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE actual_entry_id = OLD.id;
END;
