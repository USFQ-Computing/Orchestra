import os

from sqlalchemy import text

from ..CRUD.users import create_user, get_user_by_username

# Import all models so SQLAlchemy registers them before create_all
from ..models.models import (
    AnsibleTask,
    Container,
    ExecutedPlaybook,
    Metric,
    Server,
    User,
    UserCreate,
)
from .db import Base, SessionLocal, engine


def init_db() -> None:
    """Crea las tablas de la base de datos"""
    Base.metadata.create_all(bind=engine)


def ensure_schema_compatibility() -> None:
    """Aplica ajustes idempotentes para entornos con esquema antiguo."""
    db = SessionLocal()
    try:
        db.execute(
            text(
                """
                ALTER TABLE servers
                ADD COLUMN IF NOT EXISTS container_runtime_defaults JSONB NULL
                """
            )
        )
        db.execute(
            text(
                """
                ALTER TABLE labels
                ADD COLUMN IF NOT EXISTS container_runtime_overrides JSONB NULL
                """
            )
        )
        db.commit()
        print("✓ Compatibilidad de esquema aplicada (runtime policies)")
    except Exception as e:
        db.rollback()
        print(f"⚠ Error aplicando compatibilidad de esquema: {e}")
    finally:
        db.close()


def reset_sequences() -> None:
    """Resetea las secuencias de IDs de PostgreSQL para evitar conflictos"""
    db = SessionLocal()
    try:
        # Lista de tablas y sus columnas de ID
        tables = [
            "users",
            "servers",
            "metrics",
            "ansible_tasks",
            "executed_playbooks",
            "containers",
        ]

        for table in tables:
            try:
                # Obtener el máximo ID actual de la tabla
                result = db.execute(text(f"SELECT MAX(id) FROM {table}"))
                max_id = result.scalar()

                if max_id is not None:
                    # Resetear la secuencia al siguiente valor disponible
                    db.execute(
                        text(f"SELECT setval('{table}_id_seq', :max_id, true)"),
                        {"max_id": max_id},
                    )
                    print(f"  ✓ Secuencia de '{table}' ajustada a {max_id}")
                else:
                    # Si la tabla está vacía, resetear a 1
                    db.execute(text(f"SELECT setval('{table}_id_seq', 1, false)"))
                    print(f"  ✓ Secuencia de '{table}' reseteada a 1")
            except Exception as e:
                print(f"  ⚠ No se pudo resetear secuencia de '{table}': {e}")

        db.commit()
        print("✓ Secuencias de base de datos sincronizadas")
    except Exception as e:
        print(f"✗ Error al resetear secuencias: {e}")
        db.rollback()
    finally:
        db.close()


def create_default_admin() -> None:
    """Crea un usuario administrador por defecto si no existe"""
    db = SessionLocal()
    try:
        # Obtener credenciales desde variables de entorno o usar valores por defecto
        admin_username = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
        admin_email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@admin.com")
        admin_password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")

        # Verificar si ya existe el usuario admin
        existing_admin = get_user_by_username(db, admin_username)

        if not existing_admin:
            # Crear usuario administrador
            admin_data = UserCreate(
                username=admin_username,
                email=admin_email,
                password=admin_password,
                is_admin=1,  # Es administrador
                is_active=1,
            )
            admin_user = create_user(db, admin_data)
            print(f"✓ Usuario administrador creado: {admin_username}")
            print(f"  Email: {admin_email}")
            print(f"  Contraseña: {admin_password}")
            print(f"  ⚠️  CAMBIA LA CONTRASEÑA POR DEFECTO EN PRODUCCIÓN!")
        else:
            print(f"✓ Usuario administrador '{admin_username}' ya existe")
            # Asegurarse de que sea admin
            if getattr(existing_admin, "is_admin", 0) != 1:
                from ..CRUD.users import toggle_admin

                toggle_admin(db, existing_admin.id)
                print(f"  → Permisos de administrador activados")
    except Exception as e:
        print(f"✗ Error al crear usuario administrador: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    print("Inicializando base de datos...")
    init_db()
    print("✓ Tablas de base de datos creadas (si no existían)")
    print("\nAplicando compatibilidad de esquema...")
    ensure_schema_compatibility()
    print("\nSincronizando secuencias de IDs...")
    reset_sequences()
    print("\nCreando usuario administrador por defecto...")
    create_default_admin()
    print("\n✓ Inicialización completada")
