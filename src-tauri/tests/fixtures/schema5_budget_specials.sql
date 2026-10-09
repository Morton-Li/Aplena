-- Synthetic schema-5 financial records; never sourced from a user database.
INSERT INTO exchange_rates(currency_code, rate_scaled, updated_at, source, observed_on)
VALUES ('CNY', 100000000, '2026-01-01T00:00:00Z', 'BASE_CURRENCY', '2026-01-01'),
       ('USD', 730000000, '2026-01-03T00:00:00Z', 'MANUAL', '2026-01-02');
INSERT INTO settings(id, base_currency_code, created_at, updated_at, auto_update_exchange_rates)
VALUES (1, 'CNY', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', 1);
INSERT INTO plan_items(id, name, category, planned_amount_scaled, currency_code, period_months,
  recognition_mode, start_date, end_date, note, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000101', '当前名称', 'ESSENTIAL_EXPENSE', 20000, 'CNY', 1,
  'AMORTIZED', '2026-01-01', NULL, '规则备注', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z');
INSERT INTO monthly_items(id, source_plan_item_id, month, snapshot_name, category, flow_type,
  recognition_mode, item_source, scheduled_date, planned_amount_scaled, currency_code,
  note, created_at, updated_at, item_origin)
VALUES ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101',
  '2026-01-01', '冻结旧名称', 'ESSENTIAL_EXPENSE', 'EXPENSE', 'AMORTIZED', 'PLANNED', NULL,
  10000, 'CNY', '冻结备注', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', 'PLAN_LINKED'),
  ('00000000-0000-0000-0000-000000000202', NULL, '2026-01-01', '一次性支出',
  'DISCRETIONARY_BUDGET', 'EXPENSE', 'AMORTIZED', 'ACTUAL_ONLY', NULL, 0, 'CNY', NULL,
  '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z', 'MANUAL');
INSERT INTO actual_entries(id, monthly_item_id, occurred_on, effect, amount_scaled,
  source_amount_scaled, source_currency_code, exchange_rate_scaled, exchange_rate_source,
  exchange_rate_observed_on, origin, note, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201',
  '2026-01-03', 'INCREASE', 9008, 1234, 'USD', 730000000, 'MANUAL', '2026-01-02',
  'USER', '历史汇率事实', '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201',
  '2026-01-05', 'DECREASE', 800, 800, 'CNY', 100000000, 'BASE_CURRENCY', '2026-01-05',
  'USER', '退款', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202',
  '2026-01-06', 'INCREASE', 1500, 1500, 'CNY', 100000000, 'MIGRATED_BASE', '2026-01-06',
  'MIGRATED_AGGREGATE', '迁移汇总', '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z');
