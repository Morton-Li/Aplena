CREATE TABLE loan_advances (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) IS NOT NULL AND date(occurred_on) = occurred_on),
  principal_scaled INTEGER NOT NULL CHECK (principal_scaled > 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_loan_advances_date ON loan_advances(loan_id, occurred_on);

CREATE VIEW loan_principal_movements AS
  SELECT id AS loan_id, started_on AS occurred_on, principal_scaled AS delta_scaled,
         opening_only = 0 AS is_cash, NULL AS payment_id
  FROM loans
  UNION ALL
  SELECT loan_id, occurred_on, principal_scaled, 1, NULL FROM loan_advances
  UNION ALL
  SELECT loan_id, occurred_on, -principal_scaled, 1, id FROM loan_payments;

CREATE VIEW loan_daily_principal_balances AS
  SELECT loan_id, occurred_on,
         SUM(SUM(delta_scaled)) OVER (PARTITION BY loan_id ORDER BY occurred_on) AS balance_scaled
  FROM loan_principal_movements
  GROUP BY loan_id, occurred_on;

DROP TRIGGER loan_principal_limit_insert;
DROP TRIGGER loan_principal_limit_update;

CREATE TRIGGER loan_principal_limit_insert AFTER INSERT ON loan_payments
WHEN NEW.principal_scaled > 0 AND EXISTS (
  SELECT 1 FROM loan_daily_principal_balances WHERE loan_id = NEW.loan_id AND balance_scaled < 0
)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_PRINCIPAL_OVERPAYMENT'); END;

CREATE TRIGGER loan_principal_limit_update AFTER UPDATE OF occurred_on, principal_scaled, loan_id ON loan_payments
WHEN NEW.principal_scaled > 0 AND EXISTS (
  SELECT 1 FROM loan_daily_principal_balances WHERE loan_id = NEW.loan_id AND balance_scaled < 0
)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_PRINCIPAL_OVERPAYMENT'); END;

CREATE TRIGGER loan_advance_balance_update AFTER UPDATE OF occurred_on, principal_scaled, loan_id ON loan_advances
WHEN EXISTS (
  SELECT 1 FROM loan_daily_principal_balances WHERE loan_id = OLD.loan_id AND balance_scaled < 0
)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_ADVANCE_HAS_REPAYMENTS'); END;

CREATE TRIGGER loan_advance_balance_delete AFTER DELETE ON loan_advances
WHEN EXISTS (
  SELECT 1 FROM loan_daily_principal_balances WHERE loan_id = OLD.loan_id AND balance_scaled < 0
)
BEGIN SELECT RAISE(ABORT, 'APLENA_LOAN_ADVANCE_HAS_REPAYMENTS'); END;
