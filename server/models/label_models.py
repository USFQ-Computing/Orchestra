from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..utils.db import Base


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    container_runtime_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserLabel(Base):
    __tablename__ = "user_labels"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    label_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class LabelCreate(BaseModel):
    name: str
    slug: str
    color: str | None = None
    active: bool = True
    container_runtime_overrides: dict | None = None


class LabelUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    color: str | None = None
    active: bool | None = None
    container_runtime_overrides: dict | None = None


class LabelResponse(BaseModel):
    id: int
    name: str
    slug: str
    color: str | None
    active: bool
    container_runtime_overrides: dict | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True