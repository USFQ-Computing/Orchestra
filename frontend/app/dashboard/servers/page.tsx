"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { authService } from "@/lib/api";
import {
    serversService,
    Server,
    ContainerRuntimePolicy,
} from "@/lib/services";
import {
    cn,
    getStatusBadgeClass,
    getSpinnerClass,
    getIconContainerClass,
    getButtonClass,
    getAlertClass,
} from "@/lib/styles";

function normalizeRuntimePolicyForm(
    policy?: ContainerRuntimePolicy | null,
) {
    return {
        gpus: policy?.gpus || "",
        memory: policy?.memory || "",
        shm_size: policy?.shm_size || "",
        cpus: policy?.cpus !== undefined ? String(policy.cpus) : "",
        pid_mode: policy?.pid_mode || "",
        privileged: Boolean(policy?.privileged),
        command_override: policy?.command_override || "",
    };
}

function buildRuntimePolicyPayload(form: {
    gpus: string;
    memory: string;
    shm_size: string;
    cpus: string;
    pid_mode: string;
    privileged: boolean;
    command_override: string;
}): ContainerRuntimePolicy {
    const payload: ContainerRuntimePolicy = {};

    if (form.gpus.trim()) payload.gpus = form.gpus.trim();
    if (form.memory.trim()) payload.memory = form.memory.trim();
    if (form.shm_size.trim()) payload.shm_size = form.shm_size.trim();
    if (form.pid_mode.trim()) payload.pid_mode = form.pid_mode.trim();
    if (form.command_override.trim()) {
        payload.command_override = form.command_override.trim();
    }
    if (form.cpus.trim()) {
        const parsed = Number(form.cpus.trim());
        if (!Number.isNaN(parsed)) {
            payload.cpus = parsed;
        }
    }
    if (form.privileged) payload.privileged = true;

    return payload;
}

export default function ServersPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showModal, setShowModal] = useState(false);
    const [showRetryModal, setShowRetryModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedServer, setSelectedServer] = useState<Server | null>(null);

    useEffect(() => {
        const verifyAuth = async () => {
            try {
                const response = await authService.verifyToken();
                if (!response.valid) {
                    router.push("/login");
                    return;
                }
                setCurrentUser(response);

                // Si no es admin, redirigir
                if (response.is_admin !== 1) {
                    router.push("/dashboard/user");
                    return;
                }
            } catch (error) {
                router.push("/login");
            } finally {
                setAuthLoading(false);
            }
        };

        verifyAuth();
    }, [router]);

    useEffect(() => {
        if (currentUser && currentUser.is_admin === 1) {
            loadServers();
        }
    }, [currentUser]);

    const loadServers = async () => {
        try {
            const data = await serversService.getAll();
            setServers(data);
        } catch (error) {
            console.error("Error loading servers:", error);
            setError("Error al cargar servidores");
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async (serverId: number) => {
        try {
            const updatedServer = await serversService.getById(serverId);
            setServers(
                servers.map((s) => (s.id === serverId ? updatedServer : s)),
            );
        } catch (error) {
            console.error("Error refreshing server:", error);
            setError("Error al refrescar el estado del servidor");
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("¿Estás seguro de que quieres eliminar este servidor?")) {
            return;
        }

        try {
            await serversService.delete(id);
            await loadServers();
        } catch (error) {
            console.error("Error deleting server:", error);
            setError("Error al eliminar el servidor");
        }
    };

    if (authLoading || loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className={getSpinnerClass("lg")}></div>
                    <p className="mt-4 text-muted">
                        {authLoading
                            ? "Verificando permisos..."
                            : "Cargando servidores..."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ProtectedRoute
            user={currentUser}
            requireAdmin={true}
            loading={authLoading}
        >
            <div>
                {/* Header */}
                <div className="page-header">
                    <div>
                        <h1 className="page-title">Servidores</h1>
                        <p className="page-subtitle">
                            Gestiona los servidores del sistema
                        </p>
                    </div>

                    <button
                        onClick={() => setShowModal(true)}
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
                        Agregar Servidor
                    </button>
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

                {/* Stats */}
                <div className="grid-3-cols mb-8">
                    <div className="card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
                                    Total
                                </p>
                                <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                                    {servers.length}
                                </p>
                            </div>
                            <div className={getIconContainerClass("primary")}>
                                <svg
                                    className="icon-lg"
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
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">
                                    Online
                                </p>
                                <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                                    {
                                        servers.filter(
                                            (s) => s.status === "online",
                                        ).length
                                    }
                                </p>
                            </div>
                            <div className={getIconContainerClass("success")}>
                                <svg
                                    className="icon-lg"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">
                                    Offline
                                </p>
                                <p className="text-3xl font-bold text-red-700 dark:text-red-300">
                                    {
                                        servers.filter(
                                            (s) => s.status === "offline",
                                        ).length
                                    }
                                </p>
                            </div>
                            <div className={getIconContainerClass("error")}>
                                <svg
                                    className="icon-lg"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Servers List */}
                {servers.length === 0 ? (
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
                                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                            />
                        </svg>
                        <h3 className="empty-state-title">No hay servidores</h3>
                        <p className="empty-state-description">
                            Comienza agregando tu primer servidor al sistema
                        </p>
                        <button
                            onClick={() => setShowModal(true)}
                            className={getButtonClass("primary")}
                        >
                            Agregar Servidor
                        </button>
                    </div>
                ) : (
                    <div className="card overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead className="table-header">
                                    <tr>
                                        <th className="table-header-cell">
                                            Nombre
                                        </th>
                                        <th className="table-header-cell">
                                            IP
                                        </th>
                                        <th className="table-header-cell">
                                            Usuario SSH
                                        </th>
                                        <th className="table-header-cell">
                                            Estado SSH
                                        </th>
                                        <th className="table-header-cell">
                                            Estado
                                        </th>
                                        <th className="table-header-cell text-right">
                                            Acciones
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="table-body">
                                    {servers.map((server) => (
                                        <tr
                                            key={server.id}
                                            className="table-row cursor-pointer hover:bg-gray-50"
                                            onClick={() =>
                                                router.push(
                                                    `/dashboard/servers/${server.id}`,
                                                )
                                            }
                                        >
                                            <td className="table-cell">
                                                <div className="flex items-center group">
                                                    <div
                                                        className={cn(
                                                            getIconContainerClass(
                                                                "primary",
                                                            ),
                                                            "mr-3",
                                                        )}
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
                                                                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                                                            />
                                                        </svg>
                                                    </div>
                                                    <div className="font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                                                        {server.name}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="table-cell text-muted">
                                                {server.ip_address}
                                            </td>
                                            <td className="table-cell text-muted">
                                                {server.ssh_user}
                                            </td>
                                            <td className="table-cell">
                                                {server.ssh_status ===
                                                "deployed" ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700">
                                                        <svg
                                                            className="icon-xs mr-1"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                strokeWidth={2}
                                                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                                            />
                                                        </svg>
                                                        Configurado
                                                    </span>
                                                ) : server.ssh_status ===
                                                  "pending" ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700">
                                                        <div
                                                            className={cn(
                                                                getSpinnerClass(
                                                                    "sm",
                                                                ),
                                                                "mr-1",
                                                            )}
                                                        ></div>
                                                        Pendiente
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedServer(
                                                                server,
                                                            );
                                                            setShowRetryModal(
                                                                true,
                                                            );
                                                        }}
                                                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-700 dark:hover:bg-red-800 transition-colors cursor-pointer"
                                                    >
                                                        <svg
                                                            className="icon-xs mr-1"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                strokeWidth={2}
                                                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                                            />
                                                        </svg>
                                                        Falló - Reintentar
                                                    </button>
                                                )}
                                            </td>
                                            <td className="table-cell">
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
                                                        server.status ===
                                                            "online"
                                                            ? "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700"
                                                            : "bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-700",
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "w-2 h-2 rounded-full mr-1.5",
                                                            server.status ===
                                                                "online"
                                                                ? "bg-green-500"
                                                                : "bg-red-500",
                                                        )}
                                                    ></span>
                                                    {server.status === "online"
                                                        ? "Online"
                                                        : "Offline"}
                                                </span>
                                            </td>
                                            <td className="table-cell text-right">
                                                <div className="flex items-center justify-end space-x-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRefresh(
                                                                server.id,
                                                            );
                                                        }}
                                                        className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-300"
                                                        title="Refrescar estado"
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
                                                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                            />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedServer(
                                                                server,
                                                            );
                                                            setShowEditModal(
                                                                true,
                                                            );
                                                        }}
                                                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                                                        title="Editar"
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
                                                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                            />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDelete(
                                                                server.id,
                                                            );
                                                        }}
                                                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
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
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Add Server Modal */}
                {showModal && (
                    <AddServerModal
                        onClose={() => setShowModal(false)}
                        onSuccess={() => {
                            setShowModal(false);
                            loadServers();
                        }}
                    />
                )}

                {/* Retry SSH Deploy Modal */}
                {showRetryModal && selectedServer && (
                    <RetrySSHModal
                        server={selectedServer}
                        onClose={() => {
                            setShowRetryModal(false);
                            setSelectedServer(null);
                        }}
                        onSuccess={() => {
                            setShowRetryModal(false);
                            setSelectedServer(null);
                            loadServers();
                        }}
                    />
                )}

                {/* Edit Server Modal */}
                {showEditModal && selectedServer && (
                    <EditServerModal
                        server={selectedServer}
                        onClose={() => {
                            setShowEditModal(false);
                            setSelectedServer(null);
                        }}
                        onSuccess={() => {
                            setShowEditModal(false);
                            setSelectedServer(null);
                            loadServers();
                        }}
                    />
                )}
            </div>
        </ProtectedRoute>
    );
}

function AddServerModal({
    onClose,
    onSuccess,
}: {
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [formData, setFormData] = useState({
        name: "",
        ip_address: "",
        ssh_user: "root",
        ssh_password: "",
    });
    const [runtimeForm, setRuntimeForm] = useState(
        normalizeRuntimePolicyForm(null),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            await serversService.create({
                ...formData,
                container_runtime_defaults:
                    buildRuntimePolicyPayload(runtimeForm),
            });
            onSuccess();
        } catch (err: any) {
            setError(
                err.response?.data?.detail || "Error al crear el servidor",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Agregar Servidor</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
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

                <div className="modal-body">
                    {error && (
                        <div className={cn(getAlertClass("error"), "mb-4")}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="form-group">
                            <label htmlFor="name" className="label">
                                Nombre del Servidor
                            </label>
                            <input
                                id="name"
                                type="text"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        name: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="servidor-1"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="ip_address" className="label">
                                Dirección IP
                            </label>
                            <input
                                id="ip_address"
                                type="text"
                                value={formData.ip_address}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        ip_address: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="192.168.1.100"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="ssh_user" className="label">
                                Usuario SSH
                            </label>
                            <input
                                id="ssh_user"
                                type="text"
                                value={formData.ssh_user}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        ssh_user: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="root"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="ssh_password" className="label">
                                Contraseña SSH
                            </label>
                            <input
                                id="ssh_password"
                                type="password"
                                value={formData.ssh_password}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        ssh_password: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="••••••••"
                                required
                                disabled={loading}
                            />
                            <p className="form-help">
                                Requerida para configurar la clave SSH
                                automáticamente
                            </p>
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                            <p className="text-sm font-semibold mb-3">
                                Runtime por defecto del servidor
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <input
                                    className="input"
                                    placeholder="GPUs (all o 4)"
                                    value={runtimeForm.gpus}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            gpus: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="Memoria (128g)"
                                    value={runtimeForm.memory}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            memory: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="SHM Size (16g)"
                                    value={runtimeForm.shm_size}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            shm_size: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    className="input"
                                    placeholder="CPUs (8)"
                                    value={runtimeForm.cpus}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            cpus: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="PID mode (host)"
                                    value={runtimeForm.pid_mode}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            pid_mode: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="Command override"
                                    value={runtimeForm.command_override}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            command_override: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                            </div>
                            <label className="flex items-center gap-2 mt-3">
                                <input
                                    type="checkbox"
                                    checked={runtimeForm.privileged}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            privileged: e.target.checked,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <span className="text-sm">Privileged</span>
                            </label>
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className={getButtonClass("secondary")}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className={getButtonClass("primary")}
                            >
                                {loading ? (
                                    <>
                                        <div
                                            className={cn(
                                                getSpinnerClass("sm"),
                                                "mr-2",
                                            )}
                                        ></div>
                                        Creando...
                                    </>
                                ) : (
                                    "Crear Servidor"
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

function RetrySSHModal({
    server,
    onClose,
    onSuccess,
}: {
    server: Server;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            await serversService.retrySSHDeploy(server.id, password);
            onSuccess();
        } catch (err: any) {
            setError(
                err.response?.data?.detail || "Error al desplegar la clave SSH",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        Reintentar Configuración SSH
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
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

                <div className="modal-body">
                    <div className={cn(getAlertClass("warning"), "mb-4")}>
                        <div>
                            <p className="text-sm font-medium">
                                <strong>Servidor:</strong> {server.name} (
                                {server.ip_address})
                            </p>
                            <p className="text-xs mt-1">
                                La configuración de la clave SSH falló.
                                Proporciona la contraseña correcta para
                                reintentar.
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className={cn(getAlertClass("error"), "mb-4")}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="form-group">
                            <label htmlFor="password" className="label">
                                Contraseña SSH para {server.ssh_user}@
                                {server.ip_address}
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input"
                                placeholder="••••••••"
                                required
                                disabled={loading}
                                autoFocus
                            />
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className={getButtonClass("secondary")}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className={getButtonClass("primary")}
                            >
                                {loading ? (
                                    <>
                                        <div
                                            className={cn(
                                                getSpinnerClass("sm"),
                                                "mr-2",
                                            )}
                                        ></div>
                                        Desplegando...
                                    </>
                                ) : (
                                    "Reintentar"
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

function EditServerModal({
    server,
    onClose,
    onSuccess,
}: {
    server: Server;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [formData, setFormData] = useState({
        name: server.name,
        ip_address: server.ip_address,
    });
    const [runtimeForm, setRuntimeForm] = useState(
        normalizeRuntimePolicyForm(server.container_runtime_defaults),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            // Actualizar nombre si cambió
            if (formData.name !== server.name) {
                await serversService.updateName(server.id, formData.name);
            }

            // Actualizar IP si cambió
            if (formData.ip_address !== server.ip_address) {
                await serversService.updateIp(server.id, formData.ip_address);
            }

            await serversService.updateRuntimeDefaults(
                server.id,
                buildRuntimePolicyPayload(runtimeForm),
            );

            onSuccess();
        } catch (err: any) {
            setError(
                err.response?.data?.detail || "Error al actualizar el servidor",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Editar Servidor</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
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

                <div className="modal-body">
                    {error && (
                        <div className={cn(getAlertClass("error"), "mb-4")}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="form-group">
                            <label htmlFor="edit_name" className="label">
                                Nombre del Servidor
                            </label>
                            <input
                                id="edit_name"
                                type="text"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        name: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="servidor-1"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="edit_ip_address" className="label">
                                Dirección IP
                            </label>
                            <input
                                id="edit_ip_address"
                                type="text"
                                value={formData.ip_address}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        ip_address: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="192.168.1.100"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                            <p className="text-sm font-semibold mb-3">
                                Runtime por defecto del servidor
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <input
                                    className="input"
                                    placeholder="GPUs (all o 4)"
                                    value={runtimeForm.gpus}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            gpus: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="Memoria (128g)"
                                    value={runtimeForm.memory}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            memory: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="SHM Size (16g)"
                                    value={runtimeForm.shm_size}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            shm_size: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    className="input"
                                    placeholder="CPUs (8)"
                                    value={runtimeForm.cpus}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            cpus: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="PID mode (host)"
                                    value={runtimeForm.pid_mode}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            pid_mode: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <input
                                    className="input"
                                    placeholder="Command override"
                                    value={runtimeForm.command_override}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            command_override: e.target.value,
                                        })
                                    }
                                    disabled={loading}
                                />
                            </div>
                            <label className="flex items-center gap-2 mt-3">
                                <input
                                    type="checkbox"
                                    checked={runtimeForm.privileged}
                                    onChange={(e) =>
                                        setRuntimeForm({
                                            ...runtimeForm,
                                            privileged: e.target.checked,
                                        })
                                    }
                                    disabled={loading}
                                />
                                <span className="text-sm">Privileged</span>
                            </label>
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className={getButtonClass("secondary")}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className={getButtonClass("primary")}
                            >
                                {loading ? (
                                    <>
                                        <div
                                            className={cn(
                                                getSpinnerClass("sm"),
                                                "mr-2",
                                            )}
                                        ></div>
                                        Guardando...
                                    </>
                                ) : (
                                    "Guardar Cambios"
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
