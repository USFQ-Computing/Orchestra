from datetime import datetime
from enum import Enum

from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..utils.db import Base


class ExecutionState(str, Enum):
    success = "success"
    error = "error"
    dry = "dry"


class ExecutedPlaybook(Base):
    __tablename__ = "executed_playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    playbook_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ansible_tasks.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    servers: Mapped[list[int]] = mapped_column(
        ARRAY(Integer)
    )  # Lista de IDs de servidores
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    state: Mapped[str] = mapped_column(String, index=True)  # success | error | dry


class ExecutedPlaybookCreate(BaseModel):
    playbook_id: int
    user_id: int
    servers: list[int]
    state: ExecutionState


class ExecutedPlaybookResponse(BaseModel):
    id: int
    playbook_id: int
    user_id: int
    servers: list[int]
    executed_at: datetime
    state: str

    class Config:
        from_attributes = True


class ExecutedPlaybookResponseWithUser(BaseModel):
    id: int
    playbook_id: int
    user_id: int
    user_username: str | None = None
    servers: list[int]
    executed_at: datetime
    state: str

    class Config:
        from_attributes = True