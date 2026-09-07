CREATE TABLE software_update_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto_check_updates INTEGER NOT NULL DEFAULT 1
    CHECK (auto_check_updates IN (0, 1)),
  last_checked_at TEXT,
  last_check_status TEXT
    CHECK (last_check_status IS NULL OR last_check_status IN (
      'UP_TO_DATE', 'UPDATE_AVAILABLE', 'FAILED'
    )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (last_checked_at IS NULL AND last_check_status IS NULL) OR
    (last_checked_at IS NOT NULL AND last_check_status IS NOT NULL)
  )
) STRICT;

INSERT INTO software_update_preferences (
  id,
  auto_check_updates,
  last_checked_at,
  last_check_status,
  created_at,
  updated_at
)
VALUES (
  1,
  1,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
