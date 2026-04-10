#!/usr/bin/env bash
# Fix home directory permissions after UID migration
# After migrating UIDs (e.g., 2000→4000), user files may have old UID ownership
# This script resynchronizes home directory ownership to match current UIDs
#
# Usage: sudo bash fix_home_permissions.sh
# Or: sudo bash fix_home_permissions.sh [username]  # Fix specific user only

set -e

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: This script must be run as root (use sudo)" >&2
  exit 1
fi

# Source database configuration
source /etc/default/sssd-pgsql 2>/dev/null || {
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5433}"
  DB_NAME="${DB_NAME:-postgres}"
  NSS_DB_USER="${NSS_DB_USER:-postgres}"
  NSS_DB_PASSWORD="${NSS_DB_PASSWORD:-postgres}"
}

echo "🔧 Fix Home Directory Permissions After UID Migration" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}" >&2
echo "" >&2

# Check if PostgreSQL client is installed
if ! command -v psql &> /dev/null; then
  echo "❌ Error: psql is not installed" >&2
  exit 1
fi

# Get docker group GID
DOCKER_GID=$(getent group docker | cut -d: -f3)
echo "📦 Docker group GID: $DOCKER_GID" >&2
echo "" >&2

# Function to fix a single user
fix_user_permissions() {
  local username="$1"
  local uid="$2"
  local expected_gid="$3"

  local home_dir="/home/$username"

  # Skip if home doesn't exist
  if [ ! -d "$home_dir" ]; then
    echo "  ℹ️  Home directory does not exist: $home_dir" >&2
    return 0
  fi

  # Check if directory is already owned correctly
  local current_uid=$(stat -c %u "$home_dir")
  local current_gid=$(stat -c %g "$home_dir")

  if [ "$current_uid" = "$uid" ] && [ "$current_gid" = "$expected_gid" ]; then
    echo "  ✅ Already correct ($uid:$expected_gid)" >&2
    return 0
  fi

  echo "  🔄 Fixing ownership from $current_uid:$current_gid to $uid:$expected_gid" >&2

  # Resynchronize all files in home directory
  if chown -R "$uid:$expected_gid" "$home_dir" 2>/dev/null; then
    echo "  ✅ Permissions fixed successfully" >&2
    return 0
  else
    echo "  ❌ Failed to fix permissions" >&2
    return 1
  fi
}

FIXED=0
ERRORS=0
SKIPPED=0

# If specific user requested
if [ ! -z "$1" ]; then
  echo "🔍 Processing specific user: $1" >&2
  echo "" >&2

  # Query database for this user
  USER_DATA=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${NSS_DB_USER}" \
    -d "${DB_NAME}" \
    -t -A -F'|' -c \
    "SELECT username, system_uid FROM users WHERE username = '$1' AND is_active = 1" 2>&1)

  if [ -z "$USER_DATA" ]; then
    echo "❌ Error: User '$1' not found or inactive in database" >&2
    exit 1
  fi

  username=$(echo "$USER_DATA" | cut -d'|' -f1)
  uid=$(echo "$USER_DATA" | cut -d'|' -f2)

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "👤 User: $username, UID: $uid" >&2

  fix_user_permissions "$username" "$uid" "$DOCKER_GID"
  exit $?
fi

# Otherwise, process all active users
echo "🔍 Querying database for all active users..." >&2
USERS=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -F'|' -c \
  "SELECT username, system_uid FROM users WHERE is_active = 1 ORDER BY system_uid" 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Error: Failed to query database" >&2
  exit 1
fi

if [ -z "$USERS" ]; then
  echo "ℹ️  No active users found" >&2
  exit 0
fi

echo "✅ Found users in database" >&2
echo "" >&2

# Process each user
while IFS='|' read -r username uid; do
  [ -z "$username" ] && continue

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "👤 User: $username, UID: $uid" >&2

  if fix_user_permissions "$username" "$uid" "$DOCKER_GID"; then
    FIXED=$((FIXED + 1))
  else
    ERRORS=$((ERRORS + 1))
  fi

done <<< "$USERS"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "📊 Summary:" >&2
echo "  ✅ Fixed: $FIXED" >&2
echo "  ❌ Errors: $ERRORS" >&2
echo "" >&2

if [ $ERRORS -eq 0 ]; then
  echo "✅ All home directories are now using correct UIDs/GIDs" >&2
  exit 0
else
  echo "⚠️  Some directories could not be fixed" >&2
  exit 1
fi
