from pydantic import BaseModel
from sqlalchemy import Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from ..utils.db import Base


class ServerCreate(BaseModel):
    name: str
    ip_address: str
    ssh_user: str = "root"
    ssh_password: (
        str  # Password requerido para configurar SSH key y usado para become/sudo
    )
    ssh_port: int = 22
    description: str = ""
    container_runtime_defaults: dict | None = None


class ServerResponse(BaseModel):
    id: int
    name: str
    ip_address: str
    status: str
    ssh_user: str
    ssh_private_key_path: str | None
    ssh_status: str | None = "pending"
    has_ssh_password: bool = (
        False  # Indica si tiene contraseña guardada (usada para become/sudo)
    )
    container_runtime_defaults: dict | None = None

    class Config:
        from_attributes = True


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    ip_address: Mapped[str] = mapped_column(String, unique=True, index=True)
    status: Mapped[str] = mapped_column(String, default="offline")
    ssh_user: Mapped[str] = mapped_column(String, default="root")
    ssh_private_key_path: Mapped[str | None] = mapped_column(String, nullable=True)
    ssh_status: Mapped[str] = mapped_column(
        String, default="pending"
    )  # pending, deployed, failed
    ssh_password_encrypted: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # Contraseña SSH encriptada (también usada para become/sudo)
    container_runtime_defaults: Mapped[dict | None] = mapped_column(
        JSON, nullable=True
    )