#!/usr/bin/env bash
# Script ejecutado por PAM cuando un usuario cambia su contraseña vía passwd/SSH
# Este script envía la nueva contraseña al servidor central para propagarla.
# Retorna 0 (success/sufficient) para usuarios de BD, 1 para usuarios locales
# (lo que permite que pam_unix maneje el cambio para usuarios locales del sistema).

# Log file (definido antes de todo para poder loguear fallos tempranos)
LOGFILE="/var/log/password_sync.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

# pam_script.so proporciona la nueva contraseña en la variable de entorno
# PAM_AUTHTOK durante el evento chauthtok (cambio de contraseña).
NEW_PASSWORD="${PAM_AUTHTOK:-}"

# Cargar configuración
source /etc/default/sssd-pgsql 2>/dev/null || {
  log "ERROR: Cannot load /etc/default/sssd-pgsql"
  exit 1
}

# Variables requeridas
SERVER_URL="${SERVER_URL:-http://localhost:8000}"
CLIENT_SECRET="${CLIENT_SECRET:-}"
CLIENT_HOSTNAME="${HOSTNAME:-$(hostname)}"

# PAM proporciona el username en PAM_USER
USERNAME="${PAM_USER}"

if [ -z "$USERNAME" ]; then
  log "ERROR: No username provided by PAM (PAM_USER not set)"
  exit 1
fi

log "INFO: passwd hook called for user='${USERNAME}' password_provided=$([ -n "$NEW_PASSWORD" ] && echo yes || echo no)"

if [ -z "$NEW_PASSWORD" ]; then
  # PAM_AUTHTOK no está disponible aún (PAM_PRELIM_CHECK u otro evento).
  # Salir 1 para que el resto del stack maneje este caso.
  exit 1
fi

# Verificar si el usuario pertenece a la BD local.
# Redirigir stdin de psql desde /dev/null para que no consuma el pipe de PAM.
IS_DB_USER=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c \
  "SELECT 1 FROM users WHERE username = '${USERNAME}' AND is_active = 1" \
  < /dev/null 2>/dev/null)

log "INFO: IS_DB_USER='${IS_DB_USER}' for user='${USERNAME}'"

if [ "$IS_DB_USER" != "1" ]; then
  # No es usuario de BD: dejar que pam_unix actualice /etc/shadow
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

# Enviar al servidor central
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${SERVER_URL}/client-api/users/${USERNAME}/change-password" \
  -H "Content-Type: application/json" \
  -H "X-Client-Host: ${CLIENT_HOSTNAME}" \
  -H "X-Client-Secret: ${CLIENT_SECRET}" \
  -d "{\"new_password\": \"${NEW_PASSWORD}\"}" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  log "Password successfully synced to central server for user: $USERNAME"
  # Regenerar shadow local inmediatamente para no esperar al timer de 2 min
  /usr/local/bin/generate_shadow_from_db.sh >> "$LOGFILE" 2>&1 || true
  exit 0
else
  log "ERROR: Failed to sync password for user: $USERNAME (HTTP $HTTP_CODE): $BODY"
  echo "Password sync to central server failed. Contact your administrator." >&2
  # Fallar para que passwd reporte el error al usuario en lugar de silenciarlo
  exit 1
fi
