-- Separate stable application settings from the forward-looking goal. The goal
-- is intentionally a singleton for the next natural month and never becomes a
-- historical or current-month reporting input.

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

INSERT INTO next_month_goal (
  id, target_month, minimum_savings_rate_bp, created_at, updated_at
)
SELECT
  1,
  date('now', 'localtime', 'start of month', '+1 month'),
  minimum_savings_rate_bp,
  created_at,
  updated_at
FROM settings
WHERE id = 1;

DROP TRIGGER settings_base_rate_insert;
DROP TRIGGER settings_base_rate_update;
DROP TRIGGER settings_base_currency_lock;
DROP TRIGGER exchange_rate_base_lock;
DROP TRIGGER monthly_item_currency_matches_settings;

ALTER TABLE settings RENAME TO settings_legacy;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_currency_code TEXT NOT NULL
    REFERENCES exchange_rates(currency_code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO settings (id, base_currency_code, created_at, updated_at)
SELECT id, base_currency_code, created_at, updated_at
FROM settings_legacy;

DROP TABLE settings_legacy;

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
