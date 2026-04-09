"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    serversService,
    Server,
    Metric,
    ContainerRuntimePolicy,
} from "@/lib/services";
import Image from "next/image";
import {
    cn,
    getSpinnerClass,
    getAlertClass,
    getButtonClass,
    getIconContainerClass,
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
    payload.pid_mode = form.pid_mode.trim();
    if (form.command_override.trim()) {
        payload.command_override = form.command_override.trim();
    }
    if (form.cpus.trim()) {
        const parsed = Number(form.cpus.trim());
        if (!Number.isNaN(parsed)) {
            payload.cpus = parsed;
        }
    }
    payload.privileged = form.privileged;

    return payload;
}

export default function ServerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const serverId = parseInt(params.id as string);

    const [server, setServer] = useState<Server | null>(null);
    const [metrics, setMetrics] = useState<Metric[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [wsConnected, setWsConnected] = useState(false);
    const [savingRuntime, setSavingRuntime] = useState(false);
    const [runtimeFeedback, setRuntimeFeedback] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);
    const [runtimeForm, setRuntimeForm] = useState(
        normalizeRuntimePolicyForm(null),
    );
    // Verificar que el serverId sea válido
    useEffect(() => {
        console.log("[ServerDetail] Params:", params);
        console.log("[ServerDetail] Server ID:", serverId);
        if (isNaN(serverId)) {
            console.error("[ServerDetail] Invalid server ID:", params.id);
            setError("ID de servidor inválido");
            setLoading(false);
            return;
        }
    }, [params, serverId]);

    useEffect(() => {
        if (serverId && !isNaN(serverId)) {
            console.log("[ServerDetail] Loading data for server ID:", serverId);
            setLoading(true);
            setError("");
            setServer(null);
            loadServerData();
        }
    }, [serverId]);

    const loadServerData = async () => {
        try {
            console.log(
                "[ServerDetail] Fetching server data for ID:",
                serverId,
            );
            const [serverData, metricsData] = await Promise.all([
                serversService.getById(serverId),
                serversService.getMetrics(serverId),
            ]);
            console.log("[ServerDetail] Server data loaded:", serverData);
            setServer(serverData);
            setRuntimeFeedback(null);
            setRuntimeForm(
                normalizeRuntimePolicyForm(
                    serverData.container_runtime_defaults,
                ),
            );
            setMetrics(metricsData);
            setError("");
        } catch (error: any) {
            console.error("[ServerDetail] Error loading server data:", error);
            console.error(
                "[ServerDetail] Error details:",
                error.response?.data,
            );
            setError(
                error.response?.data?.detail ||
                    "Error al cargar los datos del servidor",
            );
            setServer(null);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatus = async () => {
        if (!server) return;

        try {
            const updatedServer = await serversService.getById(serverId);
            setServer(updatedServer);
        } catch (error) {
            console.error("Error refreshing server:", error);
            setError("Error al refrescar el estado del servidor");
        }
    };

    const handleDelete = async () => {
        if (
            !server ||
            !confirm("¿Estás seguro de que quieres eliminar este servidor?")
        ) {
            return;
        }

        try {
            await serversService.delete(server.id);
            router.push("/dashboard/servers");
        } catch (error) {
            console.error("Error deleting server:", error);
            setError("Error al eliminar el servidor");
        }
    };

    const handleSyncUsers = async () => {
        if (!server) return;

        try {
            setLoading(true);
            const response = await fetch(
                `/api/servers/${server.id}/sync-users`,
                {
                    method: "POST",
                    credentials: "include",
                },
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || "Error al sincronizar usuarios");
            }

            const data = await response.json();
            alert(
                `✅ ${data.message}\n\nServidor: ${data.server_name} (${data.server_ip})`,
            );
            setError("");
        } catch (error: any) {
            console.error("Error syncing users:", error);
            setError(error.message || "Error al sincronizar usuarios");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveRuntimeDefaults = async (
        e: React.FormEvent<HTMLFormElement>,
    ) => {
        e.preventDefault();
        if (!server) return;

        setSavingRuntime(true);
        setRuntimeFeedback(null);
        try {
            const payload = buildRuntimePolicyPayload(runtimeForm);
            await serversService.updateRuntimeDefaults(server.id, payload);
            const updated = await serversService.getById(server.id);
            setServer(updated);
            setRuntimeForm(
                normalizeRuntimePolicyForm(
                    updated.container_runtime_defaults,
                ),
            );
            setError("");
            setRuntimeFeedback({
                type: "success",
                message: "Runtime guardado correctamente para este servidor.",
            });
        } catch (err: any) {
            const detail =
                err.response?.data?.detail ||
                "Error al guardar configuración de runtime del servidor";
            setError(
                detail,
            );
            setRuntimeFeedback({
                type: "error",
                message: detail,
            });
        } finally {
            setSavingRuntime(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className={getSpinnerClass("lg")}></div>
                    <p className="mt-4 text-muted">
                        Cargando datos del servidor...
                    </p>
                </div>
            </div>
        );
    }

    if (!server) {
        return (
            <div className="empty-state">
                <svg
                    className="empty-state-icon text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <h3 className="empty-state-title">Servidor no encontrado</h3>
                {error && <p className="text-red-600 mb-4">{error}</p>}
                <p className="empty-state-description">
                    ID solicitado: {serverId}
                </p>
                <button
                    onClick={() => router.push("/dashboard/servers")}
                    className={cn(getButtonClass("primary"), "mt-4")}
                >
                    Volver a Servidores
                </button>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-8">
                <button
                    onClick={() => router.push("/dashboard/servers")}
                    className="back-button"
                >
                    <svg
                        className="icon-md mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                        />
                    </svg>
                    Volver a Servidores
                </button>
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <div
                            className={cn(
                                getIconContainerClass("primary"),
                                "w-16 h-16",
                            )}
                        >
                            <svg
                                className="icon-xl"
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
                        <div>
                            <h1 className="page-title">{server.name}</h1>
                            <p className="text-muted">{server.ip_address}</p>
                        </div>
                        <span
                            className={cn(
                                "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border",
                                server.status === "online"
                                    ? "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700"
                                    : "bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-700",
                            )}
                        >
                            <span
                                className={cn(
                                    "w-2 h-2 rounded-full mr-2",
                                    server.status === "online"
                                        ? "bg-green-500"
                                        : "bg-red-500",
                                )}
                            ></span>
                            {server.status === "online" ? "Online" : "Offline"}
                        </span>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={handleSyncUsers}
                            className={getButtonClass("primary")}
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <div
                                        className={cn(
                                            getSpinnerClass("sm"),
                                            "mr-2",
                                        )}
                                    ></div>
                                    Sincronizando...
                                </>
                            ) : (
                                "Sincronizar Usuarios"
                            )}
                        </button>
                        <button
                            onClick={handleToggleStatus}
                            className={getButtonClass("secondary")}
                        >
                            Refrescar Estado
                        </button>

                        <a
                            href="http://172.21.230.10:3001/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600 transition font-medium"
                        >
                            <img
                                src="https://upload.wikimedia.org/wikipedia/commons/3/3b/Grafana_icon.svg"
                                alt="Grafana"
                                className="icon-sm"
                            />
                            <span>Métricas en Grafana</span>
                        </a>

                        <button
                            onClick={handleDelete}
                            className={getButtonClass("danger")}
                        >
                            Eliminar Servidor
                        </button>
                    </div>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div className={cn(getAlertClass("error"), "mb-6")}>
                    <span>{error}</span>
                    <button
                        onClick={() => setError("")}
                        className="text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
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

            {/* Server Info */}
            <div className="grid grid-cols-1 gap-6 mb-8">
                <div className="card">
                    <h2 className="card-header">Información del Servidor</h2>
                    <dl className="dl">
                        <div className="dl-item">
                            <dt className="dl-term">ID:</dt>
                            <dd className="dl-definition">{server.id}</dd>
                        </div>
                        <div className="dl-item">
                            <dt className="dl-term">Nombre:</dt>
                            <dd className="dl-definition">{server.name}</dd>
                        </div>
                        <div className="dl-item">
                            <dt className="dl-term">IP:</dt>
                            <dd className="dl-definition">
                                {server.ip_address}
                            </dd>
                        </div>
                        <div className="dl-item">
                            <dt className="dl-term">Usuario SSH:</dt>
                            <dd className="dl-definition">{server.ssh_user}</dd>
                        </div>
                        <div className="dl-item">
                            <dt className="dl-term">Estado:</dt>
                            <dd className="dl-definition capitalize">
                                {server.status}
                            </dd>
                        </div>
                    </dl>
                </div>

                <div className="card">
                    <h2 className="card-header">Runtime de Contenedores</h2>
                    <p className="text-sm text-muted mb-4">
                        Estas reglas tienen prioridad sobre las reglas por label.
                    </p>
                    {runtimeFeedback && (
                        <div
                            className={cn(
                                getAlertClass(
                                    runtimeFeedback.type === "success"
                                        ? "success"
                                        : "error",
                                ),
                                "mb-4",
                            )}
                        >
                            <span>{runtimeFeedback.message}</span>
                        </div>
                    )}
                    <form
                        onSubmit={handleSaveRuntimeDefaults}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    >
                        <div className="form-group">
                            <label className="label">GPUs</label>
                            <input
                                className="input"
                                value={runtimeForm.gpus}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        gpus: e.target.value,
                                    })
                                }
                                placeholder="all o 4"
                                disabled={savingRuntime}
                            />
                        </div>
                        <div className="form-group">
                            <label className="label">Memoria</label>
                            <input
                                className="input"
                                value={runtimeForm.memory}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        memory: e.target.value,
                                    })
                                }
                                placeholder="128g"
                                disabled={savingRuntime}
                            />
                        </div>
                        <div className="form-group">
                            <label className="label">SHM Size</label>
                            <input
                                className="input"
                                value={runtimeForm.shm_size}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        shm_size: e.target.value,
                                    })
                                }
                                placeholder="45g"
                                disabled={savingRuntime}
                            />
                        </div>
                        <div className="form-group">
                            <label className="label">CPUs</label>
                            <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="input"
                                value={runtimeForm.cpus}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        cpus: e.target.value,
                                    })
                                }
                                placeholder="8"
                                disabled={savingRuntime}
                            />
                        </div>
                        <div className="form-group">
                            <label className="label">PID Mode</label>
                            <input
                                className="input"
                                value={runtimeForm.pid_mode}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        pid_mode: e.target.value,
                                    })
                                }
                                placeholder="host"
                                disabled={savingRuntime}
                            />
                        </div>
                        <div className="form-group">
                            <label className="label">Comando Override</label>
                            <input
                                className="input"
                                value={runtimeForm.command_override}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        command_override: e.target.value,
                                    })
                                }
                                placeholder="bash -lc 'python app.py'"
                                disabled={savingRuntime}
                            />
                        </div>
                        <label className="flex items-center gap-2 md:col-span-2">
                            <input
                                type="checkbox"
                                checked={runtimeForm.privileged}
                                onChange={(e) =>
                                    setRuntimeForm({
                                        ...runtimeForm,
                                        privileged: e.target.checked,
                                    })
                                }
                                disabled={savingRuntime}
                            />
                            <span className="text-sm">Privileged</span>
                        </label>

                        <div className="md:col-span-2 flex justify-end">
                            <button
                                type="submit"
                                className={getButtonClass("primary")}
                                disabled={savingRuntime}
                            >
                                {savingRuntime ? "Guardando..." : "Guardar runtime"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Containers */}
            <div className="card">
                <h2 className="card-header">Contenedores</h2>
            </div>
        </div>
    );
}
