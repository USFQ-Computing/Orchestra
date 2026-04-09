import logging
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.models import Label, LabelCreate, LabelUpdate, UserLabel, User

logger = logging.getLogger(__name__)


# ============ LABEL CRUD ============


def create_label(db: Session, label: LabelCreate) -> Label:
    """Crea un nuevo label"""
    logger.info(f"➕ Creating new label: {label.name} (slug: {label.slug})")

    db_label = Label(
        name=label.name,
        slug=label.slug,
        color=label.color,
        active=label.active,
        container_runtime_overrides=label.container_runtime_overrides,
    )
    db.add(db_label)
    db.commit()
    db.refresh(db_label)
    logger.info(f"✅ Label created with id: {db_label.id}")
    return db_label


def get_label_by_id(db: Session, label_id: int) -> Optional[Label]:
    """Obtiene un label por ID"""
    return db.query(Label).filter(Label.id == label_id).first()


def get_label_by_slug(db: Session, slug: str) -> Optional[Label]:
    """Obtiene un label por slug"""
    return db.query(Label).filter(Label.slug == slug).first()


def get_label_by_name(db: Session, name: str) -> Optional[Label]:
    """Obtiene un label por nombre"""
    return db.query(Label).filter(Label.name == name).first()


def get_all_labels(db: Session, active_only: bool = False) -> List[Label]:
    """Obtiene todos los labels, opcionalmente solo los activos"""
    query = db.query(Label)
    if active_only:
        query = query.filter(Label.active == True)
    return query.order_by(Label.name).all()


def update_label(db: Session, label_id: int, label_update: LabelUpdate) -> Optional[Label]:
    """Actualiza un label existente"""
    db_label = get_label_by_id(db, label_id)
    if not db_label:
        logger.warning(f"❌ Label {label_id} not found for update")
        return None

    logger.info(f"🔄 Updating label: {label_id}")

    # Solo actualizar campos que fueron proporcionados
    if label_update.name is not None:
        db_label.name = label_update.name
    if label_update.slug is not None:
        db_label.slug = label_update.slug
    if label_update.color is not None:
        db_label.color = label_update.color
    if label_update.active is not None:
        db_label.active = label_update.active
    if label_update.container_runtime_overrides is not None:
        db_label.container_runtime_overrides = label_update.container_runtime_overrides

    db.commit()
    db.refresh(db_label)
    logger.info(f"✅ Label updated: {label_id}")
    return db_label


def delete_label(db: Session, label_id: int) -> bool:
    """Elimina un label (soft delete usando active=False es más seguro)"""
    db_label = get_label_by_id(db, label_id)
    if not db_label:
        logger.warning(f"❌ Label {label_id} not found for deletion")
        return False

    logger.info(f"🗑️ Soft-deleting label: {label_id}")
    db_label.active = False
    db.commit()
    logger.info(f"✅ Label soft-deleted: {label_id}")
    return True


def hard_delete_label(db: Session, label_id: int) -> bool:
    """Elimina permanentemente un label (use con cuidado!)"""
    db_label = get_label_by_id(db, label_id)
    if not db_label:
        logger.warning(f"❌ Label {label_id} not found for hard deletion")
        return False

    logger.info(f"⚠️ Hard-deleting label: {label_id}")
    db.delete(db_label)
    db.commit()
    logger.info(f"✅ Label hard-deleted: {label_id}")
    return True


# ============ USER LABEL ASSOCIATIONS ============


def add_label_to_user(db: Session, user_id: int, label_id: int) -> bool:
    """Agrega un label a un usuario"""
    # Verificar que el usuario existe
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(f"❌ User {user_id} not found")
        return False

    # Verificar que el label existe
    label = get_label_by_id(db, label_id)
    if not label:
        logger.warning(f"❌ Label {label_id} not found")
        return False

    # Verificar que la asociación no existe ya
    existing = (
        db.query(UserLabel)
        .filter(UserLabel.user_id == user_id, UserLabel.label_id == label_id)
        .first()
    )
    if existing:
        logger.warning(
            f"⚠️ Label {label_id} already assigned to user {user_id}"
        )
        return False

    logger.info(f"➕ Adding label {label.slug} to user {user_id}")
    user_label = UserLabel(user_id=user_id, label_id=label_id)
    db.add(user_label)
    db.commit()
    logger.info(f"✅ Label {label_id} added to user {user_id}")
    return True


def remove_label_from_user(db: Session, user_id: int, label_id: int) -> bool:
    """Remueve un label de un usuario"""
    user_label = (
        db.query(UserLabel)
        .filter(UserLabel.user_id == user_id, UserLabel.label_id == label_id)
        .first()
    )
    if not user_label:
        logger.warning(f"❌ Label {label_id} not found for user {user_id}")
        return False

    logger.info(f"🗑️ Removing label {label_id} from user {user_id}")
    db.delete(user_label)
    db.commit()
    logger.info(f"✅ Label {label_id} removed from user {user_id}")
    return True


def get_user_labels(db: Session, user_id: int) -> List[Label]:
    """Obtiene todos los labels de un usuario"""
    return (
        db.query(Label)
        .join(UserLabel, Label.id == UserLabel.label_id)
        .filter(UserLabel.user_id == user_id)
        .order_by(Label.name)
        .all()
    )


def get_labels_for_users(db: Session, user_ids: List[int]) -> Dict[int, List[Label]]:
    """Obtiene labels para multiples usuarios en una sola consulta."""
    if not user_ids:
        return {}

    # Inicializa cada usuario con lista vacia para evitar checks extra en frontend.
    grouped_labels: Dict[int, List[Label]] = {user_id: [] for user_id in user_ids}

    rows = (
        db.query(UserLabel.user_id, Label)
        .join(Label, Label.id == UserLabel.label_id)
        .filter(UserLabel.user_id.in_(user_ids))
        .order_by(UserLabel.user_id, Label.name)
        .all()
    )

    for user_id, label in rows:
        grouped_labels.setdefault(user_id, []).append(label)

    return grouped_labels


def set_user_labels(db: Session, user_id: int, label_ids: List[int]) -> bool:
    """
    Reemplaza todos los labels de un usuario con los proporcionados.
    Si label_ids es vacío, elimina todos los labels del usuario.
    """
    # Verificar que el usuario existe
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(f"❌ User {user_id} not found")
        return False

    logger.info(f"🔄 Replacing labels for user {user_id} with {len(label_ids)} labels")

    # Eliminar labels actuales
    db.query(UserLabel).filter(UserLabel.user_id == user_id).delete()

    # Agregar nuevos labels
    for label_id in label_ids:
        # Verificar que el label existe
        label = get_label_by_id(db, label_id)
        if not label:
            logger.warning(f"⚠️ Label {label_id} not found, skipping")
            continue

        user_label = UserLabel(user_id=user_id, label_id=label_id)
        db.add(user_label)

    db.commit()
    logger.info(f"✅ Labels replaced for user {user_id}")
    return True


def get_users_with_label(db: Session, label_id: int) -> List[User]:
    """Obtiene todos los usuarios que tienen un label específico"""
    return (
        db.query(User)
        .join(UserLabel, User.id == UserLabel.user_id)
        .filter(UserLabel.label_id == label_id)
        .order_by(User.username)
        .all()
    )


def get_users_with_slug(db: Session, slug: str) -> List[User]:
    """Obtiene todos los usuarios que tienen un label con slug específico"""
    label = get_label_by_slug(db, slug)
    if not label:
        return []
    return get_users_with_label(db, label.id)


def user_has_label(db: Session, user_id: int, label_id: int) -> bool:
    """Verifica si un usuario tiene un label específico"""
    return (
        db.query(UserLabel)
        .filter(UserLabel.user_id == user_id, UserLabel.label_id == label_id)
        .first()
        is not None
    )


def user_has_label_slug(db: Session, user_id: int, slug: str) -> bool:
    """Verifica si un usuario tiene un label con slug específico"""
    label = get_label_by_slug(db, slug)
    if not label:
        return False
    return user_has_label(db, user_id, label.id)
