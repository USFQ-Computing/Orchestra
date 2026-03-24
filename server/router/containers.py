from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..CRUD.containers import (
    count_user_containers_on_server,
    create_colab_container_with_docker,
    create_container_with_docker,
    delete_container_with_docker,
    get_all_containers,
    get_container_by_id,
    get_containers_by_user,
    get_public_containers,
    start_container_with_docker,
    stop_container_with_docker,
    toggle_container_public,
)
from ..CRUD.servers import get_server_by_id
from ..CRUD.users import get_user_by_id
from ..models.models import (
    ContainerCreate,
    ContainerResponse,
    Server,
    User,
)
from ..utils.auth import get_user_from_token
from ..utils.container_sync import (
    get_containers_status_from_client,
    sync_all_servers,
    update_containers_status_from_client,
)
from ..utils.db import get_db
from ..utils.docker_remote import (
    DockerConnectionError,
    DockerContainerNotFoundError,
    DockerImageNotFoundError,
    DockerNotInstalledError,
    DockerPortConflictError,
    DockerRemoteError,
    DockerRemoteManager,
)
from ..utils.docker_validators import DockerValidationError

router = APIRouter(prefix="/containers", tags=["containers"])


def _build_container_responses(
    db: Session,
    containers,
) -> List[ContainerResponse]:
    """Build container responses without N+1 queries."""
    if not containers:
        return []

    server_ids = {container.server_id for container in containers}
    user_ids = {container.user_id for container in containers}

    servers = db.query(Server).filter(Server.id.in_(server_ids)).all() if server_ids else []
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []

    server_by_id = {server.id: server for server in servers}
    user_by_id = {container_user.id: container_user for container_user in users}

    result = []
    for container in containers:
        server = server_by_id.get(container.server_id)
        container_user = user_by_id.get(container.user_id)
        container_dict = {
            "id": container.id,
            "name": container.name,
            "user_id": container.user_id,
            "username": container_user.username if container_user else None,
            "server_id": container.server_id,
            "server_name": server.name if server else "Unknown",
            "server_ip": server.ip_address if server else None,
            "image": container.image,
            "ports": container.ports,
            "status": container.status,
            "is_public": container.is_public,
            "container_id": container.container_id,
            "created_at": container.created_at,
        }
        result.append(ContainerResponse(**container_dict))

    return result


def get_current_user(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
):
    """Get current authenticated user"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    token = authorization.split(" ", 1)[1]
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


@router.get("/my", response_model=List[ContainerResponse])
def get_my_containers(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Obtiene todos los contenedores del usuario actual"""
    containers = get_containers_by_user(db, user.id)
    return _build_container_responses(db, containers)


@router.get("/public", response_model=List[ContainerResponse])
def get_public_containers_list(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Obtiene todos los contenedores públicos"""
    """Obtiene todos los contenedores públicos (disponible para todos los usuarios)"""
    containers = get_public_containers(db)
    return _build_container_responses(db, containers)


@router.get("/all", response_model=List[ContainerResponse])
def get_all_containers_list(
    server_id: Optional[int] = Query(None, description="Filtrar por ID de servidor"),
    user_id: Optional[int] = Query(None, description="Filtrar por ID de usuario"),
    status: Optional[str] = Query(
        None, description="Filtrar por estado (running, stopped, etc.)"
    ),
    is_public: Optional[bool] = Query(
        None, description="Filtrar por visibilidad pública"
    ),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Obtiene todos los contenedores de todos los servidores con filtros opcionales (solo admin)"""

    # Solo admin puede ver todos los contenedores
    if user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can access all containers",
        )

    # Obtener contenedores con filtros
    containers = get_all_containers(
        db, server_id=server_id, user_id=user_id, status=status, is_public=is_public
    )
    return _build_container_responses(db, containers)


@router.get("/{container_id}", response_model=ContainerResponse)
def get_container(
    container_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Obtiene un contenedor por ID"""
    """Obtiene un contenedor por ID (solo el propietario o admin)"""
    container = get_container_by_id(db, container_id)
    if not container:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Container not found"
        )

    # Verificar permisos: propietario o admin
    if container.user_id != user.id and user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this container",
        )

    server = get_server_by_id(db, container.server_id)
    container_user = get_user_by_id(db, container.user_id)
    container_dict = {
        "id": container.id,
        "name": container.name,
        "user_id": container.user_id,
        "username": container_user.username if container_user else None,
        "server_id": container.server_id,
        "server_name": server.name if server else "Unknown",
        "server_ip": server.ip_address if server else None,
        "image": container.image,
        "ports": container.ports,
        "status": container.status,
        "is_public": container.is_public,
        "container_id": container.container_id,
        "created_at": container.created_at,
    }
    return ContainerResponse(**container_dict)


@router.post(
    "/colab", response_model=ContainerResponse, status_code=status.HTTP_201_CREATED
)
def create_colab_container(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Crea un contenedor Colab con GPU y configuración especial para el usuario"""

    # Obtener el primer servidor disponible (o puedes permitir que el usuario elija)
    from ..CRUD.servers import get_all_servers

    servers = get_all_servers(db)

    if not servers:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No servers available"
        )

    # Usar el primer servidor disponible
    server = servers[0]

    # Verificar que SSH está configurado
    if server.ssh_status != "deployed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SSH not configured on server. Current status: {server.ssh_status}",
        )

    # Verificar límite: 1 contenedor por servidor por usuario
    existing_count = count_user_containers_on_server(db, user.id, server.id)
    if existing_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a container on this server. Maximum 1 container per server allowed.",
        )

    # Crear el contenedor Colab
    try:
        container = create_colab_container_with_docker(
            db=db,
            server=server,
            user_id=user.id,
            username=user.username,
        )

        # Preparar respuesta
        container_dict = {
            "id": container.id,
            "name": container.name,
            "user_id": container.user_id,
            "server_id": container.server_id,
            "server_name": server.name,
            "server_ip": server.ip_address,
            "image": container.image,
            "ports": container.ports,
            "status": container.status,
            "is_public": container.is_public,
            "container_id": container.container_id,
            "created_at": container.created_at,
        }

        return ContainerResponse(**container_dict)

    except DockerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Validation error: {str(e)}",
        )
    except DockerConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Cannot connect to server: {str(e)}",
        )
    except DockerImageNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Colab image not found: {str(e)}",
        )
    except DockerRemoteError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Docker error: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("", response_model=ContainerResponse, status_code=status.HTTP_201_CREATED)
async def create_new_container(
    container_data: ContainerCreate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Crea un nuevo contenedor en Docker y en la base de datos"""

    # Verificar que el servidor existe
    server = get_server_by_id(db, container_data.server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Verificar que SSH está configurado
    if server.ssh_status != "deployed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SSH not configured on server. Current status: {server.ssh_status}",
        )

    # Determinar el usuario propietario del contenedor
    target_user_id = user.id  # Por defecto, el usuario actual

    # Si se especifica user_id y el usuario actual es admin, usar ese user_id
    if container_data.user_id is not None:
        if not user.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can create containers for other users",
            )

        # Verificar que el usuario objetivo existe
        target_user = get_user_by_id(db, container_data.user_id)
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id {container_data.user_id} not found",
            )

        target_user_id = container_data.user_id

    # Verificar límite: 1 contenedor por servidor por usuario
    existing_count = count_user_containers_on_server(
        db, target_user_id, container_data.server_id
    )
    if existing_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a container on this server. Maximum 1 container per server allowed.",
        )

    # Crear el contenedor en Docker y BD
    try:
        container = create_container_with_docker(
            db, server, target_user_id, container_data
        )

        # Opcional: Actualizar estado desde el cliente después de crear
        # (no es crítico, el estado se actualizará en la próxima consulta)

        # Preparar respuesta
        container_user = get_user_by_id(db, container.user_id)
        container_dict = {
            "id": container.id,
            "name": container.name,
            "user_id": container.user_id,
            "username": container_user.username if container_user else None,
            "server_id": container.server_id,
            "server_name": server.name,
            "server_ip": server.ip_address,
            "image": container.image,
            "ports": container.ports,
            "status": container.status,
            "is_public": container.is_public,
            "container_id": container.container_id,
            "created_at": container.created_at,
        }

        return ContainerResponse(**container_dict)

    except DockerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Validation error: {str(e)}",
        )
    except DockerConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Cannot connect to server: {str(e)}",
        )
    except DockerImageNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Image not found: {str(e)}"
        )
    except DockerPortConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Port conflict: {str(e)}"
        )
    except DockerRemoteError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Docker error: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("/{container_id}/start")
async def start_container(
    container_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Inicia un contenedor en Docker"""
    container = get_container_by_id(db, container_id)

    if not container:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Container not found"
        )

    # Verificar permisos: solo el dueño o admin puede iniciar
    if container.user_id != user.id and user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to start this container",
        )

    # Obtener servidor
    server = get_server_by_id(db, container.server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Iniciar contenedor en Docker
    try:
        updated_container = start_container_with_docker(db, server, container)

        # El estado se actualizará en la próxima consulta al cliente

        return {
            "success": True,
            "message": "Container started successfully",
            "container_id": container_id,
            "status": updated_container.status,
        }

    except DockerConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Cannot connect to server: {str(e)}",
        )
    except DockerContainerNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Container not found in Docker: {str(e)}",
        )
    except DockerRemoteError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Docker error: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("/{container_id}/stop")
async def stop_container(
    container_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detiene un contenedor en Docker"""
    container = get_container_by_id(db, container_id)

    if not container:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Container not found"
        )

    # Verificar permisos: solo el dueño o admin puede detener
    if container.user_id != user.id and user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to stop this container",
        )

    # Obtener servidor
    server = get_server_by_id(db, container.server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Detener contenedor en Docker
    try:
        updated_container = stop_container_with_docker(db, server, container)

        # El estado se actualizará en la próxima consulta al cliente

        return {
            "success": True,
            "message": "Container stopped successfully",
            "container_id": container_id,
            "status": updated_container.status,
        }

    except DockerConnectionError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Cannot connect to server: {str(e)}",
        )
    except DockerContainerNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Container not found in Docker: {str(e)}",
        )
    except DockerRemoteError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Docker error: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.delete("/{container_id}")
async def delete_container_endpoint(
    container_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Elimina un contenedor en Docker y de la base de datos"""
    container = get_container_by_id(db, container_id)

    if not container:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Container not found"
        )

    # Verificar permisos: solo el dueño o admin puede eliminar
    if container.user_id != user.id and user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to delete this container",
        )

    # Obtener servidor
    server = get_server_by_id(db, container.server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Eliminar contenedor de Docker y BD
    try:
        success = delete_container_with_docker(db, server, container)

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete container",
            )

        # El contenedor ya no existe, no hay nada que sincronizar

        return {
            "success": True,
            "message": "Container deleted successfully",
            "container_id": container_id,
        }

    except DockerConnectionError as e:
        # Si no podemos conectar, eliminar solo de BD
        from ..CRUD.containers import delete_container

        delete_container(db, container_id)
        return {
            "success": True,
            "message": f"Container deleted from database (could not connect to Docker: {str(e)})",
            "container_id": container_id,
        }
    except DockerRemoteError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Docker error: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("/{container_id}/toggle-public")
def toggle_container_visibility(
    container_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambia la visibilidad pública/privada de un contenedor"""
    container = get_container_by_id(db, container_id)

    if not container:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Container not found"
        )

    # Verificar permisos: solo el dueño puede cambiar visibilidad
    if container.user_id != user.id and user.is_admin != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to change this container's visibility",
        )

    updated_container = toggle_container_public(db, container_id)

    return {
        "success": True,
        "message": f"Container is now {'public' if updated_container.is_public else 'private'}",
        "container_id": container_id,
        "is_public": updated_container.is_public,
    }


@router.get("/server/{server_id}/docker-status")
def check_server_docker_status(
    server_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Verifica si Docker está instalado y corriendo en un servidor"""

    # Verificar que el servidor existe
    server = get_server_by_id(db, server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Verificar que SSH está configurado
    if server.ssh_status != "deployed":
        return {
            "success": False,
            "server_id": server_id,
            "server_name": server.name,
            "ssh_configured": False,
            "ssh_status": server.ssh_status,
            "docker_installed": False,
            "docker_running": False,
            "error": f"SSH not configured. Status: {server.ssh_status}",
        }

    try:
        with DockerRemoteManager(server) as docker:
            # Verificar si Docker está instalado
            is_installed, version_info = docker.check_docker_installed()

            if not is_installed:
                return {
                    "success": False,
                    "server_id": server_id,
                    "server_name": server.name,
                    "ssh_configured": True,
                    "docker_installed": False,
                    "docker_running": False,
                    "error": version_info,
                }

            # Verificar si Docker daemon está corriendo
            is_running, daemon_info = docker.check_docker_running()

            return {
                "success": is_running,
                "server_id": server_id,
                "server_name": server.name,
                "ssh_configured": True,
                "docker_installed": True,
                "docker_running": is_running,
                "docker_version": version_info,
                "daemon_info": daemon_info if is_running else None,
                "error": None if is_running else daemon_info,
            }

    except DockerConnectionError as e:
        return {
            "success": False,
            "server_id": server_id,
            "server_name": server.name,
            "ssh_configured": True,
            "docker_installed": None,
            "docker_running": False,
            "error": f"Cannot connect to server: {str(e)}",
        }
    except Exception as e:
        return {
            "success": False,
            "server_id": server_id,
            "server_name": server.name,
            "ssh_configured": True,
            "docker_installed": None,
            "docker_running": False,
            "error": f"Unexpected error: {str(e)}",
        }


@router.post("/sync/server/{server_id}")
async def sync_server_containers(
    server_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Actualiza el estado de contenedores consultando el cliente (Docker).

    Este endpoint:
    1. Consulta al cliente para obtener estado real desde Docker (docker ps -a)
    2. Actualiza el estado en la BD central para que coincida con la realidad
    3. Retorna estadísticas de la actualización

    Solo administradores pueden ejecutar esta acción.
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can sync containers",
        )

    # Verificar que el servidor existe
    server = get_server_by_id(db, server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Verificar que SSH está configurado
    if server.ssh_status != "deployed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SSH not configured on server. Current status: {server.ssh_status}",
        )

    try:
        result = await update_containers_status_from_client(db, server)
        return {
            "success": True,
            "server_id": server_id,
            "server_name": server.name,
            "update_result": result,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to update containers from client: {str(e)}",
        )


@router.post("/sync/all")
async def sync_all_servers_containers(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Actualiza el estado de contenedores consultando todos los servidores activos.

    Este endpoint recorre todos los servidores con SSH configurado y actualiza
    el estado de sus contenedores consultando Docker en cada cliente.

    Solo administradores pueden ejecutar esta acción.
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can sync all servers",
        )

    try:
        results = await sync_all_servers(db)
        return {
            "success": True,
            "message": f"Updated {results['success']} servers successfully, {results['failed']} failed",
            "results": results,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during sync: {str(e)}",
        )


@router.get("/status/server/{server_id}")
async def get_server_containers_status(
    server_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Obtiene el estado actual de contenedores consultando Docker en el cliente.

    Este endpoint consulta al cliente para obtener el estado real de los contenedores
    ejecutando 'docker ps -a' directamente. No modifica la base de datos.

    Solo administradores pueden ejecutar esta acción.
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can query container status",
        )

    # Verificar que el servidor existe
    server = get_server_by_id(db, server_id)
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )

    # Verificar que SSH está configurado
    if server.ssh_status != "deployed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SSH not configured on server. Current status: {server.ssh_status}",
        )

    try:
        report = await get_containers_status_from_client(server)
        return {
            "success": True,
            "server_id": server_id,
            "server_name": server.name,
            "containers_count": report.get("containers_count", 0),
            "containers": report.get("containers", []),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to get status from client: {str(e)}",
        )
