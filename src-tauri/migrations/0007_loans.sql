CREATE TABLE loans (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  counterparty TEXT NOT NULL CHECK (length(trim(counterparty)) > 0),
  direction TEXT NOT NULL CHECK (direction IN ('BORROWED', 'LENT')),
  currency_code TEXT NOT NULL REFERENCES exchange_rates(currency_code) ON DELETE RESTRICT,
  principal_scaled INTEGER NOT NULL CHECK (principal_scaled > 0),
  started_on TEXT NOT NULL CHECK (date(started_on) IS NOT NULL AND date(started_on) = started_on),
  opening_only INTEGER NOT NULL CHECK (opening_only IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE loan_schedule_versions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAY', 'MONTH', 'QUARTER', 'YEAR')),
  interval_count INTEGER NOT NULL CHECK (interval_count BETWEEN 1 AND 10000),
  method TEXT NOT NULL CHECK (method IN ('MANUAL', 'EQUAL_PRINCIPAL', 'ANNUITY')),
  period_rate_percent TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE loan_installments (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES loan_schedule_versions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position > 0),
  due_on TEXT NOT NULL CHECK (date(due_on) IS NOT NULL AND date(due_on) = due_on),
  principal_scaled INTEGER NOT NULL CHECK (principal_scaled >= 0),
  interest_scaled INTEGER NOT NULL CHECK (interest_scaled >= 0),
  fees_scaled INTEGER NOT NULL CHECK (fees_scaled >= 0),
  superseded INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0, 1)),
  CHECK (principal_scaled > 0 OR interest_scaled > 0 OR fees_scaled > 0),
  UNIQUE (version_id, position)
) STRICT;

CREATE TABLE loan_payments (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) IS NOT NULL AND date(occurred_on) = occurred_on),
  principal_scaled INTEGER NOT NULL CHECK (principal_scaled >= 0),
  interest_scaled INTEGER NOT NULL CHECK (interest_scaled >= 0),
  fees_scaled INTEGER NOT NULL CHECK (fees_scaled >= 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (principal_scaled > 0 OR interest_scaled > 0 OR fees_scaled > 0)
) STRICT;

CREATE TABLE loan_payment_allocations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  payment_id TEXT NOT NULL REFERENCES loan_payments(id) ON DELETE CASCADE,
  installment_id TEXT REFERENCES loan_installments(id) ON DELETE RESTRICT,
  principal_scaled INTEGER NOT NULL CHECK (principal_scaled >= 0),
  interest_scaled INTEGER NOT NULL CHECK (interest_scaled >= 0),
  fees_scaled INTEGER NOT NULL CHECK (fees_scaled >= 0),
  CHECK (principal_scaled > 0 OR interest_scaled > 0 OR fees_scaled > 0)
) STRICT;

CREATE TABLE loan_monthly_items (
  monthly_item_id TEXT PRIMARY KEY REFERENCES monthly_items(id) ON DELETE RESTRICT,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  month TEXT NOT NULL CHECK (date(month) IS NOT NULL AND date(month) = month AND substr(month, 9, 2) = '01'),
  UNIQUE (loan_id, month)
) STRICT;

CREATE TABLE loan_actual_links (
  payment_id TEXT PRIMARY KEY REFERENCES loan_payments(id) ON DELETE RESTRICT,
  actual_entry_id TEXT NOT NULL UNIQUE REFERENCES actual_entries(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_loans_direction ON loans(direction, archived);
CREATE INDEX idx_loan_installments_due ON loan_installments(loan_id, superseded, due_on);
CREATE INDEX idx_loan_payments_date ON loan_payments(loan_id, occurred_on);
CREATE INDEX idx_loan_allocations_installment ON loan_payment_allocations(installment_id);

CREATE TRIGGER loan_currency_matches_settings BEFORE INSERT ON loans
WHEN NEW.currency_code != COALESCE((SELECT base_currency_code FROM settings WHERE id = 1), '')
BEGIN SELECT RAISE(ABORT, 'APLENA_MONTHLY_CURRENCY_MISMATCH'); END;

CREATE TRIGGER loan_base_currency_locked BEFORE UPDATE OF base_currency_code ON settings
WHEN NEW.base_currency_code != OLD.base_currency_code AND EXISTS (SELECT 1 FROM loans)
BEGIN SELECT RAISE(ABORT, 'APLENA_BASE_CURRENCY_LOCKED'); END;

CREATE TRIGGER loan_actual_protect_update BEFORE UPDATE ON actual_entries
WHEN EXISTS (SELECT 1 FROM loan_actual_links WHERE actual_entry_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_MANAGED_ENTRY'); END;

CREATE TRIGGER loan_actual_protect_delete BEFORE DELETE ON actual_entries
WHEN EXISTS (SELECT 1 FROM loan_actual_links WHERE actual_entry_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_MANAGED_ENTRY'); END;

CREATE TRIGGER loan_actual_protect_insert BEFORE INSERT ON actual_entries
WHEN EXISTS (SELECT 1 FROM loan_monthly_items WHERE monthly_item_id = NEW.monthly_item_id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_MANAGED_ENTRY'); END;

CREATE TRIGGER loan_allocation_same_contract BEFORE INSERT ON loan_payment_allocations
WHEN NEW.installment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM loan_installments i JOIN loan_payments p ON p.loan_id = i.loan_id
  WHERE i.id = NEW.installment_id AND p.id = NEW.payment_id
)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_ALLOCATION_MISMATCH'); END;

CREATE TRIGGER loan_principal_limit_insert BEFORE INSERT ON loan_payments
WHEN NEW.principal_scaled > (SELECT principal_scaled FROM loans WHERE id=NEW.loan_id)
  - (SELECT COALESCE(SUM(principal_scaled),0) FROM loan_payments WHERE loan_id=NEW.loan_id AND id!=NEW.id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_PRINCIPAL_OVERPAYMENT'); END;

CREATE TRIGGER loan_principal_limit_update BEFORE UPDATE OF principal_scaled,loan_id ON loan_payments
WHEN NEW.principal_scaled > (SELECT principal_scaled FROM loans WHERE id=NEW.loan_id)
  - (SELECT COALESCE(SUM(principal_scaled),0) FROM loan_payments WHERE loan_id=NEW.loan_id AND id!=OLD.id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_PRINCIPAL_OVERPAYMENT'); END;

CREATE TRIGGER loan_version_same_contract BEFORE INSERT ON loan_installments
WHEN NOT EXISTS (SELECT 1 FROM loan_schedule_versions WHERE id=NEW.version_id AND loan_id=NEW.loan_id)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_ALLOCATION_MISMATCH'); END;
