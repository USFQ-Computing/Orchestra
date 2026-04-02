from typing import List

from pydantic import BaseModel


class ContainerReport(BaseModel):
    """Modelo para reportar estado de un contenedor local"""

    name: str
    container_id: str
    image: str
    status: str  # running, exited, created, paused, etc.
    ports: str | None = None
    created: str | None = None


class ContainerReportResponse(BaseModel):
    """Respuesta con lista de contenedores"""

    success: bool
    message: str
    containers_count: int
    containers: List[ContainerReport]