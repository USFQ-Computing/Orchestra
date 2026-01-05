# 🔐 Permisos Docker (sin Sudo)

## 🎯 Solución Final - AUTOMÁTICA

**El sistema detecta automáticamente el GID de Docker en cada cliente y lo usa como grupo primario de usuarios.**

- ✅ GID de Docker detectado automáticamente (puede ser 984, 999, etc.)
- ✅ Usuarios tienen Docker como grupo primario (acceso directo)
- ❌ Sin grupos privilegiados: `sudo`, `admin`

---

## ⚠️ El Problema que Encontraste

```bash
groups bacunia
# bacunia : admin  ❌ INCORRECTO (GID 2000 = admin del sistema)
```

## ✅ La Solución

El sistema ahora:
1. **Detecta automáticamente el GID de docker** en cada cliente
2. **Asigna ese GID como grupo primario** a los usuarios
3. No necesita crear grupos adicionales ni GIDs fijos

```bash
groups bacunia
# bacunia : docker  ✅ CORRECTO (GID auto-detectado)
```

---

## 🚀 EJECUTAR EN SERVIDOR (Backend)

```bash
# Reiniciar para aplicar cambios en el modelo
docker compose restart server
```

**Cambio:** `system_gid` ahora es `NULL` (se asigna automáticamente en cada cliente).

---

## 🚀 EJECUTAR EN CADA CLIENTE (Host)

### Opción A: Script Completo (Recomendado)

```bash
# 1. Limpiar usuarios existentes con grupos incorrectos
chmod +x fix_user_gid.sh
sudo ./fix_user_gid.sh

# 2. Sincronizar y crear usuarios con GID correcto
sudo bash client/utils/sync_docker_group.sh

# 3. Verificar resultado
sudo ./check_user_permissions.sh

# 4. Usuarios deben reconectar
sudo pkill -u bacunia
```

### Opción B: Solo Sincronizar (Si no hay usuarios con admin)

```bash
# Si los usuarios aún no existen o no tienen problemas
sudo bash client/utils/sync_docker_group.sh
sudo ./check_user_permissions.sh
```

---

## ✅ Resultado Esperado

```bash
# Ver grupos
groups bacunia
# bacunia : docker  ✅

# Ver GID (auto-detectado, puede variar por sistema)
id bacunia
# uid=2000(bacunia) gid=984(docker) groups=984(docker)
# o
# uid=2000(bacunia) gid=999(docker) groups=999(docker)

# Verificar sin sudo
sudo -l -U bacunia
# User bacunia is not allowed to run sudo on hostname  ✅

# Probar docker (debe funcionar sin sudo)
su - bacunia -c "docker ps"
# CONTAINER ID   IMAGE     COMMAND   ...  ✅
```

---

## 📋 Lo Que Pueden Hacer los Usuarios

### ✅ CON grupo `docker` (permitido)

```bash
docker ps                    # Ver contenedores
docker run ubuntu            # Crear contenedores  
docker images                # Ver imágenes
docker logs <container>      # Ver logs
docker exec -it <cont> bash  # Entrar a contenedor
docker-compose up            # Usar docker-compose
docker build -t myapp .      # Construir imágenes
```

### ❌ SIN grupo `sudo` (bloqueado)

```bash
apt-get install nginx        # ❌ Instalar software
systemctl restart docker     # ❌ Reiniciar servicios
useradd newuser              # ❌ Crear usuarios
nano /etc/hosts              # ❌ Modificar sistema
sudo cualquier_cosa          # ❌ Ejecutar como root
```

---

## 🔍 Comandos de Verificación

```bash
# Ver GID de docker en este sistema
getent group docker
# docker:x:984:staffteam,bacunia,...

# Ver quién tiene docker como grupo primario
getent passwd | grep ":$(getent group docker | cut -d: -f3):"

# Ver quién tiene sudo (solo admins del sistema)
getent group sudo

# Verificar un usuario específico
groups bacunia           # Ver grupos
id bacunia               # Ver UID/GID completo
sudo -l -U bacunia       # Verificar permisos sudo

# Probar acceso docker
su - bacunia -c "docker ps"
```

---

## 🎯 ¿Cómo Funciona?

### 1. En cada cliente, `sync_docker_group.sh`:

```bash
# Detecta GID de docker automáticamente
DOCKER_GID=$(getent group docker | cut -d: -f3)
# Resultado: 984 (o 999, 998, etc. según el sistema)

# Crea usuarios con ese GID como grupo primario
useradd -u 2000 -g $DOCKER_GID -d /home/bacunia bacunia
```

### 2. Ventajas:

- ✅ **Automático**: No necesitas saber el GID de antemano
- ✅ **Portable**: Funciona en cualquier sistema con Docker
- ✅ **Simple**: No crea grupos adicionales
- ✅ **Directo**: Docker es el grupo primario (acceso inmediato)
- ✅ **Consistente**: Mismo comportamiento en todos los clientes

---

## 📊 Comparación

| Aspecto | Antes | Después |
|---------|-------|---------|
| Grupo primario | `admin` (GID 2000) ❌ | `docker` (GID auto) ✅ |
| GID | Fijo 2000 | Auto-detectado |
| Acceso Docker | Secundario | Primario (directo) |
| Permisos sudo | ❌ Podían tener | ❌ Bloqueado |
| Configuración | Manual | Automática |

---

## 🔄 Flujo Completo

```
Usuario creado en DB (sin GID específico)
          ↓
Cliente ejecuta sync_docker_group.sh
          ↓
Detecta GID de docker → Ejemplo: 984
          ↓
Crea usuario con GID 984 (docker)
          ↓
Usuario tiene acceso directo a Docker ✅
Usuario NO tiene sudo ✅
```

---

## 🆘 Troubleshooting

### Usuario sigue teniendo grupo admin

```bash
# Ver GID actual
id bacunia

# Si tiene GID 2000 (admin), ejecutar:
sudo ./fix_user_gid.sh

# O manualmente:
DOCKER_GID=$(getent group docker | cut -d: -f3)
sudo usermod -g $DOCKER_GID bacunia
sudo deluser bacunia admin 2>/dev/null
sudo pkill -u bacunia
```

### GID de docker diferente en clientes

**Esto es normal y está bien.** Cada cliente detecta su propio GID de docker:

- Cliente A: docker GID 984
- Cliente B: docker GID 999
- Cliente C: docker GID 998

El script se adapta automáticamente a cada sistema.

### Usuario no puede usar docker

```bash
# Verificar que docker es el grupo primario
id bacunia
# Debe mostrar: gid=XXX(docker)

# Si no:
DOCKER_GID=$(getent group docker | cut -d: -f3)
sudo usermod -g $DOCKER_GID bacunia

# Usuario debe reconectar
sudo pkill -u bacunia
```

### Cambios no se aplican

El usuario **DEBE** cerrar sesión y volver a conectarse:

```bash
# Método 1: Forzar desde servidor
sudo pkill -u bacunia

# Método 2: Usuario ejecuta
exit
# Luego volver a conectar por SSH

# Verificar en nueva sesión
groups
id
```

---

## 📝 Scripts Disponibles

| Script | Propósito | Cuándo usar |
|--------|-----------|-------------|
| `sync_docker_group.sh` | Sincronizar usuarios con GID auto | Siempre |
| `fix_user_gid.sh` | Limpiar usuarios con admin/sudo | Si hay problemas |
| `check_user_permissions.sh` | Verificar estado | Para auditar |

---

## 🔒 Seguridad

### ¿Es seguro que docker sea el grupo primario?

**Sí, para este caso de uso:**

- ✅ Los usuarios **necesitan** acceso a Docker (es el propósito)
- ✅ No tienen sudo (no pueden hacer `sudo su root`)
- ✅ No están en grupos privilegiados (admin, sudo)
- ⚠️ Tienen acceso completo a Docker daemon (esto es intencional)

### Limitaciones conocidas del grupo docker

Usuarios con acceso a Docker **técnicamente** podrían:

```bash
# Montar el filesystem del host (si son maliciosos)
docker run -v /:/host -it ubuntu chroot /host
```

**Mitigación:**

1. **Confía en tus usuarios**: Solo crear cuentas para personas de confianza
2. **Auditoría**: Monitorear comandos docker ejecutados
3. **Logs**: Revisar `docker logs` y `journalctl`
4. **Namespaces**: Configurar user namespaces en Docker (avanzado)

Para este sistema de gestión de equipos de desarrollo, es aceptable.

---

## ✅ Checklist de Implementación

- [ ] Servidor: `docker compose restart server`
- [ ] Cliente: `sudo ./fix_user_gid.sh` (si hay usuarios con admin)
- [ ] Cliente: `sudo bash client/utils/sync_docker_group.sh`
- [ ] Cliente: `sudo ./check_user_permissions.sh`
- [ ] Verificar: `groups bacunia` → debe mostrar `docker`
- [ ] Verificar: `sudo -l -U bacunia` → debe decir "not allowed"
- [ ] Probar: `su - bacunia -c "docker ps"` → debe funcionar

---

## 🎓 Resumen Técnico

**Cambio principal:**
- `system_gid` en DB: `2000` → `NULL` (auto-detectado en cliente)
- Grupo primario: `admin` → `docker` (GID variable)

**Resultado:**
- Usuario tiene acceso directo a Docker (grupo primario)
- Usuario NO tiene sudo (explícitamente bloqueado)
- Funciona en cualquier sistema Linux con Docker
- Zero configuración manual de GIDs

---

## 📞 Comandos de Emergencia

```bash
# Ver estado actual
getent group docker
getent group sudo
getent group admin

# Limpiar usuario específico
DOCKER_GID=$(getent group docker | cut -d: -f3)
sudo usermod -g $DOCKER_GID <username>
sudo deluser <username> sudo 2>/dev/null
sudo deluser <username> admin 2>/dev/null
sudo pkill -u <username>

# Verificar
id <username>
sudo -l -U <username>
su - <username> -c "docker ps"
```

---

**Simple, automático y seguro.** 🎯 🔒