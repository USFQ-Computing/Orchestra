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

# Fetch user metadata (no password hash) from PostgreSQL.
#
# sp_lstchg: EXTRACT(EPOCH FROM ...) / 86400 gives days since Unix epoch.
#   - Use password_changed_at if set, otherwise fall back to created_at,
#     otherwise fall back to today (CURRENT_DATE).
#
# sp_max: use password_max_age_days when set, otherwise 99999 (never expires).
#
# IMPORTANT: We do NOT SELECT password_hash from the DB here.
# The DB stores bcrypt hashes ($2b$...) used for web login.  PAM/SSH uses
# pam_extrausers which reads /var/lib/extrausers/shadow; that file must contain
# SHA-512 ($6$...) or yescrypt ($y$...) hashes.  The SHA-512 hash is written
# there by pam_extrausers.so when the user runs `passwd`.  We must NEVER
# overwrite an existing non-bcrypt hash with the bcrypt value from the DB.
DB_ROWS=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -F$'\t' -c \
  "SELECT
    username,
    FLOOR(EXTRACT(EPOCH FROM COALESCE(password_changed_at, created_at, NOW())) / 86400)::INTEGER,
    COALESCE(password_max_age_days::TEXT, '99999')
   FROM users
   WHERE is_active = 1
   ORDER BY system_uid" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "Error: PostgreSQL query failed" >&2
  exit 1
fi

if [ -z "$DB_ROWS" ]; then
  echo "Warning: No active users found, creating empty shadow file" >&2
  touch "$TARGET_FILE"
  chmod 640 "$TARGET_FILE"
  chown root:shadow "$TARGET_FILE" 2>/dev/null || chown root:root "$TARGET_FILE" 2>/dev/null
  exit 0
fi

# Build the new shadow file, preserving any existing SHA-512/yescrypt hash.
# For users whose shadow entry already has a non-bcrypt hash, keep it.
# For new users (or users whose shadow entry is bcrypt/missing), use '!' (locked)
# so that SSH via password is blocked until they set a real password via `passwd`.
> "$TEMP_FILE"

while IFS=$'\t' read -r USERNAME SP_LSTCHG SP_MAX; do
  [ -z "$USERNAME" ] && continue

  # Look up the current hash in the existing shadow file (field 2, colon-separated).
  EXISTING_HASH=""
  if [ -f "$TARGET_FILE" ]; then
    EXISTING_HASH=$(awk -F: -v u="$USERNAME" '$1==u{print $2}' "$TARGET_FILE")
  fi

  # Decide which hash to write:
  # - If the existing hash is a PAM-compatible hash (SHA-512 $6$, yescrypt $y$,
  #   MD5 $1$, blowfish $2a$/$2y$ — but NOT bcrypt $2b$), keep it.
  # - bcrypt ($2b$) comes from the web DB and PAM cannot verify it → replace with '!'
  # - Empty or '!' or '*' → keep as '!' (locked until first passwd run)
  case "$EXISTING_HASH" in
    '$6$'*|'$y$'*|'$1$'*|'$2a$'*|'$2y$'*|'$5$'*)
      HASH="$EXISTING_HASH"
      ;;
    *)
      # bcrypt ($2b$), empty, '!', '*', or anything else PAM cannot use
      HASH="!"
      ;;
  esac

  printf '%s:%s:%s:0:%s:7:::\n' "$USERNAME" "$HASH" "$SP_LSTCHG" "$SP_MAX" >> "$TEMP_FILE"
done <<< "$DB_ROWS"

mv "$TEMP_FILE" "$TARGET_FILE" || {
  echo "Error: Failed to move $TEMP_FILE to $TARGET_FILE" >&2
  exit 1
}

chmod 640 "$TARGET_FILE" || echo "Warning: Could not set permissions on $TARGET_FILE" >&2
chown root:shadow "$TARGET_FILE" 2>/dev/null || chown root:root "$TARGET_FILE" 2>/dev/null || echo "Warning: Could not set ownership on $TARGET_FILE" >&2

echo "Successfully generated $TARGET_FILE" >&2
