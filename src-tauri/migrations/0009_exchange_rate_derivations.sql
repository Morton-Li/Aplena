ALTER TABLE exchange_rates ADD COLUMN rebased_from_currency TEXT
  CHECK (rebased_from_currency IS NULL OR rebased_from_currency GLOB '[A-Z][A-Z][A-Z]');
ALTER TABLE exchange_rates ADD COLUMN rebased_on TEXT
  CHECK (
    (rebased_on IS NULL AND rebased_from_currency IS NULL)
    OR (rebased_on IS NOT NULL AND rebased_from_currency IS NOT NULL
      AND date(rebased_on, '+0 days') IS rebased_on
      AND source = 'MANUAL' AND observed_on IS NULL)
  );

ALTER TABLE actual_entries ADD COLUMN exchange_rate_rebased_from_currency TEXT
  CHECK (exchange_rate_rebased_from_currency IS NULL
    OR exchange_rate_rebased_from_currency GLOB '[A-Z][A-Z][A-Z]');
ALTER TABLE actual_entries ADD COLUMN exchange_rate_rebased_on TEXT
  CHECK (
    (exchange_rate_rebased_on IS NULL AND exchange_rate_rebased_from_currency IS NULL)
    OR (exchange_rate_rebased_on IS NOT NULL AND exchange_rate_rebased_from_currency IS NOT NULL
      AND date(exchange_rate_rebased_on, '+0 days') IS exchange_rate_rebased_on
      AND exchange_rate_source = 'MANUAL'
      AND exchange_rate_observed_on = exchange_rate_rebased_on)
  );

-- At creation, a derived snapshot must match the currently saved derivation.
-- Later exchange-rate updates must leave existing snapshots untouched.
CREATE TRIGGER actual_entry_rebased_rate_insert
BEFORE INSERT ON actual_entries
WHEN NEW.exchange_rate_rebased_from_currency IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM exchange_rates
  WHERE currency_code = NEW.source_currency_code
    AND rate_scaled = NEW.exchange_rate_scaled
    AND rebased_from_currency = NEW.exchange_rate_rebased_from_currency
    AND rebased_on = NEW.exchange_rate_rebased_on
)
BEGIN
  SELECT RAISE(ABORT, 'APLENA_REBASED_EXCHANGE_RATE_CHANGED');
END;
