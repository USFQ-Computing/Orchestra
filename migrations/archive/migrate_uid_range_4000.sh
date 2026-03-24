#!/usr/bin/env bash
# Script de migración: Cambiar rango de UIDs de 2000 a 4000
# 
# Este script:
# 1. Renumera todos los UIDs existentes comenzando desde 4000
# 2. Se ejecuta en el servidor central (BD principal)
# 3. Automáticamente dispara sincronización con todos los clientes
#
# Uso: sudo bash {ruta}/migrate_uid_range_4000.sh
# O desde Python: python -m migrations.migrate_uid_range_4000

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Migración: Cambiar Rango de UIDs a partir de 4000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Detectar si se ejecuta desde script o desde Python
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Cargar configuración de BD (desde .env si existe)
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Variables de BD (con defaults)
DB_HOST="${DATABASE_URL_HOST:-localhost}"
DB_PORT="${DATABASE_URL_PORT:-5432}"
DB_NAME="${DATABASE_URL_DB:-mydb}"
DB_USER="${DATABASE_URL_USER:-postgres}"
DB_PASSWORD="${DATABASE_URL_PASSWORD:-postgres}"

echo "🔗 Conectando a: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""

# Verificar conexión a la BD
echo "🔍 Verificando conexión a la base de datos..."
PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -c "SELECT 1" > /dev/null 2>&1 || {
  echo "❌ Error: No se puede conectar a la base de datos"
  echo "   Host: ${DB_HOST}:${DB_PORT}"
  echo "   BD: ${DB_NAME}"
  exit 1
}
echo "✅ Conexión exitosa"
echo ""

# Contar usuarios actuales
echo "📊 Estado actual de usuarios:"
PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  << 'SQL'
SELECT 
  COUNT(*) as "Total de usuarios",
  MIN(system_uid) as "UID mínimo",
  MAX(system_uid) as "UID máximo"
FROM users;
SQL
echo ""

# Pedir confirmación
read -p "⚠️  ¿Continuar con la migración? Los UIDs se renumerarán comenzando desde 4000 (s/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
  echo "❌ Migración cancelada"
  exit 0
fi
echo ""

# Ejecutar migración
echo "🚀 Iniciando migración..."
echo ""

PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  << 'SQL'
BEGIN;

-- Crear tabla temporal con los nuevos UIDs
CREATE TEMP TABLE uid_mapping AS
SELECT 
  id,
  username,
  system_uid as old_uid,
  4000 + ROW_NUMBER() OVER (ORDER BY id) - 1 as new_uid
FROM users
WHERE is_active = 1
ORDER BY id;

-- Mostrar el mapeo de UIDs
\echo '📋 Mapeo de UIDs (antes -> después):'
SELECT 
  username,
  old_uid,
  new_uid,
  (new_uid - old_uid) as diferencia
FROM uid_mapping
ORDER BY id;

-- Actualizar los UIDs
UPDATE users
SET system_uid = uid_mapping.new_uid
FROM uid_mapping
WHERE users.id = uid_mapping.id;

-- Mostrar resultado
\echo ''
\echo '✅ Migración completada:'
SELECT 
  COUNT(*) as "Usuarios actualizados",
  MIN(system_uid) as "UID mínimo (nuevo)",
  MAX(system_uid) as "UID máximo (nuevo)"
FROM users;

COMMIT;
SQL

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Migración completada exitosamente"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📌 Próximos pasos:"
echo ""
echo "1️⃣  La sincronización con clientes se disparará automáticamente"
echo "   Espera a que se sincronicen (puede tomar unos minutos)"
echo ""
echo "2️⃣  Verifica en los clientes:"
echo "   cat /etc/passwd-pgsql | grep -E '^[a-z]' | awk -F: '{print \$1, \$3}'"
echo ""
echo "3️⃣  (Opcional) Ejecutar en cada cliente:"
echo "   sudo bash client/utils/sync_docker_group.sh"
echo ""
