DROP TRIGGER actual_entry_reopens_insert;
DROP TRIGGER actual_entry_reopens_update;
DROP TRIGGER actual_entry_reopens_delete;

ALTER TABLE monthly_items DROP COLUMN actual_confirmed_at;
