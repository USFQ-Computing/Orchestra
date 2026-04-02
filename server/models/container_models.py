from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..utils.db import Base


class Container(Base):
    __tablename__ = "containers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    server_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("servers.id"), index=True
    )
    image: Mapped[str] = mapped_column(String)
    ports: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="stopped")  # stopped, running
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    container_id: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # Docker container ID
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ContainerCreate(BaseModel):
    name: str
    server_id: int
    image: str
    ports: str | None = None
    user_id: int | None = (
        None  # Optional: para admin crear contenedor para otro usuario
    )


class ContainerResponse(BaseModel):
    id: int
    name: str
    user_id: int
    username: str | None = None
    server_id: int
    server_name: str | None = None
    server_ip: str | None = None
    image: str
    ports: str | None
    status: str
    is_public: bool
    container_id: str | None
    created_at: datetime

    class Config:
        from_attributes = True