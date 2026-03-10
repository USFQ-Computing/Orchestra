"use client";

import { useEffect, useState } from "react";
import { usersService, User } from "@/lib/services";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { authService } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function UsersPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        username: "",
        email: "",
        password: "",
        is_admin: 0,
    });
    const [editFormData, setEditFormData] = useState({
        username: "",
        email: "",
        password: "",
        is_admin: 0,
    });
    const [creating, setCreating] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState<any>(null);

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
            loadUsers();
        }
    }, [currentUser]);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const data = await usersService.getAll();
            setUsers(data);
            setError("");
        } catch (error: any) {
            console.error("Error loading users:", error);
            setError(
                error.response?.data?.detail || "Error al cargar usuarios",
            );
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);

        try {
            await usersService.create(formData);
            setShowCreateModal(false);
            setFormData({ username: "", email: "", password: "", is_admin: 0 });
            loadUsers();
        } catch (error: any) {
            console.error("Error creating user:", error);
            setError(error.response?.data?.detail || "Error al crear usuario");
        } finally {
            setCreating(false);
        }
    };

    const handleOpenEditModal = (user: User) => {
        setSelectedUser(user);
        setEditFormData({
            username: user.username,
            email: user.email,
            password: "",
            is_admin: user.is_admin,
        });
        setShowEditModal(true);
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;

        setUpdating(true);

        try {
            // Update basic info
            await usersService.update(selectedUser.id, {
                username: editFormData.username,
                email: editFormData.email,
                is_admin: editFormData.is_admin,
            });

            // Update password if provided
            if (editFormData.password) {
                await usersService.changePassword(
                    selectedUser.id,
                    editFormData.password,
                );
            }

            setShowEditModal(false);
            setSelectedUser(null);
            setEditFormData({
                username: "",
                email: "",
                password: "",
                is_admin: 0,
            });
            loadUsers();
        } catch (error: any) {
            console.error("Error updating user:", error);
            setError(
                error.response?.data?.detail || "Error al actualizar usuario",
            );
        } finally {
            setUpdating(false);
        }
    };

    const handleToggleActive = async (user: User) => {
        try {
            let updatedUser;
            if (user.is_active) {
                updatedUser = await usersService.deactivate(user.id);
            } else {
                updatedUser = await usersService.activate(user.id);
            }

            // Update local state without reloading
            setUsers(users.map((u) => (u.id === user.id ? updatedUser : u)));
        } catch (error: any) {
            console.error("Error toggling user active status:", error);
            setError(
                error.response?.data?.detail ||
                    "Error al cambiar estado del usuario",
            );
        }
    };

    const handleToggleAdmin = async (user: User) => {
        try {
            const updatedUser = await usersService.toggleAdmin(user.id);

            // Update local state without reloading
            setUsers(users.map((u) => (u.id === user.id ? updatedUser : u)));
        } catch (error: any) {
            console.error("Error toggling admin status:", error);
            setError(
                error.response?.data?.detail ||
                    "Error al cambiar estado de administrador",
            );
        }
    };

    const handleDeleteUser = async (id: number) => {
        if (!confirm("¿Estás seguro de que quieres eliminar este usuario?")) {
            return;
        }
        try {
            await usersService.delete(id);
            loadUsers();
        } catch (error: any) {
            console.error("Error deleting user:", error);
            setError(
                error.response?.data?.detail || "Error al eliminar usuario",
            );
        }
    };

    const handleExpirePassword = async (user: User) => {
        try {
            const updatedUser = await usersService.expirePassword(user.id);
            setUsers(users.map((u) => (u.id === user.id ? updatedUser : u)));
        } catch (error: any) {
            console.error("Error expiring password:", error);
            setError(
                error.response?.data?.detail || "Error al expirar contraseña",
            );
        }
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) {
            setError("Selecciona un archivo");
            return;
        }

        setUploading(true);
        try {
            const result = await usersService.bulkUpload(bulkFile);
            setBulkResult(result);
            loadUsers();
            setBulkFile(null);
        } catch (error: any) {
            console.error("Error uploading file:", error);
            setError(error.response?.data?.detail || "Error al cargar archivo");
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const ext = file.name.toLowerCase().split(".").pop();
            if (ext === "csv" || ext === "txt") {
                setBulkFile(file);
                setError("");
            } else {
                setError("Solo se permiten archivos .csv o .txt");
                e.target.value = "";
            }
        }
    };

    if (authLoading || loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className="spinner spinner-lg"></div>
                    <p className="mt-4 text-muted">
                        {authLoading
                            ? "Verificando permisos..."
                            : "Cargando usuarios..."}
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
                <div className="page-header flex items-center justify-between">
                    <div>
                        <h1 className="page-title">Gestión de Usuarios</h1>
                        <p className="page-subtitle">
                            Administra los usuarios del sistema
                        </p>
                    </div>
                    <div className="action-buttons">
                        <button
                            onClick={() => setShowBulkUploadModal(true)}
                            className="btn btn-secondary flex items-center space-x-2"
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
                                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                />
                            </svg>
                            <span>Carga Masiva</span>
                        </button>
                        <button
                            onClick={() => setShowCreateModal(true)}
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
                            <span>Nuevo Usuario</span>
                        </button>
                    </div>
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

                {/* Users Table */}
                {users.length === 0 ? (
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
                                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                            />
                        </svg>
                        <h3 className="empty-state-title">No hay usuarios</h3>
                        <p className="empty-state-description">
                            Crea el primer usuario del sistema
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="btn btn-primary"
                        >
                            Crear Usuario
                        </button>
                    </div>
                ) : (
                    <div className="card p-0">
                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead className="table-header">
                                    <tr>
                                        <th className="table-header-cell">
                                            ID
                                        </th>
                                        <th className="table-header-cell">
                                            Username
                                        </th>
                                        <th className="table-header-cell">
                                            Email
                                        </th>
                                        <th className="table-header-cell">
                                            System UID
                                        </th>
                                        <th className="table-header-cell">
                                            Admin
                                        </th>
                                        <th className="table-header-cell">
                                            Estado
                                        </th>
                                        <th className="table-header-cell">
                                            Creado
                                        </th>
                                        <th className="table-header-cell">
                                            Acciones
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="table-body">
                                    {users.map((user) => (
                                        <tr key={user.id} className="table-row">
                                            <td className="table-cell font-medium">
                                                #{user.id}
                                            </td>
                                            <td className="table-cell font-medium">
                                                {user.username}
                                            </td>
                                            <td className="table-cell text-muted">
                                                {user.email}
                                            </td>
                                            <td className="table-cell text-muted code-inline">
                                                {user.system_uid}
                                            </td>
                                            <td className="table-cell">
                                                <button
                                                    onClick={() =>
                                                        handleToggleAdmin(user)
                                                    }
                                                    className={`badge cursor-pointer transition-colors ${
                                                        user.is_admin
                                                            ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50"
                                                            : "badge-neutral hover:bg-gray-200 dark:hover:bg-gray-600"
                                                    }`}
                                                >
                                                    {user.is_admin
                                                        ? "👑 Admin"
                                                        : "Usuario"}
                                                </button>
                                            </td>
                                            <td className="table-cell">
                                                <button
                                                    onClick={() =>
                                                        handleToggleActive(user)
                                                    }
                                                    className={`badge cursor-pointer transition-colors ${
                                                        user.is_active
                                                            ? "badge-success hover:bg-green-200 dark:hover:bg-green-900/50"
                                                            : "badge-error hover:bg-red-200 dark:hover:bg-red-900/50"
                                                    }`}
                                                >
                                                    {user.is_active
                                                        ? "✓ Activo"
                                                        : "✗ Inactivo"}
                                                </button>
                                            </td>
                                            <td className="table-cell text-muted">
                                                {new Date(
                                                    user.created_at,
                                                ).toLocaleDateString()}
                                            </td>
                                            <td className="table-cell">
                                                <div className="flex items-center space-x-3">
                                                    <button
                                                        onClick={() =>
                                                            handleOpenEditModal(
                                                                user,
                                                            )
                                                        }
                                                        className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium"
                                                    >
                                                        Editar
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleExpirePassword(user)
                                                        }
                                                        disabled={user.must_change_password}
                                                        title={user.must_change_password ? "Ya tiene cambio de contraseña pendiente" : "Forzar cambio de contraseña en próximo login"}
                                                        className={`font-medium ${
                                                            user.must_change_password
                                                                ? "text-amber-400 dark:text-amber-500 cursor-default"
                                                                : "text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
                                                        }`}
                                                    >
                                                        {user.must_change_password ? "Pwd Expirada" : "Expirar Pwd"}
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleDeleteUser(
                                                                user.id,
                                                            )
                                                        }
                                                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
                                                    >
                                                        Eliminar
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

                {/* Edit User Modal */}
                {showEditModal && selectedUser && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h2 className="modal-title">Editar Usuario</h2>
                                <button
                                    onClick={() => {
                                        setShowEditModal(false);
                                        setSelectedUser(null);
                                    }}
                                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    <svg
                                        className="w-6 h-6"
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

                            <form
                                onSubmit={handleUpdateUser}
                                className="modal-body"
                            >
                                <div className="form-group">
                                    <label className="label">Username</label>
                                    <input
                                        type="text"
                                        value={editFormData.username}
                                        onChange={(e) =>
                                            setEditFormData({
                                                ...editFormData,
                                                username: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="username"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Email</label>
                                    <input
                                        type="email"
                                        value={editFormData.email}
                                        onChange={(e) =>
                                            setEditFormData({
                                                ...editFormData,
                                                email: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">
                                        Nueva Contraseña (opcional)
                                    </label>
                                    <input
                                        type="password"
                                        value={editFormData.password}
                                        onChange={(e) =>
                                            setEditFormData({
                                                ...editFormData,
                                                password: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="Dejar vacío para no cambiar"
                                    />
                                    <p className="form-help">
                                        Deja este campo vacío si no deseas
                                        cambiar la contraseña
                                    </p>
                                </div>

                                <div className="form-group">
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            id="edit_is_admin"
                                            checked={!!editFormData.is_admin}
                                            onChange={(e) =>
                                                setEditFormData({
                                                    ...editFormData,
                                                    is_admin: e.target.checked
                                                        ? 1
                                                        : 0,
                                                })
                                            }
                                            className="checkbox"
                                        />
                                        <label
                                            htmlFor="edit_is_admin"
                                            className="label ml-2 mb-0"
                                        >
                                            Es Administrador
                                        </label>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowEditModal(false);
                                            setSelectedUser(null);
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
                                        {updating
                                            ? "Actualizando..."
                                            : "Guardar Cambios"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Create User Modal */}
                {showCreateModal && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h2 className="modal-title">
                                    Crear Nuevo Usuario
                                </h2>
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    <svg
                                        className="w-6 h-6"
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

                            <form
                                onSubmit={handleCreateUser}
                                className="modal-body"
                            >
                                <div className="form-group">
                                    <label className="label">Username</label>
                                    <input
                                        type="text"
                                        value={formData.username}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                username: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="username"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Email</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                email: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Contraseña</label>
                                    <input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                password: e.target.value,
                                            })
                                        }
                                        className="input"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            id="is_admin"
                                            checked={!!formData.is_admin}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    is_admin: e.target.checked
                                                        ? 1
                                                        : 0,
                                                })
                                            }
                                            className="checkbox"
                                        />
                                        <label
                                            htmlFor="is_admin"
                                            className="label ml-2 mb-0"
                                        >
                                            Es Administrador
                                        </label>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowCreateModal(false)
                                        }
                                        className="btn btn-secondary"
                                        disabled={creating}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={creating}
                                    >
                                        {creating
                                            ? "Creando..."
                                            : "Crear Usuario"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Bulk Upload Modal */}
                {showBulkUploadModal && (
                    <div className="modal-overlay">
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <div className="modal-header">
                                    <h2 className="modal-title">
                                        Carga Masiva de Usuarios
                                    </h2>
                                    <button
                                        onClick={() => {
                                            setShowBulkUploadModal(false);
                                            setBulkResult(null);
                                            setBulkFile(null);
                                        }}
                                        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                    >
                                        <svg
                                            className="w-6 h-6"
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

                                {!bulkResult ? (
                                    <div className="space-y-4">
                                        <div className="alert alert-info">
                                            <div className="w-full">
                                                <h3 className="font-semibold mb-2">
                                                    📋 Formatos Soportados:
                                                </h3>
                                                <div className="text-sm space-y-2">
                                                    <div>
                                                        <strong>CSV:</strong>{" "}
                                                        Archivo con una columna{" "}
                                                        <code className="bg-blue-200 dark:bg-blue-900/50 px-1 rounded">
                                                            username
                                                        </code>
                                                        <pre className="mt-1 bg-blue-200 dark:bg-blue-900/50 p-2 rounded text-xs">
                                                            username{"\n"}
                                                            juan{"\n"}
                                                            maria
                                                        </pre>
                                                    </div>
                                                    <div>
                                                        <strong>TXT:</strong> Un
                                                        username por línea
                                                        <pre className="mt-1 bg-blue-200 dark:bg-blue-900/50 p-2 rounded text-xs">
                                                            juan{"\n"}
                                                            maria{"\n"}
                                                            pedro
                                                        </pre>
                                                    </div>
                                                    <p className="mt-2 text-xs">
                                                        📧 El email se genera
                                                        automáticamente:{" "}
                                                        <code className="bg-blue-200 dark:bg-blue-900/50 px-1 rounded">
                                                            {"{username}"}
                                                            @estud.usfq.edu.ec
                                                        </code>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="alert alert-warning">
                                            <div className="w-full">
                                                <h3 className="font-semibold mb-2">
                                                    🔐 Contraseña por Defecto:
                                                </h3>
                                                <p className="text-sm">
                                                    <code className="bg-yellow-200 dark:bg-yellow-900/50 px-2 py-1 rounded">
                                                        {"{username}"}
                                                        {new Date().getFullYear()}
                                                    </code>
                                                </p>
                                                <p className="text-xs mt-1">
                                                    Ejemplo: Para el usuario
                                                    "juan" →{" "}
                                                    <code className="bg-yellow-200 dark:bg-yellow-900/50 px-1 rounded">
                                                        juan
                                                        {new Date().getFullYear()}
                                                    </code>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label className="label">
                                                Seleccionar Archivo (.csv o
                                                .txt)
                                            </label>
                                            <input
                                                type="file"
                                                accept=".csv,.txt"
                                                onChange={handleFileChange}
                                                className="input"
                                            />
                                            {bulkFile && (
                                                <p className="form-help text-green-600 dark:text-green-400">
                                                    ✓ Archivo seleccionado:{" "}
                                                    {bulkFile.name}
                                                </p>
                                            )}
                                        </div>

                                        <div className="modal-footer">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowBulkUploadModal(
                                                        false,
                                                    );
                                                    setBulkFile(null);
                                                }}
                                                className="btn btn-secondary"
                                                disabled={uploading}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleBulkUpload}
                                                className="btn btn-primary"
                                                disabled={
                                                    !bulkFile || uploading
                                                }
                                            >
                                                {uploading
                                                    ? "Cargando..."
                                                    : "Cargar Usuarios"}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="alert alert-success">
                                            <div className="w-full">
                                                <h3 className="font-semibold mb-2">
                                                    ✓ Carga Completada
                                                </h3>
                                                <p className="text-sm">
                                                    Se crearon{" "}
                                                    <strong>
                                                        {bulkResult.created}
                                                    </strong>{" "}
                                                    usuarios correctamente
                                                </p>
                                                {bulkResult.failed > 0 && (
                                                    <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
                                                        Fallaron{" "}
                                                        <strong>
                                                            {bulkResult.failed}
                                                        </strong>{" "}
                                                        usuarios
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {bulkResult.users_created.length >
                                            0 && (
                                            <div>
                                                <h4 className="section-header text-base">
                                                    Usuarios Creados:
                                                </h4>
                                                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto scrollbar-thin">
                                                    <ul className="text-sm space-y-1">
                                                        {bulkResult.users_created.map(
                                                            (user: any) => (
                                                                <li
                                                                    key={
                                                                        user.id
                                                                    }
                                                                    className="text-gray-700 dark:text-gray-300"
                                                                >
                                                                    ✓{" "}
                                                                    {
                                                                        user.username
                                                                    }{" "}
                                                                    (
                                                                    {user.email}
                                                                    )
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}

                                        {bulkResult.users_failed.length > 0 && (
                                            <div>
                                                <h4 className="section-header text-base text-red-900 dark:text-red-300">
                                                    Usuarios con Errores:
                                                </h4>
                                                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 max-h-48 overflow-y-auto scrollbar-thin">
                                                    <ul className="text-sm space-y-1">
                                                        {bulkResult.users_failed.map(
                                                            (
                                                                user: any,
                                                                idx: number,
                                                            ) => (
                                                                <li
                                                                    key={idx}
                                                                    className="text-red-700 dark:text-red-400"
                                                                >
                                                                    ✗{" "}
                                                                    {
                                                                        user.username
                                                                    }
                                                                    :{" "}
                                                                    {typeof user.reason ===
                                                                    "string"
                                                                        ? user.reason
                                                                        : JSON.stringify(
                                                                              user.reason,
                                                                          )}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => {
                                                setShowBulkUploadModal(false);
                                                setBulkResult(null);
                                                setBulkFile(null);
                                            }}
                                            className="w-full btn btn-primary"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
