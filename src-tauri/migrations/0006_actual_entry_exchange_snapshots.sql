-- Preserve the original currency and exchange-rate basis of every actual entry.
-- Existing entries were already denominated in the base currency, so they migrate
-- as explicit 1:1 base-currency snapshots without changing any historical totals.

ALTER TABLE exchange_rates
ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('BASE_CURRENCY', 'ECB_REFERENCE', 'MANUAL'));

ALTER TABLE exchange_rates
ADD COLUMN observed_on TEXT
  CHECK (observed_on IS NULL OR date(observed_on) = observed_on);

UPDATE exchange_rates
SET source = 'BASE_CURRENCY', observed_on = date(updated_at)
WHERE currency_code = (SELECT base_currency_code FROM settings WHERE id = 1);

DROP TRIGGER actual_entry_month_insert;
DROP TRIGGER actual_entry_month_update;
DROP TRIGGER actual_entry_reopens_insert;
DROP TRIGGER actual_entry_reopens_update;
DROP TRIGGER actual_entry_reopens_delete;

ALTER TABLE actual_entries RENAME TO actual_entries_legacy;

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
    CHECK (exchange_rate_source IN ('BASE_CURRENCY', 'ECB_REFERENCE', 'MANUAL', 'MIGRATED_BASE')),
  exchange_rate_observed_on TEXT NOT NULL CHECK (date(exchange_rate_observed_on) = exchange_rate_observed_on),
  origin TEXT NOT NULL CHECK (origin IN ('USER', 'MIGRATED_AGGREGATE')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO actual_entries (
  id, monthly_item_id, occurred_on, effect, amount_scaled,
  source_amount_scaled, source_currency_code, exchange_rate_scaled,
  exchange_rate_source, exchange_rate_observed_on,
  origin, note, created_at, updated_at
)
SELECT
  e.id, e.monthly_item_id, e.occurred_on, e.effect, e.amount_scaled,
  e.amount_scaled, s.base_currency_code, 100000000,
  'MIGRATED_BASE', e.occurred_on,
  e.origin, e.note, e.created_at, e.updated_at
FROM actual_entries_legacy e
CROSS JOIN settings s
WHERE s.id = 1;

DROP TABLE actual_entries_legacy;

CREATE INDEX idx_actual_entries_monthly_item ON actual_entries(monthly_item_id, occurred_on, id);
CREATE INDEX idx_actual_entries_occurred_on ON actual_entries(occurred_on);

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
