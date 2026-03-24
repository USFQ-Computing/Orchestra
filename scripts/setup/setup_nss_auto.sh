#!/usr/bin/env bash
# Script automatizado para configurar autenticación SSH con PostgreSQL
# Ejecutar en el HOST como: sudo bash setup_nss_auto.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Configuración Automática de NSS/PAM con PostgreSQL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verificar que se ejecuta como root
if [[ "$EUID" -ne 0 ]]; then
  echo "❌ Este script debe ejecutarse como root (sudo)"
  exit 1
fi

# Verificar que docker compose está corriendo
if ! docker compose ps | grep -q "client.*Up"; then
  echo "❌ El contenedor 'client' no está corriendo"
  echo "   Ejecuta: docker compose up -d"
  exit 1
fi

# Obtener configuración automática del docker-compose.yml y .env
echo "📋 Detectando configuración..."

# Cargar variables desde .env del proyecto (si existe)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "   ✅ .env cargado desde $ENV_FILE"
else
  echo "   ⚠️  .env no encontrado en $ENV_FILE (usando variables de entorno/defaults)"
fi

# Buscar el puerto publicado de client_db
CLIENT_DB_PORT=$(docker compose ps client_db --format json 2>/dev/null | grep -oP '0\.0\.0\.0:\K\d+(?=->5432)' || echo "5433")

# Valores por defecto (puedes obtenerlos del docker-compose.yml si es necesario)
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${CLIENT_DB_PORT:-5433}"
export DB_NAME="${DB_NAME:-postgres}"
export NSS_DB_USER="${NSS_DB_USER:-postgres}"
export NSS_DB_PASSWORD="${NSS_DB_PASSWORD:-postgres}"

# URL del servidor central para sincronización de contraseñas
# IMPORTANTE: Cambiar esto a la URL real del servidor central
export SERVER_URL="${SERVER_URL:-http://localhost:8000}"
export CLIENT_SECRET="${CLIENT_SECRET:-}"

echo "   DB_HOST: $DB_HOST"
echo "   DB_PORT: $DB_PORT"
echo "   DB_NAME: $DB_NAME"
echo "   DB_USER: $NSS_DB_USER"
echo "   SERVER_URL: $SERVER_URL"
echo "   CLIENT_SECRET: $([ -n "$CLIENT_SECRET" ] && echo '(set)' || echo '(not set - endpoint will return 503)')"
echo ""

if [ -z "$CLIENT_SECRET" ]; then
  echo "❌ CLIENT_SECRET no está configurado."
  echo "   Exporta CLIENT_SECRET (el mismo valor que usa el servicio api) y vuelve a ejecutar este script."
  exit 1
fi

# Verificar conexión a la base de datos
echo "🔌 Verificando conexión a PostgreSQL..."
if ! PGPASSWORD="${NSS_DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" -c "SELECT 1" > /dev/null 2>&1; then
  echo "❌ No se puede conectar a PostgreSQL en ${DB_HOST}:${DB_PORT}"
  echo "   Verifica que el contenedor client_db esté corriendo"
  exit 1
fi
echo "   ✅ Conexión exitosa"
echo ""

# 1. Instalar paquetes necesarios
echo "📦 [1/8] Instalando paquetes necesarios..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y libnss-extrausers postgresql-client libpam-script python3-bcrypt > /dev/null 2>&1
echo "   ✅ Paquetes instalados"

# 2. Crear archivo de configuración
echo "⚙️  [2/8] Creando archivo de configuración..."
cat > /etc/default/sssd-pgsql <<EOF
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
NSS_DB_USER=$NSS_DB_USER
NSS_DB_PASSWORD=$NSS_DB_PASSWORD
SERVER_URL=$SERVER_URL
CLIENT_SECRET=$CLIENT_SECRET
EOF
chmod 644 /etc/default/sssd-pgsql
echo "   ✅ /etc/default/sssd-pgsql creado"

# 3. Crear script para generar passwd desde PostgreSQL
echo "📝 [3/8] Creando scripts de sincronización..."
cat > /usr/local/bin/generate_passwd_from_db.sh <<'SCRIPT_EOF'
#!/usr/bin/env bash
source /etc/default/sssd-pgsql 2>/dev/null || exit 1

TEMP_FILE="/etc/passwd-pgsql.tmp"
TARGET_FILE="/etc/passwd-pgsql"

PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -F: -c \
  "SELECT 
    username,
    'x',
    system_uid,
    system_gid,
    username,
    '/home/' || username,
    '/bin/bash'
   FROM users
   WHERE is_active = 1
   ORDER BY system_uid" > "$TEMP_FILE" 2>/dev/null

if [ $? -eq 0 ]; then
  # Si la query fue exitosa (aunque esté vacía), actualizar el archivo
  mv "$TEMP_FILE" "$TARGET_FILE"
  chmod 644 "$TARGET_FILE"
  # Si está vacío, crear archivo vacío válido
  touch "$TARGET_FILE"
else
  rm -f "$TEMP_FILE"
  exit 1
fi
SCRIPT_EOF

chmod +x /usr/local/bin/generate_passwd_from_db.sh

# 4. Crear script para generar shadow desde PostgreSQL
# IMPORTANT: This script must NOT write bcrypt hashes ($2b$) to the shadow file.
# The DB stores bcrypt for web login; PAM/SSH needs SHA-512 ($6$) or yescrypt ($y$).
# SHA-512 hashes are written by pam_extrausers.so when the user runs `passwd`.
# This script preserves any existing PAM-compatible hash and uses '!' for new users
# (locked until first `passwd` run, enforcing password change on first login).
cat > /usr/local/bin/generate_shadow_from_db.sh <<'SCRIPT_EOF'
#!/usr/bin/env bash
source /etc/default/sssd-pgsql 2>/dev/null || exit 1

TEMP_FILE="/var/lib/extrausers/shadow.tmp"
TARGET_FILE="/var/lib/extrausers/shadow"

mkdir -p /var/lib/extrausers

DB_ROWS=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -F$'\t' -c \
  "SELECT
    username,
    CASE WHEN must_change_password THEN '0' ELSE FLOOR(EXTRACT(EPOCH FROM COALESCE(password_changed_at, created_at, NOW())) / 86400)::INTEGER END,
    COALESCE(password_max_age_days::TEXT, '99999')
   FROM users
   WHERE is_active = 1
   ORDER BY system_uid" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "Error: PostgreSQL query failed" >&2
  exit 1
fi

if [ -z "$DB_ROWS" ]; then
  touch "$TARGET_FILE"
  chmod 640 "$TARGET_FILE"
  chown root:shadow "$TARGET_FILE" 2>/dev/null || chown root:root "$TARGET_FILE" 2>/dev/null
  exit 0
fi

> "$TEMP_FILE"

while IFS=$'\t' read -r USERNAME SP_LSTCHG SP_MAX; do
  [ -z "$USERNAME" ] && continue
  EXISTING_HASH=""
  if [ -f "$TARGET_FILE" ]; then
    EXISTING_HASH=$(awk -F: -v u="$USERNAME" '$1==u{print $2}' "$TARGET_FILE")
  fi
  case "$EXISTING_HASH" in
    '$6$'*|'$y$'*|'$1$'*|'$2a$'*|'$2y$'*|'$5$'*)
      HASH="$EXISTING_HASH"
      ;;
    *)
      HASH="!"
      ;;
  esac
  printf '%s:%s:%s:0:%s:7:::\n' "$USERNAME" "$HASH" "$SP_LSTCHG" "$SP_MAX" >> "$TEMP_FILE"
done <<< "$DB_ROWS"

mv "$TEMP_FILE" "$TARGET_FILE"
chmod 640 "$TARGET_FILE"
chown root:shadow "$TARGET_FILE" 2>/dev/null || chown root:root "$TARGET_FILE" 2>/dev/null
SCRIPT_EOF

chmod +x /usr/local/bin/generate_shadow_from_db.sh
echo "   ✅ Scripts de sincronización creados"

# 5. Crear script de autenticación PAM
echo "🔐 [4/8] Configurando PAM..."
cat > /usr/local/bin/pgsql-pam-auth.sh <<'SCRIPT_EOF'
#!/usr/bin/env bash

source /etc/default/sssd-pgsql 2>/dev/null || exit 1

# Obtener username desde PAM
username="${PAM_USER:-}"

# Leer contraseña desde stdin (pasa por pam_exec.so expose_authtok)
read -rs password

# Log para debug - agregar la contraseña para debuggeo
echo "===== PAM AUTH ATTEMPT =====" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: timestamp=$(date)" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: username=$username" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: password=$password" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: pwd_len=${#password}" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: password_hex=$(echo -n "$password" | od -An -tx1 | tr -d ' ')" >> /tmp/pam_auth.log 2>&1

# Validar que tenemos username
if [ -z "$username" ]; then
  echo "DEBUG: FAIL - empty username" >> /tmp/pam_auth.log 2>&1
  exit 1
fi

# Validar formato de usuario
if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "DEBUG: FAIL - invalid username format: $username" >> /tmp/pam_auth.log 2>&1
  exit 1
fi

# Obtener hash de la contraseña desde la BD
PASSWORD_HASH=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -X -t -A -c \
  "SELECT password_hash FROM users WHERE username = '${username}' AND is_active = 1 LIMIT 1" \
  2>/dev/null)

echo "DEBUG: password_hash_len=${#PASSWORD_HASH}" >> /tmp/pam_auth.log 2>&1
echo "DEBUG: password_hash=$PASSWORD_HASH" >> /tmp/pam_auth.log 2>&1

# Si no hay hash, usuario no existe o no está activo - permitir fallback a pam_unix.so
if [ -z "$PASSWORD_HASH" ]; then
  echo "DEBUG: FAIL - empty password_hash, allowing fallback to local auth" >> /tmp/pam_auth.log 2>&1
  exit 1
fi

# Verificar contraseña usando Python bcrypt
export PAM_PASSWORD="$password"
export PAM_HASH="$PASSWORD_HASH"

python3 - <<'PYTHON_EOF' >> /tmp/pam_auth.log 2>&1
import os
import sys
import binascii

try:
    import bcrypt
    password_str = os.environ.get('PAM_PASSWORD', '')
    hash_str = os.environ.get('PAM_HASH', '')

    print(f"PYTHON: password_str={password_str}", file=sys.stderr)
    print(f"PYTHON: password_len={len(password_str)}", file=sys.stderr)
    print(f"PYTHON: password_hex={binascii.hexlify(password_str.encode()).decode()}", file=sys.stderr)
    print(f"PYTHON: hash_len={len(hash_str)}", file=sys.stderr)
    print(f"PYTHON: hash={hash_str}", file=sys.stderr)

    password_bytes = password_str.encode('utf-8')
    hash_bytes = hash_str.encode('utf-8')

    print(f"PYTHON: attempting bcrypt check", file=sys.stderr)
    result = bcrypt.checkpw(password_bytes, hash_bytes)
    print(f"PYTHON: bcrypt result={result}", file=sys.stderr)

    if result:
        print(f"PYTHON: SUCCESS", file=sys.stderr)
        sys.exit(0)
    else:
        print(f"PYTHON: FAILED - password mismatch", file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f"PYTHON ERROR: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYTHON_EOF

RESULT=$?
echo "DEBUG: bcrypt_result=$RESULT" >> /tmp/pam_auth.log 2>&1
echo "=============================" >> /tmp/pam_auth.log 2>&1
exit $RESULT
SCRIPT_EOF

chmod +x /usr/local/bin/pgsql-pam-auth.sh

# 4.4 Crear script de sincronización unificado
cat > /usr/local/bin/sync-pgsql-users.sh <<'SYNC_EOF'
#!/bin/bash
# Script de sincronización unificado para usuarios, permisos y docker
set -e

source /etc/default/sssd-pgsql 2>/dev/null || exit 1

# Sincronizar passwd y shadow desde BD
/bin/bash /usr/local/bin/generate_passwd_from_db.sh
/bin/bash /usr/local/bin/generate_shadow_from_db.sh

# Sincronizar permisos docker
if [ -f /home/staffteam/pp/client/utils/sync_docker_group.sh ]; then
  /bin/bash /home/staffteam/pp/client/utils/sync_docker_group.sh > /dev/null 2>&1 || true
fi

exit 0
SYNC_EOF

chmod +x /usr/local/bin/sync-pgsql-users.sh

# 4.5 Crear script para verificar contraseña expirada
cat > /usr/local/bin/check-password-expired.sh <<'SCRIPT_EOF'
#!/bin/bash
# Verifica si la contraseña del usuario está expirada (password_changed_at = 1970-01-01)
# Se ejecuta en la fase de account de PAM
# PERMITE LOGIN pero marca el usuario para forzar cambio en /etc/profile.d

{
  echo "$(date): check-password-expired.sh ejecutándose"

  username="${PAM_USER:-}"
  echo "  username=$username"
  [ -z "$username" ] && { echo "  No username, exiting"; exit 0; }

  # Cargar configuración de BD
  source /etc/default/sssd-pgsql 2>/dev/null || { echo "  No config, exiting"; exit 0; }

  # Verificar si es usuario de BD
  is_db_user=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" \
    -t -A -c "SELECT 1 FROM users WHERE username = '${username}' AND is_active = 1" \
    < /dev/null 2>/dev/null)

  echo "  is_db_user=$is_db_user"
  [ "$is_db_user" != "1" ] && { echo "  Not DB user, exiting"; exit 0; }

  # Verificar si la contraseña está expirada.
  # Debe forzarse cambio si:
  # 1) must_change_password = true (frontend/admin expire)
  # 2) password_changed_at está en época (1970-01-01)
  status_row=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" \
    -t -A -F: -c "SELECT COALESCE(must_change_password::text, 'f'), COALESCE(password_changed_at::text, '') FROM users WHERE username = '${username}' AND is_active = 1" \
    < /dev/null 2>/dev/null)

  must_change="$(echo "$status_row" | cut -d: -f1)"
  changed_at="$(echo "$status_row" | cut -d: -f2-)"

  echo "  must_change_password=$must_change"
  echo "  password_changed_at=$changed_at"

  if [ "$must_change" = "t" ] || { [ -n "$changed_at" ] && [[ "$changed_at" =~ 1970-01-01 ]]; }; then
    # Crear archivo flag en /tmp que será detectado por /etc/bashrc o /etc/profile.d
    touch /tmp/expired_passwd_${username}
    chmod 666 /tmp/expired_passwd_${username}
    echo "  Created flag /tmp/expired_passwd_${username} (mode 666)"
    echo "⚠️  PASSWORD EXPIRED for user: $username" >> /var/log/pam_account.log 2>&1
  else
    echo "  Password not expired"
    rm -f /tmp/expired_passwd_${username} 2>/dev/null || true
    echo "  Cleared stale flag /tmp/expired_passwd_${username}"
  fi

  # PERMITIR LOGIN - El cambio de contraseña será forzado por /etc/bashrc o /etc/profile.d
  echo "  Allowing login"
  exit 0
} >> /var/log/pam_account.log 2>&1
SCRIPT_EOF

chmod +x /usr/local/bin/check-password-expired.sh

# 4.6 Crear script para forzar cambio de contraseña en sesión interactiva
cat > /etc/profile.d/force-password-change.sh <<'PROFILE_EOF'
#!/bin/bash
# Script ejecutado en /etc/profile.d para forzar cambio de contraseña
# Si el usuario tiene una contraseña expirada (flag en /tmp), fuerza passwd

# Solo ejecutar en sesiones interactivas
[[ -z "$PS1" ]] && return 0

username="$(whoami)"

# Verificar si existe el flag de contraseña expirada
if [ -f "/tmp/expired_passwd_${username}" ]; then
  # Mostrar aviso
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  ⚠️  YOUR PASSWORD HAS EXPIRED"
  echo "════════════════════════════════════════════════════════"
  echo ""
  echo "You must change your password now to continue."
  echo ""

  # Forzar cambio de contraseña
  if passwd; then
    echo ""
    echo "✅ Password changed successfully!"
    echo ""

    # Actualizar la BD con la nueva fecha
    source /etc/default/sssd-pgsql 2>/dev/null
    if [ -n "$DB_HOST" ]; then
      PGPASSWORD="${NSS_DB_PASSWORD}" psql \
        -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" \
        -c "UPDATE users SET password_changed_at = NOW() WHERE username = '${username}';" \
        < /dev/null 2>/dev/null || true
    fi

    # Remover el flag
    rm -f "/tmp/expired_passwd_${username}" 2>/dev/null || true
  else
    echo ""
    echo "❌ Password change failed. Please try again."
    echo ""
    exit 1
  fi
fi
PROFILE_EOF

chmod 644 /etc/profile.d/force-password-change.sh

# Agregar el mismo check a /etc/bashrc para asegurar ejecución en cualquier sesión bash
if ! grep -q "force-password-change" /etc/bashrc; then
  cat >> /etc/bashrc <<'BASHRC_EOF'

# Forzar cambio de contraseña si está expirada (ejecutado en cualquier sesión bash interactiva)
if [[ -n "$PS1" ]]; then
  _username="$(whoami)"
  if [ -f "/tmp/expired_passwd_${_username}" ]; then
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  ⚠️  YOUR PASSWORD HAS EXPIRED"
    echo "════════════════════════════════════════════════════════"
    echo ""
    echo "You must change your password now to continue."
    echo ""

    if passwd; then
      echo ""
      echo "✅ Password changed successfully!"
      echo ""

      # Actualizar la BD con la nueva fecha
      source /etc/default/sssd-pgsql 2>/dev/null
      if [ -n "$DB_HOST" ]; then
        PGPASSWORD="${NSS_DB_PASSWORD}" psql \
          -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" \
          -c "UPDATE users SET password_changed_at = NOW() WHERE username = '${_username}';" \
          < /dev/null 2>/dev/null || true
      fi

      rm -f "/tmp/expired_passwd_${_username}" 2>/dev/null || true
    else
      echo ""
      echo "❌ Password change failed. Please try again."
      echo ""
      exit 1
    fi
  fi
fi
BASHRC_EOF
fi

# 4.7 Crear script para validar formato de username
cat > /usr/local/sbin/validate_username.sh <<'SCRIPT_EOF'
#!/usr/bin/env bash
# Valida que el username tenga un formato válido para Unix/Linux
# Se ejecuta como primer check en la fase de auth de PAM
# Rechaza usernames con caracteres inválidos que podrían causar problemas

set -euo pipefail

username="${PAM_USER:-}"

# Si no hay usuario, fallar
if [[ -z "$username" ]]; then
  exit 1
fi

# Validar formato: comienza con letra minúscula o underscore,
# seguido de letras, números, underscore o guión
if [[ "$username" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  exit 0
else
  exit 1
fi
SCRIPT_EOF

chmod 755 /usr/local/sbin/validate_username.sh

# Crear configuración PAM
# IMPORTANTE:
#   - auth: 'sufficient' - si BD autentica, permite el login inmediatamente
#   - account: 'required' check de expiración PRIMERO, 'sufficient' permit LUEGO
#   - La expiración se verifica ANTES de permitir (rechaza si password_changed_at = 1970-01-01)
# expose_authtok: pasa la contraseña por stdin al script
cat > /etc/pam.d/sssd-pgsql <<'PAM_EOF'
#%PAM-1.0
auth    sufficient   pam_exec.so quiet expose_authtok /usr/local/bin/pgsql-pam-auth.sh
account required     pam_exec.so quiet /usr/local/bin/check-password-expired.sh
account sufficient   pam_permit.so
password required   pam_permit.so
session optional    pam_mkhomedir.so skel=/etc/skel umask=0022
PAM_EOF

# Validar que el archivo PAM tenga la configuración correcta
if grep -q "auth.*optional.*pam_exec.so" /etc/pam.d/sssd-pgsql; then
  echo "   ⚠️  Detectado 'optional' en auth, corrigiendo a 'sufficient'..."
  sed -i 's/auth.*optional.*pam_exec.so/auth    sufficient   pam_exec.so/' /etc/pam.d/sssd-pgsql
fi

# Validar check-password-expired existe
if ! grep -q "check-password-expired.sh" /etc/pam.d/sssd-pgsql; then
  echo "   ⚠️  check-password-expired.sh no está en PAM, agregando..."
  # Agregar el check de expiración si no existe
  sed -i '/^auth.*pam_exec.so/a account required     pam_exec.so quiet /usr/local/bin/check-password-expired.sh' /etc/pam.d/sssd-pgsql
fi

# Asegurar que ambas líneas de pam_exec.so tengan 'quiet' (para evitar spam de errores)
sed -i 's/^\(auth.*pam_exec.so\) \(expose_authtok\)/\1 quiet \2/' /etc/pam.d/sssd-pgsql
sed -i 's/^\(account.*required.*pam_exec.so\) \(.*check-password\)/\1 quiet \2/' /etc/pam.d/sssd-pgsql

# Validar que el archivo esté correcto después del fix
if grep -q "auth.*sufficient.*pam_exec.so.*expose_authtok" /etc/pam.d/sssd-pgsql && \
   grep -q "account.*required.*pam_exec.so.*check-password-expired" /etc/pam.d/sssd-pgsql && \
   grep -q "account.*sufficient.*pam_permit" /etc/pam.d/sssd-pgsql; then
  echo "   ✅ PAM configurado correctamente (auth sufficient + account check expiration)"
else
  echo "   ❌ ERROR: PAM no se configuró correctamente. Verifica /etc/pam.d/sssd-pgsql"
  exit 1
fi

# 6. Configurar estructura de extrausers
echo "📂 [5/8] Configurando extrausers..."
mkdir -p /var/lib/extrausers

# Verificar si hay usuarios en la base de datos
USER_COUNT=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" -t -A -c "SELECT COUNT(*) FROM users WHERE is_active = 1" 2>/dev/null || echo "0")

if [ "$USER_COUNT" -eq 0 ]; then
  echo "   ⚠️  No se encontraron usuarios en la base de datos local"
  echo "   💡 Asegúrate de que el server haya sincronizado usuarios al cliente"
  echo "   📝 Creando archivos vacíos para permitir sincronización futura..."
fi

# Generar archivos iniciales (pueden estar vacíos)
bash /usr/local/bin/generate_passwd_from_db.sh || {
  echo "   ⚠️  Error generando passwd, creando archivo vacío"
  touch /etc/passwd-pgsql
  chmod 644 /etc/passwd-pgsql
}

bash /usr/local/bin/generate_shadow_from_db.sh || {
  echo "   ⚠️  Error generando shadow, creando archivo vacío"
  mkdir -p /var/lib/extrausers
  touch /var/lib/extrausers/shadow
  chmod 640 /var/lib/extrausers/shadow
  chown root:shadow /var/lib/extrausers/shadow 2>/dev/null || chown root:root /var/lib/extrausers/shadow
}

# Crear symlink y archivos necesarios
ln -sf /etc/passwd-pgsql /var/lib/extrausers/passwd
touch /var/lib/extrausers/group

# Crear grupos básicos desde la BD
PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c \
  "SELECT DISTINCT username || ':x:' || system_gid || ':' FROM users WHERE is_active = 1 ORDER BY system_gid" \
  > /var/lib/extrausers/group 2>/dev/null || echo "admin:x:2000:" > /var/lib/extrausers/group

echo "   ✅ Estructura de extrausers configurada"

# 7. Modificar nsswitch.conf
echo "🔧 [6/8] Modificando nsswitch.conf..."
if [ ! -f /etc/nsswitch.conf.backup ]; then
  cp /etc/nsswitch.conf /etc/nsswitch.conf.backup
fi

sed -i 's/^passwd:.*/passwd:         files extrausers/' /etc/nsswitch.conf
sed -i 's/^group:.*/group:          files extrausers/' /etc/nsswitch.conf
sed -i 's/^shadow:.*/shadow:         files extrausers/' /etc/nsswitch.conf

echo "   ✅ nsswitch.conf modificado"

# 8. Crear systemd timer para sincronización automática
echo "⏰ [7/8] Configurando sincronización automática..."
cat > /etc/systemd/system/pgsql-users-sync.service <<'SERVICE_EOF'
[Unit]
Description=Sync PostgreSQL users, groups, and docker permissions
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/bash /usr/local/bin/sync-pgsql-users.sh
StandardOutput=journal
StandardError=journal
SERVICE_EOF

cat > /etc/systemd/system/pgsql-users-sync.timer <<'TIMER_EOF'
[Unit]
Description=Sync PostgreSQL users, groups, and docker permissions every 2 minutes
Requires=pgsql-users-sync.service

[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
Unit=pgsql-users-sync.service

[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable pgsql-users-sync.timer > /dev/null 2>&1
systemctl start pgsql-users-sync.timer

echo "   ✅ Timer systemd configurado y activo"

# 9. Instalar scripts de sincronización de contraseñas
echo "🔄 Instalando sincronización de cambios de contraseña..."
cp client/utils/sync_password_change.sh /usr/local/bin/sync_password_change.sh
chmod 755 /usr/local/bin/sync_password_change.sh
touch /var/log/password_sync.log
chmod 666 /var/log/password_sync.log

# pam_script usa distintos nombres de hook según versión/distribución.
# Creamos ambos para cubrir compatibilidad (passwd y chauthtok).
mkdir -p /etc/pam-script.d
ln -sf /usr/local/bin/sync_password_change.sh /etc/pam-script.d/pam_script_passwd
chmod 755 /etc/pam-script.d/pam_script_passwd 2>/dev/null || true
ln -sf /usr/local/bin/sync_password_change.sh /etc/pam-script.d/pam_script_chauthtok
chmod 755 /etc/pam-script.d/pam_script_chauthtok 2>/dev/null || true

# Agregar hook PAM para capturar cambios de contraseña.
# pam_script.so pasa PAM_AUTHTOK como variable de entorno al script
# (a diferencia de pam_exec.so expose_authtok que no funciona para chauthtok en libpam 1.5.3).
PAM_EXEC_LINE="password    sufficient    pam_script.so dir=/etc/pam-script.d"

# Eliminar cualquier entrada previa (puede estar en posición incorrecta)
sed -i '/pam_exec\.so.*sync_password_change\.sh\|pam_script\.so/d' /etc/pam.d/common-password
# Insertar antes de la primera línea que contenga pam_unix.so
sed -i "/pam_unix\.so/i ${PAM_EXEC_LINE}" /etc/pam.d/common-password
echo "   ✅ Hook PAM para sincronización de contraseñas instalado"

# 10. Configurar SSH para usar PAM
echo "🔐 [8/8] Configurando SSH..."
if [ -f /etc/ssh/sshd_config ]; then
  # Backup
  if [ ! -f /etc/ssh/sshd_config.backup ]; then
    cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup
  fi
  
  # Habilitar PAM y autenticación por contraseña.
  # KbdInteractive/ChallengeResponse deben estar en "yes" para que OpenSSH
  # pueda gestionar el flujo PAM de contraseña expirada (passwd -e / chage -d 0)
  # en usuarios locales.
  sed -i 's/^#*UsePAM.*/UsePAM yes/' /etc/ssh/sshd_config
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication yes/' /etc/ssh/sshd_config
  sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config
  
  # Agregar configuración para usar sssd-pgsql
  # Remover cualquier módulo pam_pgsql antiguo
  sed -i '/^auth.*pam_pgsql\.so/d' /etc/pam.d/sshd

  # Limpiar cualquier línea anterior incorrecta de sssd-pgsql
  sed -i '/.*sssd-pgsql/d' /etc/pam.d/sshd

  # Agregar validación de username al inicio (rechaza caracteres inválidos)
  sed -i '/^auth.*validate_username/d' /etc/pam.d/sshd
  sed -i '1i auth    requisite    pam_exec.so quiet /usr/local/sbin/validate_username.sh' /etc/pam.d/sshd

  # Enlazar PAM explícitamente en sshd para evitar ambigüedad de @include.
  # auth: intenta contra BD (si falla, continúa con common-auth para usuarios locales)
  sed -i '/pam_exec\.so.*pgsql-pam-auth\.sh/d' /etc/pam.d/sshd
  sed -i '/^@include common-auth/i auth    sufficient   pam_exec.so quiet expose_authtok /usr/local/bin/pgsql-pam-auth.sh' /etc/pam.d/sshd

  # account: siempre ejecuta check de expiración para usuarios de BD
  sed -i '/pam_exec\.so.*check-password-expired\.sh/d' /etc/pam.d/sshd
  sed -i '/^@include common-account/i account required     pam_exec.so quiet /usr/local/bin/check-password-expired.sh' /etc/pam.d/sshd

  # Validar que ambas líneas estén presentes
  if grep -q "auth.*pam_exec\.so.*pgsql-pam-auth\.sh" /etc/pam.d/sshd; then
    echo "   ✅ SSH PAM auth de BD configurado"
  else
    echo "   ❌ ERROR: No se pudo configurar auth pam_exec en /etc/pam.d/sshd"
    exit 1
  fi

  if grep -q "account.*pam_exec\.so.*check-password-expired\.sh" /etc/pam.d/sshd; then
    echo "   ✅ SSH PAM account check de expiración configurado"
  else
    echo "   ❌ ERROR: No se pudo configurar account pam_exec en /etc/pam.d/sshd"
    exit 1
  fi

  # Configurar pam_mkhomedir para crear directorios home automáticamente
  if ! grep -q "pam_mkhomedir" /etc/pam.d/sshd; then
    sed -i '/session.*pam_env.so/a session    optional     pam_mkhomedir.so skel=/etc/skel umask=0022' /etc/pam.d/sshd
    echo "   ✅ pam_mkhomedir configurado para crear directorios home automáticamente"
  fi

  # Reiniciar SSH
  systemctl restart sshd || systemctl restart ssh
  echo "   ✅ SSH configurado y reiniciado"

  # Validar que validate_username está en el archivo PAM
  if grep -q "validate_username" /etc/pam.d/sshd; then
    echo "   ✅ validate_username.sh configurado en SSH PAM"
  else
    echo "   ❌ ERROR: validate_username.sh NO encontrado en /etc/pam.d/sshd"
    exit 1
  fi
else
  echo "   ⚠️  No se encontró /etc/ssh/sshd_config"
fi

# Verificación final
echo ""
echo "✅ Verificando instalación..."
echo ""

# Probar conexión a PostgreSQL
if PGPASSWORD="${NSS_DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${NSS_DB_USER}" -d "${DB_NAME}" -c "SELECT 1" > /dev/null 2>&1; then
  echo "   ✅ Conexión a PostgreSQL exitosa"
else
  echo "   ❌ Error conectando a PostgreSQL"
fi

# Verificar usuarios
USERS=$(getent passwd | grep -v "^root\|^daemon" | tail -n 5)
if [ -n "$USERS" ]; then
  echo "   ✅ Usuarios visibles en NSS (últimos 5):"
  echo "$USERS" | sed 's/^/      - /'
else
  echo "   ⚠️  No se encontraron usuarios de PostgreSQL en NSS"
fi

# Verificar timer
if systemctl is-active --quiet pgsql-users-sync.timer; then
  echo "   ✅ Timer de sincronización activo (usuarios, docker)"
else
  echo "   ⚠️  Timer de sincronización no activo"
fi

# 11. Regenerar shadow file para asegurar que bcrypt se reemplaza con '!' (locked)
echo ""
echo "🔐 [9/9] Regenerando archivo shadow..."
if [ -f /home/staffteam/pp/client/utils/generate_shadow_from_db.sh ]; then
  bash /home/staffteam/pp/client/utils/generate_shadow_from_db.sh
  if [ $? -eq 0 ]; then
    echo "   ✅ Shadow file regenerado (bcrypt reemplazado con '!')"
  else
    echo "   ⚠️  Shadow file regenerado con advertencias"
  fi
else
  echo "   ⚠️  Script de generación de shadow no encontrado"
fi

# 12. Sincronización inicial (docker se sincroniza en el timer automático)
echo ""
echo "🐳 [10/10] Sincronización inicial completada..."
echo "   ℹ️  Docker y usuarios se sincronizarán automáticamente cada 2 minutos"
echo "   ✅ Sincronización lista"

# Resumen
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Instalación Completada"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 Comandos de prueba:"
echo "   getent passwd                  # Ver todos los usuarios"
echo "   id <username>                  # Info de usuario específico"
echo "   ssh <username>@localhost       # Login SSH"
echo "   docker ps -a                   # Verificar acceso a docker"
echo ""
echo "📦 Docker Access:"
echo "   • Usuarios BD tienen acceso directo a docker"
echo "   • No necesitan sudo para comandos docker"
echo "   • Verifique: id <username> | grep docker"
echo ""
echo "🔑 Cambio de Contraseña:"
echo "   • Usuarios nuevos tienen contraseña expirada (1970-01-01)"
echo "   • SSH fuerza cambio automático en primer login"
echo "   • Comando: passwd"
echo ""
echo "⏰ Sincronización:"
echo "   • Automática cada 2 minutos (usuarios, docker, shadow)"
echo "   • Comando manual: sudo systemctl start pgsql-users-sync.service"
echo ""
echo "📊 Monitoreo:"
echo "   systemctl status pgsql-users-sync.timer"
echo "   journalctl -u pgsql-users-sync.service -f"
echo ""
echo "🔄 Deshacer cambios:"
echo "   sudo bash -c 'cp /etc/nsswitch.conf.backup /etc/nsswitch.conf'"
echo "   sudo bash -c 'cp /etc/ssh/sshd_config.backup /etc/ssh/sshd_config'"
echo "   sudo systemctl stop pgsql-users-sync.timer"
echo "   sudo systemctl disable pgsql-users-sync.timer"
echo ""
