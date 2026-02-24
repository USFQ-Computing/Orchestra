"""
Router para sincronización de datos desde el servidor central
"""

import os
import subprocess
from datetime import datetime
from typing import List, Optional

import psycopg2
from dateutil import parser as date_parser
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/sync", tags=["Synchronization"])


def ensure_tables_exist(conn):
    """
    Verifica y crea las tablas necesarias si no existen.
    Esta función se ejecuta antes de cualquier operación de sincronización.
    """
    try:
        cur = conn.cursor()

        # Crear tabla users si no existe
        # NOTA: system_gid es NULL inicialmente porque cada servidor tiene su propio GID de Docker
        # El script sync_docker_group.sh detecta automáticamente el GID local y actualiza la DB
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username VARCHAR UNIQUE NOT NULL,
                email VARCHAR UNIQUE NOT NULL,
                password_hash VARCHAR NOT NULL,
                is_admin INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                must_change_password BOOLEAN DEFAULT FALSE,
                system_uid INTEGER UNIQUE NOT NULL,
                system_gid INTEGER DEFAULT NULL,
                ssh_public_key VARCHAR,
                password_max_age_days INTEGER DEFAULT NULL,
                password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT username_valid_pattern CHECK (username ~ '^[a-z_][a-z0-9_-]*$')
            )
        """)

        # Añadir columnas de expiración si no existen (para bases de datos ya existentes)
        cur.execute("""
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS password_max_age_days INTEGER DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        """)

        # Crear índices si no existen
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_system_uid ON users(system_uid)"
        )

        conn.commit()
        cur.close()

        print("✅ Database tables verified/created successfully")
        return True

    except Exception as e:
        print(f"❌ Error creating tables: {str(e)}")
        conn.rollback()
        raise


class UserSync(BaseModel):
    """Modelo para sincronizar usuarios"""

    id: int
    username: str
    email: str
    password_hash: str
    is_admin: int
    is_active: int
    must_change_password: bool = False
    system_uid: int
    system_gid: Optional[int] = None
    ssh_public_key: Optional[str] = None
    password_max_age_days: Optional[int] = None
    password_changed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class SyncRequest(BaseModel):
    """Request de sincronización con metadatos"""

    server_url: Optional[str] = None  # URL del servidor central
    users: List[UserSync]


class SyncResponse(BaseModel):
    """Respuesta de sincronización"""

    success: bool
    message: str
    users_synced: int
    users_created: int
    users_updated: int
    users_deleted: int


def get_db_connection():
    """Obtiene conexión a la base de datos local del cliente"""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("NSS_DB_USER", "postgres"),
        password=os.getenv("NSS_DB_PASSWORD", "postgres"),
    )


@router.post("/users", response_model=SyncResponse)
async def sync_users(sync_data: SyncRequest):
    """
    Sincroniza la lista completa de usuarios desde el servidor central.
    También guarda la URL del servidor para sincronización de contraseñas.

    Este endpoint:
    1. Verifica que las tablas existan (las crea si es necesario)
    2. Guarda la URL del servidor central en /etc/default/sssd-pgsql
    3. Recibe la lista completa de usuarios desde el servidor central
    4. Actualiza o crea usuarios en la base de datos local
    5. Elimina usuarios que ya no existen en el servidor central
    6. Mantiene la base de datos local sincronizada
    7. Regenera archivos NSS/PAM para autenticación SSH
    """
    print("=" * 80)
    print("🔄 CLIENT: Received sync request")
    print(f"📦 Total users to sync: {len(sync_data.users)}")
    print(f"🌐 Server URL: {sync_data.server_url}")

    # Log estructura del primer usuario para debug
    if sync_data.users:
        first_user = sync_data.users[0]
        print(f"📝 Sample user structure:")
        print(f"   - id: {first_user.id}")
        print(f"   - username: {first_user.username}")
        print(f"   - email: {first_user.email}")
        print(f"   - is_admin: {first_user.is_admin}")
        print(f"   - is_active: {first_user.is_active}")
        print(f"   - must_change_password: {first_user.must_change_password}")
        print(f"   - system_uid: {first_user.system_uid}")
        print(f"   - system_gid: {first_user.system_gid}")
        print(
            f"   - ssh_public_key: {'Present' if first_user.ssh_public_key else 'None'}"
        )
        print(f"   - created_at: {first_user.created_at}")
    print("=" * 80)

    users = sync_data.users

    # Guardar SERVER_URL si fue proporcionado
    if sync_data.server_url:
        try:
            config_file = "/etc/default/sssd-pgsql"
            config_lines = []
            server_url_exists = False

            # Leer configuración existente si existe
            if os.path.exists(config_file):
                with open(config_file, "r") as f:
                    for line in f:
                        if line.startswith("SERVER_URL="):
                            config_lines.append(f"SERVER_URL={sync_data.server_url}\n")
                            server_url_exists = True
                        else:
                            config_lines.append(line)

            # Si no existe la línea, agregarla
            if not server_url_exists:
                config_lines.append(f"SERVER_URL={sync_data.server_url}\n")

            # Escribir configuración actualizada
            with open(config_file, "w") as f:
                f.writelines(config_lines)

            print(f"✅ SERVER_URL auto-configurado: {sync_data.server_url}")
        except Exception as e:
            print(f"⚠️  No se pudo auto-configurar SERVER_URL: {str(e)}")
            # No fallar la sincronización por esto

    conn = None
    try:
        print("🔌 Connecting to local database...")
        # Conectar a la base de datos
        try:
            conn = get_db_connection()
            print("✅ Database connection established")
        except psycopg2.OperationalError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Database connection failed: {str(e)}. Please verify that client_db is running.",
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected error connecting to database: {str(e)}",
            )

        # Verificar/crear tablas
        print("🗄️  Verifying/creating database tables...")
        try:
            ensure_tables_exist(conn)
            print("✅ Database tables verified")
        except Exception as e:
            if conn:
                conn.close()
            raise HTTPException(
                status_code=500,
                detail=f"Failed to initialize database tables: {str(e)}",
            )

        cur = conn.cursor()

        users_created = 0
        users_updated = 0
        users_deleted = 0

        # IDs de usuarios que vienen del servidor central
        central_user_ids = {user.id for user in users}
        print(f"📋 Central user IDs: {central_user_ids}")

        # Obtener IDs de usuarios locales
        try:
            cur.execute("SELECT id FROM users")
            local_user_ids = {row[0] for row in cur.fetchall()}
            print(f"📋 Local user IDs: {local_user_ids}")
        except psycopg2.ProgrammingError as e:
            if conn:
                conn.close()
            raise HTTPException(
                status_code=500,
                detail=f"Error querying users table: {str(e)}. Table may not exist or be corrupted.",
            )

        # Procesar cada usuario del servidor central
        print(f"\n⚙️  Processing {len(users)} users...")
        for user in users:
            try:
                print(f"   Processing user: {user.username} (id={user.id})")
                # Parsear created_at si viene como string
                created_at_value = user.created_at
                if isinstance(created_at_value, str):
                    try:
                        created_at_value = date_parser.parse(created_at_value)
                    except:
                        created_at_value = None

                # system_gid puede ser None - será detectado y actualizado automáticamente
                # por el script sync_docker_group.sh que detecta el GID de Docker del servidor
                system_gid_value = user.system_gid

                # Verificar si el usuario existe localmente
                cur.execute("SELECT id FROM users WHERE id = %s", (user.id,))
                existing = cur.fetchone()

                if existing:
                    # Actualizar usuario existente
                    print(f"      ↻ Updating existing user: {user.username}")
                    try:
                        cur.execute(
                            """
                            UPDATE users
                            SET username = %s,
                                email = %s,
                                password_hash = %s,
                                is_admin = %s,
                                is_active = %s,
                                must_change_password = %s,
                                system_uid = %s,
                                system_gid = %s,
                                ssh_public_key = %s,
                                password_max_age_days = %s,
                                password_changed_at = %s,
                                created_at = %s
                            WHERE id = %s
                        """,
                            (
                                user.username,
                                user.email,
                                user.password_hash,
                                user.is_admin,
                                user.is_active,
                                user.must_change_password,
                                user.system_uid,
                                system_gid_value,
                                user.ssh_public_key,
                                user.password_max_age_days,
                                user.password_changed_at,
                                created_at_value,
                                user.id,
                            ),
                        )
                        users_updated += 1
                        print(f"      ✅ User {user.username} updated successfully")
                    except psycopg2.IntegrityError as e:
                        print(
                            f"      ⚠️  Warning: Could not update user {user.username}: {str(e)}"
                        )
                        conn.rollback()
                        continue
                else:
                    # Crear nuevo usuario
                    print(f"      + Creating new user: {user.username}")
                    try:
                        cur.execute(
                            """
                            INSERT INTO users
                            (id, username, email, password_hash, is_admin, is_active,
                             must_change_password, system_uid, system_gid, ssh_public_key,
                             password_max_age_days, password_changed_at, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                            (
                                user.id,
                                user.username,
                                user.email,
                                user.password_hash,
                                user.is_admin,
                                user.is_active,
                                user.must_change_password,
                                user.system_uid,
                                system_gid_value,
                                user.ssh_public_key,
                                user.password_max_age_days,
                                user.password_changed_at,
                                created_at_value,
                            ),
                        )
                        users_created += 1
                        print(f"      ✅ User {user.username} created successfully")
                    except psycopg2.IntegrityError as e:
                        print(
                            f"      ⚠️  Warning: Could not create user {user.username}: {str(e)}"
                        )
                        conn.rollback()
                        continue

            except Exception as e:
                print(f"      ❌ Error processing user {user.username}: {str(e)}")
                import traceback

                print(f"      Traceback: {traceback.format_exc()}")
                conn.rollback()
                continue

        # Eliminar usuarios que ya no existen en el servidor central
        users_to_delete = local_user_ids - central_user_ids
        print(f"\n🗑️  Users to delete: {users_to_delete}")
        if users_to_delete:
            try:
                cur.execute(
                    "DELETE FROM users WHERE id = ANY(%s)", (list(users_to_delete),)
                )
                users_deleted = len(users_to_delete)
                print(f"   ✅ Deleted {users_deleted} users")
            except Exception as e:
                print(f"   ⚠️  Warning: Could not delete users: {str(e)}")
                conn.rollback()

        # Commit todos los cambios
        print(f"\n💾 Committing changes to database...")
        try:
            conn.commit()
            print(f"✅ Database changes committed successfully")
        except Exception as e:
            conn.rollback()
            if conn:
                conn.close()
            raise HTTPException(
                status_code=500, detail=f"Failed to commit database changes: {str(e)}"
            )

        cur.close()
        conn.close()

        # Crear directorios necesarios si no existen
        print("\n📁 Creating necessary directories...")
        os.makedirs("/var/lib/extrausers", exist_ok=True)
        os.makedirs("/etc", exist_ok=True)

        # Regenerar archivos passwd y shadow con manejo de errores
        print("🔄 Regenerating NSS/PAM files...")
        errors = []

        try:
            result = subprocess.run(
                ["bash", "/app/client/utils/generate_passwd_from_db.sh"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                error_msg = f"generate_passwd_from_db.sh failed (exit {result.returncode}): {result.stderr}"
                print(f"ERROR: {error_msg}")
                errors.append(error_msg)
            else:
                print("✅ Successfully generated /etc/passwd-pgsql")
        except subprocess.TimeoutExpired:
            error_msg = "generate_passwd_from_db.sh timed out"
            print(f"ERROR: {error_msg}")
            errors.append(error_msg)
        except Exception as e:
            error_msg = f"generate_passwd_from_db.sh exception: {str(e)}"
            print(f"ERROR: {error_msg}")
            errors.append(error_msg)

        try:
            result = subprocess.run(
                ["bash", "/app/client/utils/generate_shadow_from_db.sh"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                error_msg = f"generate_shadow_from_db.sh failed (exit {result.returncode}): {result.stderr}"
                print(f"ERROR: {error_msg}")
                errors.append(error_msg)
            else:
                print("✅ Successfully generated /var/lib/extrausers/shadow")
        except subprocess.TimeoutExpired:
            error_msg = "generate_shadow_from_db.sh timed out"
            print(f"ERROR: {error_msg}")
            errors.append(error_msg)
        except Exception as e:
            error_msg = f"generate_shadow_from_db.sh exception: {str(e)}"
            print(f"ERROR: {error_msg}")
            errors.append(error_msg)

        # Mensaje informativo sobre permisos de Docker
        print("")
        print("ℹ️  IMPORTANTE: Los usuarios sincronizados necesitan permisos de Docker")
        print("   Para darles acceso, ejecuta en el host:")
        print("   sudo bash /ruta/a/add_users_to_docker.sh")
        print("")

        # Si hay errores, incluirlos en la respuesta pero no fallar
        message = f"Successfully synchronized {len(users)} users"
        if errors:
            message += f" (Warnings: {'; '.join(errors)})"

        print("\n" + "=" * 80)
        print(f"✅ SYNC COMPLETED SUCCESSFULLY")
        print(f"   Total users: {len(users)}")
        print(f"   Created: {users_created}")
        print(f"   Updated: {users_updated}")
        print(f"   Deleted: {users_deleted}")
        print("=" * 80 + "\n")

        return SyncResponse(
            success=True,
            message=message,
            users_synced=len(users),
            users_created=users_created,
            users_updated=users_updated,
            users_deleted=users_deleted,
        )

    except HTTPException as http_ex:
        # Re-raise HTTP exceptions with logging
        print(f"\n❌ HTTP Exception: {http_ex.status_code} - {http_ex.detail}")
        raise

    except psycopg2.OperationalError as e:
        error_msg = (
            f"Database operational error: {str(e)}. Please check database connectivity."
        )
        print(f"\n❌ {error_msg}")
        import traceback

        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=503, detail=error_msg)

    except psycopg2.Error as e:
        error_msg = f"Database error during synchronization: {str(e)}"
        print(f"\n❌ {error_msg}")
        import traceback

        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)

    except Exception as e:
        error_msg = (
            f"Unexpected error synchronizing users: {type(e).__name__}: {str(e)}"
        )
        print(f"\n❌ {error_msg}")
        import traceback

        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)

    finally:
        # Asegurar que la conexión se cierre
        if conn and not conn.closed:
            conn.close()
