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
apt-get install -y libnss-extrausers postgresql-client libpam-script > /dev/null 2>&1
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
  -t -A -F: -c \
  "SELECT
    username,
    password_hash,
    CASE WHEN must_change_password THEN '0' ELSE '18000' END,
    '0',
    '99999',
    '7',
    '',
    '',
    ''
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
set -euo pipefail

source /etc/default/sssd-pgsql 2>/dev/null || exit 1

# Leer credenciales de PAM
read -r username
read -rs password

# Validar formato de usuario
if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  exit 1
fi

# Verificar que el usuario existe y está activo
PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c \
  "SELECT 1 FROM users WHERE username = '${username}' AND is_active = 1" \
  2>/dev/null | grep -q "1" || exit 1

# Verificar contraseña usando bcrypt
PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c \
  "SELECT CASE WHEN password_hash = crypt('${password}', password_hash) THEN 1 ELSE 0 END FROM users WHERE username = '${username}'" \
  2>/dev/null | grep -q "1" && exit 0 || exit 1
SCRIPT_EOF

chmod +x /usr/local/bin/pgsql-pam-auth.sh

# Crear configuración PAM
cat > /etc/pam.d/sssd-pgsql <<'PAM_EOF'
#%PAM-1.0
auth    required    pam_exec.so quiet /usr/local/bin/pgsql-pam-auth.sh
account required    pam_permit.so
password required   pam_permit.so
session optional    pam_mkhomedir.so skel=/etc/skel umask=0022
PAM_EOF

echo "   ✅ PAM configurado"

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
Description=Sync PostgreSQL users to local files
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/bash /usr/local/bin/generate_passwd_from_db.sh
ExecStart=/bin/bash /usr/local/bin/generate_shadow_from_db.sh
StandardOutput=journal
StandardError=journal
SERVICE_EOF

cat > /etc/systemd/system/pgsql-users-sync.timer <<'TIMER_EOF'
[Unit]
Description=Sync PostgreSQL users every 2 minutes
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

# pam_script busca el script de cambio de contraseña en /etc/pam-script.d/pam_script_passwd
mkdir -p /etc/pam-script.d
ln -sf /usr/local/bin/sync_password_change.sh /etc/pam-script.d/pam_script_passwd
chmod 755 /etc/pam-script.d/pam_script_passwd 2>/dev/null || true

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
  
  # Habilitar PAM y autenticación por contraseña
  sed -i 's/^#*UsePAM.*/UsePAM yes/' /etc/ssh/sshd_config
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
  
  # Agregar configuración para usar sssd-pgsql
  if ! grep -q "auth.*sssd-pgsql" /etc/pam.d/sshd; then
    sed -i '/^@include common-auth/a auth    [success=1 default=ignore]    pam_unix.so nullok\nauth    requisite                       pam_deny.so\nauth    required                        pam_permit.so\nauth    optional                        include=sssd-pgsql' /etc/pam.d/sshd
  fi
  
  # Configurar pam_mkhomedir para crear directorios home automáticamente
  if ! grep -q "pam_mkhomedir" /etc/pam.d/sshd; then
    sed -i '/session.*pam_env.so/a session    optional     pam_mkhomedir.so skel=/etc/skel umask=0022' /etc/pam.d/sshd
    echo "   ✅ pam_mkhomedir configurado para crear directorios home automáticamente"
  fi
  
  # Reiniciar SSH
  systemctl restart sshd || systemctl restart ssh
  echo "   ✅ SSH configurado y reiniciado"
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
  echo "   ✅ Timer de sincronización activo"
else
  echo "   ⚠️  Timer de sincronización no activo"
fi

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
echo ""
echo "⏰ Sincronización:"
echo "   • Automática cada 2 minutos"
echo "   • Manual: sudo systemctl start pgsql-users-sync.service"
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
