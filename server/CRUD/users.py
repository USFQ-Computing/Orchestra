import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.models import Label, User, UserCreate, UserLabel
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

    # Get the next available system_uid (starting from 4000)
    max_uid = db.query(func.max(User.system_uid)).scalar()
    if max_uid is None or max_uid < 4000:
        next_uid = 4000
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
        # Mark the password as already expired so the user is forced to change it
        # on first SSH login.  sp_lstchg will be 0 (epoch) → immediately expired
        # for any positive sp_max value.
        must_change_password=True,
        password_changed_at=datetime(1970, 1, 1, tzinfo=timezone.utc),
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
        user_data["password_changed_at"] = datetime.now(timezone.utc)
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
    db.query(User).filter(User.id == user_id).update(
        {
            "password_hash": hashed,
            "must_change_password": False,
            "password_changed_at": datetime.now(timezone.utc),
        }
    )
    db.commit()

    logger.info(f"✅ Password updated successfully for user: {db_user.username}")

    _trigger_user_sync(db)

    return get_user_by_id(db, user_id)


def expire_user_password(db: Session, user_id: int) -> Optional[User]:
    """Marca must_change_password=True y password_changed_at=epoch para forzar cambio en próximo login"""
    db_user = get_user_by_id(db, user_id)
    if not db_user:
        logger.warning(f"⚠️  Cannot expire password for user {user_id}: User not found")
        return None

    logger.info(f"🔑 Expiring password for user: {db_user.username} (id={user_id})")

    db.query(User).filter(User.id == user_id).update({
        "must_change_password": True,
        "password_changed_at": datetime(1970, 1, 1, tzinfo=timezone.utc)
    })
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


def preview_bulk_user_operation(
    db: Session, user_ids: List[int], operation: str, data: dict
) -> dict:
    """Genera un preview de cambios para operaciones masivas sobre usuarios."""
    valid_operations = {
        "set_active",
        "set_admin",
        "expire_password",
        "add_labels",
        "remove_labels",
        "replace_labels",
    }
    if operation not in valid_operations:
        raise ValueError(f"Unsupported operation: {operation}")

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    found_ids = {u.id for u in users}

    results = []
    for requested_id in user_ids:
        user = next((u for u in users if u.id == requested_id), None)
        if not user:
            results.append(
                {
                    "user_id": requested_id,
                    "status": "not_found",
                    "changed": False,
                    "message": "User not found",
                }
            )
            continue

        if operation == "set_active":
            target = int(data.get("is_active", 1))
            changed = int(user.is_active) != target
            results.append(
                {
                    "user_id": user.id,
                    "status": "change" if changed else "noop",
                    "changed": changed,
                    "message": f"is_active -> {target}",
                }
            )
        elif operation == "set_admin":
            target = int(data.get("is_admin", 0))
            changed = int(user.is_admin) != target
            results.append(
                {
                    "user_id": user.id,
                    "status": "change" if changed else "noop",
                    "changed": changed,
                    "message": f"is_admin -> {target}",
                }
            )
        elif operation == "expire_password":
            changed = not bool(user.must_change_password)
            results.append(
                {
                    "user_id": user.id,
                    "status": "change" if changed else "noop",
                    "changed": changed,
                    "message": "must_change_password -> true",
                }
            )
        else:
            label_ids = [int(x) for x in data.get("label_ids", [])]
            if not label_ids:
                results.append(
                    {
                        "user_id": user.id,
                        "status": "invalid",
                        "changed": False,
                        "message": "label_ids is required",
                    }
                )
                continue

            current_ids = {
                row.label_id
                for row in db.query(UserLabel)
                .filter(UserLabel.user_id == user.id)
                .all()
            }
            target_ids = set(label_ids)
            if operation == "add_labels":
                changed = len(target_ids - current_ids) > 0
            elif operation == "remove_labels":
                changed = len(target_ids & current_ids) > 0
            else:
                changed = current_ids != target_ids

            results.append(
                {
                    "user_id": user.id,
                    "status": "change" if changed else "noop",
                    "changed": changed,
                    "message": f"{operation} with labels={label_ids}",
                }
            )

    return {
        "operation": operation,
        "requested": len(user_ids),
        "found": len(found_ids),
        "to_change": len([r for r in results if r.get("changed")]),
        "results": results,
    }


def apply_bulk_user_operation(
    db: Session, user_ids: List[int], operation: str, data: dict
) -> dict:
    """Aplica una operación masiva sobre usuarios y sincroniza una sola vez."""
    valid_operations = {
        "set_active",
        "set_admin",
        "expire_password",
        "add_labels",
        "remove_labels",
        "replace_labels",
    }
    if operation not in valid_operations:
        raise ValueError(f"Unsupported operation: {operation}")

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    users_by_id = {u.id: u for u in users}
    results = []
    changed_count = 0

    label_ids = [int(x) for x in data.get("label_ids", [])]
    valid_label_ids = set()
    if operation in {"add_labels", "remove_labels", "replace_labels"}:
        labels = (
            db.query(Label)
            .filter(Label.id.in_(label_ids), Label.active.is_(True))
            .all()
        )
        valid_label_ids = {l.id for l in labels}
        missing = sorted(set(label_ids) - valid_label_ids)
        if missing:
            return {
                "operation": operation,
                "requested": len(user_ids),
                "success": 0,
                "failed": len(user_ids),
                "results": [
                    {
                        "user_id": uid,
                        "status": "failed",
                        "message": f"Invalid/inactive label ids: {missing}",
                    }
                    for uid in user_ids
                ],
            }

    for requested_id in user_ids:
        user = users_by_id.get(requested_id)
        if not user:
            results.append(
                {
                    "user_id": requested_id,
                    "status": "failed",
                    "message": "User not found",
                }
            )
            continue

        changed = False
        if operation == "set_active":
            target = int(data.get("is_active", 1))
            if int(user.is_active) != target:
                user.is_active = target
                changed = True
        elif operation == "set_admin":
            target = int(data.get("is_admin", 0))
            if int(user.is_admin) != target:
                user.is_admin = target
                changed = True
        elif operation == "expire_password":
            if not user.must_change_password:
                user.must_change_password = True
                user.password_changed_at = datetime(1970, 1, 1, tzinfo=timezone.utc)
                changed = True
        else:
            current_rows = (
                db.query(UserLabel).filter(UserLabel.user_id == user.id).all()
            )
            current_ids = {row.label_id for row in current_rows}

            if operation == "add_labels":
                to_add = valid_label_ids - current_ids
                for label_id in to_add:
                    db.add(UserLabel(user_id=user.id, label_id=label_id))
                changed = len(to_add) > 0
            elif operation == "remove_labels":
                to_remove = valid_label_ids & current_ids
                if to_remove:
                    db.query(UserLabel).filter(
                        UserLabel.user_id == user.id,
                        UserLabel.label_id.in_(to_remove),
                    ).delete(synchronize_session=False)
                    changed = True
            else:  # replace_labels
                if current_ids != valid_label_ids:
                    db.query(UserLabel).filter(UserLabel.user_id == user.id).delete(
                        synchronize_session=False
                    )
                    for label_id in valid_label_ids:
                        db.add(UserLabel(user_id=user.id, label_id=label_id))
                    changed = True

        if changed:
            changed_count += 1
            results.append(
                {
                    "user_id": user.id,
                    "status": "updated",
                    "message": "Updated",
                }
            )
        else:
            results.append(
                {
                    "user_id": user.id,
                    "status": "skipped",
                    "message": "No changes needed",
                }
            )

    db.commit()

    if changed_count > 0:
        _trigger_user_sync(db)

    return {
        "operation": operation,
        "requested": len(user_ids),
        "success": len([r for r in results if r["status"] in {"updated", "skipped"}]),
        "updated": len([r for r in results if r["status"] == "updated"]),
        "failed": len([r for r in results if r["status"] == "failed"]),
        "results": results,
        "synced_to_clients": changed_count > 0,
    }
