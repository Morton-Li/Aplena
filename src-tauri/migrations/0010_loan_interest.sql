CREATE TABLE loan_interest_rules (
  loan_id TEXT PRIMARY KEY NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('SIMPLE', 'COMPOUND', 'FIXED')),
  frequency TEXT NOT NULL CHECK (frequency IN ('DAY', 'MONTH', 'QUARTER', 'YEAR')),
  rate_percent TEXT NOT NULL,
  fixed_amount_scaled INTEGER NOT NULL CHECK (fixed_amount_scaled >= 0),
  started_on TEXT NOT NULL CHECK (date(started_on) IS NOT NULL AND date(started_on) = started_on)
) STRICT;
