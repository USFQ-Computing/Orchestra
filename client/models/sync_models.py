from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class UserSync(BaseModel):
    """Modelo para sincronizar usuarios"""

    id: int
    username: str
    email: str
    password_hash: str
    is_admin: int
    is_active: int
    must_change_password: bool = False
    system_uid: int
    system_gid: Optional[int] = None
    ssh_public_key: Optional[str] = None
    password_max_age_days: Optional[int] = None
    password_changed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class SyncRequest(BaseModel):
    """Request de sincronización con metadatos"""

    server_url: Optional[str] = None  # URL del servidor central
    users: List[UserSync]


class SyncResponse(BaseModel):
    """Respuesta de sincronización"""

    success: bool
    message: str
    users_synced: int
    users_created: int
    users_updated: int
    users_deleted: int