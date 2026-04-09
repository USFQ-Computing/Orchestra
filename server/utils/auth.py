from datetime import datetime, timedelta
from typing import Optional, Any, Dict
from passlib.context import CryptContext
import jwt
import os
import logging
from sqlalchemy.orm import Session
from ..models.models import User

# Clave y algoritmo para JWT (ideal cargar desde variables de entorno)
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE_ME_SUPER_SECRET")  # Reemplazar en producción
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
	return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
	return pwd_context.verify(plain_password, hashed_password)


def create_access_token(sub: str, user_id: int, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
	expire = datetime.utcnow() + timedelta(minutes=expires_minutes)
	payload = {
		"sub": sub,
		"user_id": user_id,
		"iat": datetime.utcnow(),
		"exp": expire,
	}
	token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
	return token


def verify_token(token: str) -> Optional[Dict[str, Any]]:
	try:
		decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
		return decoded
	except jwt.ExpiredSignatureError:
		return None
	except jwt.InvalidTokenError:
		return None


def authenticate_user(db: Session, username: str, password: str) -> Optional[str]:
	logger.debug("authenticate_user start username=%s", username)
	user: Optional[User] = db.query(User).filter(User.username == username).first()
	if not user:
		logger.debug("authenticate_user failed: user not found username=%s", username)
		return None
	logger.debug(
		"authenticate_user found user username=%s is_active=%s stored_hash=%s",
		user.username,
		getattr(user, "is_active", None),
		user.password_hash,
	)
	is_valid_password = verify_password(password, user.password_hash)
	if not is_valid_password:
		logger.debug("authenticate_user failed: invalid password username=%s", user.username)
		return None
	if user.is_active == 0:
		logger.debug("authenticate_user failed: inactive user username=%s", user.username)
		return None
	logger.debug("authenticate_user success username=%s", user.username)
	return create_access_token(sub=user.username, user_id=user.id)


def get_user_from_token(db: Session, token: str) -> Optional[User]:
	payload = verify_token(token)
	if not payload:
		return None
	user_id = payload.get("user_id")
	if user_id is None:
		return None
	return db.query(User).filter(User.id == user_id).first()

