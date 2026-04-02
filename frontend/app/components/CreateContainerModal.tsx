"use client";

import { useState, useEffect } from "react";
import { cn, getButtonClass, getAlertClass, getInputClass } from "@/lib/styles";
import { useToast } from "@/app/contexts/ToastContext";

interface Server {
    id: number;
    name: string;
    ssh_status: string;
    status?: string;
}

interface User {
    id: number;
    username: string;
    email: string;
    is_admin: number;
    is_active?: number;
}

interface CreateContainerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newContainer: any) => void;
    adminMode?: boolean; // Si es true, permite seleccionar usuario
    preselectedUserId?: number; // Usuario preseleccionado (opcional)
}

export default function CreateContainerModal({
    isOpen,
    onClose,
    onSuccess,
    adminMode = false,
    preselectedUserId,
}: CreateContainerModalProps) {
    const toast = useToast();
    const [servers, setServers] = useState<Server[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [selectedUserId, setSelectedUserId] = useState<string>("");
    const [userSearch, setUserSearch] = useState<string>("");

    // Valores por defecto para Colab Runtime
    const DEFAULT_IMAGE =
        "us-docker.pkg.dev/colab-images/public/runtime:latest";
    const DEFAULT_SHM_SIZE = "32g";

    const [formData, setFormData] = useState({
        name: "",
        server_id: "",
        user_id: "", // Para modo admin
        image: DEFAULT_IMAGE,
        ports: "",
        // Configuración avanzada
        shm_size: DEFAULT_SHM_SIZE,
        gpus: "all",
        privileged: true,
        volumes: "",
        custom_command: "",
    });

    useEffect(() => {
        if (isOpen) {
            fetchServers();
            fetchCurrentUser();
            if (adminMode) {
                fetchUsers();
            }
        }
    }, [isOpen, adminMode]);

    useEffect(() => {
        if (preselectedUserId) {
            setSelectedUserId(preselectedUserId.toString());
            setFormData((prev) => ({
                ...prev,
                user_id: preselectedUserId.toString(),
            }));
        }
    }, [preselectedUserId]);

    useEffect(() => {
        if (!preselectedUserId) {
            return;
        }

        const preselectedUser = users.find((u) => u.id === preselectedUserId);
        if (preselectedUser) {
            setUserSearch(preselectedUser.username);
        }
    }, [preselectedUserId, users]);

    const fetchCurrentUser = async () => {
        try {
            const response = await fetch("/api/auth/verify");
            if (response.ok) {
                const data = await response.json();
                setCurrentUser(data);
                // Actualizar el nombre del contenedor con el username
                if (data.username) {
                    setFormData((prev) => ({
                        ...prev,
                        name: `colab_${data.username}`,
                    }));
                }
            }
        } catch (err) {
            console.error("Error fetching user:", err);
        }
    };

    const fetchUsers = async () => {
        try {
            const response = await fetch("/api/users");
            if (response.ok) {
                const data = await response.json();
                // Filtrar solo usuarios activos
                const activeUsers = data
                    .filter((u: User) => u.is_active === 1)
                    .sort((a: User, b: User) =>
                        a.username.localeCompare(b.username),
                    );
                setUsers(activeUsers);
            }
        } catch (err) {
            console.error("Error fetching users:", err);
        }
    };

    const fetchServers = async () => {
        try {
            const response = await fetch("/api/servers");
            if (response.ok) {
                const data = await response.json();
                // Filtrar solo servidores con SSH configurado y online
                const availableServers = data
                    .filter(
                        (s: Server) =>
                            s.ssh_status === "deployed" &&
                            s.status === "online",
                    )
                    .sort((a: Server, b: Server) =>
                        a.name.localeCompare(b.name),
                    );
                setServers(availableServers);
            }
        } catch (err) {
            console.error("Error fetching servers:", err);
        }
    };

    const getDefaultVolumes = () => {
        let username = currentUser?.username || "user";

        // En modo admin, usar el username del usuario seleccionado
        if (adminMode && selectedUserId) {
            const selectedUser = users.find(
                (u) => u.id.toString() === selectedUserId,
            );
            if (selectedUser) {
                username = selectedUser.username;
            }
        }

        return `/media:/media:ro,/mnt:/mnt:ro,/home/${username}:/home/${username}`;
    };

    const buildDockerCommand = () => {
        let username = currentUser?.username || "user";

        // En modo admin, usar el username del usuario seleccionado
        if (adminMode && selectedUserId) {
            const selectedUser = users.find(
                (u) => u.id.toString() === selectedUserId,
            );
            if (selectedUser) {
                username = selectedUser.username;
            }
        }

        const containerName = formData.name || `colab_${username}`;

        let cmd = "docker run";

        // Shared memory
        if (formData.shm_size) {
            cmd += ` --shm-size=${formData.shm_size}`;
        }

        // GPUs
        if (formData.gpus) {
            cmd += ` --gpus=${formData.gpus}`;
        }

        // Privileged
        if (formData.privileged) {
            cmd += " --privileged";
        }

        // Auto-publish ports
        cmd += " -P";

        // Volumes
        const volumes = formData.volumes || getDefaultVolumes();
        const volumeList = volumes
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v);
        volumeList.forEach((vol) => {
            cmd += ` -v "${vol}"`;
        });

        // Container name
        cmd += ` --name=${containerName}`;

        // Image
        cmd += ` ${formData.image}`;

        return cmd;
    };

    const handleSelectUser = (user: User) => {
        const userId = user.id.toString();
        setSelectedUserId(userId);
        setUserSearch(user.username);
        setFormData((prev) => ({
            ...prev,
            user_id: userId,
            name: `colab_${user.username}`,
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            // Construir el payload
            const payload: any = {
                name: formData.name,
                server_id: parseInt(formData.server_id),
                image: formData.image,
                ports: formData.ports || null,
            };

            // En modo admin, agregar user_id
            if (adminMode && selectedUserId) {
                payload.user_id = parseInt(selectedUserId);
            }

            // Si hay configuración avanzada, agregarla
            if (showAdvanced) {
                payload.advanced_config = {
                    shm_size: formData.shm_size,
                    gpus: formData.gpus,
                    privileged: formData.privileged,
                    volumes: formData.volumes || getDefaultVolumes(),
                    custom_command: formData.custom_command,
                };
            }

            const response = await fetch("/api/containers", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || "Error al crear contenedor");
            }

            // Éxito
            toast.success(
                `Contenedor "${formData.name}" creado exitosamente 🎉`,
            );
            resetForm();
            onSuccess(data); // Pasar el contenedor creado al callback
            onClose();
        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : "Error desconocido";
            setError(errorMessage);
            toast.error(`Error: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        let username = currentUser?.username || "user";

        // En modo admin, usar el username del usuario seleccionado
        if (adminMode && selectedUserId) {
            const selectedUser = users.find(
                (u) => u.id.toString() === selectedUserId,
            );
            if (selectedUser) {
                username = selectedUser.username;
            }
        }

        setFormData({
            name: `colab_${username}`,
            server_id: "",
            user_id:
                adminMode && preselectedUserId
                    ? preselectedUserId.toString()
                    : "",
            image: DEFAULT_IMAGE,
            ports: "",
            shm_size: DEFAULT_SHM_SIZE,
            gpus: "all",
            privileged: true,
            volumes: "",
            custom_command: "",
        });
        setError("");
        setShowAdvanced(false);
        setUserSearch("");

        // Mantener el usuario preseleccionado si existe
        if (preselectedUserId) {
            const preselectedUser = users.find(
                (u) => u.id === preselectedUserId,
            );
            if (preselectedUser) {
                setUserSearch(preselectedUser.username);
            }
        } else {
            setSelectedUserId("");
        }
    };

    const handleClose = () => {
        if (!loading) {
            resetForm();
            onClose();
        }
    };

    if (!isOpen) return null;

    const filteredUsers = users
        .filter((user) => {
            const query = userSearch.trim().toLowerCase();
            if (!query) {
                return true;
            }

            return (
                user.username.toLowerCase().includes(query) ||
                user.email.toLowerCase().includes(query)
            );
        })
        .slice(0, 20);

    const selectedUser = users.find(
        (u) => u.id.toString() === selectedUserId,
    );

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
                onClick={handleClose}
            ></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative w-full max-w-3xl">
                    <div className="card max-h-[90vh] overflow-y-auto">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="card-header mb-1">
                                    🐳 Crear Nuevo Contenedor
                                </h2>
                                <p className="text-sm text-muted">
                                    Contenedor Docker con configuración Colab
                                    Runtime
                                </p>
                            </div>
                            <button
                                onClick={handleClose}
                                disabled={loading}
                                className="btn-icon text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                title="Cerrar"
                            >
                                <span className="text-2xl">×</span>
                            </button>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className={cn("mb-4", getAlertClass("error"))}>
                                <span className="mr-2">⚠️</span>
                                {error}
                            </div>
                        )}

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Selector de Usuario (Solo en modo Admin) */}
                            {adminMode && (
                                <div>
                                    <label className="label">Usuario *</label>
                                    <input
                                        type="text"
                                        value={userSearch}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setUserSearch(value);
                                            setSelectedUserId("");
                                            setFormData((prev) => ({
                                                ...prev,
                                                user_id: "",
                                            }));
                                        }}
                                        placeholder="Buscar por usuario o email"
                                        className={getInputClass()}
                                        required
                                        disabled={loading || !!preselectedUserId}
                                    />

                                    {selectedUser && (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            ✅ Seleccionado: {selectedUser.username} ({selectedUser.email})
                                        </p>
                                    )}

                                    {!preselectedUserId && userSearch.trim() && (
                                        <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto bg-white dark:bg-gray-900">
                                            {filteredUsers.length > 0 ? (
                                                filteredUsers.map((user) => (
                                                    <button
                                                        key={user.id}
                                                        type="button"
                                                        onClick={() =>
                                                            handleSelectUser(user)
                                                        }
                                                        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                                                    >
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                            {user.username}
                                                            {user.is_admin ? " 👑" : ""}
                                                        </div>
                                                        <div className="text-xs text-muted">
                                                            {user.email}
                                                        </div>
                                                    </button>
                                                ))
                                            ) : (
                                                <p className="px-3 py-2 text-xs text-muted">
                                                    No se encontraron usuarios
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {users.length === 0 && (
                                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                                            ⚠️ No hay usuarios activos
                                            disponibles
                                        </p>
                                    )}
                                    <p className="text-xs text-muted mt-1">
                                        Busca y selecciona el usuario propietario del
                                        contenedor
                                    </p>
                                </div>
                            )}

                            {/* Servidor */}
                            <div>
                                <label className="label">Servidor *</label>
                                <select
                                    value={formData.server_id}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            server_id: e.target.value,
                                        })
                                    }
                                    className="select"
                                    required
                                    disabled={loading}
                                >
                                    <option value="">
                                        Selecciona un servidor
                                    </option>
                                    {servers.map((server) => (
                                        <option
                                            key={server.id}
                                            value={server.id}
                                        >
                                            {server.name}
                                        </option>
                                    ))}
                                </select>
                                {servers.length === 0 && (
                                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                                        ⚠️ No hay servidores disponibles con SSH
                                        configurado
                                    </p>
                                )}
                                <p className="text-xs text-muted mt-1">
                                    Solo se muestran servidores online con SSH
                                    configurado
                                </p>
                            </div>

                            {/* Dropdown de Configuración Avanzada */}
                            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowAdvanced(!showAdvanced)
                                    }
                                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <div className="flex items-center space-x-2">
                                        <span className="text-lg">⚙️</span>
                                        <span className="font-medium text-gray-900 dark:text-white">
                                            Configuración Avanzada
                                        </span>
                                    </div>
                                    <svg
                                        className={cn(
                                            "w-5 h-5 transition-transform text-gray-500",
                                            showAdvanced &&
                                                "transform rotate-180",
                                        )}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M19 9l-7 7-7-7"
                                        />
                                    </svg>
                                </button>

                                {showAdvanced && (
                                    <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                        {/* Imagen Docker */}
                                        <div>
                                            <label className="label">
                                                Imagen Docker *
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.image}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        image: e.target.value,
                                                    })
                                                }
                                                placeholder={DEFAULT_IMAGE}
                                                className={getInputClass()}
                                                required
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Por defecto: Colab Runtime
                                                (us-docker.pkg.dev/colab-images/public/runtime:latest)
                                            </p>
                                        </div>

                                        {/* Shared Memory Size */}
                                        <div>
                                            <label className="label">
                                                Tamaño de Memoria Compartida
                                                (--shm-size)
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.shm_size}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        shm_size:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="32g"
                                                className={getInputClass()}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Memoria compartida para el
                                                contenedor (ej: 32g, 16g, 64g)
                                            </p>
                                        </div>

                                        {/* GPUs */}
                                        <div>
                                            <label className="label">
                                                GPUs (--gpus)
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.gpus}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        gpus: e.target.value,
                                                    })
                                                }
                                                placeholder="all"
                                                className={getInputClass()}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Acceso a GPUs (all, device=0,1,
                                                etc.)
                                            </p>
                                        </div>

                                        {/* Privileged Mode */}
                                        <div className="flex items-center space-x-3">
                                            <input
                                                type="checkbox"
                                                id="privileged"
                                                checked={formData.privileged}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        privileged:
                                                            e.target.checked,
                                                    })
                                                }
                                                className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                                disabled={loading}
                                            />
                                            <label
                                                htmlFor="privileged"
                                                className="text-sm font-medium text-gray-900 dark:text-white"
                                            >
                                                Modo Privilegiado (--privileged)
                                            </label>
                                        </div>

                                        {/* Volúmenes */}
                                        <div>
                                            <label className="label">
                                                Volúmenes (-v)
                                            </label>
                                            <textarea
                                                value={formData.volumes}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        volumes: e.target.value,
                                                    })
                                                }
                                                placeholder={getDefaultVolumes()}
                                                className={cn(
                                                    getInputClass(),
                                                    "min-h-[80px]",
                                                )}
                                                disabled={loading}
                                                rows={3}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Volúmenes separados por comas
                                                (ej:
                                                /media:/media:ro,/mnt:/mnt:ro)
                                            </p>
                                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                                💡 Por defecto: /media, /mnt
                                                (read-only) y /home/tu_usuario
                                            </p>
                                        </div>

                                        {/* Puertos */}
                                        <div>
                                            <label className="label">
                                                Puertos Específicos (Opcional)
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.ports}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        ports: e.target.value,
                                                    })
                                                }
                                                placeholder="8080:80"
                                                className={getInputClass()}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Mapeo de puertos (ej: 8080:80).
                                                Por defecto usa -P
                                                (auto-publish)
                                            </p>
                                        </div>

                                        {/* Comando Personalizado */}
                                        <div>
                                            <label className="label">
                                                Comando Personalizado (Opcional)
                                            </label>
                                            <textarea
                                                value={formData.custom_command}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        custom_command:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="bash -c 'echo Hello World'"
                                                className={cn(
                                                    getInputClass(),
                                                    "min-h-[60px] font-mono text-sm",
                                                )}
                                                disabled={loading}
                                                rows={2}
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                Comando adicional a ejecutar al
                                                iniciar el contenedor
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Botones */}
                            <div className="flex justify-end space-x-3 pt-4">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    disabled={loading}
                                    className={getButtonClass("secondary")}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={
                                        loading ||
                                        servers.length === 0 ||
                                        (adminMode && !selectedUserId)
                                    }
                                    className={getButtonClass("primary")}
                                >
                                    {loading ? (
                                        <>
                                            <span className="inline-block animate-spin mr-2">
                                                ⏳
                                            </span>
                                            Creando...
                                        </>
                                    ) : (
                                        <>
                                            <span className="mr-2">🚀</span>
                                            Crear Contenedor
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
