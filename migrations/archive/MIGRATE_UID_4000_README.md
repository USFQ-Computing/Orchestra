# 📝 Migración: Cambiar Rango de UIDs a partir de 4000

## 🎯 ¿Qué hace esta migración?

- ✅ Cambia el valor inicial de UIDs de **2000 a 4000**
- ✅ Renumera **todos los usuarios existentes** comenzando desde 4000
- ✅ Dispara la **sincronización automática** con todos los clientes
- ✅ Actualiza `/etc/passwd-pgsql` en todos los servidores

## 📋 Mapeo de ejemplo

| Usuario | UID Anterior | UID Nuevo |
|---------|------------|-----------|
| bacunia | 2000 | 4000 |
| juan | 2001 | 4001 |
| maria | 2002 | 4002 |
| ... | ... | ... |

**Nuevos usuarios creados después de esta migración comenzarán desde UID 4000+**

---

## 🚀 Ejecución

### Opción 1: Script Python (Recomendado)

```bash
# Desde la raíz del proyecto
cd /home/staffteam/pp

# Ejecutar el script de migración
python migrations/migrate_uid_range_4000.py
```

**Ventajas:**
- ✅ Más interactivo (muestra confirmaciones y progreso)
- ✅ Dispara sincronización automáticamente
- ✅ Más seguro (pide confirmación)

---

### Opción 2: Script Bash (Versión manual)

```bash
# Ejecutar desde la raíz del proyecto
cd /home/staffteam/pp
sudo bash migrations/archive/migrate_uid_range_4000.sh
```

**Nota:** Esta opción solo actualiza la BD. Necesitará disparar la sincronización manualmente después.

---

## ⏱️ Proceso Paso a Paso

### Paso 1: Ejecutar la Migración

```bash
python migrations/migrate_uid_range_4000.py
```

El script:
1. Se conecta a la BD
2. Muestra el estado actual
3. Pide confirmación
4. Renumera los UIDs
5. Dispara sincronización

### Paso 2: Esperar Sincronización

La sincronización se ejecuta automáticamente. Espera:

```
🌍 Enviando actualización a todos los clientes...
   Esto puede tomar unos minutos...
```

**Tiempo estimado:** 5-10 minutos

### Paso 3: Verificar en los Clientes

En cada servidor cliente, ejecuta:

```bash
# Ver los nuevos UIDs en /etc/passwd-pgsql
cat /etc/passwd-pgsql | grep -E '^[a-z]' | awk -F: '{print $1, $3}'

# Ejemplo de salida esperada:
# bacunia 4000
# juan 4001
# maria 4002
```

### Paso 4: (Opcional) Sincronizar Permisos Docker

En cada cliente:

```bash
sudo bash /app/client/utils/sync_docker_group.sh
```

---

## ⚠️ Consideraciones Importantes

### 1. **Cambios Solo en la BD Central**
- Los UIDs se renumeran **solo en el servidor central**
- Los clientes reciben automáticamente la actualización
- **No necesitas ejecutar comando en cada cliente** (excepto paso 4 opcional)

### 2. **La Sincronización es Automática**
El script Python dispara `_trigger_user_sync()`, que:
- Obtiene la lista completa de usuarios
- Envía a todos los clientes registrados
- Cada cliente ejecuta `generate_passwd_from_db.sh`
- Las actualizaciones entran en efecto inmediatamente

### 3. **Sesiones SSH Activas**
- Los usuarios con sesiones SSH activas **no son afectados**
- Nuevos logins usarán los nuevos UIDs
- Si hay problemas, cierra la sesión y vuelve a conectar

### 4. **Backup Recomendado**
Antes de ejecutar:

```bash
# Hacer backup de la BD
docker compose exec db pg_dump -U postgres -d mydb > backup_uid_migration_$(date +%s).sql
```

---

## 🔍 Verificar Estado Actual

Antes de migrar:

```bash
# Conectar a la BD central
docker compose exec db psql -U postgres -d mydb -c \
  "SELECT username, system_uid, is_active FROM users ORDER BY system_uid;"

# Debería mostrar usuarios con UIDs >= 2000
```

Después de migrar:

```bash
# Mismo comando debería mostrar UIDs >= 4000
docker compose exec db psql -U postgres -d mydb -c \
  "SELECT username, system_uid, is_active FROM users ORDER BY system_uid;"
```

---

## 🐛 Troubleshooting

### Error: "No se puede conectar a la base de datos"

```bash
# Verificar que los servicios están corriendo
docker compose ps

# Verificar conexión manualmente
docker compose exec db psql -U postgres -d mydb -c "SELECT 1"
```

### Los clientes no se sincronizaron

```bash
# Ver logs del cliente
docker compose -f docker-compose.client.yml logs client

# Sincronizar manualmente en un cliente
docker compose -f docker-compose.client.yml exec client bash \
  /app/client/utils/generate_passwd_from_db.sh
```

### UIDs no se reflejaron en los clientes

```bash
# Esperar más tiempo (la sincronización puede tardar)
# O ejecutar manualmente:
sudo bash /app/client/utils/generate_passwd_from_db.sh
sudo bash /app/client/utils/generate_shadow_from_db.sh
```

---

## 📊 Código Cambios

### 1. Actualización en `server/CRUD/users.py`

Para nuevos usuarios, el valor inicial cambió de **2000** a **4000**:

```python
# Antes:
if max_uid is None or max_uid < 2000:
    next_uid = 2000

# Después:
if max_uid is None or max_uid < 4000:
    next_uid = 4000
```

### 2. Migración Disponible

Dos formas de ejecutarla:
- `migrations/migrate_uid_range_4000.py` (recomendado)
- `migrations/archive/migrate_uid_range_4000.sh` (manual)

---

## ✅ Lista de Verificación

- [ ] Backup de BD realizado
- [ ] Servicios están corriendo (`docker compose ps`)
- [ ] Ejecutado `python migrations/migrate_uid_range_4000.py`
- [ ] Confirmada la migración cuando se pidió
- [ ] Esperado 5-10 minutos para la sincronización
- [ ] Verificado en al menos un cliente: `cat /etc/passwd-pgsql`
- [ ] (Opcional) Ejecutado `sync_docker_group.sh` en clientes

---

## 📞 Soporte

Si hay problemas:

1. Verificar logs: `docker compose logs -f api`
2. Verificar BD: `docker compose exec db psql -U postgres -d mydb`
3. Verificar clientes: `docker compose logs -f client`

