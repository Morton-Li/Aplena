-- Forward-only transition from four-decimal monthly aggregates to cents and
-- project-linked actual entries. Existing snapshot values are rounded once,
-- half away from zero, without using SQLite REAL values.

DROP TRIGGER settings_base_rate_insert;
DROP TRIGGER settings_base_rate_update;
DROP TRIGGER settings_base_currency_lock;
DROP TRIGGER exchange_rate_base_lock;
DROP TRIGGER monthly_item_source_required;
DROP TRIGGER monthly_item_currency_matches_settings;

ALTER TABLE monthly_items RENAME TO monthly_items_legacy;
ALTER TABLE plan_items RENAME TO plan_items_legacy;

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME', 'VARIABLE_INCOME', 'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE', 'DISCRETIONARY_BUDGET'
  )),
  planned_amount_scaled INTEGER NOT NULL CHECK (planned_amount_scaled >= 0),
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  period_months INTEGER NOT NULL CHECK (period_months > 0),
  recognition_mode TEXT NOT NULL CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  start_date TEXT NOT NULL CHECK (date(start_date) = start_date),
  end_date TEXT CHECK (
    end_date IS NULL OR (date(end_date) = end_date AND end_date >= start_date)
  ),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO plan_items (
  id, name, category, planned_amount_scaled, currency_code, period_months,
  recognition_mode, start_date, end_date, note, created_at, updated_at
)
SELECT
  id, name, category,
  planned_amount_scaled / 100 + CASE WHEN planned_amount_scaled % 100 >= 50 THEN 1 ELSE 0 END,
  currency_code, period_months, recognition_mode, start_month, end_month, note,
  created_at, updated_at
FROM plan_items_legacy;

CREATE TABLE monthly_items (
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
      date(scheduled_date) = scheduled_date AND substr(scheduled_date, 1, 7) = substr(month, 1, 7)
    )
  ),
  planned_amount_scaled INTEGER NOT NULL CHECK (planned_amount_scaled >= 0),
  actual_confirmed_at TEXT,
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_plan_item_id, month),
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

INSERT INTO monthly_items (
  id, source_plan_item_id, month, snapshot_name, category, flow_type,
  recognition_mode, item_source, scheduled_date, planned_amount_scaled,
  actual_confirmed_at, currency_code, note, created_at, updated_at
)
SELECT
  id, source_plan_item_id, month, snapshot_name, category, flow_type,
  recognition_mode, 'PLANNED',
  CASE WHEN recognition_mode = 'PAYMENT' THEN month ELSE NULL END,
  planned_amount_scaled / 100 + CASE WHEN planned_amount_scaled % 100 >= 50 THEN 1 ELSE 0 END,
  CASE WHEN actual_amount_scaled IS NULL THEN NULL ELSE updated_at END,
  currency_code, note, created_at, updated_at
FROM monthly_items_legacy;

CREATE TABLE actual_entries (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  monthly_item_id TEXT NOT NULL REFERENCES monthly_items(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) = occurred_on),
  effect TEXT NOT NULL CHECK (effect IN ('INCREASE', 'DECREASE')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
  origin TEXT NOT NULL CHECK (origin IN ('USER', 'MIGRATED_AGGREGATE')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO actual_entries (
  id, monthly_item_id, occurred_on, effect, amount_scaled, origin, note, created_at, updated_at
)
SELECT
  id, id, month, 'INCREASE',
  actual_amount_scaled / 100 + CASE WHEN actual_amount_scaled % 100 >= 50 THEN 1 ELSE 0 END,
  'MIGRATED_AGGREGATE',
  '由旧版月度实际总额自动迁移；原始值已按 ROUND_HALF_UP 转换为两位小数。',
  updated_at, updated_at
FROM monthly_items_legacy
WHERE actual_amount_scaled IS NOT NULL
  AND actual_amount_scaled / 100 + CASE WHEN actual_amount_scaled % 100 >= 50 THEN 1 ELSE 0 END > 0;

DROP TABLE monthly_items_legacy;
DROP TABLE plan_items_legacy;

CREATE INDEX idx_plan_items_active_dates ON plan_items(start_date, end_date);
CREATE INDEX idx_plan_items_category ON plan_items(category);
CREATE INDEX idx_monthly_items_month ON monthly_items(month);
CREATE INDEX idx_monthly_items_month_category_flow ON monthly_items(month, category, flow_type);
CREATE INDEX idx_monthly_items_source_plan ON monthly_items(source_plan_item_id);
CREATE INDEX idx_actual_entries_monthly_item ON actual_entries(monthly_item_id, occurred_on, id);
CREATE INDEX idx_actual_entries_occurred_on ON actual_entries(occurred_on);

CREATE TRIGGER settings_base_rate_insert
BEFORE INSERT ON settings FOR EACH ROW
WHEN COALESCE((SELECT rate_scaled FROM exchange_rates WHERE currency_code = NEW.base_currency_code), 0) != 100000000
BEGIN SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE'); END;

CREATE TRIGGER settings_base_rate_update
BEFORE UPDATE OF base_currency_code ON settings FOR EACH ROW
WHEN COALESCE((SELECT rate_scaled FROM exchange_rates WHERE currency_code = NEW.base_currency_code), 0) != 100000000
BEGIN SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE'); END;

CREATE TRIGGER settings_base_currency_lock
BEFORE UPDATE OF base_currency_code ON settings FOR EACH ROW
WHEN NEW.base_currency_code != OLD.base_currency_code AND EXISTS (SELECT 1 FROM monthly_items LIMIT 1)
BEGIN SELECT RAISE(ABORT, 'APLENA_BASE_CURRENCY_LOCKED'); END;

CREATE TRIGGER exchange_rate_base_lock
BEFORE UPDATE OF rate_scaled ON exchange_rates FOR EACH ROW
WHEN NEW.rate_scaled != 100000000 AND EXISTS (
  SELECT 1 FROM settings WHERE base_currency_code = OLD.currency_code
)
BEGIN SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE'); END;

CREATE TRIGGER monthly_item_currency_matches_settings
BEFORE INSERT ON monthly_items FOR EACH ROW
WHEN NEW.currency_code != COALESCE((SELECT base_currency_code FROM settings WHERE id = 1), '')
BEGIN SELECT RAISE(ABORT, 'APLENA_MONTHLY_CURRENCY_MISMATCH'); END;

CREATE TRIGGER actual_entry_month_insert
BEFORE INSERT ON actual_entries FOR EACH ROW
WHEN substr(NEW.occurred_on, 1, 7) != COALESCE((
  SELECT substr(month, 1, 7) FROM monthly_items WHERE id = NEW.monthly_item_id
), '')
BEGIN SELECT RAISE(ABORT, 'APLENA_ACTUAL_ENTRY_MONTH_MISMATCH'); END;

CREATE TRIGGER actual_entry_month_update
BEFORE UPDATE OF monthly_item_id, occurred_on ON actual_entries FOR EACH ROW
WHEN substr(NEW.occurred_on, 1, 7) != COALESCE((
  SELECT substr(month, 1, 7) FROM monthly_items WHERE id = NEW.monthly_item_id
), '')
BEGIN SELECT RAISE(ABORT, 'APLENA_ACTUAL_ENTRY_MONTH_MISMATCH'); END;

CREATE TRIGGER actual_entry_reopens_insert
AFTER INSERT ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items SET actual_confirmed_at = NULL, updated_at = NEW.updated_at
  WHERE id = NEW.monthly_item_id;
END;

CREATE TRIGGER actual_entry_reopens_update
AFTER UPDATE ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items SET actual_confirmed_at = NULL, updated_at = NEW.updated_at
  WHERE id IN (OLD.monthly_item_id, NEW.monthly_item_id);
END;

CREATE TRIGGER actual_entry_reopens_delete
AFTER DELETE ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items SET actual_confirmed_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.monthly_item_id;
END;
