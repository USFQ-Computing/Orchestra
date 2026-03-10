from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from ..CRUD.users import create_user
from ..models.models import (
    ChangePasswordRequest,
    LoginRequest,
    SignupRequest,
    TokenResponse,
    User,
    UserCreate,
    VerifyTokenResponse,
)
from ..utils.auth import (
    authenticate_user,
    get_user_from_token,
    hash_password,
    verify_password,
)
from ..utils.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


def get_current_staff_user(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(db, token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    if getattr(user, "is_active", 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )
    if getattr(user, "is_admin", 0) != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")
    return user


@router.post("/signup", response_model=TokenResponse)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    existing = (
        db.query(User)
        .filter((User.username == payload.username) | (User.email == payload.email))
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already exists",
        )
    # Crear usuario usando la función CRUD que asigna system_uid correctamente
    user_data = UserCreate(
        username=payload.username,
        email=payload.email,
        password=payload.password,
        is_admin=0,
        is_active=1,
    )
    user = create_user(db, user_data)
    # Devolver token
    token = authenticate_user(db, payload.username, payload.password)
    assert token is not None
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    # Validar que el usuario exista y esté activo (por username o email)
    user = (
        db.query(User)
        .filter((User.username == payload.username) | (User.email == payload.username))
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    if getattr(user, "is_active", 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )

    # Usar el username real del usuario encontrado para autenticar
    token = authenticate_user(db, user.username, payload.password)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # Verificar si debe cambiar contraseña
    must_change = getattr(user, "must_change_password", False)

    return TokenResponse(access_token=token, must_change_password=must_change)


@router.get("/verify", response_model=VerifyTokenResponse)
def verify(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        return VerifyTokenResponse(valid=False)
    user = get_user_from_token(db, token)
    if not user:
        return VerifyTokenResponse(valid=False)
    return VerifyTokenResponse(
        valid=True,
        user_id=user.id,
        username=user.username,
        email=getattr(user, "email", ""),
        is_admin=getattr(user, "is_admin", 0),
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Endpoint para cambiar la contraseña del usuario autenticado.
    Si el usuario tiene must_change_password=1, este será su único endpoint accesible
    hasta que cambie su contraseña.
    """
    # Validar token
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )

    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(db, token)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    # Verificar contraseña actual
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Validar nueva contraseña (mínimo 6 caracteres)
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 6 characters",
        )

    # Verificar que la nueva contraseña sea diferente
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password",
        )

    # Actualizar contraseña
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False  # Desmarcar flag de cambio obligatorio
    user.password_changed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(user)

    # Sincronizar usuarios a todos los clientes
    try:
        from ..utils.user_sync import trigger_user_sync

        trigger_user_sync()
    except Exception as e:
        print(f"⚠️  Warning: Could not trigger user sync after password change: {e}")

    return {"success": True, "message": "Password changed successfully"}
