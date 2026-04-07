from typing import List, Optional

from sqlalchemy.orm import Session

from ..models.models import Server, ServerCreate
from ..utils.encryption import decrypt_password, encrypt_password
from ..utils.server_status import get_server_status
from ..utils.ssh import deploy_ssh_key, generate_ssh_keypair


# CREATE
def create_server(db: Session, server: ServerCreate) -> Server:
    """Crea un nuevo servidor en la base de datos y genera SSH keys"""
    # Generate SSH key pair
    private_key_path, public_key = generate_ssh_keypair(server.name)

    print(f"SSH key generated for {server.name}")
    print(f"Public key: {public_key[:50]}...")

    # Encriptar ssh_password para guardarla (usada también para become/sudo)
    encrypted_ssh_pwd = None
    if server.ssh_password:
        encrypted_ssh_pwd = encrypt_password(server.ssh_password)

    # Create server in database with pending SSH status
    db_server = Server(
        name=server.name,
        ip_address=server.ip_address,
        status="offline",
        ssh_user=server.ssh_user,
        ssh_private_key_path=private_key_path,
        ssh_status="pending",
        ssh_password_encrypted=encrypted_ssh_pwd,
        container_runtime_defaults=server.container_runtime_defaults,
    )
    db.add(db_server)
    db.commit()
    db.refresh(db_server)

    # Deploy SSH key to remote server
    print(f"Deploying SSH key to {server.ip_address}...")
    deploy_success = deploy_ssh_key(
        host=server.ip_address,
        username=server.ssh_user,
        password=server.ssh_password,
        public_key=public_key,
        port=getattr(server, "ssh_port", 22),
    )

    # Update SSH status based on deployment result
    if deploy_success:
        db_server.ssh_status = "deployed"  # type: ignore
        print(f"✓ SSH key deployed successfully to {server.name}")
    else:
        db_server.ssh_status = "failed"  # type: ignore
        print(f"✗ SSH key deployment failed for {server.name}")

    db.commit()
    db.refresh(db_server)

    return db_server


def get_server_by_id(
    db: Session, server_id: int, check_status: bool = True
) -> Optional[Server]:
    """Obtiene un servidor por su ID y actualiza su estado si check_status=True"""
    server = db.query(Server).filter(Server.id == server_id).first()

    if server and check_status:
        # Actualizar el estado real del servidor
        real_status = get_server_status(server.ip_address)
        if server.status != real_status:
            server.status = real_status  # type: ignore
            db.commit()

    return server


def get_server_by_name(db: Session, name: str) -> Optional[Server]:
    """Obtiene un servidor por su nombre"""
    return db.query(Server).filter(Server.name == name).first()


def get_server_by_ip(db: Session, ip_address: str) -> Optional[Server]:
    """Obtiene un servidor por su dirección IP"""
    return db.query(Server).filter(Server.ip_address == ip_address).first()


def get_all_servers(
    db: Session, skip: int = 0, limit: int = 100, check_status: bool = True
) -> List[Server]:
    """Obtiene todos los servidores con paginación y actualiza su estado si check_status=True"""
    servers = db.query(Server).offset(skip).limit(limit).all()

    if check_status:
        # Actualizar el estado real de cada servidor
        for server in servers:
            real_status = get_server_status(server.ip_address)
            if server.status != real_status:
                server.status = real_status  # type: ignore
        db.commit()

    return servers


def get_servers_by_status(db: Session, status: str) -> List[Server]:
    """Obtiene todos los servidores por estado (online/offline)"""
    return db.query(Server).filter(Server.status == status).all()


def get_online_servers(db: Session) -> List[Server]:
    """Obtiene todos los servidores online"""
    return get_servers_by_status(db, "online")


def get_offline_servers(db: Session) -> List[Server]:
    """Obtiene todos los servidores offline"""
    return get_servers_by_status(db, "offline")


def count_servers(db: Session) -> int:
    """Cuenta el total de servidores"""
    return db.query(Server).count()


def count_servers_by_status(db: Session, status: str) -> int:
    """Cuenta servidores por estado"""
    return db.query(Server).filter(Server.status == status).count()


# UPDATE
def update_server(db: Session, server_id: int, server_data: dict) -> Optional[Server]:
    """Actualiza los datos de un servidor"""
    db_server = get_server_by_id(db, server_id)
    if not db_server:
        return None

    # Actualizar los campos
    for key, value in server_data.items():
        if hasattr(db_server, key):
            setattr(db_server, key, value)

    db.commit()
    db.refresh(db_server)
    return db_server


def update_server_status(db: Session, server_id: int, status: str) -> Optional[Server]:
    """Actualiza solo el estado de un servidor"""
    db_server = get_server_by_id(db, server_id)
    if not db_server:
        return None

    db_server.status = status  # type: ignore
    db.commit()
    db.refresh(db_server)
    return db_server


def set_server_online(db: Session, server_id: int) -> Optional[Server]:
    """Marca un servidor como online"""
    return update_server_status(db, server_id, "online")


def set_server_offline(db: Session, server_id: int) -> Optional[Server]:
    """Marca un servidor como offline"""
    return update_server_status(db, server_id, "offline")


def update_server_name(db: Session, server_id: int, new_name: str) -> Optional[Server]:
    """Actualiza el nombre de un servidor"""
    db_server = get_server_by_id(db, server_id)
    if not db_server:
        return None

    db_server.name = new_name  # type: ignore
    db.commit()
    db.refresh(db_server)
    return db_server


def update_server_ip(db: Session, server_id: int, new_ip: str) -> Optional[Server]:
    """Actualiza la dirección IP de un servidor"""
    db_server = get_server_by_id(db, server_id)
    if not db_server:
        return None

    db_server.ip_address = new_ip  # type: ignore
    db.commit()
    db.refresh(db_server)
    return db_server


# DELETE
def delete_server(db: Session, server_id: int) -> bool:
    """Elimina permanentemente un servidor de la base de datos"""
    db_server = get_server_by_id(db, server_id)
    if not db_server:
        return False

    db.delete(db_server)
    db.commit()
    return True


def delete_server_by_name(db: Session, name: str) -> bool:
    """Elimina un servidor por su nombre"""
    db_server = get_server_by_name(db, name)
    if not db_server:
        return False

    db.delete(db_server)
    db.commit()
    return True


# BULK OPERATIONS
def create_multiple_servers(db: Session, servers: List[ServerCreate]) -> List[Server]:
    """Crea múltiples servidores en una sola operación"""
    db_servers = []
    for server in servers:
        # Generate SSH key pair for each server
        private_key_path, public_key = generate_ssh_keypair(server.name)

        print(f"SSH key generated for {server.name}")

        db_server = Server(
            name=server.name,
            ip_address=server.ip_address,
            status="offline",
            ssh_user=server.ssh_user,
            ssh_private_key_path=private_key_path,
            container_runtime_defaults=server.container_runtime_defaults,
        )
        db_servers.append(db_server)

        # Deploy SSH key if password is provided
        if server.ssh_password:
            print(f"Deploying SSH key to {server.ip_address}...")
            deploy_success = deploy_ssh_key(
                host=server.ip_address,
                username=server.ssh_user,
                password=server.ssh_password,
                public_key=public_key,
                port=getattr(server, "ssh_port", 22),
            )

            if deploy_success:
                print(f"✓ SSH key deployed successfully to {server.name}")
            else:
                print(f"✗ Warning: Could not deploy SSH key to {server.ip_address}")

    db.add_all(db_servers)
    db.commit()
    for db_server in db_servers:
        db.refresh(db_server)

    return db_servers


def set_all_servers_offline(db: Session) -> int:
    """Marca todos los servidores como offline. Retorna el número de servidores actualizados"""
    count = db.query(Server).update({"status": "offline"})
    db.commit()
    return count


def delete_all_offline_servers(db: Session) -> int:
    """Elimina todos los servidores offline. Retorna el número de servidores eliminados"""
    count = db.query(Server).filter(Server.status == "offline").delete()
    db.commit()
    return count
