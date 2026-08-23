CREATE TABLE exchange_rates (
  currency_code TEXT PRIMARY KEY
    CHECK (
      length(currency_code) = 3
      AND currency_code GLOB '[A-Z][A-Z][A-Z]'
    ),
  rate_scaled INTEGER NOT NULL CHECK (rate_scaled > 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_month TEXT NOT NULL
    CHECK (
      date(target_month) IS NOT NULL
      AND date(target_month) = target_month
      AND substr(target_month, 9, 2) = '01'
    ),
  base_currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  minimum_savings_rate_bp INTEGER NOT NULL
    CHECK (minimum_savings_rate_bp BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME',
    'VARIABLE_INCOME',
    'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE',
    'DISCRETIONARY_BUDGET'
  )),
  planned_amount_scaled INTEGER NOT NULL
    CHECK (planned_amount_scaled >= 0),
  currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  period_months INTEGER NOT NULL CHECK (period_months > 0),
  recognition_mode TEXT NOT NULL
    CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  start_month TEXT NOT NULL
    CHECK (
      date(start_month) IS NOT NULL
      AND date(start_month) = start_month
      AND substr(start_month, 9, 2) = '01'
    ),
  end_month TEXT
    CHECK (
      end_month IS NULL
      OR (
        date(end_month) IS NOT NULL
        AND date(end_month) = end_month
        AND substr(end_month, 9, 2) = '01'
        AND end_month >= start_month
      )
    ),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_plan_items_active_months
ON plan_items(start_month, end_month);

CREATE INDEX idx_plan_items_category
ON plan_items(category);

CREATE TABLE monthly_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  source_plan_item_id TEXT
    REFERENCES plan_items(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  month TEXT NOT NULL
    CHECK (
      date(month) IS NOT NULL
      AND date(month) = month
      AND substr(month, 9, 2) = '01'
    ),
  snapshot_name TEXT NOT NULL CHECK (length(trim(snapshot_name)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'FIXED_INCOME',
    'VARIABLE_INCOME',
    'ESSENTIAL_EXPENSE',
    'FIXED_COMMITMENT_EXPENSE',
    'DISCRETIONARY_BUDGET'
  )),
  flow_type TEXT NOT NULL CHECK (flow_type IN ('INCOME', 'EXPENSE')),
  recognition_mode TEXT NOT NULL
    CHECK (recognition_mode IN ('AMORTIZED', 'PAYMENT')),
  planned_amount_scaled INTEGER NOT NULL
    CHECK (planned_amount_scaled >= 0),
  actual_amount_scaled INTEGER
    CHECK (actual_amount_scaled IS NULL OR actual_amount_scaled >= 0),
  currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_plan_item_id, month),
  CHECK (
    (category IN ('FIXED_INCOME', 'VARIABLE_INCOME') AND flow_type = 'INCOME')
    OR
    (category IN (
      'ESSENTIAL_EXPENSE',
      'FIXED_COMMITMENT_EXPENSE',
      'DISCRETIONARY_BUDGET'
    ) AND flow_type = 'EXPENSE')
  )
) STRICT;

CREATE INDEX idx_monthly_items_month
ON monthly_items(month);

CREATE INDEX idx_monthly_items_month_category_flow
ON monthly_items(month, category, flow_type);

CREATE INDEX idx_monthly_items_actual_coverage
ON monthly_items(month, actual_amount_scaled);

CREATE TRIGGER settings_base_rate_insert
BEFORE INSERT ON settings
FOR EACH ROW
WHEN COALESCE((
  SELECT rate_scaled
  FROM exchange_rates
  WHERE currency_code = NEW.base_currency_code
), 0) != 100000000
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
END;

CREATE TRIGGER settings_base_rate_update
BEFORE UPDATE OF base_currency_code ON settings
FOR EACH ROW
WHEN COALESCE((
  SELECT rate_scaled
  FROM exchange_rates
  WHERE currency_code = NEW.base_currency_code
), 0) != 100000000
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
END;

CREATE TRIGGER settings_base_currency_lock
BEFORE UPDATE OF base_currency_code ON settings
FOR EACH ROW
WHEN NEW.base_currency_code != OLD.base_currency_code
  AND EXISTS (SELECT 1 FROM monthly_items LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_CURRENCY_LOCKED');
END;

CREATE TRIGGER exchange_rate_base_lock
BEFORE UPDATE OF rate_scaled ON exchange_rates
FOR EACH ROW
WHEN NEW.rate_scaled != 100000000
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE base_currency_code = OLD.currency_code
  )
BEGIN
  SELECT RAISE(ABORT, 'APLENA_BASE_RATE_MUST_EQUAL_ONE');
END;

CREATE TRIGGER monthly_item_source_required
BEFORE INSERT ON monthly_items
FOR EACH ROW
WHEN NEW.source_plan_item_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'APLENA_MONTHLY_SOURCE_REQUIRED');
END;

CREATE TRIGGER monthly_item_currency_matches_settings
BEFORE INSERT ON monthly_items
FOR EACH ROW
WHEN NEW.currency_code != COALESCE((
  SELECT base_currency_code FROM settings WHERE id = 1
), '')
BEGIN
  SELECT RAISE(ABORT, 'APLENA_MONTHLY_CURRENCY_MISMATCH');
END;
