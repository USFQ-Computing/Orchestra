from typing import Optional

from pydantic import BaseModel


class SignupRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    must_change_password: bool = False  # Indica si debe cambiar contraseña


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    token_type: str = "bearer"


class VerifyTokenResponse(BaseModel):
    valid: bool
    user_id: Optional[int] = None
    username: Optional[str] = None
    email: Optional[str] = None
    is_admin: Optional[int] = None