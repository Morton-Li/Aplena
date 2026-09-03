ALTER TABLE settings
ADD COLUMN auto_update_exchange_rates INTEGER NOT NULL DEFAULT 0
  CHECK (auto_update_exchange_rates IN (0, 1));
