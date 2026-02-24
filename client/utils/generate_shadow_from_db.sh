#!/usr/bin/env bash
# Generate /var/lib/extrausers/shadow from PostgreSQL
# Called after every user sync to keep PAM/SSH authentication up to date.
#
# Shadow field mapping:
#   sp_lstchg  = days since epoch of last password change
#                (from password_changed_at; falls back to created_at; falls back to today)
#   sp_min     = 0   (no minimum days between changes)
#   sp_max     = password_max_age_days (NULL → 99999, i.e. never expires)
#   sp_warn    = 7   (warn 7 days before expiry)
#   sp_inact   = ''  (no inactivity grace period)
#   sp_expire  = ''  (no absolute account expiry date)

set -e

source /etc/default/sssd-pgsql 2>/dev/null || {
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5433}"
  DB_NAME="${DB_NAME:-postgres}"
  NSS_DB_USER="${NSS_DB_USER:-postgres}"
  NSS_DB_PASSWORD="${NSS_DB_PASSWORD:-postgres}"
}

mkdir -p /var/lib/extrausers

TEMP_FILE="/var/lib/extrausers/shadow.tmp"
TARGET_FILE="/var/lib/extrausers/shadow"

# Generate shadow entries from PostgreSQL.
#
# sp_lstchg: EXTRACT(EPOCH FROM ...) / 86400 gives days since Unix epoch.
#   - Use password_changed_at if set, otherwise fall back to created_at,
#     otherwise fall back to today (CURRENT_DATE).
#
# sp_max: use password_max_age_days when set, otherwise 99999 (never expires).
PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -F: -c \
  "SELECT
    username,
    password_hash,
    FLOOR(EXTRACT(EPOCH FROM COALESCE(password_changed_at, created_at, NOW())) / 86400)::INTEGER,
    '0',
    COALESCE(password_max_age_days::TEXT, '99999'),
    '7',
    '',
    '',
    ''
   FROM users
   WHERE is_active = 1
   ORDER BY system_uid" > "$TEMP_FILE" 2>/dev/null

if [ $? -eq 0 ]; then
  if [ ! -s "$TEMP_FILE" ]; then
    echo "Warning: No active users found, creating empty shadow file" >&2
    touch "$TEMP_FILE"
  fi

  mv "$TEMP_FILE" "$TARGET_FILE" || {
    echo "Error: Failed to move $TEMP_FILE to $TARGET_FILE" >&2
    exit 1
  }

  chmod 640 "$TARGET_FILE" || echo "Warning: Could not set permissions on $TARGET_FILE" >&2
  chown root:shadow "$TARGET_FILE" 2>/dev/null || chown root:root "$TARGET_FILE" 2>/dev/null || echo "Warning: Could not set ownership on $TARGET_FILE" >&2

  echo "Successfully generated $TARGET_FILE" >&2
else
  echo "Error: PostgreSQL query failed" >&2
  rm -f "$TEMP_FILE"
  exit 1
fi
