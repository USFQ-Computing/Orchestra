"use client";

import { useEffect, useState } from "react";
import {
    labelsService,
    Label,
    LabelCreate,
    LabelUpdate,
    ContainerRuntimePolicy,
} from "@/lib/services";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { authService } from "@/lib/api";
import { useRouter } from "next/navigation";

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

const slugify = (value: string) =>
    value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

export default function LabelsPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [labels, setLabels] = useState<Label[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedLabel, setSelectedLabel] = useState<Label | null>(null);
    const [creating, setCreating] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [formData, setFormData] = useState<LabelCreate>({
        name: "",
        slug: "",
        color: "#6B7280",
        active: true,
        container_runtime_overrides: {},
    });
    const [editFormData, setEditFormData] = useState<LabelUpdate>({
        name: "",
        slug: "",
        color: "#6B7280",
        active: true,
        container_runtime_overrides: {},
    });
    const [createRuntimeForm, setCreateRuntimeForm] = useState(
        normalizeRuntimePolicyForm(null),
    );
    const [editRuntimeForm, setEditRuntimeForm] = useState(
        normalizeRuntimePolicyForm(null),
    );
    const [createSlugManuallyEdited, setCreateSlugManuallyEdited] =
        useState(false);
    const [editSlugManuallyEdited, setEditSlugManuallyEdited] =
        useState(false);

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
            loadLabels();
        }
    }, [currentUser]);

    const loadLabels = async () => {
        try {
            setLoading(true);
            const data = await labelsService.getAll();
            setLabels(data);
            setError("");
        } catch (error: any) {
            console.error("Error loading labels:", error);
            setError(error.response?.data?.detail || "Error al cargar etiquetas");
        } finally {
            setLoading(false);
        }
    };

    const handleCreateLabel = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);

        try {
            const payload: LabelCreate = {
                ...formData,
                container_runtime_overrides:
                    buildRuntimePolicyPayload(createRuntimeForm),
            };
            await labelsService.create(payload);
            setShowCreateModal(false);
            setFormData({
                name: "",
                slug: "",
                color: "#6B7280",
                active: true,
                container_runtime_overrides: {},
            });
            setCreateRuntimeForm(normalizeRuntimePolicyForm(null));
            setCreateSlugManuallyEdited(false);
            loadLabels();
        } catch (error: any) {
            console.error("Error creating label:", error);
            setError(error.response?.data?.detail || "Error al crear etiqueta");
        } finally {
            setCreating(false);
        }
    };

    const handleOpenEditModal = (label: Label) => {
        setSelectedLabel(label);
        setEditSlugManuallyEdited(false);
        setEditFormData({
            name: label.name,
            slug: label.slug,
            color: label.color,
            active: label.active,
            container_runtime_overrides: label.container_runtime_overrides || {},
        });
        setEditRuntimeForm(
            normalizeRuntimePolicyForm(label.container_runtime_overrides),
        );
        setShowEditModal(true);
    };

    const handleUpdateLabel = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedLabel) return;

        setUpdating(true);

        try {
            const payload: LabelUpdate = {
                ...editFormData,
                container_runtime_overrides:
                    buildRuntimePolicyPayload(editRuntimeForm),
            };
            await labelsService.update(selectedLabel.id, payload);
            setShowEditModal(false);
            setSelectedLabel(null);
            loadLabels();
        } catch (error: any) {
            console.error("Error updating label:", error);
            setError(error.response?.data?.detail || "Error al actualizar etiqueta");
        } finally {
            setUpdating(false);
        }
    };

    const handleDeleteLabel = async (id: number) => {
        if (!confirm("¿Estás seguro de que quieres eliminar esta etiqueta?")) {
            return;
        }
        try {
            await labelsService.delete(id);
            loadLabels();
        } catch (error: any) {
            console.error("Error deleting label:", error);
            setError(error.response?.data?.detail || "Error al eliminar etiqueta");
        }
    };

    if (authLoading || loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className="spinner spinner-lg"></div>
                    <p className="mt-4 text-muted">
                        {authLoading ? "Verificando permisos..." : "Cargando etiquetas..."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ProtectedRoute user={currentUser} requireAdmin={true} loading={authLoading}>
            <div>
                {/* Header */}
                <div className="page-header flex items-center justify-between">
                    <div>
                        <h1 className="page-title">Gestión de Etiquetas</h1>
                        <p className="page-subtitle">
                            Administra las etiquetas de usuario para categorización y agrupación
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setCreateSlugManuallyEdited(false);
                            setShowCreateModal(true);
                        }}
                        className="btn btn-primary flex items-center space-x-2"
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
                                d="M12 4v16m8-8H4"
                            />
                        </svg>
                        <span>Nueva Etiqueta</span>
                    </button>
                </div>

                {/* Error message */}
                {error && (
                    <div className="alert alert-error mb-6">
                        <span>{error}</span>
                        <button onClick={() => setError("")}>
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

                {/* Labels Grid */}
                {labels.length === 0 ? (
                    <div className="empty-state">
                        <svg
                            className="empty-state-icon text-gray-400 dark:text-gray-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                            />
                        </svg>
                        <h3 className="empty-state-title">No hay etiquetas</h3>
                        <p className="empty-state-description">
                            Crea la primera etiqueta del sistema
                        </p>
                        <button
                            onClick={() => {
                                setCreateSlugManuallyEdited(false);
                                setShowCreateModal(true);
                            }}
                            className="btn btn-primary"
                        >
                            Crear Etiqueta
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {labels.map((label) => (
                            <div
                                key={label.id}
                                className="card p-6 flex flex-col justify-between"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3 flex-1">
                                        <div
                                            className="w-4 h-4 rounded-full flex-shrink-0"
                                            style={{
                                                backgroundColor: label.color || "#6B7280",
                                            }}
                                        ></div>
                                        <div>
                                            <h3 className="font-semibold text-lg">
                                                {label.name}
                                            </h3>
                                            <p className="text-sm text-muted">
                                                {label.slug}
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className={`badge text-xs ${
                                            label.active
                                                ? "badge-success"
                                                : "badge-neutral"
                                        }`}
                                    >
                                        {label.active ? "Activa" : "Inactiva"}
                                    </span>
                                </div>

                                <div className="text-xs text-muted mb-4">
                                    Creada:{" "}
                                    {new Date(
                                        label.created_at,
                                    ).toLocaleDateString()}
                                </div>

                                <div className="text-xs text-muted mb-4 space-y-1">
                                    <div>
                                        Runtime override:
                                        {label.container_runtime_overrides &&
                                        Object.keys(
                                            label.container_runtime_overrides,
                                        ).length > 0
                                            ? " configurado"
                                            : " no configurado"}
                                    </div>
                                    {label.container_runtime_overrides?.memory && (
                                        <div>
                                            memory: {label.container_runtime_overrides.memory}
                                        </div>
                                    )}
                                    {label.container_runtime_overrides?.gpus && (
                                        <div>
                                            gpus: {label.container_runtime_overrides.gpus}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() =>
                                            handleOpenEditModal(label)
                                        }
                                        className="flex-1 text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium text-sm"
                                    >
                                        Editar
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleDeleteLabel(label.id)
                                        }
                                        className="flex-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium text-sm"
                                    >
                                        Eliminar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Create Modal */}
                {showCreateModal && (
                    <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                        <div
                            className="modal-content"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h2 className="modal-title">Nueva Etiqueta</h2>
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="modal-close-btn"
                                    disabled={creating}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleCreateLabel}>
                                <div className="modal-body space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Nombre *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => {
                                                const name = e.target.value;
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    name,
                                                    slug: createSlugManuallyEdited
                                                        ? prev.slug || ""
                                                        : slugify(name),
                                                }));
                                            }}
                                            required
                                            disabled={creating}
                                            className="input w-full"
                                            placeholder="Ej: Investigación"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Slug *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.slug}
                                            onChange={(e) => {
                                                setCreateSlugManuallyEdited(true);
                                                setFormData({
                                                    ...formData,
                                                    slug: slugify(e.target.value),
                                                });
                                            }}
                                            required
                                            disabled={creating}
                                            className="input w-full"
                                            placeholder="Ej: investigacion"
                                        />
                                        <p className="text-xs text-muted mt-1">
                                            Identificador único, amigable para URLs
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Color
                                        </label>
                                        <input
                                            type="color"
                                            value={formData.color || "#6B7280"}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    color: e.target.value,
                                                })
                                            }
                                            disabled={creating}
                                            className="input w-full h-10"
                                        />
                                    </div>

                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.active}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    active: e.target.checked,
                                                })
                                            }
                                            disabled={creating}
                                        />
                                        <span className="text-sm">Etiqueta activa</span>
                                    </label>

                                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                                        <p className="text-sm font-semibold mb-3">
                                            Runtime Overrides del Label
                                        </p>
                                        <p className="text-xs text-muted mb-3">
                                            Se aplican al crear contenedores del usuario, pero el servidor tiene prioridad final.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <input
                                                className="input"
                                                placeholder="GPUs (all o 4)"
                                                value={createRuntimeForm.gpus}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        gpus: e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="Memoria (128g)"
                                                value={createRuntimeForm.memory}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        memory: e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="SHM Size (16g)"
                                                value={createRuntimeForm.shm_size}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        shm_size: e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                className="input"
                                                placeholder="CPUs (8)"
                                                value={createRuntimeForm.cpus}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        cpus: e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="PID mode (host)"
                                                value={createRuntimeForm.pid_mode}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        pid_mode: e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="Command override"
                                                value={createRuntimeForm.command_override}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        command_override:
                                                            e.target.value,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                        </div>
                                        <label className="flex items-center gap-2 mt-3">
                                            <input
                                                type="checkbox"
                                                checked={createRuntimeForm.privileged}
                                                onChange={(e) =>
                                                    setCreateRuntimeForm({
                                                        ...createRuntimeForm,
                                                        privileged:
                                                            e.target.checked,
                                                    })
                                                }
                                                disabled={creating}
                                            />
                                            <span className="text-sm">Privileged</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreateModal(false);
                                            setCreateSlugManuallyEdited(false);
                                        }}
                                        className="btn btn-secondary"
                                        disabled={creating}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={creating || !formData.name || !formData.slug}
                                    >
                                        {creating ? (
                                            <>
                                                <span className="spinner spinner-sm mr-2"></span>
                                                Creando...
                                            </>
                                        ) : (
                                            "Crear"
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Edit Modal */}
                {showEditModal && selectedLabel && (
                    <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                        <div
                            className="modal-content"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h2 className="modal-title">
                                    Editar Etiqueta: {selectedLabel.name}
                                </h2>
                                <button
                                    onClick={() => setShowEditModal(false)}
                                    className="modal-close-btn"
                                    disabled={updating}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleUpdateLabel}>
                                <div className="modal-body space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Nombre
                                        </label>
                                        <input
                                            type="text"
                                            value={editFormData.name || ""}
                                            onChange={(e) => {
                                                const name = e.target.value;
                                                setEditFormData((prev) => ({
                                                    ...prev,
                                                    name,
                                                    slug: editSlugManuallyEdited
                                                        ? prev.slug
                                                        : slugify(name),
                                                }));
                                            }}
                                            disabled={updating}
                                            className="input w-full"
                                            placeholder="Ingresa el nombre"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Slug
                                        </label>
                                        <input
                                            type="text"
                                            value={editFormData.slug || ""}
                                            onChange={(e) => {
                                                setEditSlugManuallyEdited(true);
                                                setEditFormData({
                                                    ...editFormData,
                                                    slug: slugify(e.target.value),
                                                });
                                            }}
                                            disabled={updating}
                                            className="input w-full"
                                            placeholder="Ingresa el slug"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Color
                                        </label>
                                        <input
                                            type="color"
                                            value={
                                                editFormData.color || "#6B7280"
                                            }
                                            onChange={(e) =>
                                                setEditFormData({
                                                    ...editFormData,
                                                    color: e.target.value,
                                                })
                                            }
                                            disabled={updating}
                                            className="input w-full h-10"
                                        />
                                    </div>

                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editFormData.active || false}
                                            onChange={(e) =>
                                                setEditFormData({
                                                    ...editFormData,
                                                    active: e.target.checked,
                                                })
                                            }
                                            disabled={updating}
                                        />
                                        <span className="text-sm">
                                            Etiqueta activa
                                        </span>
                                    </label>

                                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                                        <p className="text-sm font-semibold mb-3">
                                            Runtime Overrides del Label
                                        </p>
                                        <p className="text-xs text-muted mb-3">
                                            Se aplican al crear contenedores del usuario, pero el servidor tiene prioridad final.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <input
                                                className="input"
                                                placeholder="GPUs (all o 4)"
                                                value={editRuntimeForm.gpus}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        gpus: e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="Memoria (128g)"
                                                value={editRuntimeForm.memory}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        memory: e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="SHM Size (16g)"
                                                value={editRuntimeForm.shm_size}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        shm_size: e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                className="input"
                                                placeholder="CPUs (8)"
                                                value={editRuntimeForm.cpus}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        cpus: e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="PID mode (host)"
                                                value={editRuntimeForm.pid_mode}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        pid_mode: e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <input
                                                className="input"
                                                placeholder="Command override"
                                                value={editRuntimeForm.command_override}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        command_override:
                                                            e.target.value,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                        </div>
                                        <label className="flex items-center gap-2 mt-3">
                                            <input
                                                type="checkbox"
                                                checked={editRuntimeForm.privileged}
                                                onChange={(e) =>
                                                    setEditRuntimeForm({
                                                        ...editRuntimeForm,
                                                        privileged:
                                                            e.target.checked,
                                                    })
                                                }
                                                disabled={updating}
                                            />
                                            <span className="text-sm">Privileged</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowEditModal(false);
                                            setEditSlugManuallyEdited(false);
                                        }}
                                        className="btn btn-secondary"
                                        disabled={updating}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={updating}
                                    >
                                        {updating ? (
                                            <>
                                                <span className="spinner spinner-sm mr-2"></span>
                                                Actualizando...
                                            </>
                                        ) : (
                                            "Guardar"
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
