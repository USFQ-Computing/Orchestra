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

# pam_script.so puede exponer la nueva contraseña con distintos nombres
# según la versión/distribución de PAM/libpam-script.
PAM_STAGE="${PAM_TYPE:-unknown}"
NEW_PASSWORD="${PAM_AUTHTOK:-}"
if [ -z "$NEW_PASSWORD" ]; then
  NEW_PASSWORD="${PAM_NEWAUTHTOK:-}"
fi
if [ -z "$NEW_PASSWORD" ]; then
  NEW_PASSWORD="${PAM_NEW_AUTHTOK:-}"
fi
if [ -z "$NEW_PASSWORD" ] && [ -p /dev/stdin ]; then
  # Fallback defensivo: algunas pilas pasan el authtok por stdin.
  IFS= read -r -s -t 1 NEW_PASSWORD || true
fi

# Cargar configuración
source /etc/default/sssd-pgsql 2>/dev/null || {
  log "ERROR: Cannot load /etc/default/sssd-pgsql"
  exit 1
}

# Variables requeridas
SERVER_URL="${SERVER_URL:-http://localhost:8000}"
CLIENT_SECRET="${CLIENT_SECRET:-}"
CLIENT_HOSTNAME="${HOSTNAME:-$(hostname)}"

if [ -z "$CLIENT_SECRET" ]; then
  log "ERROR: CLIENT_SECRET is empty in /etc/default/sssd-pgsql"
  echo "Password sync to central server failed (missing client secret). Contact your administrator." >&2
  exit 1
fi

# PAM proporciona el username en PAM_USER
USERNAME="${PAM_USER}"

if [ -z "$USERNAME" ]; then
  log "ERROR: No username provided by PAM (PAM_USER not set)"
  exit 1
fi

log "INFO: passwd hook called for user='${USERNAME}' pam_type='${PAM_STAGE}' password_provided=$([ -n "$NEW_PASSWORD" ] && echo yes || echo no) authtok_len=${#PAM_AUTHTOK} newauthtok_len=${#PAM_NEWAUTHTOK} new_authtok_len=${#PAM_NEW_AUTHTOK}"

if [ -z "$NEW_PASSWORD" ]; then
  # El authtok no está disponible aún (PAM_PRELIM_CHECK u otro evento).
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

DB_HASH_BEFORE=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c "SELECT password_hash FROM users WHERE username = '${USERNAME}' LIMIT 1" \
  < /dev/null 2>/dev/null || true)

SHADOW_HASH_BEFORE=""
if [ -r /var/lib/extrausers/shadow ]; then
  SHADOW_HASH_BEFORE=$(awk -F: -v u="$USERNAME" '$1==u{print $2}' /var/lib/extrausers/shadow)
fi

log "DEBUG: pre-sync hashes user='${USERNAME}' db_hash='${DB_HASH_BEFORE}' shadow_hash='${SHADOW_HASH_BEFORE}'"

if [ "$IS_DB_USER" != "1" ]; then
  # No es usuario de BD: dejar que pam_unix actualice /etc/shadow
  exit 1
fi

# Usuario gestionado por BD: propagar al servidor central
log "Password change detected for DB user: $USERNAME from host: $CLIENT_HOSTNAME"

REQUEST_URL="${SERVER_URL}/client-api/users/${USERNAME}/change-password"
log "INFO: Sending password sync request url='${REQUEST_URL}' host='${CLIENT_HOSTNAME}' client_secret_set=$([ -n "$CLIENT_SECRET" ] && echo yes || echo no)"

# Construir JSON de forma segura para soportar contraseñas con comillas,
# backslashes y otros caracteres especiales.
JSON_PAYLOAD=$(python3 - <<'PYTHON_EOF'
import json
import os

print(json.dumps({"new_password": os.environ.get("NEW_PASSWORD", "")}))
PYTHON_EOF
)

# Enviar al servidor central con trazas de red/HTTP
TMP_BODY_FILE=$(mktemp)
TMP_ERR_FILE=$(mktemp)

HTTP_CODE=$(curl -sS -m 15 -o "$TMP_BODY_FILE" -w "%{http_code}" -X POST "$REQUEST_URL" \
  -H "Content-Type: application/json" \
  -H "X-Client-Host: ${CLIENT_HOSTNAME}" \
  -H "X-Client-Secret: ${CLIENT_SECRET}" \
  -d "$JSON_PAYLOAD" 2>"$TMP_ERR_FILE")
CURL_EXIT=$?

BODY=$(cat "$TMP_BODY_FILE")
CURL_ERR=$(cat "$TMP_ERR_FILE")
rm -f "$TMP_BODY_FILE" "$TMP_ERR_FILE"

log "INFO: Request finished curl_exit=${CURL_EXIT} http_code='${HTTP_CODE}' body='${BODY}' curl_err='${CURL_ERR}'"

if [ "$CURL_EXIT" -ne 0 ]; then
  log "ERROR: curl failed while syncing password for user='${USERNAME}'"
  echo "Password sync to central server failed (network error). Contact your administrator." >&2
  exit 1
fi

if [ "$HTTP_CODE" = "200" ]; then
  log "Password successfully synced to central server for user: $USERNAME"
  # Regenerar shadow local inmediatamente para no esperar al timer de 2 min
  /usr/local/bin/generate_shadow_from_db.sh >> "$LOGFILE" 2>&1 || true

  DB_HASH_AFTER=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${NSS_DB_USER}" \
    -d "${DB_NAME}" \
    -t -A -c "SELECT password_hash FROM users WHERE username = '${USERNAME}' LIMIT 1" \
    < /dev/null 2>/dev/null || true)

  SHADOW_HASH_AFTER=""
  if [ -r /var/lib/extrausers/shadow ]; then
    SHADOW_HASH_AFTER=$(awk -F: -v u="$USERNAME" '$1==u{print $2}' /var/lib/extrausers/shadow)
  fi

  log "DEBUG: post-sync hashes user='${USERNAME}' db_hash='${DB_HASH_AFTER}' shadow_hash='${SHADOW_HASH_AFTER}'"
  exit 0
else
  log "ERROR: Failed to sync password for user: $USERNAME (HTTP $HTTP_CODE): $BODY"
  echo "Password sync to central server failed. Contact your administrator." >&2
  # Fallar para que passwd reporte el error al usuario en lugar de silenciarlo
  exit 1
fi
