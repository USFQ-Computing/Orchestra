import os
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..CRUD.servers import (
    count_servers,
    count_servers_by_status,
    create_multiple_servers,
    create_server,
    delete_server,
    delete_server_by_name,
    get_all_servers,
    get_offline_servers,
    get_online_servers,
    get_server_by_id,
    get_server_by_ip,
    get_server_by_name,
    get_servers_by_status,
    set_server_offline,
    set_server_online,
    update_server,
    update_server_ip,
    update_server_name,
    update_server_status,
)
from ..CRUD.app_settings import (
    get_container_runtime_global_defaults,
    set_container_runtime_global_defaults,
)
from ..CRUD.containers import (
    GLOBAL_CONTAINER_RUNTIME_DEFAULTS,
    _sanitize_runtime_policy,
)
from ..CRUD.users import get_all_users
from ..models.models import MetricResponse, Server, ServerCreate, ServerResponse
from ..utils.db import get_db
from ..utils.user_sync import sync_users_to_client


def server_to_response(server: Server) -> ServerResponse:
    """Convierte un objeto Server a ServerResponse incluyendo has_ssh_password"""
    return ServerResponse(
        id=server.id,
        name=server.name,
        ip_address=server.ip_address,
        status=server.status,
        ssh_user=server.ssh_user,
        ssh_private_key_path=server.ssh_private_key_path,
        ssh_status=server.ssh_status,
        has_ssh_password=bool(server.ssh_password_encrypted),
        container_runtime_defaults=server.container_runtime_defaults,
    )


from .auth import get_current_staff_user


# Función para obtener usuario autenticado (no requiere ser staff)
def get_current_user(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
):
    """Get current authenticated user (staff or regular user)"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    token = authorization.split(" ", 1)[1]
    from ..utils.auth import get_user_from_token

    user = get_user_from_token(db, token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    if getattr(user, "is_active", 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )
    return user


router = APIRouter(prefix="/servers", tags=["servers"])

# URL del cliente desde variable de entorno
CLIENT_URL = os.getenv("CLIENT_URL", "http://client:8100")


class RetrySSHDeployRequest(BaseModel):
    """Request model for retrying SSH key deployment"""

    ssh_password: str
    ssh_port: int = 22


class SaveSSHPasswordRequest(BaseModel):
    """Request model for saving SSH password to existing server"""

    ssh_password: str


class GlobalRuntimeDefaultsUpdateRequest(BaseModel):
    container_runtime_defaults: dict | None = None


async def sync_users_to_new_server(server: Server, db: Session):
    """Tarea en background para sincronizar usuarios al servidor recién creado"""
    # Sincronizar todos los usuarios al cliente
    users = get_all_users(db)
    users_data = [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "password_hash": user.password_hash,
            "is_admin": user.is_admin,
            "is_active": user.is_active,
            "must_change_password": user.must_change_password,
            "system_uid": user.system_uid,
            "system_gid": user.system_gid,
            "ssh_public_key": user.ssh_public_key,
            "password_max_age_days": user.password_max_age_days,
            "password_changed_at": user.password_changed_at.isoformat() if user.password_changed_at else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
        for user in users
    ]

    # Sincronizar usuarios con el cliente
    client_url = f"http://{server.ip_address}:8100"
    await sync_users_to_client(client_url, users_data, server.name)


@router.post("/", response_model=ServerResponse)
async def create_new_server(
    payload: ServerCreate,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    # Validar que no exista servidor con mismo nombre o IP
    if get_server_by_name(db, payload.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Server name already exists"
        )
    if get_server_by_ip(db, payload.ip_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="IP address already in use"
        )

    # Crear servidor en BD
    new_server = create_server(db, payload)

    # Sincronizar usuarios en background
    background_tasks.add_task(sync_users_to_new_server, new_server, db)

    return new_server


@router.get("/", response_model=List[ServerResponse])
def list_servers(
    skip: int = 0,
    limit: int = 100,
    check_status: bool = True,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    servers = get_all_servers(
        db,
        skip=skip,
        limit=limit,
        check_status=check_status,
    )
    return [server_to_response(s) for s in servers]


# Rutas de conteo ANTES de las rutas con parámetros dinámicos
@router.get("/count/total")
def count_all_servers(user=Depends(get_current_user), db: Session = Depends(get_db)):
    count = count_servers(db)
    print(f"[SERVERS] Total count: {count}")
    return {"count": count}


@router.get("/count/by-status/{status_filter}")
def count_servers_by_status_filter(
    status_filter: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    count = count_servers_by_status(db, status_filter)
    print(f"[SERVERS] Count by status '{status_filter}': {count}")
    return {"count": count}


@router.get("/runtime-defaults/global")
def get_global_runtime_defaults(
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    persisted = get_container_runtime_global_defaults(db)
    effective = dict(GLOBAL_CONTAINER_RUNTIME_DEFAULTS)
    effective.update(_sanitize_runtime_policy(persisted))

    return {
        "container_runtime_defaults": persisted or {},
        "effective_container_runtime_defaults": effective,
    }


@router.patch("/runtime-defaults/global")
def patch_global_runtime_defaults(
    payload: GlobalRuntimeDefaultsUpdateRequest,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    sanitized = _sanitize_runtime_policy(payload.container_runtime_defaults)
    saved = set_container_runtime_global_defaults(db, sanitized)

    effective = dict(GLOBAL_CONTAINER_RUNTIME_DEFAULTS)
    effective.update(saved)

    return {
        "container_runtime_defaults": saved,
        "effective_container_runtime_defaults": effective,
    }


@router.get("/{server_id}", response_model=ServerResponse)
def read_server(
    server_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    server = get_server_by_id(db, server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return server_to_response(server)


@router.get("/by-name/{name}", response_model=ServerResponse)
def read_server_by_name(
    name: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    server = get_server_by_name(db, name)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return server_to_response(server)


@router.get("/by-ip/{ip_address}", response_model=ServerResponse)
def read_server_by_ip(
    ip_address: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    server = get_server_by_ip(db, ip_address)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return server_to_response(server)


@router.get("/status/{status_filter}", response_model=List[ServerResponse])
def list_servers_by_status(
    status_filter: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    servers = get_servers_by_status(db, status_filter)
    return [server_to_response(s) for s in servers]


@router.get("/status/online/list", response_model=List[ServerResponse])
def list_online_servers(user=Depends(get_current_user), db: Session = Depends(get_db)):
    servers = get_online_servers(db)
    return [server_to_response(s) for s in servers]


@router.get("/status/offline/list", response_model=List[ServerResponse])
def list_offline_servers(user=Depends(get_current_user), db: Session = Depends(get_db)):
    servers = get_offline_servers(db)
    return [server_to_response(s) for s in servers]


@router.patch("/{server_id}", response_model=ServerResponse)
def patch_server(
    server_id: int,
    updates: dict,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    # Validar que el servidor exista
    if not get_server_by_id(db, server_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Validar unicidad de nombre e IP si se están actualizando
    if "name" in updates:
        existing = get_server_by_name(db, updates["name"])
        if existing and existing.id != server_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Server name already exists",
            )

    if "ip_address" in updates:
        existing = get_server_by_ip(db, updates["ip_address"])
        if existing and existing.id != server_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="IP address already in use",
            )

    updated = update_server(db, server_id, updates)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Update failed"
        )
    return updated


@router.put("/{server_id}/status", response_model=ServerResponse)
def put_server_status(
    server_id: int,
    new_status: str,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    updated = update_server_status(db, server_id, new_status)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return updated


@router.put("/{server_id}/online", response_model=ServerResponse)
def mark_server_online(
    server_id: int, user=Depends(get_current_staff_user), db: Session = Depends(get_db)
):
    updated = set_server_online(db, server_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return updated


@router.put("/{server_id}/offline", response_model=ServerResponse)
def mark_server_offline(
    server_id: int, user=Depends(get_current_staff_user), db: Session = Depends(get_db)
):
    updated = set_server_offline(db, server_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return updated


@router.put("/{server_id}/name", response_model=ServerResponse)
def put_server_name(
    server_id: int,
    name: str,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    # Validar unicidad
    existing = get_server_by_name(db, name)
    if existing and existing.id != server_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Server name already exists"
        )

    updated = update_server_name(db, server_id, name)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return updated


@router.put("/{server_id}/ip", response_model=ServerResponse)
def put_server_ip(
    server_id: int,
    ip_address: str,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    # Validar unicidad
    existing = get_server_by_ip(db, ip_address)
    if existing and existing.id != server_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="IP address already in use"
        )

    updated = update_server_ip(db, server_id, ip_address)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return updated


@router.delete("/{server_id}")
async def remove_server(
    server_id: int,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    deleted = delete_server(db, server_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    return {"deleted": True}


@router.delete("/by-name/{name}")
def remove_server_by_name(
    name: str, user=Depends(get_current_staff_user), db: Session = Depends(get_db)
):
    deleted = delete_server_by_name(db, name)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return {"deleted": True}


@router.post("/{server_id}/retry-ssh-deploy")
def retry_ssh_deploy(
    server_id: int,
    payload: RetrySSHDeployRequest,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    """
    Reintentar el despliegue de clave SSH en un servidor que falló.
    """
    from pathlib import Path

    from ..utils.ssh import deploy_ssh_key

    # Get server
    server = get_server_by_id(db, server_id, check_status=False)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Check if SSH key exists
    public_key_path = Path(f"/app/{server.ssh_private_key_path}.pub")
    if not public_key_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"SSH public key not found. Generate keys first.",
        )

    # Read public key
    with open(public_key_path, "r") as f:
        public_key = f.read().strip()

    # Update status to pending while deploying
    server.ssh_status = "pending"  # type: ignore
    db.commit()

    # Try to deploy
    deploy_success = deploy_ssh_key(
        host=server.ip_address,
        username=server.ssh_user,
        password=payload.ssh_password,
        public_key=public_key,
        port=payload.ssh_port,
    )

    # Update status based on result
    if deploy_success:
        server.ssh_status = "deployed"  # type: ignore
        db.commit()
        return {
            "success": True,
            "ssh_status": "deployed",
            "message": f"SSH key deployed successfully to {server.name}",
        }
    else:
        server.ssh_status = "failed"  # type: ignore
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deploy SSH key. Check password and connectivity.",
        )


@router.patch("/{server_id}/ssh-password")
def save_ssh_password(
    server_id: int,
    payload: SaveSSHPasswordRequest,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    """
    Guarda la contraseña SSH de un servidor existente (encriptada).
    Útil para servidores creados antes de implementar el almacenamiento de contraseñas.
    """
    from ..utils.encryption import encrypt_password

    # Get server
    server = get_server_by_id(db, server_id, check_status=False)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Encrypt and save password
    encrypted_password = encrypt_password(payload.ssh_password)
    server.ssh_password_encrypted = encrypted_password  # type: ignore
    db.commit()
    db.refresh(server)

    return {
        "success": True,
        "message": f"SSH password saved for server {server.name}",
        "has_ssh_password": True,
    }


@router.post("/{server_id}/sync-users")
async def manual_sync_users(
    server_id: int,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    """
    Sincroniza manualmente todos los usuarios al servidor especificado.
    Útil para forzar sincronización o recuperar de errores.
    """
    # Verificar que el servidor existe
    server = get_server_by_id(db, server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Sincronizar usuarios en background
    background_tasks.add_task(sync_users_to_new_server, server, db)

    return {
        "success": True,
        "message": f"User synchronization started for server '{server.name}'",
        "server_id": server_id,
        "server_name": server.name,
        "server_ip": server.ip_address,
    }


@router.post("/bulk", response_model=List[ServerResponse])
def bulk_create_servers(
    payload: List[ServerCreate],
    user=Depends(get_current_staff_user),
    db: Session = Depends(get_db),
):
    # Validar duplicados antes de crear
    for server_data in payload:
        if get_server_by_name(db, server_data.name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Server name '{server_data.name}' already exists",
            )
        if get_server_by_ip(db, server_data.ip_address):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"IP '{server_data.ip_address}' already in use",
            )

    return create_multiple_servers(db, payload)


# --------- Metrics Endpoints ---------


@router.get("/{server_id}/metrics", response_model=List[MetricResponse])
def get_server_metrics(
    server_id: int,
    limit: int = 10,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Obtiene las últimas métricas de un servidor específico"""
    from ..models.models import Metric

    if not get_server_by_id(db, server_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return (
        db.query(Metric)
        .filter(Metric.server_id == server_id)
        .order_by(Metric.timestamp.desc())
        .limit(limit)
        .all()
    )


@router.get("/metrics/all")
def get_all_metrics(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Obtiene la última métrica de todos los servidores"""
    from ..models.models import Metric

    servers = get_all_servers(db)
    result = {}
    for server in servers:
        latest = (
            db.query(Metric)
            .filter(Metric.server_id == server.id)
            .order_by(Metric.timestamp.desc())
            .first()
        )
        result[server.id] = {
            "server": {
                "id": server.id,
                "name": server.name,
                "ip_address": server.ip_address,
                "status": server.status,
            },
            "latest_metric": latest,
        }
    return result
