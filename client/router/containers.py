"""
Router para reportar estado de contenedores Docker locales.

Este módulo NO usa base de datos local, consulta Docker directamente.
"""

import subprocess
from typing import List

from fastapi import APIRouter, HTTPException

from ..models.container_models import ContainerReport, ContainerReportResponse

router = APIRouter(prefix="/api/containers", tags=["Containers"])


def parse_docker_ps_line(line: str) -> ContainerReport | None:
    """
    Parsea una línea de docker ps para extraer información del contenedor.

    Formato esperado: CONTAINER_ID|IMAGE|STATUS|NAMES|PORTS|CREATED
    """
    try:
        parts = line.strip().split("|")
        if len(parts) < 6:
            return None

        container_id = parts[0]
        image = parts[1]
        status_full = parts[2]
        name = parts[3]
        ports = parts[4] if parts[4] else None
        created = parts[5]

        # Extraer estado simple (running, exited, etc.)
        status = "unknown"
        if "Up" in status_full:
            status = "running"
        elif "Exited" in status_full:
            status = "stopped"
        elif "Created" in status_full:
            status = "created"
        elif "Paused" in status_full:
            status = "paused"
        elif "Restarting" in status_full:
            status = "restarting"

        return ContainerReport(
            name=name,
            container_id=container_id,
            image=image,
            status=status,
            ports=ports,
            created=created,
        )

    except Exception as e:
        print(f"⚠️ Error parsing docker ps line: {str(e)}")
        return None


def get_all_docker_containers() -> List[ContainerReport]:
    """
    Obtiene todos los contenedores Docker del sistema local usando docker ps -a.

    Returns:
        Lista de ContainerReport con información de cada contenedor
    """
    try:
        # Ejecutar docker ps -a con formato personalizado
        result = subprocess.run(
            [
                "docker",
                "ps",
                "-a",
                "--format",
                "{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}|{{.Ports}}|{{.CreatedAt}}",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() if result.stderr else "Unknown error"
            print(f"❌ Error running docker ps: {error_msg}")
            raise Exception(f"Docker command failed: {error_msg}")

        # Parsear output
        containers = []
        lines = result.stdout.strip().split("\n")

        for line in lines:
            if not line.strip():
                continue

            container = parse_docker_ps_line(line)
            if container:
                containers.append(container)

        print(f"✅ Found {len(containers)} containers in Docker")
        return containers

    except subprocess.TimeoutExpired:
        print("❌ Timeout executing docker ps")
        raise Exception("Docker command timed out")

    except FileNotFoundError:
        print("❌ Docker not found in system")
        raise Exception("Docker is not installed or not in PATH")

    except Exception as e:
        print(f"❌ Error getting Docker containers: {str(e)}")
        raise


@router.get("/report", response_model=ContainerReportResponse)
async def report_containers():
    """
    Reporta el estado actual de todos los contenedores Docker en el sistema local.

    Este endpoint:
    1. Ejecuta 'docker ps -a' para obtener todos los contenedores
    2. Parsea la información de cada contenedor
    3. Retorna la lista completa con estado actual

    No usa base de datos local, consulta Docker directamente.
    """
    try:
        containers = get_all_docker_containers()

        return ContainerReportResponse(
            success=True,
            message=f"Successfully retrieved {len(containers)} containers from Docker",
            containers_count=len(containers),
            containers=containers,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get containers from Docker: {str(e)}",
        )


@router.get("/status/{container_name}")
async def get_container_status(container_name: str):
    """
    Obtiene el estado de un contenedor específico por nombre.

    Args:
        container_name: Nombre del contenedor

    Returns:
        Información del contenedor o 404 si no existe
    """
    try:
        containers = get_all_docker_containers()

        # Buscar contenedor por nombre
        container = next((c for c in containers if c.name == container_name), None)

        if not container:
            raise HTTPException(
                status_code=404, detail=f"Container '{container_name}' not found"
            )

        return {
            "success": True,
            "container": container.model_dump(),
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get container status: {str(e)}"
        )


@router.post("/sync-trigger")
async def manual_sync_trigger():
    """
    Endpoint para trigger manual de reporte.

    Este endpoint es llamado por el servidor central para obtener
    el estado actual de contenedores cuando lo necesite.

    Simplemente retorna el reporte actual.
    """
    return await report_containers()
