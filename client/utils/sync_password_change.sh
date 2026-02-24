#!/usr/bin/env bash
# Script ejecutado por PAM cuando un usuario cambia su contraseña vía passwd/SSH
# Si el usuario está en el sistema gestionado (DB local), sincroniza con el servidor central.
# Si el usuario es local (no está en la DB), permite el cambio sin sincronización.

# Cargar configuración
source /etc/default/sssd-pgsql 2>/dev/null || {
  echo "ERROR: Cannot load configuration from /etc/default/sssd-pgsql" >&2
  exit 1
}

# Variables requeridas
SERVER_URL="${SERVER_URL:-http://localhost:8000}"
CLIENT_HOSTNAME="${HOSTNAME:-$(hostname)}"

# DB connection settings (same defaults as the client service)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${NSS_DB_USER:-postgres}"
DB_PASS="${NSS_DB_PASSWORD:-postgres}"

# Log file
LOGFILE="/var/log/password_sync.log"

# Función para log
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

# PAM proporciona el username en PAM_USER
USERNAME="${PAM_USER}"

if [ -z "$USERNAME" ]; then
  log "ERROR: No username provided by PAM"
  exit 1
fi

# Leer la nueva contraseña desde stdin (PAM la proporciona)
read -rs NEW_PASSWORD

if [ -z "$NEW_PASSWORD" ]; then
  log "ERROR: No password provided for user $USERNAME"
  exit 1
fi

# ── Check if user is a managed system user ────────────────────────────────────
# Query the local PostgreSQL DB (populated by the central server sync).
# If psql is not available or the query fails, fall through and skip sync safely.
IS_MANAGED=0
if command -v psql >/dev/null 2>&1; then
  MANAGED_CHECK=$(PGPASSWORD="$DB_PASS" psql \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc "SELECT 1 FROM users WHERE username = '$USERNAME' AND is_active = 1 LIMIT 1;" \
    2>/dev/null)
  if [ "$MANAGED_CHECK" = "1" ]; then
    IS_MANAGED=1
  fi
fi

if [ "$IS_MANAGED" -eq 0 ]; then
  log "INFO: User '$USERNAME' is a local-only user — password changed locally, no sync needed"
  exit 0
fi

# ── Managed user: propagate to central server ─────────────────────────────────
log "Password change detected for managed user: $USERNAME from host: $CLIENT_HOSTNAME"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${SERVER_URL}/api/users/${USERNAME}/change-password-from-client" \
  -H "Content-Type: application/json" \
  -H "X-Client-Host: ${CLIENT_HOSTNAME}" \
  -d "{\"new_password\": \"${NEW_PASSWORD}\"}" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  log "Password successfully synced to central server for user: $USERNAME"
  echo "Password changed successfully and synced to all servers" >&2
  exit 0
else
  log "Failed to sync password for user: $USERNAME (HTTP $HTTP_CODE): $BODY"
  echo "Warning: password changed locally but sync to central server failed" >&2
  echo "   Contact your system administrator" >&2
  # Do not block the local password change
  exit 0
fi
