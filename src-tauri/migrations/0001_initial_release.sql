CREATE TABLE exchange_rates (
  currency_code TEXT PRIMARY KEY
    CHECK (
      length(currency_code) = 3
      AND currency_code GLOB '[A-Z][A-Z][A-Z]'
    ),
  rate_scaled INTEGER NOT NULL CHECK (rate_scaled > 0),
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('BASE_CURRENCY', 'ECB_REFERENCE', 'MANUAL')),
  observed_on TEXT
    CHECK (observed_on IS NULL OR date(observed_on) = observed_on)
) STRICT;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE next_month_goal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_month TEXT NOT NULL CHECK (
    date(target_month) = target_month AND substr(target_month, 9, 2) = '01'
  ),
  minimum_savings_rate_bp INTEGER NOT NULL
    CHECK (minimum_savings_rate_bp BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

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
      date(scheduled_date) = scheduled_date
      AND substr(scheduled_date, 1, 7) = substr(month, 1, 7)
    )
  ),
  planned_amount_scaled INTEGER NOT NULL CHECK (planned_amount_scaled >= 0),
  actual_confirmed_at TEXT,
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item_origin TEXT NOT NULL DEFAULT 'PLAN_LINKED'
    CHECK (item_origin IN ('PLAN_LINKED', 'MANUAL')),
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

CREATE TABLE actual_entries (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  monthly_item_id TEXT NOT NULL REFERENCES monthly_items(id)
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
  origin TEXT NOT NULL CHECK (origin IN ('USER', 'MIGRATED_AGGREGATE')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_plan_items_active_dates
ON plan_items(start_date, end_date);

CREATE INDEX idx_plan_items_category
ON plan_items(category);

CREATE INDEX idx_monthly_items_month
ON monthly_items(month);

CREATE INDEX idx_monthly_items_month_category_flow
ON monthly_items(month, category, flow_type);

CREATE INDEX idx_monthly_items_source_plan
ON monthly_items(source_plan_item_id);

CREATE INDEX idx_actual_entries_monthly_item
ON actual_entries(monthly_item_id, occurred_on, id);

CREATE INDEX idx_actual_entries_occurred_on
ON actual_entries(occurred_on);

CREATE TRIGGER settings_base_rate_insert
BEFORE INSERT ON settings FOR EACH ROW
WHEN COALESCE((
  SELECT rate_scaled FROM exchange_rates WHERE currency_code = NEW.base_currency_code
), 0) != 100000000
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
END;

CREATE TRIGGER settings_base_rate_update
BEFORE UPDATE OF base_currency_code ON settings FOR EACH ROW
WHEN COALESCE((
  SELECT rate_scaled FROM exchange_rates WHERE currency_code = NEW.base_currency_code
), 0) != 100000000
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
END;

CREATE TRIGGER settings_base_currency_lock
BEFORE UPDATE OF base_currency_code ON settings FOR EACH ROW
WHEN NEW.base_currency_code != OLD.base_currency_code
  AND EXISTS (SELECT 1 FROM monthly_items LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_CURRENCY_LOCKED');
END;

CREATE TRIGGER exchange_rate_base_lock
BEFORE UPDATE OF rate_scaled ON exchange_rates FOR EACH ROW
WHEN NEW.rate_scaled != 100000000 AND EXISTS (
  SELECT 1 FROM settings WHERE base_currency_code = OLD.currency_code
)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
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

CREATE TRIGGER actual_entry_reopens_insert
AFTER INSERT ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items
  SET actual_confirmed_at = NULL, updated_at = NEW.updated_at
  WHERE id = NEW.monthly_item_id;
END;

CREATE TRIGGER actual_entry_reopens_update
AFTER UPDATE ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items
  SET actual_confirmed_at = NULL, updated_at = NEW.updated_at
  WHERE id IN (OLD.monthly_item_id, NEW.monthly_item_id);
END;

CREATE TRIGGER actual_entry_reopens_delete
AFTER DELETE ON actual_entries FOR EACH ROW
BEGIN
  UPDATE monthly_items
  SET actual_confirmed_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.monthly_item_id;
END;
