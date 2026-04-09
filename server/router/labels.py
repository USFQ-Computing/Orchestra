from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, List

from ..utils.db import get_db
from .auth import get_current_staff_user
from ..models.models import (
    Label,
    LabelCreate,
    LabelUpdate,
    LabelResponse,
    User,
)
from ..CRUD.labels import (
    create_label,
    get_label_by_id,
    get_label_by_slug,
    get_all_labels,
    update_label,
    delete_label,
    add_label_to_user,
    remove_label_from_user,
    get_user_labels,
    get_labels_for_users,
    set_user_labels,
    get_users_with_label,
    get_users_with_slug,
    user_has_label,
    user_has_label_slug,
)

router = APIRouter(
    prefix="/admin/labels",
    tags=["admin-labels"],
    dependencies=[Depends(get_current_staff_user)],
)


# ============ LABEL MANAGEMENT ENDPOINTS ============


@router.get("", response_model=List[LabelResponse])
def list_labels(
    db: Session = Depends(get_db),
    active_only: bool = False,
):
    """
    Obtiene todos los labels.

    Query parameters:
    - active_only: Si es True, solo retorna labels activos
    """
    labels = get_all_labels(db, active_only=active_only)
    return labels


@router.post("", response_model=LabelResponse, status_code=status.HTTP_201_CREATED)
def create_new_label(
    label: LabelCreate,
    db: Session = Depends(get_db),
):
    """
    Crea un nuevo label.

    Body:
    - name: Nombre del label (único)
    - slug: Identificador único amigable para URLs
    - color: Color hexadecimal o nombre de color (opcional)
    - active: Si el label está activo (default: true)
    """
    # Validar que no exista un label con el mismo nombre
    existing_by_name = get_label_by_name(db, label.name)
    if existing_by_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Label with name '{label.name}' already exists",
        )

    # Validar que no exista un label con el mismo slug
    existing_by_slug = get_label_by_slug(db, label.slug)
    if existing_by_slug:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Label with slug '{label.slug}' already exists",
        )

    new_label = create_label(db, label)
    return new_label


@router.get("/{label_id}", response_model=LabelResponse)
def get_label(
    label_id: int,
    db: Session = Depends(get_db),
):
    """Obtiene un label por ID"""
    label = get_label_by_id(db, label_id)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not found",
        )
    return label


@router.patch("/{label_id}", response_model=LabelResponse)
def update_existing_label(
    label_id: int,
    label_update: LabelUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza un label existente.

    Body (todos los campos son opcionales):
    - name: Nuevo nombre
    - slug: Nuevo slug
    - color: Nuevo color
    - active: Nuevo estado
    """
    label = get_label_by_id(db, label_id)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not found",
        )

    # Validar unicidad si se cambia nombre
    if label_update.name is not None and label_update.name != label.name:
        existing = get_label_by_name(db, label_update.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Label with name '{label_update.name}' already exists",
            )

    # Validar unicidad si se cambia slug
    if label_update.slug is not None and label_update.slug != label.slug:
        existing = get_label_by_slug(db, label_update.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Label with slug '{label_update.slug}' already exists",
            )

    updated_label = update_label(db, label_id, label_update)
    return updated_label


@router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_label(
    label_id: int,
    db: Session = Depends(get_db),
):
    """
    Elimina un label (soft delete: marca como inactivo).
    Esto permite recuperación futura sin perder datos.
    """
    label = get_label_by_id(db, label_id)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not found",
        )

    success = delete_label(db, label_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete label",
        )


# ============ USER LABEL ASSOCIATION ENDPOINTS ============


@router.get("/slug/{slug}", response_model=LabelResponse)
def get_label_by_slug_endpoint(
    slug: str,
    db: Session = Depends(get_db),
):
    """Obtiene un label por su slug"""
    label = get_label_by_slug(db, slug)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label with slug '{slug}' not found",
        )
    return label


@router.get("/{label_id}/users", response_model=List[dict])
def get_label_users(
    label_id: int,
    db: Session = Depends(get_db),
):
    """
    Obtiene todos los usuarios que tienen un label específico.

    Retorna lista de usuarios con: id, username, email
    """
    label = get_label_by_id(db, label_id)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not found",
        )

    users = get_users_with_label(db, label_id)
    return [
        {"id": u.id, "username": u.username, "email": u.email}
        for u in users
    ]


# ============ USER LABEL MANAGEMENT ENDPOINTS ============


@router.get("/user/{user_id}/labels", response_model=List[LabelResponse])
def get_user_labels_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Obtiene todos los labels de un usuario específico"""
    # Verificar que el usuario existe
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )

    labels = get_user_labels(db, user_id)
    return labels


@router.post("/users/labels-map", response_model=Dict[int, List[LabelResponse]])
def get_users_labels_map(
    user_ids: List[int],
    db: Session = Depends(get_db),
):
    """Obtiene las etiquetas de multiples usuarios en una sola request."""
    if not user_ids:
        return {}

    unique_user_ids = sorted(set(user_ids))

    existing_user_ids = {
        row[0]
        for row in db.query(User.id).filter(User.id.in_(unique_user_ids)).all()
    }
    missing_ids = [uid for uid in unique_user_ids if uid not in existing_user_ids]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Users not found: {missing_ids}",
        )

    return get_labels_for_users(db, unique_user_ids)


@router.put("/user/{user_id}/labels", status_code=status.HTTP_204_NO_CONTENT)
def replace_user_labels(
    user_id: int,
    label_ids: List[int],
    db: Session = Depends(get_db),
):
    """
    Reemplaza TODOS los labels de un usuario con los proporcionados.

    Body: Lista de IDs de labels
    Si es una lista vacía, elimina todos los labels del usuario.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )

    # Validar que todos los labels existen
    for label_id in label_ids:
        label = get_label_by_id(db, label_id)
        if not label:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Label {label_id} not found",
            )

    success = set_user_labels(db, user_id, label_ids)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user labels",
        )


@router.post("/user/{user_id}/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_label_to_user_endpoint(
    user_id: int,
    label_id: int,
    db: Session = Depends(get_db),
):
    """Agrega un label a un usuario"""
    label = get_label_by_id(db, label_id)
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not found",
        )

    success = add_label_to_user(db, user_id, label_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to add label to user (user might not exist or label already assigned)",
        )


@router.delete(
    "/user/{user_id}/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_label_from_user_endpoint(
    user_id: int,
    label_id: int,
    db: Session = Depends(get_db),
):
    """Remueve un label de un usuario"""
    success = remove_label_from_user(db, user_id, label_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Label {label_id} not assigned to user {user_id}",
        )


# ============ HELPER FUNCTIONS ============


def get_label_by_name(db: Session, name: str):
    """Helper function to check if label exists by name"""
    return db.query(Label).filter(Label.name == name).first()
