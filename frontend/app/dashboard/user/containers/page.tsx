"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authService, api } from "@/lib/api";
import CreateContainerModal from "@/app/components/CreateContainerModal";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import InfoDialog from "@/app/components/InfoDialog";
import {
    cn,
    getButtonClass,
    getAlertClass,
    getSpinnerClass,
    getIconContainerClass,
} from "@/lib/styles";

interface Container {
    id: number;
    name: string;
    server_id: number;
    server_name: string;
    server_ip?: string;
    image: string;
    status: string;
    ports: string | null;
    created_at: string;
    username?: string;
}

const getHostPortFromMapping = (ports?: string | null): string | null => {
    if (!ports) {
        return null;
    }

    const entries = ports
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

    for (const entry of entries) {
        // Formato docker habitual: 0.0.0.0:4000->8080/tcp o :::4000->8080/tcp
        const dockerArrowMatch = entry.match(/.*:(\d+)->\d+(?:\/\w+)?$/);
        if (dockerArrowMatch) {
            return dockerArrowMatch[1];
        }

        // Formato simple legado: 4000:8080
        const simpleMappingMatch = entry.match(/^(\d+):\d+$/);
        if (simpleMappingMatch) {
            return simpleMappingMatch[1];
        }

        // Solo puerto expuesto en host: 4000
        const rawPortMatch = entry.match(/^(\d+)$/);
        if (rawPortMatch) {
            return rawPortMatch[1];
        }
    }

    return null;
};

const getSshUserForContainer = (
    containerUsername?: string,
    currentUsername?: string,
): string => {
    const preferredUser = containerUsername || currentUsername;
    if (!preferredUser) {
        return "<usuario>";
    }

    return preferredUser.toLowerCase() === "admin"
        ? "<usuario>"
        : preferredUser;
};

export default function UserContainersPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [containers, setContainers] = useState<Container[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [containerToDelete, setContainerToDelete] = useState<number | null>(
        null,
    );
    const [showSshDialog, setShowSshDialog] = useState(false);
    const [sshCommand, setSshCommand] = useState("");
    const [sshPort, setSshPort] = useState("");

    const setShowDeleteConfirmGlobal = (value: boolean) => {
        setShowDeleteConfirm(value);
    };

    const setContainerToDeleteGlobal = (value: number | null) => {
        setContainerToDelete(value);
    };

    useEffect(() => {
        const verifyAuth = async () => {
            try {
                const response = await authService.verifyToken();
                if (!response.valid) {
                    router.push("/login");
                    return;
                }

                // Si es admin, redirigir al dashboard admin
                if (response.is_admin === 1) {
                    router.push("/dashboard");
                    return;
                }

                setCurrentUser(response);
            } catch (error) {
                router.push("/login");
            } finally {
                setAuthLoading(false);
            }
        };

        verifyAuth();
    }, [router]);

    useEffect(() => {
        if (currentUser && currentUser.is_admin !== 1) {
            loadContainers();
        }
    }, [currentUser]);

    const loadContainers = async (showLoading = true) => {
        try {
            if (showLoading) {
                setLoading(true);
            }
            setError("");

            const response = await fetch("/api/containers/my", {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
            });

            if (!response.ok) {
                throw new Error("Error al cargar contenedores");
            }

            const data = await response.json();
            setContainers(data);
        } catch (error) {
            console.error("Error loading containers:", error);
            setError("Error al cargar contenedores");
        } finally {
            if (showLoading) {
                setLoading(false);
            }
        }
    };

    // Función para actualizar un contenedor localmente
    const updateContainerLocally = (
        containerId: number,
        updates: Partial<Container>,
    ) => {
        setContainers((prev) =>
            prev.map((c) => (c.id === containerId ? { ...c, ...updates } : c)),
        );
    };

    // Función para eliminar un contenedor localmente
    const removeContainerLocally = (containerId: number) => {
        setContainers((prev) => prev.filter((c) => c.id !== containerId));
    };

    // Agregar contenedor localmente (sin refrescar)
    const addContainerLocally = (newContainer: any) => {
        // Mapear la respuesta del backend al formato de Container
        const container: Container = {
            id: newContainer.id,
            name: newContainer.name,
            server_id: newContainer.server_id,
            server_name: newContainer.server_name || "Servidor",
            server_ip: newContainer.server_ip,
            image: newContainer.image,
            status: newContainer.status || "stopped",
            ports: newContainer.ports || "",
            created_at: newContainer.created_at || new Date().toISOString(),
        };
        setContainers((prev) => [...prev, container]);
    };

    const handleConfirmDelete = async () => {
        if (containerToDelete === null) return;

        try {
            const response = await fetch(
                `/api/containers/${containerToDelete}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                },
            );

            if (!response.ok) {
                throw new Error("Error al eliminar contenedor");
            }

            // Eliminar localmente sin refrescar
            removeContainerLocally(containerToDelete);
            setShowDeleteConfirm(false);
            setContainerToDelete(null);
        } catch (error) {
            console.error("Error deleting container:", error);
            alert("Error al eliminar el contenedor");
            setShowDeleteConfirm(false);
            setContainerToDelete(null);
        }
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirm(false);
        setContainerToDelete(null);
    };

    if (authLoading || loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className={getSpinnerClass("lg")}></div>
                    <p className="mt-4 text-muted">
                        {authLoading
                            ? "Verificando sesión..."
                            : "Cargando contenedores..."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Mis Contenedores</h1>
                    <p className="page-subtitle">
                        Gestiona tus contenedores Docker
                    </p>
                </div>

                <div className="flex space-x-3">
                    <button
                        onClick={() => loadContainers()}
                        className={cn(
                            getButtonClass("secondary"),
                            "flex items-center",
                        )}
                        title="Actualizar lista"
                    >
                        <svg
                            className="icon-sm mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                        </svg>
                        Actualizar
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className={cn(
                            getButtonClass("primary"),
                            "flex items-center",
                        )}
                    >
                        <svg
                            className="icon-sm mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 4v16m8-8H4"
                            />
                        </svg>
                        Crear Contenedor
                    </button>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div className={cn(getAlertClass("error"), "mb-6")}>
                    <span>{error}</span>
                    <button
                        onClick={() => setError("")}
                        className="text-red-700 hover:text-red-900"
                    >
                        <svg
                            className="icon-md"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>
            )}

            {/* Info Card */}
            <div className="card mb-6">
                <div className="flex items-start space-x-3">
                    <div className={getIconContainerClass("info")}>
                        <svg
                            className="icon-md"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                            📦 Información sobre Contenedores
                        </h3>
                        <ul className="text-sm text-muted space-y-1">
                            <li>
                                • Puedes crear{" "}
                                <strong>
                                    máximo 1 contenedor por servidor
                                </strong>
                            </li>
                            <li>
                                • Los contenedores se ejecutan en servidores
                                disponibles
                            </li>
                            <li>
                                • Asegúrate de detener contenedores cuando no
                                los uses
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Containers List */}
            {containers.length === 0 ? (
                <div className="empty-state">
                    <svg
                        className="empty-state-icon text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                        />
                    </svg>
                    <h3 className="empty-state-title">
                        No tienes contenedores
                    </h3>
                    <p className="empty-state-description">
                        Comienza creando tu primer contenedor Docker
                    </p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className={getButtonClass("primary")}
                    >
                        Crear Contenedor
                    </button>
                </div>
            ) : (
                <div className="grid-3-cols">
                    {containers.map((container) => (
                        <ContainerCard
                            key={container.id}
                            container={container}
                            currentUsername={currentUser?.username}
                            onRefresh={loadContainers}
                            onUpdate={updateContainerLocally}
                            onDelete={removeContainerLocally}
                            containerToDelete={containerToDelete}
                            setShowDeleteConfirm={setShowDeleteConfirmGlobal}
                            setContainerToDelete={setContainerToDeleteGlobal}
                            onShowSshDialog={(command, port) => {
                                setSshCommand(command);
                                setSshPort(port);
                                setShowSshDialog(true);
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Create Modal */}
            <CreateContainerModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSuccess={(newContainer) => {
                    setShowCreateModal(false);
                    addContainerLocally(newContainer);
                    // Opcionalmente, refrescar en background para confirmar
                    // loadContainers(false);
                }}
            />

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title="Eliminar Contenedor"
                message={`¿Estás seguro de que deseas eliminar este contenedor? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                cancelText="Cancelar"
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
                type="danger"
            />

            <InfoDialog
                isOpen={showSshDialog}
                title="Comando SSH"
                message={
                    sshCommand
                        ? `Copia este comando para conectarte al contenedor:\n\nDespués de conectarte, accede a: http://localhost:${sshPort}`
                        : "No hay información de conexión disponible"
                }
                copyText={sshCommand || undefined}
                onClose={() => setShowSshDialog(false)}
                type="info"
            />
        </div>
    );
}

function ContainerCard({
    container,
    currentUsername,
    onRefresh,
    onUpdate,
    onDelete,
    containerToDelete,
    setShowDeleteConfirm,
    setContainerToDelete,
    onShowSshDialog,
}: {
    container: Container;
    currentUsername?: string;
    onRefresh: () => void;
    onUpdate: (containerId: number, updates: Partial<Container>) => void;
    onDelete: (containerId: number) => void;
    containerToDelete: number | null;
    setShowDeleteConfirm: (value: boolean) => void;
    setContainerToDelete: (value: number | null) => void;
    onShowSshDialog: (command: string, port: string) => void;
}) {
    const [loading, setLoading] = useState(false);
    const [localStatus, setLocalStatus] = useState(container.status);

    const handleStart = async () => {
        setLoading(true);
        // Actualización optimista
        setLocalStatus("starting");
        onUpdate(container.id, { status: "starting" });

        try {
            const response = await fetch(
                `/api/containers/${container.id}/start`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                },
            );

            if (!response.ok) {
                throw new Error("Error al iniciar contenedor");
            }

            // Actualizar estado a running
            setLocalStatus("running");
            onUpdate(container.id, { status: "running" });
        } catch (error) {
            console.error("Error starting container:", error);
            alert("Error al iniciar el contenedor");
            // Revertir en caso de error
            setLocalStatus(container.status);
            onUpdate(container.id, { status: container.status });
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        setLoading(true);
        // Actualización optimista
        setLocalStatus("stopping");
        onUpdate(container.id, { status: "stopping" });

        try {
            const response = await fetch(
                `/api/containers/${container.id}/stop`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                },
            );

            if (!response.ok) {
                throw new Error("Error al detener contenedor");
            }

            // Actualizar estado a stopped
            setLocalStatus("stopped");
            onUpdate(container.id, { status: "stopped" });
        } catch (error) {
            console.error("Error stopping container:", error);
            alert("Error al detener el contenedor");
            // Revertir en caso de error
            setLocalStatus(container.status);
            onUpdate(container.id, { status: container.status });
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = () => {
        if (!container.server_ip || !container.ports) {
            onShowSshDialog("", "");
            return;
        }

        const hostPort = getHostPortFromMapping(container.ports);
        if (!hostPort) {
            onShowSshDialog("", "");
            return;
        }

        const localPort = hostPort; // Usar el mismo puerto localmente

        // Usar owner del contenedor; si es admin fallback mostrar placeholder.
        const sshUser = getSshUserForContainer(
            container.username,
            currentUsername,
        );
        const command = `ssh -N -L 127.0.0.1:${localPort}:127.0.0.1:${localPort} ${sshUser}@${container.server_ip}`;

        onShowSshDialog(command, localPort);
    };

    return (
        <div className="card hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        {container.name}
                    </h3>
                    <p className="text-sm text-muted">{container.image}</p>
                </div>
                <span
                    className={cn(
                        "badge border",
                        localStatus === "running"
                            ? "badge-success border-green-200 dark:border-green-700"
                            : localStatus === "starting"
                              ? "badge-info border-blue-200 dark:border-blue-700"
                              : localStatus === "stopping"
                                ? "badge-warning border-yellow-200 dark:border-yellow-700"
                                : "badge-neutral border-gray-200 dark:border-gray-600",
                    )}
                >
                    {localStatus === "running"
                        ? "Activo"
                        : localStatus === "starting"
                          ? "Iniciando..."
                          : localStatus === "stopping"
                            ? "Deteniendo..."
                            : "Detenido"}
                </span>
            </div>

            <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm">
                    <svg
                        className="icon-sm mr-2 text-muted"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                        />
                    </svg>
                    <span className="text-muted">{container.server_name}</span>
                </div>
                <div className="flex items-center text-sm">
                    <svg
                        className="icon-sm mr-2 text-muted"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                    <span className="text-muted">
                        Puertos: {container.ports || "N/A"}
                    </span>
                </div>
                <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="text-xs text-muted mb-1">
                        SSH Port Forwarding
                    </div>
                    {container.server_ip &&
                    getHostPortFromMapping(container.ports) ? (
                        <div className="font-mono text-xs break-all text-primary">
                            {`ssh -N -L 127.0.0.1:${getHostPortFromMapping(container.ports)}:127.0.0.1:${getHostPortFromMapping(container.ports)} ${getSshUserForContainer(container.username, currentUsername)}@${container.server_ip}`}
                        </div>
                    ) : (
                        <div className="text-xs text-muted">
                            No hay puertos publicados para generar comando
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center space-x-2">
                {(localStatus === "running" || localStatus === "starting") && (
                    <button
                        onClick={handleConnect}
                        disabled={loading}
                        className={cn(
                            getButtonClass("primary"),
                            "flex-1 text-sm",
                            loading && "opacity-50 cursor-not-allowed",
                        )}
                        title="Copiar comando SSH"
                    >
                        <svg
                            className="icon-sm mr-1 inline-block"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                        Conectarse
                    </button>
                )}
                {localStatus === "running" || localStatus === "starting" ? (
                    <button
                        onClick={handleStop}
                        disabled={loading || localStatus === "stopping"}
                        className={cn(
                            getButtonClass("secondary"),
                            "flex-1 text-sm",
                            loading && "opacity-50 cursor-not-allowed",
                        )}
                    >
                        {loading && localStatus === "stopping" ? (
                            <>
                                <span className="inline-block animate-spin mr-2">
                                    ⏳
                                </span>
                                Deteniendo...
                            </>
                        ) : (
                            "Detener"
                        )}
                    </button>
                ) : (
                    <button
                        onClick={handleStart}
                        disabled={loading || localStatus === "starting"}
                        className={cn(
                            getButtonClass("primary"),
                            "flex-1 text-sm",
                            loading && "opacity-50 cursor-not-allowed",
                        )}
                    >
                        {loading && localStatus === "starting" ? (
                            <>
                                <span className="inline-block animate-spin mr-2">
                                    ⏳
                                </span>
                                Iniciando...
                            </>
                        ) : (
                            "Iniciar"
                        )}
                    </button>
                )}
                <button
                    onClick={() => {
                        setShowDeleteConfirm(true);
                        setContainerToDelete(container.id);
                    }}
                    disabled={loading || containerToDelete === container.id}
                    className={cn(
                        "text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-2 transition-colors",
                        (loading || containerToDelete === container.id) &&
                            "opacity-50 cursor-not-allowed",
                    )}
                    title="Eliminar"
                >
                    <svg
                        className="icon-md"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}
