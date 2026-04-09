"""Docker Remote Manager - Execute Docker commands on remote servers via SSH."""

import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import paramiko

from ..models.models import Server


class DockerRemoteError(Exception):
    """Base exception for Docker remote operations."""

    pass


class DockerConnectionError(DockerRemoteError):
    """Raised when cannot connect to remote server."""

    pass


class DockerNotInstalledError(DockerRemoteError):
    """Raised when Docker is not installed on remote server."""

    pass


class DockerImageNotFoundError(DockerRemoteError):
    """Raised when Docker image is not found."""

    pass


class DockerPortConflictError(DockerRemoteError):
    """Raised when port is already in use."""

    pass


class DockerContainerNotFoundError(DockerRemoteError):
    """Raised when container is not found."""

    pass


def build_docker_run_command(
    name: str,
    image: str,
    ports: Optional[str] = None,
    env_vars: Optional[Dict[str, str]] = None,
    volumes: Optional[str] = None,
    restart_policy: Optional[str] = None,
    gpus: Optional[str] = None,
    memory: Optional[str] = None,
    shm_size: Optional[str] = None,
    cpus: Optional[float] = None,
    privileged: Optional[bool] = None,
    pid_mode: Optional[str] = None,
    command_override: Optional[str] = None,
) -> str:
    """Build docker run command string used for both preview and execution."""
    cmd_parts = ["docker", "run", "-d"]

    cmd_parts.extend(["--name", name])
    if restart_policy:
        cmd_parts.extend(["--restart", restart_policy])

    if gpus:
        cmd_parts.extend(["--gpus", gpus])
    if memory:
        cmd_parts.extend(["--memory", memory])
    if shm_size:
        cmd_parts.extend(["--shm-size", shm_size])
    if cpus is not None:
        cmd_parts.extend(["--cpus", str(cpus)])
    if privileged:
        cmd_parts.append("--privileged")
    if pid_mode:
        cmd_parts.extend(["--pid", pid_mode])

    if ports:
        for port_mapping in ports.split(","):
            port_mapping = port_mapping.strip()
            if port_mapping:
                cmd_parts.extend(["-p", port_mapping])

    if env_vars:
        for key, value in env_vars.items():
            cmd_parts.extend(["-e", f"{key}={value}"])

    if volumes:
        for volume in volumes.split(","):
            volume = volume.strip()
            if volume:
                cmd_parts.extend(["-v", volume])

    cmd_parts.append(image)

    if command_override:
        cmd_parts.append(command_override)

    return " ".join(cmd_parts)


class DockerRemoteManager:
    """Manage Docker containers on remote servers via SSH."""

    def __init__(self, server: Server, timeout: int = 60, max_retries: int = 3):
        """
        Initialize Docker remote manager for a server.

        Args:
            server: Server model with SSH configuration
            timeout: SSH connection timeout in seconds
            max_retries: Maximum number of connection retry attempts
        """
        self.server = server
        self.timeout = timeout
        self.max_retries = max_retries
        self.ssh_client: Optional[paramiko.SSHClient] = None

    def _connect(self) -> paramiko.SSHClient:
        """
        Establish SSH connection to the server with retry logic.

        Returns:
            paramiko.SSHClient: Connected SSH client

        Raises:
            DockerConnectionError: If connection fails after all retries
        """
        # Check if we have an active and healthy connection
        if self.ssh_client:
            try:
                transport = self.ssh_client.get_transport()
                if transport and transport.is_active():
                    # Verify socket is actually working by checking if it's open
                    sock = transport.sock
                    if sock and sock.fileno() != -1:
                        return self.ssh_client
                    else:
                        print("[SSH] Socket is closed, forcing reconnection")
            except (OSError, AttributeError) as e:
                print(f"[SSH] Connection check failed: {e}, forcing reconnection")

            # If we get here, connection is bad - close it
            self._force_close()

        # Get private key path
        private_key_path = Path(f"/app/{self.server.ssh_private_key_path}")

        if not private_key_path.exists():
            raise DockerConnectionError(
                f"SSH private key not found: {private_key_path}"
            )

        # Load private key
        try:
            private_key = paramiko.RSAKey.from_private_key_file(str(private_key_path))
        except Exception as e:
            raise DockerConnectionError(f"Failed to load SSH private key: {e}")

        # Retry connection with backoff
        import time

        last_error = None

        for attempt in range(self.max_retries):
            try:
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

                # Configure TCP keepalive
                ssh.connect(
                    hostname=self.server.ip_address,
                    username=self.server.ssh_user,
                    pkey=private_key,
                    timeout=self.timeout,
                    look_for_keys=False,
                    allow_agent=False,
                    banner_timeout=self.timeout,
                )

                # Enable TCP keepalive to prevent connection drops
                transport = ssh.get_transport()
                if transport:
                    transport.set_keepalive(30)

                self.ssh_client = ssh
                print(
                    f"[SSH] Connected to {self.server.ip_address} (attempt {attempt + 1})"
                )
                return ssh

            except paramiko.AuthenticationException as e:
                # Don't retry authentication errors
                raise DockerConnectionError(f"SSH authentication failed: {e}")
            except (paramiko.SSHException, Exception) as e:
                last_error = e
                print(
                    f"[SSH] Connection attempt {attempt + 1}/{self.max_retries} failed: {e}"
                )

                # Close any partially opened connection
                try:
                    if ssh:
                        ssh.close()
                except:
                    pass

                # Wait before retrying (exponential backoff)
                if attempt < self.max_retries - 1:
                    wait_time = 2**attempt  # 1s, 2s, 4s
                    print(f"[SSH] Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)

        # All retries failed
        raise DockerConnectionError(
            f"Failed to connect to {self.server.ip_address} after {self.max_retries} attempts: {last_error}"
        )

    def _execute_command(
        self, command: str, timeout: Optional[int] = None
    ) -> Tuple[int, str, str]:
        """
        Execute a command on the remote server with retry on connection failure.

        Args:
            command: Command to execute
            timeout: Command timeout in seconds (None = no timeout)

        Returns:
            Tuple of (exit_code, stdout, stderr)

        Raises:
            DockerConnectionError: If SSH connection fails after retries
        """
        import time

        last_error = None

        # Try to execute command, retry on connection errors
        for attempt in range(2):  # 2 attempts total
            try:
                ssh = self._connect()
                stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
                exit_code = stdout.channel.recv_exit_status()
                stdout_text = stdout.read().decode("utf-8").strip()
                stderr_text = stderr.read().decode("utf-8").strip()

                return exit_code, stdout_text, stderr_text

            except (OSError, EOFError) as e:
                # These errors often indicate a bad connection
                last_error = e
                print(f"[SSH] Command execution failed (attempt {attempt + 1}/2): {e}")

                # Force close and reconnect
                self._force_close()

                if attempt < 1:  # If not last attempt
                    time.sleep(1)
                    continue
                else:
                    raise DockerConnectionError(
                        f"Failed to execute command after retries: {e}"
                    )
            except Exception as e:
                # Other errors shouldn't retry
                raise DockerConnectionError(f"Failed to execute command: {e}")

        # Should not reach here, but just in case
        raise DockerConnectionError(
            f"Failed to execute command after retries: {last_error}"
        )

    def check_docker_installed(self) -> Tuple[bool, str]:
        """
        Check if Docker is installed and running on the server.

        Returns:
            Tuple of (is_installed, version_or_error)
        """
        try:
            exit_code, stdout, stderr = self._execute_command("docker --version")

            if exit_code == 0:
                return True, stdout
            else:
                return False, stderr or "Docker not found"

        except Exception as e:
            return False, str(e)

    def check_docker_running(self) -> Tuple[bool, str]:
        """
        Check if Docker daemon is running.

        Returns:
            Tuple of (is_running, info_or_error)
        """
        try:
            exit_code, stdout, stderr = self._execute_command("docker info")

            if exit_code == 0:
                return True, "Docker daemon is running"
            else:
                return False, stderr or "Docker daemon not running"

        except Exception as e:
            return False, str(e)

    def create_colab_container(
        self,
        username: str,
        container_name: Optional[str] = None,
    ) -> Tuple[str, Dict[str, str]]:
        """
        Create a Colab container with GPU support and specific configuration.

        Args:
            username: System username for volume mapping
            container_name: Optional container name (default: colab_{username})

        Returns:
            Tuple of (container_id, port_mappings)

        Raises:
            DockerRemoteError: If container creation fails
        """
        if not container_name:
            container_name = f"colab_{username}"

        # Build docker run command with Colab-specific settings
        cmd_parts = [
            "docker",
            "run",
            "-d",
            "--shm-size=45g",
            "--gpus=all",
            "--pid=host",
            "--privileged",
            "-P",  # Random port mapping
            f"-v /media:/media:ro",
            f"-v /mnt:/mnt:ro",
            f"-v /home/{username}:/home/{username}",
            f"--name={container_name}",
            "us-docker.pkg.dev/colab-images/public/runtime:latest",
        ]

        command = " ".join(cmd_parts)
        print(f"[Docker] Executing: {command}")

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=120)

            if exit_code == 0:
                container_id = stdout.strip()
                print(f"[Docker] Colab container created: {container_id}")

                # Wait for Docker to assign ports
                import time

                time.sleep(12)

                # Get port mappings
                port_mappings = self._get_container_ports(container_name)

                return container_id, port_mappings
            else:
                error_msg = stderr.lower()

                if "no such image" in error_msg or "unable to find image" in error_msg:
                    raise DockerImageNotFoundError(f"Colab image not found")
                elif "name is already in use" in error_msg or "conflict" in error_msg:
                    raise DockerRemoteError(
                        f"Container name '{container_name}' already exists"
                    )
                else:
                    raise DockerRemoteError(
                        f"Failed to create Colab container: {stderr}"
                    )

        except (DockerImageNotFoundError, DockerRemoteError):
            raise
        except Exception as e:
            raise DockerRemoteError(f"Error creating Colab container: {e}")

    def _get_container_ports(self, container_name: str) -> Dict[str, str]:
        """
        Get port mappings for a container.

        Args:
            container_name: Container name

        Returns:
            Dict with port mappings (e.g., {"8080/tcp": "32768"})
        """
        command = f"docker port {container_name}"

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=10)

            if exit_code == 0:
                port_mappings = {}
                for line in stdout.split("\n"):
                    line = line.strip()
                    if "->" in line:
                        # Format: "8888/tcp -> 0.0.0.0:32768"
                        parts = line.split("->")
                        if len(parts) == 2:
                            container_port = parts[0].strip()
                            host_mapping = parts[1].strip()
                            # Extract just the port number
                            if ":" in host_mapping:
                                host_port = host_mapping.split(":")[-1]
                                port_mappings[container_port] = host_port

                return port_mappings
            else:
                return {}

        except Exception as e:
            print(f"[Docker] Error getting ports: {e}")
            return {}

    def create_container(
        self,
        name: str,
        image: str,
        ports: Optional[str] = None,
        env_vars: Optional[Dict[str, str]] = None,
        volumes: Optional[str] = None,
        restart_policy: str = "unless-stopped",
        gpus: Optional[str] = None,
        memory: Optional[str] = None,
        shm_size: Optional[str] = None,
        cpus: Optional[float] = None,
        privileged: Optional[bool] = None,
        pid_mode: Optional[str] = None,
        command_override: Optional[str] = None,
    ) -> str:
        """
        Create and start a Docker container.

        Args:
            name: Container name
            image: Docker image (e.g., 'nginx:latest')
            ports: Port mappings (e.g., '80:8080' or '80:8080,443:8443')
            env_vars: Environment variables dict
            volumes: Volume mappings (e.g., '/host:/container')
            restart_policy: Restart policy (no, always, unless-stopped, on-failure)

        Returns:
            Container ID

        Raises:
            DockerImageNotFoundError: If image doesn't exist
            DockerPortConflictError: If port is already in use
            DockerRemoteError: For other Docker errors
        """
        command = build_docker_run_command(
            name=name,
            image=image,
            ports=ports,
            env_vars=env_vars,
            volumes=volumes,
            restart_policy=restart_policy,
            gpus=gpus,
            memory=memory,
            shm_size=shm_size,
            cpus=cpus,
            privileged=privileged,
            pid_mode=pid_mode,
            command_override=command_override,
        )
        print(f"[Docker] Executing: {command}")

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=120)

            if exit_code == 0:
                container_id = stdout.strip()
                print(f"[Docker] Container created: {container_id}")
                return container_id
            else:
                # Parse error
                error_msg = stderr.lower()

                if "no such image" in error_msg or "unable to find image" in error_msg:
                    raise DockerImageNotFoundError(f"Image not found: {image}")
                elif (
                    "port is already allocated" in error_msg
                    or "address already in use" in error_msg
                ):
                    raise DockerPortConflictError(f"Port conflict: {ports}")
                elif "name is already in use" in error_msg or "conflict" in error_msg:
                    raise DockerRemoteError(f"Container name '{name}' already exists")
                else:
                    raise DockerRemoteError(f"Failed to create container: {stderr}")

        except (DockerImageNotFoundError, DockerPortConflictError, DockerRemoteError):
            raise
        except Exception as e:
            raise DockerRemoteError(f"Error creating container: {e}")

    def start_container(self, container_id_or_name: str) -> bool:
        """
        Start a stopped container.

        Args:
            container_id_or_name: Container ID or name

        Returns:
            True if started successfully

        Raises:
            DockerContainerNotFoundError: If container doesn't exist
            DockerRemoteError: For other errors
        """
        command = f"docker start {container_id_or_name}"
        print(f"[Docker] Executing: {command}")

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=30)

            if exit_code == 0:
                print(f"[Docker] Container started: {container_id_or_name}")
                return True
            else:
                error_msg = stderr.lower()

                if "no such container" in error_msg:
                    raise DockerContainerNotFoundError(
                        f"Container not found: {container_id_or_name}"
                    )
                else:
                    raise DockerRemoteError(f"Failed to start container: {stderr}")

        except DockerContainerNotFoundError:
            raise
        except Exception as e:
            raise DockerRemoteError(f"Error starting container: {e}")

    def stop_container(self, container_id_or_name: str, timeout: int = 10) -> bool:
        """
        Stop a running container.

        Args:
            container_id_or_name: Container ID or name
            timeout: Seconds to wait before killing

        Returns:
            True if stopped successfully

        Raises:
            DockerContainerNotFoundError: If container doesn't exist
            DockerRemoteError: For other errors
        """
        command = f"docker stop -t {timeout} {container_id_or_name}"
        print(f"[Docker] Executing: {command}")

        try:
            exit_code, stdout, stderr = self._execute_command(
                command, timeout=timeout + 10
            )

            if exit_code == 0:
                print(f"[Docker] Container stopped: {container_id_or_name}")
                return True
            else:
                error_msg = stderr.lower()

                if "no such container" in error_msg:
                    raise DockerContainerNotFoundError(
                        f"Container not found: {container_id_or_name}"
                    )
                else:
                    raise DockerRemoteError(f"Failed to stop container: {stderr}")

        except DockerContainerNotFoundError:
            raise
        except Exception as e:
            raise DockerRemoteError(f"Error stopping container: {e}")

    def remove_container(self, container_id_or_name: str, force: bool = True) -> bool:
        """
        Remove a container.

        Args:
            container_id_or_name: Container ID or name
            force: Force removal (even if running)

        Returns:
            True if removed successfully

        Raises:
            DockerContainerNotFoundError: If container doesn't exist
            DockerRemoteError: For other errors
        """
        force_flag = "-f" if force else ""
        command = f"docker rm {force_flag} {container_id_or_name}".strip()
        print(f"[Docker] Executing: {command}")

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=30)

            if exit_code == 0:
                print(f"[Docker] Container removed: {container_id_or_name}")
                return True
            else:
                error_msg = stderr.lower()

                if "no such container" in error_msg:
                    raise DockerContainerNotFoundError(
                        f"Container not found: {container_id_or_name}"
                    )
                else:
                    raise DockerRemoteError(f"Failed to remove container: {stderr}")

        except DockerContainerNotFoundError:
            raise
        except Exception as e:
            raise DockerRemoteError(f"Error removing container: {e}")

    def get_container_status(self, container_id_or_name: str) -> Dict:
        """
        Get detailed status of a container.

        Args:
            container_id_or_name: Container ID or name

        Returns:
            Dict with container status info

        Raises:
            DockerContainerNotFoundError: If container doesn't exist
        """
        command = f"docker inspect --format='{{{{.State.Status}}}}|{{{{.State.Running}}}}|{{{{.State.Paused}}}}|{{{{.State.Restarting}}}}' {container_id_or_name}"

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=10)

            if exit_code == 0:
                parts = stdout.split("|")
                if len(parts) >= 4:
                    return {
                        "status": parts[0],  # running, exited, created, etc.
                        "running": parts[1].lower() == "true",
                        "paused": parts[2].lower() == "true",
                        "restarting": parts[3].lower() == "true",
                    }
                else:
                    return {"status": "unknown", "running": False}
            else:
                if "no such container" in stderr.lower():
                    raise DockerContainerNotFoundError(
                        f"Container not found: {container_id_or_name}"
                    )
                else:
                    return {"status": "error", "running": False, "error": stderr}

        except DockerContainerNotFoundError:
            raise
        except Exception as e:
            return {"status": "error", "running": False, "error": str(e)}

    def list_containers(self, all: bool = True) -> List[Dict]:
        """
        List containers on the server.

        Args:
            all: Include stopped containers

        Returns:
            List of container info dicts
        """
        all_flag = "-a" if all else ""
        command = f"docker ps {all_flag} --format '{{{{.ID}}}}|{{{{.Names}}}}|{{{{.Image}}}}|{{{{.Status}}}}|{{{{.Ports}}}}'".strip()

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=15)

            if exit_code == 0:
                containers = []
                for line in stdout.split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    parts = line.split("|")
                    if len(parts) >= 5:
                        containers.append(
                            {
                                "id": parts[0],
                                "name": parts[1],
                                "image": parts[2],
                                "status": parts[3],
                                "ports": parts[4],
                            }
                        )

                return containers
            else:
                print(f"[Docker] Failed to list containers: {stderr}")
                return []

        except Exception as e:
            print(f"[Docker] Error listing containers: {e}")
            return []

    def get_container_logs(self, container_id_or_name: str, lines: int = 100) -> str:
        """
        Get container logs.

        Args:
            container_id_or_name: Container ID or name
            lines: Number of lines to retrieve

        Returns:
            Container logs
        """
        command = f"docker logs --tail {lines} {container_id_or_name}"

        try:
            exit_code, stdout, stderr = self._execute_command(command, timeout=20)

            # Docker logs can output to both stdout and stderr
            logs = stdout
            if stderr:
                logs = logs + "\n" + stderr if logs else stderr

            return logs

        except Exception as e:
            return f"Error retrieving logs: {e}"

    def _force_close(self):
        """Force close SSH connection, even if there are errors."""
        if self.ssh_client:
            try:
                transport = self.ssh_client.get_transport()
                if transport:
                    try:
                        if transport.is_active():
                            transport.close()
                    except:
                        pass
                self.ssh_client.close()
            except Exception as e:
                print(f"[SSH] Error force closing connection: {e}")
            finally:
                self.ssh_client = None

    def close(self):
        """Close SSH connection safely."""
        if self.ssh_client:
            try:
                transport = self.ssh_client.get_transport()
                if transport and transport.is_active():
                    transport.close()
                self.ssh_client.close()
                print(f"[SSH] Connection closed to {self.server.ip_address}")
            except Exception as e:
                print(f"[SSH] Error closing connection: {e}")
            finally:
                self.ssh_client = None

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
