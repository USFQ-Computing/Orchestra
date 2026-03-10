from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Header
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
import csv
import io
import re
import bcrypt
from pydantic import BaseModel

from ..utils.db import get_db
from .auth import get_current_staff_user
from ..models.models import User, UserCreate, UserResponse
from ..models.password_models import PasswordChangeFromClient
from ..CRUD.users import (
    get_all_users,
    get_user_by_id,
    get_user_by_username,
    get_active_users,
    get_admin_users,
    create_user,
    update_user,
    update_user_password,
    expire_user_password,
    activate_user,
    deactivate_user,
    toggle_admin,
    delete_user,
    _trigger_user_sync,
)


class PasswordChange(BaseModel):
    new_password: str

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(get_current_staff_user)])


def normalize_username(username: str) -> str:
    """
    Normaliza el username para cumplir con el constraint de PostgreSQL.

    Reglas:
    - Convierte a minúsculas
    - Reemplaza espacios y caracteres inválidos por guiones bajos
    - Asegura que comience con letra o guion bajo
    - Solo permite: letras minúsculas, números, guiones y guiones bajos
    """
    if not username:
        return ""

    # Convertir a minúsculas y eliminar espacios al inicio/final
    username = username.lower().strip()

    # Reemplazar espacios y caracteres no permitidos por guiones bajos
    username = re.sub(r'[^a-z0-9_-]', '_', username)

    # Asegurar que comience con letra o guion bajo (no con número o guion)
    if username and not re.match(r'^[a-z_]', username):
        username = f"_{username}"

    # Validar que el resultado sea válido
    if not re.match(r'^[a-z_][a-z0-9_-]*$', username):
        return ""

    return username


@router.get("/", response_model=List[UserResponse])
def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Lista todos los usuarios"""
    return get_all_users(db, skip=skip, limit=limit)


@router.get("/count/total")
def count_total_users(db: Session = Depends(get_db)):
    """Cuenta el total de usuarios"""
    users = get_all_users(db)
    return {"count": len(users)}


@router.get("/count/active")
def count_active_users(db: Session = Depends(get_db)):
    """Cuenta usuarios activos"""
    users = get_active_users(db)
    return {"count": len(users)}


@router.get("/count/admin")
def count_admin_users(db: Session = Depends(get_db)):
    """Cuenta usuarios administradores"""
    users = get_admin_users(db)
    return {"count": len(users)}


@router.get("/active", response_model=List[UserResponse])
def list_active_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Lista usuarios activos"""
    return get_active_users(db, skip=skip, limit=limit)


@router.get("/admins", response_model=List[UserResponse])
def list_admin_users(db: Session = Depends(get_db)):
    """Lista usuarios administradores"""
    return get_admin_users(db)


@router.get("/{user_id}", response_model=UserResponse)
def read_user(user_id: int, db: Session = Depends(get_db)):
    """Obtiene un usuario por ID"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.post("/", response_model=UserResponse)
def create_new_user(payload: UserCreate, db: Session = Depends(get_db)):
    """Crea un nuevo usuario"""
    # Validar que no exista
    existing = get_user_by_username(db, payload.username)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    return create_user(db, payload)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user_data(user_id: int, updates: dict, db: Session = Depends(get_db)):
    """Actualiza datos de un usuario"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updated = update_user(db, user_id, updates)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Update failed")
    return updated


@router.put("/{user_id}/password")
def change_password(user_id: int, password_data: PasswordChange, db: Session = Depends(get_db)):
    """Cambia la contraseña de un usuario"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updated = update_user_password(db, user_id, password_data.new_password)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password update failed")
    return {"success": True, "message": "Password updated"}


@router.post("/{user_id}/expire-password", response_model=UserResponse)
def expire_password(user_id: int, db: Session = Depends(get_db)):
    """Fuerza al usuario a cambiar su contraseña en el próximo login"""
    user = expire_user_password(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.put("/{user_id}/activate", response_model=UserResponse)
def activate_user_account(user_id: int, db: Session = Depends(get_db)):
    """Activa un usuario"""
    user = activate_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.put("/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user_account(user_id: int, db: Session = Depends(get_db)):
    """Desactiva un usuario"""
    user = deactivate_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.put("/{user_id}/toggle-admin", response_model=UserResponse)
def toggle_admin_status(user_id: int, db: Session = Depends(get_db)):
    """Cambia el estado de administrador de un usuario"""
    user = toggle_admin(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.delete("/{user_id}")
def remove_user(user_id: int, db: Session = Depends(get_db)):
    """Elimina un usuario"""
    deleted = delete_user(db, user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"deleted": True}


@router.post("/bulk-upload")
async def bulk_upload_users(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Carga masiva de usuarios desde archivo CSV o TXT.

    Formato CSV: username (una columna)
    Formato TXT: un username por línea

    Email generado automáticamente: {username}@estud.usfq.edu.ec
    Contraseña por defecto: {username}{año}
    Todos los usuarios creados así NO son administradores
    """
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file provided")

    # Validar extensión
    file_ext = file.filename.lower().split('.')[-1]
    if file_ext not in ['csv', 'txt']:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .csv and .txt files are supported"
        )

    # Leer contenido del archivo
    content = await file.read()
    text_content = content.decode('utf-8')

    # Año actual para la contraseña
    current_year = datetime.now().year

    users_created = []
    users_failed = []

    try:
        if file_ext == 'csv':
            # Procesar CSV
            csv_reader = csv.DictReader(io.StringIO(text_content))

            for row in csv_reader:
                username = row.get('username', '').strip()

                if not username:
                    users_failed.append({"username": username or "unknown", "reason": "Username is required"})
                    continue

                # Normalizar username para cumplir con el constraint
                original_username = username
                username = normalize_username(username)

                if not username:
                    users_failed.append({
                        "username": original_username,
                        "reason": "Invalid username format after normalization"
                    })
                    continue

                # Generar email automáticamente
                email = f"{username}@estud.usfq.edu.ec"

                # Verificar si el usuario ya existe
                if get_user_by_username(db, username):
                    users_failed.append({"username": username, "reason": "User already exists"})
                    continue

                # Crear usuario
                try:
                    default_password = f"{username}{current_year}"
                    user_data = UserCreate(
                        username=username,
                        email=email,
                        password=default_password,
                        is_admin=0,
                        is_active=1
                    )
                    # create_user already sets must_change_password=True and
                    # password_changed_at=epoch so the password is immediately expired
                    new_user = create_user(db, user_data, auto_sync=False)

                    users_created.append({
                        "id": new_user.id,
                        "username": new_user.username,
                        "email": new_user.email,
                        "original_username": original_username if original_username != username else None
                    })
                except Exception as e:
                    db.rollback()
                    users_failed.append({"username": username, "reason": str(e)})

        else:  # TXT
            # Procesar TXT (un username por línea)
            lines = text_content.strip().split('\n')

            for line in lines:
                username = line.strip()

                if not username or username.startswith('#'):  # Ignorar líneas vacías y comentarios
                    continue

                # Normalizar username para cumplir con el constraint
                original_username = username
                username = normalize_username(username)

                if not username:
                    users_failed.append({
                        "username": original_username,
                        "reason": "Invalid username format after normalization"
                    })
                    continue

                # Generar email automáticamente
                email = f"{username}@estud.usfq.edu.ec"

                # Verificar si el usuario ya existe
                if get_user_by_username(db, username):
                    users_failed.append({"username": username, "reason": "User already exists"})
                    continue

                # Crear usuario
                try:
                    default_password = f"{username}{current_year}"
                    user_data = UserCreate(
                        username=username,
                        email=email,
                        password=default_password,
                        is_admin=0,
                        is_active=1
                    )
                    # create_user already sets must_change_password=True and
                    # password_changed_at=epoch so the password is immediately expired
                    new_user = create_user(db, user_data, auto_sync=False)

                    users_created.append({
                        "id": new_user.id,
                        "username": new_user.username,
                        "email": new_user.email,
                        "original_username": original_username if original_username != username else None
                    })

                except Exception as e:
                    db.rollback()
                    users_failed.append({"username": username, "reason": str(e)})

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing file: {str(e)}"
        )

    # Sincronizar todos los usuarios con los clientes una sola vez al final
    if users_created:
        _trigger_user_sync(db)

    return {
        "success": True,
        "created": len(users_created),
        "failed": len(users_failed),
        "users_created": users_created,
        "users_failed": users_failed,
        "default_password_format": "{username}{year}",
        "email_domain": "@estud.usfq.edu.ec",
        "synced_to_clients": True if users_created else False
    }


@router.post("/{username}/change-password-from-client")
def change_password_from_client(
    username: str,
    password_data: PasswordChangeFromClient,
    x_client_host: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Endpoint para recibir cambios de contraseña desde los clientes.
    Se llama cuando un usuario cambia su contraseña vía SSH/passwd en un cliente.
    """
    # Buscar el usuario
    user = get_user_by_username(db, username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{username}' not found"
        )

    # Hashear la nueva contraseña
    hashed_password = bcrypt.hashpw(
        password_data.new_password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    # Actualizar contraseña en la base de datos central
    user.password_hash = hashed_password
    user.must_change_password = False  # Ya cambió la contraseña
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    # Sincronizar con todos los clientes
    _trigger_user_sync(db)

    return {
        "success": True,
        "message": f"Password updated for user '{username}' and synced to all clients",
        "username": username,
        "source_client": x_client_host,
        "must_change_password": False
    }
