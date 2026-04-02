from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..utils.db import Base


class AnsibleTaskCreate(BaseModel):
    name: str
    playbook: str
    inventory: str


class AnsibleTaskResponse(BaseModel):
    id: int
    name: str
    playbook: str
    inventory: str

    class Config:
        from_attributes = True


class AnsibleTask(Base):
    __tablename__ = "ansible_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    playbook: Mapped[str] = mapped_column(String)
    inventory: Mapped[str] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )