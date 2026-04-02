from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..utils.db import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "username ~ '^[a-z_][a-z0-9_-]*$'",
            name="username_valid_pattern",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    is_admin: Mapped[int] = mapped_column(Integer, default=0)  # 0 = False, 1 = True
    is_active: Mapped[int] = mapped_column(Integer, default=1)  # 0 = False, 1 = True
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    system_uid: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    system_gid: Mapped[int | None] = mapped_column(
        Integer, nullable=True, default=None
    )  # GID auto-detected by client (docker group GID)
    ssh_public_key: Mapped[str | None] = mapped_column(String, nullable=True)
    password_max_age_days: Mapped[int | None] = mapped_column(
        Integer, nullable=True, default=None
    )  # NULL = never expires; any positive int = days until password expires
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )  # Timestamp of the last password change; used to compute sp_lstchg
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    is_admin: int = 0
    is_active: int = 1
    ssh_public_key: str | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_admin: int
    is_active: int
    must_change_password: bool
    system_uid: int
    password_max_age_days: int | None = None
    password_changed_at: datetime | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True