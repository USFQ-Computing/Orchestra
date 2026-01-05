#!/usr/bin/env bash
# Script simplificado para limpiar usuarios con grupos privilegiados
# El GID se asigna automáticamente por sync_docker_group.sh
# Ejecutar como: sudo bash fix_user_gid.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Limpieza de Permisos Privilegiados"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verificar que se ejecuta como root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Este script debe ejecutarse como root (sudo)"
  exit 1
fi

# Cargar configuración
source /etc/default/sssd-pgsql 2>/dev/null || {
  DB_HOST="localhost"
  DB_PORT="5433"
  DB_NAME="postgres"
  NSS_DB_USER="postgres"
  NSS_DB_PASSWORD="postgres"
}

echo "Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""

# Detectar GID de docker
if ! getent group docker > /dev/null 2>&1; then
  echo "❌ Grupo docker no existe. Instala Docker primero."
  exit 1
fi

DOCKER_GID=$(getent group docker | cut -d: -f3)
echo "📦 Docker GID detectado: $DOCKER_GID"
echo "   Los usuarios usarán este GID como grupo primario"
echo ""

# Obtener lista de usuarios
echo "🔍 Consultando usuarios activos..."
USERS=$(PGPASSWORD="${NSS_DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${NSS_DB_USER}" \
  -d "${DB_NAME}" \
  -t -A -c \
  "SELECT username FROM users WHERE is_active = 1 ORDER BY username" 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Error consultando usuarios"
  echo "Detalles: $USERS"
  exit 1
fi

if [ -z "$USERS" ]; then
  echo "ℹ️  No hay usuarios activos"
  exit 0
fi

echo "✅ Usuarios encontrados"
echo ""

FIXED=0
ALREADY_OK=0
NOT_EXIST=0
ERRORS=0

while IFS= read -r username; do
  [ -z "$username" ] && continue

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "👤 Usuario: $username"

  # Verificar si existe en el sistema
  if ! id "$username" > /dev/null 2>&1; then
    echo "  ⏭️  No existe en el sistema, se creará en próxima sync"
    NOT_EXIST=$((NOT_EXIST + 1))
    echo ""
    continue
  fi

  # Ver GID actual
  CURRENT_GID=$(id -g "$username")
  CURRENT_GROUP=$(id -gn "$username")
  echo "  📋 GID actual: $CURRENT_GID ($CURRENT_GROUP)"

  CLEANED=0

  # Cambiar GID a docker si no lo tiene
  if [ "$CURRENT_GID" -ne "$DOCKER_GID" ]; then
    echo "  🔄 Cambiando GID a $DOCKER_GID (docker)..."
    usermod -g "$DOCKER_GID" "$username" 2>/dev/null && {
      echo "  ✅ GID actualizado a docker"
      FIXED=$((FIXED + 1))
      CLEANED=1
    } || {
      echo "  ❌ Error cambiando GID"
      ERRORS=$((ERRORS + 1))
    }
  else
    echo "  ✅ GID correcto (docker)"
    ALREADY_OK=$((ALREADY_OK + 1))
  fi

  # Remover de grupo sudo
  if groups "$username" 2>/dev/null | grep -qw "sudo"; then
    deluser "$username" sudo 2>/dev/null && {
      echo "  🔒 Removido del grupo sudo"
      CLEANED=1
    } || {
      echo "  ⚠️  No se pudo remover de sudo"
    }
  fi

  # Remover de grupo admin (GID 2000)
  if groups "$username" 2>/dev/null | grep -qw "admin"; then
    deluser "$username" admin 2>/dev/null && {
      echo "  🔒 Removido del grupo admin"
      CLEANED=1
    } || {
      echo "  ⚠️  No se pudo remover de admin"
    }
  fi

  # Si el grupo primario es admin (GID 2000), cambiar a docker
  if [ "$CURRENT_GID" -eq 2000 ]; then
    echo "  ⚠️  Grupo primario es admin (GID 2000), cambiando a docker..."
    usermod -g "$DOCKER_GID" "$username" 2>/dev/null && {
      echo "  ✅ Cambiado de admin a docker"
      FIXED=$((FIXED + 1))
      CLEANED=1
    } || {
      echo "  ❌ Error cambiando grupo primario"
      ERRORS=$((ERRORS + 1))
    }
  fi

  if [ $CLEANED -eq 0 ] && [ "$CURRENT_GID" -eq "$DOCKER_GID" ]; then
    echo "  ✅ Usuario ya está limpio"
  fi

  # Mostrar grupos finales
  FINAL_GROUPS=$(groups "$username" 2>/dev/null | cut -d: -f2 | xargs)
  echo "  📋 Grupos finales: $FINAL_GROUPS"

  # Verificar sudo
  if sudo -l -U "$username" 2>&1 | grep -q "not allowed"; then
    echo "  ✅ Sin acceso sudo"
  else
    echo "  ⚠️  Podría tener acceso sudo (verificar)"
  fi

  echo ""

done <<< "$USERS"

# Resumen
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Resumen"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔧 Usuarios corregidos: $FIXED"
echo "  ✅ Ya estaban correctos: $ALREADY_OK"
echo "  ⏭️  No existen en sistema: $NOT_EXIST"
echo "  ❌ Errores: $ERRORS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -eq 0 ]; then
  echo "✅ Corrección completada exitosamente"
  echo ""
  echo "📝 Próximos pasos:"
  echo "  1. Ejecutar sync para asegurar todo:"
  echo "     sudo bash client/utils/sync_docker_group.sh"
  echo ""
  echo "  2. Verificar estado:"
  echo "     sudo ./check_user_permissions.sh"
  echo ""
  echo "  3. Usuarios deben hacer logout/login:"
  echo "     sudo pkill -u <username>"
else
  echo "⚠️  Corrección completada con $ERRORS error(es)"
fi

exit 0
