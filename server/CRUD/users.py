import asyncio
import logging
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.models import User, UserCreate
from ..utils.auth import hash_password

logger = logging.getLogger(__name__)


def _trigger_user_sync(db: Session):
    """
    Dispara la sincronización de usuarios con todos los clientes.
    Se ejecuta después de cualquier operación que modifique la tabla users.
    """
    logger.info("🔄 Triggering user synchronization to all clients...")
    try:
        from ..utils.user_sync import sync_users_to_all_clients_sync

        # Ejecutar sincronización en segundo plano
        result = sync_users_to_all_clients_sync(db)
        logger.info(f"✅ User sync completed: {result.get('message', 'No message')}")
        logger.debug(f"   Sync details: {result}")
    except Exception as e:
        # No fallar la operación principal si la sincronización falla
        logger.error(f"❌ Warning: User sync failed: {type(e).__name__}: {str(e)}")
        import traceback

        logger.error(f"   Traceback: {traceback.format_exc()}")


# CREATE
def create_user(db: Session, user: UserCreate, auto_sync: bool = True) -> User:
    """Crea un nuevo usuario en la base de datos con system_uid auto-asignado"""
    logger.info(f"➕ Creating new user: {user.username}")
    logger.debug(
        f"   Email: {user.email}, is_admin: {user.is_admin}, is_active: {user.is_active}"
    )

    hashed_password = hash_password(user.password)

    # Get the next available system_uid (starting from 2000)
    max_uid = db.query(func.max(User.system_uid)).scalar()
    if max_uid is None or max_uid < 2000:
        next_uid = 2000
    else:
        next_uid = max_uid + 1

    logger.debug(f"   Assigned system_uid: {next_uid}")

    db_user = User(
        username=user.username,
        email=user.email,
        password_hash=hashed_password,
        is_admin=user.is_admin,
        is_active=user.is_active,
        ssh_public_key=user.ssh_public_key,
        system_uid=next_uid,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    logger.info(
        f"✅ User created successfully: {user.username} (id={db_user.id}, uid={next_uid})"
    )

    if auto_sync:
        _trigger_user_sync(db)

    return db_user


# READ
def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Obtiene un usuario por su ID"""
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Obtiene un usuario por su nombre de usuario"""
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Obtiene un usuario por su email"""
    return db.query(User).filter(User.email == email).first()


def get_all_users(db: Session, skip: int = 0, limit: int = 100) -> List[User]:
    """Obtiene todos los usuarios con paginación ordenados por ID"""
    return db.query(User).order_by(User.id).offset(skip).limit(limit).all()


def get_active_users(db: Session, skip: int = 0, limit: int = 100) -> List[User]:
    """Obtiene todos los usuarios activos"""
    return db.query(User).filter(User.is_active == 1).offset(skip).limit(limit).all()


def get_admin_users(db: Session) -> List[User]:
    """Obtiene todos los usuarios administradores"""
    return db.query(User).filter(User.is_admin == 1).all()


# UPDATE
def update_user(db: Session, user_id: int, user_data: dict) -> Optional[User]:
    """Actualiza los datos de un usuario"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot update user {user_id}: User not found")
        return None

    logger.info(f"✏️  Updating user: {db_user.username} (id={user_id})")
    logger.debug(f"   Update data: {user_data}")

    # Si se incluye una nueva contraseña, hashearla
    if "password" in user_data:
        user_data["password_hash"] = hash_password(user_data.pop("password"))
        logger.debug(f"   Password will be updated")

    # Actualizar los campos
    for key, value in user_data.items():
        if hasattr(db_user, key):
            setattr(db_user, key, value)

    db.commit()
    db.refresh(db_user)

    logger.info(f"✅ User updated successfully: {db_user.username}")

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return db_user


def update_user_password(
    db: Session, user_id: int, new_password: str
) -> Optional[User]:
    """Actualiza solo la contraseña de un usuario"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot update password for user {user_id}: User not found")
        return None

    logger.info(f"🔐 Updating password for user: {db_user.username} (id={user_id})")

    hashed = hash_password(new_password)
    db.query(User).filter(User.id == user_id).update({"password_hash": hashed, "must_change_password": False})
    db.commit()

    logger.info(f"✅ Password updated successfully for user: {db_user.username}")

    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


def expire_user_password(db: Session, user_id: int) -> Optional[User]:
    """Marca must_change_password=True para forzar cambio en próximo login"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot expire password for user {user_id}: User not found")
        return None

    logger.info(f"🔑 Expiring password for user: {db_user.username} (id={user_id})")

    db.query(User).filter(User.id == user_id).update({"must_change_password": True})
    db.commit()

    logger.info(f"✅ Password expired for user: {db_user.username}")

    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


def deactivate_user(db: Session, user_id: int) -> Optional[User]:
    """Desactiva un usuario (soft delete)"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot deactivate user {user_id}: User not found")
        return None

    logger.info(f"🔴 Deactivating user: {db_user.username} (id={user_id})")

    db.query(User).filter(User.id == user_id).update({"is_active": 0})
    db.commit()

    logger.info(f"✅ User deactivated: {db_user.username}")

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


def activate_user(db: Session, user_id: int) -> Optional[User]:
    """Activa un usuario"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot activate user {user_id}: User not found")
        return None

    logger.info(f"🟢 Activating user: {db_user.username} (id={user_id})")

    db.query(User).filter(User.id == user_id).update({"is_active": 1})
    db.commit()

    logger.info(f"✅ User activated: {db_user.username}")

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


def toggle_admin(db: Session, user_id: int) -> Optional[User]:
    """Alterna el estado de administrador de un usuario"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot toggle admin for user {user_id}: User not found")
        return None

    new_value = 0 if getattr(db_user, "is_admin") == 1 else 1
    status = "admin" if new_value == 1 else "regular user"
    logger.info(
        f"👤 Toggling admin status for: {db_user.username} (id={user_id}) -> {status}"
    )

    db.query(User).filter(User.id == user_id).update({"is_admin": new_value})
    db.commit()

    logger.info(f"✅ Admin status toggled: {db_user.username} is now {status}")

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


# DELETE
def delete_user(db: Session, user_id: int) -> bool:
    """Elimina permanentemente un usuario de la base de datos"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot delete user {user_id}: User not found")
        return False

    username = db_user.username
    logger.info(f"🗑️  Deleting user: {username} (id={user_id})")

    db.delete(db_user)
    db.commit()

    logger.info(f"✅ User deleted: {username}")

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return True


# AUTHENTICATION
# Autenticación movida a utils/auth.py (authenticate_user devuelve JWT)
