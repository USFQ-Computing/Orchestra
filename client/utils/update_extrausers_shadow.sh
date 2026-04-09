#!/usr/bin/env bash
# PAM password module for managed (extrausers) users.
# Called by pam_exec.so expose_authtok in common-password BEFORE pam_unix.
#
# For users that exist in the local PostgreSQL DB (managed users):
#   - Hash the new password with SHA-512 crypt
#   - Write the new hash into /var/lib/extrausers/shadow in place
#   - Exit 0 (success) so PAM marks this stack as satisfied
#
# For local-only users:
#   - Exit 1 (ignore/fail) so PAM falls through to pam_unix as normal
#
# PAM provides:
#   PAM_USER    - the username
#   stdin       - the new plaintext password (via expose_authtok)

# Load DB connection settings
source /etc/default/sssd-pgsql 2>/dev/null || true

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${NSS_DB_USER:-postgres}"
DB_PASS="${NSS_DB_PASSWORD:-postgres}"

SHADOW_FILE="/var/lib/extrausers/shadow"
LOGFILE="/var/log/password_sync.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

USERNAME="${PAM_USER}"
if [ -z "$USERNAME" ]; then
  exit 1
fi

PAM_STAGE="${PAM_TYPE:-unknown}"

# Read new password from stdin (provided by pam_exec expose_authtok)
read -rs NEW_PASSWORD
if [ -z "$NEW_PASSWORD" ]; then
  exit 1
fi

# Check if this is a managed user
IS_MANAGED=0
if command -v psql >/dev/null 2>&1; then
  RESULT=$(PGPASSWORD="$DB_PASS" psql \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc "SELECT 1 FROM users WHERE username = '$USERNAME' AND is_active = 1 LIMIT 1;" \
    2>/dev/null)
  [ "$RESULT" = "1" ] && IS_MANAGED=1
fi

log "DEBUG: pam_update_shadow called user='${USERNAME}' pam_type='${PAM_STAGE}' is_managed=${IS_MANAGED} db_lookup='${RESULT:-}'"

# Not a managed user — let pam_unix handle it
if [ "$IS_MANAGED" -eq 0 ]; then
  exit 1
fi

# Capture current hashes for diagnostics before updating shadow.
OLD_SHADOW_HASH=""
if [ -r "$SHADOW_FILE" ]; then
  OLD_SHADOW_HASH=$(awk -F: -v u="$USERNAME" '$1==u{print $2}' "$SHADOW_FILE")
fi

DB_HASH=$(PGPASSWORD="$DB_PASS" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -tAc "SELECT password_hash FROM users WHERE username = '$USERNAME' LIMIT 1;" \
  2>/dev/null || true)

# Hash the new password using Python's crypt (SHA-512, random salt)
NEW_HASH=$(python3 -c "
import crypt, sys
print(crypt.crypt(sys.argv[1], crypt.mksalt(crypt.METHOD_SHA512)))
" "$NEW_PASSWORD" 2>/dev/null)

if [ -z "$NEW_HASH" ]; then
  log "ERROR: Failed to hash password for $USERNAME"
  exit 1
fi

log "DEBUG: hash transition user='${USERNAME}' db_hash='${DB_HASH}' old_shadow_hash='${OLD_SHADOW_HASH}' new_shadow_hash='${NEW_HASH}'"

# Update /var/lib/extrausers/shadow in place
if [ ! -f "$SHADOW_FILE" ]; then
  log "ERROR: $SHADOW_FILE not found"
  exit 1
fi

# Build updated shadow file: replace the hash field for this user only
TMPFILE=$(mktemp)
awk -v user="$USERNAME" -v hash="$NEW_HASH" -v today="$(( $(date +%s) / 86400 ))" '
BEGIN { FS=":"; OFS=":" }
$1 == user {
  $2 = hash   # new hash
  $3 = today  # sp_lstchg = today (days since epoch)
  print; next
}
{ print }
' "$SHADOW_FILE" > "$TMPFILE"

# Atomically replace
chmod 640 "$TMPFILE"
chown root:shadow "$TMPFILE" 2>/dev/null || chown root:root "$TMPFILE" 2>/dev/null
mv "$TMPFILE" "$SHADOW_FILE"

log "Password updated in extrausers shadow for: $USERNAME"
exit 0
