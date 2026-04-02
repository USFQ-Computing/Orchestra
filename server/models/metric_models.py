from pydantic import BaseModel
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..utils.db import Base


class Metric(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    server_id: Mapped[int] = mapped_column(Integer, index=True)
    cpu_usage: Mapped[str] = mapped_column(String)
    memory_usage: Mapped[str] = mapped_column(String)
    disk_usage: Mapped[str] = mapped_column(String)
    timestamp: Mapped[str] = mapped_column(String)
    gpu_usage: Mapped[str] = mapped_column(String, default="N/A")


class MetricCreate(BaseModel):
    server_id: int
    cpu_usage: str
    memory_usage: str
    disk_usage: str
    timestamp: str
    gpu_usage: str = "N/A"


class MetricResponse(BaseModel):
    id: int
    server_id: int
    cpu_usage: str
    memory_usage: str
    disk_usage: str
    timestamp: str
    gpu_usage: str

    class Config:
        from_attributes = True