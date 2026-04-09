from typing import List, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..CRUD.app_settings import get_container_runtime_global_defaults
from ..models.models import Container, ContainerCreate, Label, Server, UserLabel
from ..utils.docker_remote import (
    DockerConnectionError,
    DockerContainerNotFoundError,
    DockerImageNotFoundError,
    DockerPortConflictError,
    DockerRemoteError,
    DockerRemoteManager,
)
from ..utils.docker_validators import (
    DockerValidationError,
    validate_cpu_limit,
    validate_container_name,
    validate_image_name,
    validate_memory_limit,
    validate_ports,
)


GLOBAL_CONTAINER_RUNTIME_DEFAULTS = {
    "gpus": "all",
    "shm_size": "45g",
    "pid_mode": "host",
}


def resolve_default_container_volumes(username: str) -> str:
    """Return default host volume mappings for Colab-style containers."""
    return f"/media:/media:ro,/mnt:/mnt:ro,/home/{username}:/home/{username}"


def resolve_runtime_volumes(
    runtime_policy: Optional[dict],
    username: str,
) -> str:
    """
    Resolve runtime volume mappings and render username placeholders.

    Supported placeholders in settings: $USERNAME, ${USERNAME}, {username}
    """
    default_volumes = resolve_default_container_volumes(username)

    if not isinstance(runtime_policy, dict):
        return default_volumes

    volumes = runtime_policy.get("volumes")
    if not isinstance(volumes, str) or not volumes.strip():
        return default_volumes

    return (
        volumes.strip()
        .replace("${USERNAME}", username)
        .replace("$USERNAME", username)
        .replace("{username}", username)
    )


def _sanitize_runtime_policy(policy: Optional[dict]) -> dict:
    """Return only known runtime keys and validate basic values."""
    if not isinstance(policy, dict):
        return {}

    allowed_keys = {
        "gpus",
        "memory",
        "shm_size",
        "cpus",
        "pid_mode",
        "privileged",
        "command_override",
        "volumes",
    }

    sanitized = {k: v for k, v in policy.items() if k in allowed_keys and v is not None}

    if "memory" in sanitized:
        sanitized["memory"] = validate_memory_limit(sanitized.get("memory"))

    if "shm_size" in sanitized:
        sanitized["shm_size"] = validate_memory_limit(sanitized.get("shm_size"))

    if "cpus" in sanitized:
        sanitized["cpus"] = validate_cpu_limit(sanitized.get("cpus"))

    if "privileged" in sanitized:
        sanitized["privileged"] = bool(sanitized.get("privileged"))

    return sanitized


def resolve_effective_runtime_policy(db: Session, server: Server, user_id: int) -> dict:
    """
    Resolve container runtime policy with precedence:
    global defaults -> label overrides -> server defaults.
    """
    global_runtime_defaults = get_container_runtime_global_defaults(db)
    effective = dict(GLOBAL_CONTAINER_RUNTIME_DEFAULTS)
    effective.update(_sanitize_runtime_policy(global_runtime_defaults))

    # Label overrides (ordered by label id for deterministic behavior)
    labels = (
        db.query(Label)
        .join(UserLabel, Label.id == UserLabel.label_id)
        .filter(UserLabel.user_id == user_id, Label.active == True)
        .order_by(Label.id.asc())
        .all()
    )

    for label in labels:
        effective.update(_sanitize_runtime_policy(label.container_runtime_overrides))

    # Server-level defaults have highest priority
    effective.update(_sanitize_runtime_policy(server.container_runtime_defaults))

    return effective


def extract_host_ports(ports_string: str) -> List[int]:
    """
    Extrae los puertos del host desde el string de puertos.

    Args:
        ports_string: String con formato "4000:8080" o "4000:8080,4001:443"

    Returns:
        Lista de puertos del host (ej: [4000, 4001])
    """
    if not ports_string:
        return []

    ports = []
    for mapping in ports_string.split(","):
        mapping = mapping.strip()
        if ":" in mapping:
            try:
                host_port = mapping.split(":")[0].strip()
                ports.append(int(host_port))
            except ValueError:
                continue

    return ports


def find_next_available_port(used_ports: List[int], start: int = 4000) -> int:
    """
    Encuentra el primer puerto disponible, llenando huecos si existen.

    Args:
        used_ports: Lista de puertos ya en uso
        start: Puerto inicial (por defecto 4000)

    Returns:
        Primer puerto disponible >= start
    """
    # Caso 1: No hay puertos usados
    if not used_ports:
        return start

    # Ordenar los puertos usados
    used_ports_sorted = sorted(used_ports)

    # Buscar el primer hueco
    current = start
    for port in used_ports_sorted:
        if port < start:
            continue
        if port == current:
            current += 1
        elif port > current:
            # Encontramos un hueco
            return current

    # No hay huecos, devolver el siguiente después del último
    return current


def get_next_available_port(db: Session, server_id: int, start_port: int = 4000) -> int:
    """
    Obtiene el siguiente puerto disponible para un servidor específico.

    Args:
        db: Database session
        server_id: ID del servidor
        start_port: Puerto inicial (por defecto 4000)

    Returns:
        Puerto disponible (ej: 4002)
    """
    # Obtener todos los contenedores del servidor
    containers = db.query(Container).filter(Container.server_id == server_id).all()

    # Extraer todos los puertos del host en uso
    used_ports = []
    for container in containers:
        if container.ports:
            host_ports = extract_host_ports(container.ports)
            used_ports.extend(host_ports)

    # Encontrar el siguiente puerto disponible
    return find_next_available_port(used_ports, start_port)


def create_container(
    db: Session, container_data: ContainerCreate, user_id: int
) -> Container:
    """Crea un nuevo contenedor"""
    container = Container(
        name=container_data.name,
        user_id=user_id,
        server_id=container_data.server_id,
        image=container_data.image,
        ports=container_data.ports,
        status="stopped",
        is_public=False,
    )
    db.add(container)
    db.commit()
    db.refresh(container)
    return container


def get_container_by_id(db: Session, container_id: int) -> Optional[Container]:
    """Obtiene un contenedor por ID"""
    return db.query(Container).filter(Container.id == container_id).first()


def get_containers_by_user(db: Session, user_id: int) -> List[Container]:
    """Obtiene todos los contenedores de un usuario"""
    return db.query(Container).filter(Container.user_id == user_id).all()


def get_public_containers(db: Session) -> List[Container]:
    """Obtiene todos los contenedores públicos"""
    return db.query(Container).filter(Container.is_public == True).all()


def get_all_containers(
    db: Session,
    server_id: Optional[int] = None,
    user_id: Optional[int] = None,
    status: Optional[str] = None,
    is_public: Optional[bool] = None,
) -> List[Container]:
    """Obtiene todos los contenedores con filtros opcionales"""
    query = db.query(Container)

    filters = []

    if server_id is not None:
        filters.append(Container.server_id == server_id)

    if user_id is not None:
        filters.append(Container.user_id == user_id)

    if status is not None:
        filters.append(Container.status == status)

    if is_public is not None:
        filters.append(Container.is_public == is_public)

    if filters:
        query = query.filter(and_(*filters))

    return query.all()


def get_containers_by_server(db: Session, server_id: int) -> List[Container]:
    """Obtiene todos los contenedores de un servidor"""
    return db.query(Container).filter(Container.server_id == server_id).all()


def get_user_container_on_server(
    db: Session, user_id: int, server_id: int
) -> Optional[Container]:
    """Obtiene el contenedor de un usuario en un servidor específico"""
    return (
        db.query(Container)
        .filter(Container.user_id == user_id, Container.server_id == server_id)
        .first()
    )


def count_user_containers_on_server(db: Session, user_id: int, server_id: int) -> int:
    """Cuenta cuántos contenedores tiene un usuario en un servidor"""
    return (
        db.query(Container)
        .filter(Container.user_id == user_id, Container.server_id == server_id)
        .count()
    )


def update_container_status(
    db: Session, container_id: int, status: str
) -> Optional[Container]:
    """Actualiza el estado de un contenedor"""
    container = get_container_by_id(db, container_id)
    if container:
        container.status = status
        db.commit()
        db.refresh(container)
    return container


def update_container_docker_id(
    db: Session, container_id: int, docker_id: str
) -> Optional[Container]:
    """Actualiza el Docker container ID"""
    container = get_container_by_id(db, container_id)
    if container:
        container.container_id = docker_id
        db.commit()
        db.refresh(container)
    return container


def delete_container(db: Session, container_id: int) -> bool:
    """Elimina un contenedor"""
    container = get_container_by_id(db, container_id)
    if container:
        db.delete(container)
        db.commit()
        return True
    return False


def toggle_container_public(db: Session, container_id: int) -> Optional[Container]:
    """Cambia el estado público/privado de un contenedor"""
    container = get_container_by_id(db, container_id)
    if container:
        container.is_public = not container.is_public
        db.commit()
        db.refresh(container)
    return container


# ============================================================================
# FUNCIONES CON INTEGRACIÓN DOCKER
# ============================================================================


def create_container_with_docker(
    db: Session, server: Server, user_id: int, container_data: ContainerCreate
) -> Container:
    """
    Crea un contenedor en la BD y en Docker.

    Args:
        db: Database session
        server: Servidor donde crear el contenedor
        user_id: ID del usuario propietario
        container_data: Datos del contenedor

    Returns:
        Container creado

    Raises:
        DockerValidationError: Si los datos son inválidos
        DockerConnectionError: Si no se puede conectar al servidor
        DockerImageNotFoundError: Si la imagen no existe
        DockerPortConflictError: Si hay conflicto de puertos
        DockerRemoteError: Otros errores de Docker
    """
    # Validar datos
    validate_container_name(container_data.name)
    validate_image_name(container_data.image)

    # Asignar puerto automáticamente si no se especificó
    ports = container_data.ports
    if not ports:
        next_port = get_next_available_port(db, server.id)
        ports = f"{next_port}:8080"
        print(f"[Auto-assign] Puerto asignado automáticamente: {ports}")
    else:
        validate_ports(ports)

    # Crear registro en BD con estado "creating"
    container = Container(
        name=container_data.name,
        user_id=user_id,
        server_id=container_data.server_id,
        image=container_data.image,
        ports=ports,
        status="creating",
        is_public=False,
    )
    db.add(container)
    db.commit()
    db.refresh(container)

    runtime_policy = resolve_effective_runtime_policy(db, server, user_id)
    target_user = db.query(User).filter(User.id == user_id).first()
    username = target_user.username if target_user and target_user.username else "user"
    volumes = resolve_runtime_volumes(runtime_policy, username)

    try:
        # Conectar con Docker en el servidor remoto
        with DockerRemoteManager(server) as docker:
            # Crear contenedor en Docker
            docker_id = docker.create_container(
                name=container_data.name,
                image=container_data.image,
                ports=ports,
                volumes=volumes,
                gpus=runtime_policy.get("gpus"),
                memory=runtime_policy.get("memory"),
                shm_size=runtime_policy.get("shm_size"),
                cpus=runtime_policy.get("cpus"),
                privileged=runtime_policy.get("privileged"),
                pid_mode=runtime_policy.get("pid_mode"),
                command_override=runtime_policy.get("command_override"),
            )

            # Actualizar container_id y status en BD
            container.container_id = docker_id
            container.status = "running"  # Docker run -d ya lo inicia
            db.commit()
            db.refresh(container)

            print(
                f"✓ Container created successfully: {container.name} (ID: {docker_id[:12]})"
            )
            return container

    except (DockerImageNotFoundError, DockerPortConflictError, DockerRemoteError) as e:
        # Si falla Docker, marcar como error en BD
        container.status = "error"
        db.commit()
        raise
    except Exception as e:
        # Error inesperado
        container.status = "error"
        db.commit()
        raise DockerRemoteError(f"Unexpected error creating container: {e}")


def start_container_with_docker(
    db: Session, server: Server, container: Container
) -> Container:
    """
    Inicia un contenedor en Docker y actualiza BD.

    Args:
        db: Database session
        server: Servidor del contenedor
        container: Container a iniciar

    Returns:
        Container actualizado

    Raises:
        DockerConnectionError: Si no se puede conectar
        DockerContainerNotFoundError: Si el contenedor no existe en Docker
        DockerRemoteError: Otros errores
    """
    if not container.container_id:
        raise DockerRemoteError("Container has no Docker ID. Cannot start.")

    try:
        with DockerRemoteManager(server) as docker:
            # Iniciar contenedor
            docker.start_container(container.container_id)

            # Actualizar status en BD
            container.status = "running"
            db.commit()
            db.refresh(container)

            print(f"✓ Container started: {container.name}")
            return container

    except DockerContainerNotFoundError:
        # Contenedor no existe en Docker, marcar como error
        container.status = "error"
        db.commit()
        raise
    except Exception as e:
        container.status = "error"
        db.commit()
        raise DockerRemoteError(f"Error starting container: {e}")


def stop_container_with_docker(
    db: Session, server: Server, container: Container
) -> Container:
    """
    Detiene un contenedor en Docker y actualiza BD.

    Args:
        db: Database session
        server: Servidor del contenedor
        container: Container a detener

    Returns:
        Container actualizado

    Raises:
        DockerConnectionError: Si no se puede conectar
        DockerContainerNotFoundError: Si el contenedor no existe
        DockerRemoteError: Otros errores
    """
    if not container.container_id:
        raise DockerRemoteError("Container has no Docker ID. Cannot stop.")

    try:
        with DockerRemoteManager(server) as docker:
            # Detener contenedor
            docker.stop_container(container.container_id, timeout=10)

            # Actualizar status en BD
            container.status = "stopped"
            db.commit()
            db.refresh(container)

            print(f"✓ Container stopped: {container.name}")
            return container

    except DockerContainerNotFoundError:
        # Contenedor no existe, marcar como stopped de todas formas
        container.status = "stopped"
        db.commit()
        raise
    except Exception as e:
        raise DockerRemoteError(f"Error stopping container: {e}")


def delete_container_with_docker(
    db: Session, server: Server, container: Container
) -> bool:
    """
    Elimina un contenedor de Docker y BD.

    Args:
        db: Database session
        server: Servidor del contenedor
        container: Container a eliminar

    Returns:
        True si se eliminó correctamente

    Raises:
        DockerConnectionError: Si no se puede conectar
        DockerRemoteError: Otros errores
    """
    # Si tiene container_id, intentar eliminar de Docker
    if container.container_id:
        try:
            with DockerRemoteManager(server) as docker:
                # Eliminar contenedor (force=True para eliminar aunque esté corriendo)
                docker.remove_container(container.container_id, force=True)
                print(f"✓ Container removed from Docker: {container.name}")
        except DockerContainerNotFoundError:
            # Ya no existe en Docker, continuar con eliminación de BD
            print(
                f"⚠ Container not found in Docker, removing from DB: {container.name}"
            )
        except Exception as e:
            # Error al eliminar de Docker, pero intentar eliminar de BD de todas formas
            print(f"⚠ Error removing from Docker: {e}")

    # Eliminar de BD
    db.delete(container)
    db.commit()
    print(f"✓ Container removed from database: {container.name}")
    return True


def sync_container_status(
    db: Session, server: Server, container: Container
) -> Container:
    """
    Sincroniza el estado del contenedor desde Docker a la BD.

    Args:
        db: Database session
        server: Servidor del contenedor
        container: Container a sincronizar

    Returns:
        Container actualizado
    """
    if not container.container_id:
        return container

    try:
        with DockerRemoteManager(server) as docker:
            status_info = docker.get_container_status(container.container_id)

            # Mapear estado de Docker a nuestro formato
            docker_status = status_info.get("status", "unknown")

            if status_info.get("running"):
                container.status = "running"
            elif docker_status in ["exited", "stopped"]:
                container.status = "stopped"
            elif docker_status == "created":
                container.status = "stopped"
            else:
                container.status = "error"

            db.commit()
            db.refresh(container)

    except DockerContainerNotFoundError:
        # Contenedor no existe en Docker
        container.status = "error"
        db.commit()
    except Exception as e:
        print(f"⚠ Error syncing container status: {e}")

    return container


def create_colab_container_with_docker(
    db: Session,
    server: Server,
    user_id: int,
    username: str,
    container_name: Optional[str] = None,
) -> Container:
    """
    Crea un contenedor Colab con configuración GPU especial.

    Args:
        db: Database session
        server: Servidor donde crear el contenedor
        user_id: ID del usuario propietario
        username: Username del sistema para mapeo de volúmenes
        container_name: Nombre opcional del contenedor (default: colab_{username})

    Returns:
        Container creado

    Raises:
        DockerConnectionError: Si no se puede conectar al servidor
        DockerImageNotFoundError: Si la imagen no existe
        DockerRemoteError: Otros errores de Docker
    """
    if not container_name:
        container_name = f"colab_{username}"

    # Configuración del contenedor Colab
    image = "us-docker.pkg.dev/colab-images/public/runtime:latest"

    # Asignar puerto automáticamente
    next_port = get_next_available_port(db, server.id)
    ports = f"{next_port}:8080"
    print(f"[Colab Auto-assign] Puerto asignado automáticamente: {ports}")

    # Crear registro en BD con estado "creating"
    container = Container(
        name=container_name,
        user_id=user_id,
        server_id=server.id,
        image=image,
        ports=ports,
        status="creating",
        is_public=False,
    )
    db.add(container)
    db.commit()
    db.refresh(container)

    try:
        # Conectar con Docker en el servidor remoto
        with DockerRemoteManager(server) as docker:
            # Crear contenedor Colab en Docker con el puerto asignado
            docker_id = docker.create_container(
                name=container_name,
                image=image,
                ports=ports,
                restart_policy="unless-stopped",
            )

            # Actualizar container_id y status en BD
            container.container_id = docker_id
            container.status = "running"  # Docker run -d ya lo inicia
            db.commit()
            db.refresh(container)

            print(
                f"✓ Colab container created successfully: {container.name} (ID: {docker_id[:12]})"
            )
            print(f"✓ Port: {ports}")
            return container

    except (DockerImageNotFoundError, DockerRemoteError) as e:
        # Si falla Docker, marcar como error en BD
        container.status = "error"
        db.commit()
        raise
    except Exception as e:
        # Error inesperado
        container.status = "error"
        db.commit()
        raise DockerRemoteError(f"Unexpected error creating Colab container: {e}")
