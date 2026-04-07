"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BulkUserOperation,
    BulkUsersRequest,
    BulkUsersResult,
    Label,
    labelsService,
    usersService,
    User,
} from "@/lib/services";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import UserLabelsModal from "@/app/components/UserLabelsModal";
import UserLabelsBadges from "@/app/components/UserLabelsBadges";
import { authService } from "@/lib/api";
import { useRouter } from "next/navigation";

const getContrastTextColor = (backgroundColor: string | null) => {
    if (!backgroundColor || !backgroundColor.startsWith("#")) {
        return "#ffffff";
    }

    const hex = backgroundColor.slice(1);
    const normalizedHex =
        hex.length === 3
            ? hex
                  .split("")
                  .map((char) => char + char)
                  .join("")
            : hex;

    if (normalizedHex.length !== 6) {
        return "#ffffff";
    }

    const r = parseInt(normalizedHex.slice(0, 2), 16);
    const g = parseInt(normalizedHex.slice(2, 4), 16);
    const b = parseInt(normalizedHex.slice(4, 6), 16);

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#111827" : "#ffffff";
};

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
    const [showLabelsModal, setShowLabelsModal] = useState(false);
    const [selectedUserForLabels, setSelectedUserForLabels] =
        useState<User | null>(null);
    const [labelsRefreshKey, setLabelsRefreshKey] = useState(0);
    const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
    const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
    const [bulkAction, setBulkAction] = useState<BulkUserOperation>("set_active");
    const [bulkToggleValue, setBulkToggleValue] = useState<0 | 1>(1);
    const [bulkLabelIds, setBulkLabelIds] = useState<number[]>([]);
    const [bulkApplying, setBulkApplying] = useState(false);
    const [showBulkPreviewModal, setShowBulkPreviewModal] = useState(false);
    const [bulkPreview, setBulkPreview] = useState<BulkUsersResult | null>(null);
    const [pendingBulkPayload, setPendingBulkPayload] = useState<BulkUsersRequest | null>(null);
    const [bulkOpResult, setBulkOpResult] = useState<BulkUsersResult | null>(null);
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
    const [adminFilter, setAdminFilter] = useState<"all" | "admin" | "non_admin">("all");
    const [labelFilterId, setLabelFilterId] = useState<number | "all">("all");
    const [labelFilteredUserIds, setLabelFilteredUserIds] = useState<Set<number> | null>(null);
    const [loadingLabelFilter, setLoadingLabelFilter] = useState(false);
    const [userLabelsCache, setUserLabelsCache] = useState<Record<number, Label[]>>({});
    const labelFilterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [pendingLabelFilterId, setPendingLabelFilterId] = useState<number | "all">("all");

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
            loadLabels();
        }
    }, [currentUser]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                filterDropdownRef.current &&
                !filterDropdownRef.current.contains(event.target as Node)
            ) {
                setShowFilterDropdown(false);
            }
        };

        if (showFilterDropdown) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => {
                document.removeEventListener("mousedown", handleClickOutside);
            };
        }
    }, [showFilterDropdown]);

    useEffect(() => {
        // Debounce label filter selection to avoid rapid API calls
        if (labelFilterTimeoutRef.current) {
            clearTimeout(labelFilterTimeoutRef.current);
        }

        labelFilterTimeoutRef.current = setTimeout(async () => {
            if (pendingLabelFilterId === "all") {
                setLabelFilteredUserIds(null);
                setLabelFilterId("all");
                return;
            }

            setLoadingLabelFilter(true);
            try {
                const usersForLabel = await labelsService.getLabelUsers(
                    pendingLabelFilterId as number,
                );
                setLabelFilteredUserIds(new Set(usersForLabel.map((user) => user.id)));
                setLabelFilterId(pendingLabelFilterId);
                setError("");
            } catch (error: any) {
                console.error("Error loading users for label filter:", error);
                setLabelFilteredUserIds(null);
                setError(
                    error.response?.data?.detail ||
                        "Error al cargar usuarios para la etiqueta seleccionada",
                );
            } finally {
                setLoadingLabelFilter(false);
            }
        }, 300); // 300ms debounce

        return () => {
            if (labelFilterTimeoutRef.current) {
                clearTimeout(labelFilterTimeoutRef.current);
            }
        };
    }, [pendingLabelFilterId]);

    const getCachedUserLabels = useCallback(
        (userId: number) => {
            return userLabelsCache[userId];
        },
        [userLabelsCache],
    );

    const cacheUserLabels = useCallback(
        (userId: number, labels: Label[]) => {
            setUserLabelsCache((prev) => ({
                ...prev,
                [userId]: labels,
            }));
        },
        [],
    );

    const filteredUsers = useMemo(() => {
        return users.filter((user) => {
            const matchesActive =
                activeFilter === "all" ||
                (activeFilter === "active" && user.is_active === 1) ||
                (activeFilter === "inactive" && user.is_active === 0);

            const matchesAdmin =
                adminFilter === "all" ||
                (adminFilter === "admin" && user.is_admin === 1) ||
                (adminFilter === "non_admin" && user.is_admin === 0);

            const matchesLabel =
                labelFilterId === "all" ||
                                (loadingLabelFilter
                                        ? true
                                        : labelFilteredUserIds
                                            ? labelFilteredUserIds.has(user.id)
                                            : false);

            return matchesActive && matchesAdmin && matchesLabel;
        });
    }, [users, activeFilter, adminFilter, labelFilterId, labelFilteredUserIds, loadingLabelFilter]);

    useEffect(() => {
        // Keep selection valid when filtered results change
        setSelectedUserIds((prev) => {
            const validIds = new Set(filteredUsers.map((u) => u.id));
            const updated = prev.filter((id) => validIds.has(id));
            return updated.length === prev.length ? prev : updated;
        });
    }, [filteredUsers]);

    const activeFilterCount =
        (activeFilter !== "all" ? 1 : 0) +
        (adminFilter !== "all" ? 1 : 0) +
        (labelFilterId !== "all" ? 1 : 0);

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

    const loadLabels = async () => {
        try {
            const labels = await labelsService.getAll(true);
            setAvailableLabels(labels);
        } catch (error) {
            console.error("Error loading labels:", error);
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
        setShowLabelsModal(false);
        setSelectedUserForLabels(null);
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
            setShowLabelsModal(false);
            setSelectedUser(null);
            setSelectedUserForLabels(null);
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

    const isAllSelected = useMemo(
        () =>
            filteredUsers.length > 0 &&
            filteredUsers.every((user) => selectedUserIds.includes(user.id)),
        [filteredUsers, selectedUserIds],
    );
    const hasSelectedUsers = selectedUserIds.length > 0;

    const toggleSelectAll = useCallback(() => {
        setSelectedUserIds((prev) =>
            prev.length === filteredUsers.length
                ? []
                : filteredUsers.map((u) => u.id),
        );
    }, [filteredUsers]);

    const toggleUserSelection = useCallback((userId: number) => {
        setSelectedUserIds((prev) =>
            prev.includes(userId)
                ? prev.filter((id) => id !== userId)
                : [...prev, userId],
        );
    }, []);

    const clearBulkSelection = () => {
        setSelectedUserIds([]);
        setBulkLabelIds([]);
        setBulkPreview(null);
        setPendingBulkPayload(null);
    };

    const clearFilters = useCallback(() => {
        setActiveFilter("all");
        setAdminFilter("all");
        setLabelFilterId("all");
        setShowFilterDropdown(false);
    }, []);

    const getActiveFilterLabel = (filter: string) => {
        const labels: Record<string, string> = {
            active: "✓ Activos",
            inactive: "✗ Inactivos",
            admin: "👑 Admins",
            non_admin: "👤 Usuarios",
        };
        return labels[filter];
    };

    const selectedLabelName = useMemo(
        () =>
            labelFilterId !== "all"
                ? availableLabels.find((l) => l.id === labelFilterId)?.name
                : null,
        [labelFilterId, availableLabels],
    );

    const toggleBulkLabelSelection = (labelId: number) => {
        setBulkLabelIds((prev) =>
            prev.includes(labelId)
                ? prev.filter((id) => id !== labelId)
                : [...prev, labelId],
        );
    };

    const getBulkPayloadData = () => {
        if (bulkAction === "set_active") {
            return { is_active: bulkToggleValue };
        }
        if (bulkAction === "set_admin") {
            return { is_admin: bulkToggleValue };
        }
        if (
            bulkAction === "add_labels" ||
            bulkAction === "remove_labels" ||
            bulkAction === "replace_labels"
        ) {
            return { label_ids: bulkLabelIds };
        }
        return {};
    };

    const handleApplyBulk = async () => {
        if (selectedUserIds.length === 0) {
            setError("Selecciona al menos un usuario");
            return;
        }

        if (
            (bulkAction === "add_labels" ||
                bulkAction === "remove_labels" ||
                bulkAction === "replace_labels") &&
            bulkLabelIds.length === 0
        ) {
            setError("Selecciona al menos una etiqueta para esa operación");
            return;
        }

        const payload: BulkUsersRequest = {
            user_ids: selectedUserIds,
            operation: bulkAction,
            data: getBulkPayloadData(),
        };

        setBulkApplying(true);
        try {
            const preview = await usersService.bulkPreview(payload);
            setBulkPreview(preview);
            setPendingBulkPayload(payload);
            setShowBulkPreviewModal(true);
            setError("");
        } catch (error: any) {
            console.error("Error applying bulk operation:", error);
            setError(
                error.response?.data?.detail ||
                    "Error al aplicar la operación masiva",
            );
        } finally {
            setBulkApplying(false);
        }
    };

    const handleConfirmBulkApply = async () => {
        if (!pendingBulkPayload) return;

        setBulkApplying(true);
        try {
            const result = await usersService.bulkApply(pendingBulkPayload);
            await loadUsers();
            setLabelsRefreshKey((prev) => prev + 1);
            setBulkOpResult(result);
            setShowBulkPreviewModal(false);
            clearBulkSelection();
            setError("");
        } catch (error: any) {
            console.error("Error confirming bulk operation:", error);
            setError(
                error.response?.data?.detail ||
                    "Error al confirmar la operación masiva",
            );
        } finally {
            setBulkApplying(false);
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
                        <div className="relative" ref={filterDropdownRef}>
                            <button
                                type="button"
                                onClick={() =>
                                    setShowFilterDropdown((prev) => !prev)
                                }
                                className={`btn flex items-center space-x-2 transition-all ${
                                    showFilterDropdown || activeFilterCount > 0
                                        ? "btn-primary"
                                        : "btn-secondary"
                                }`}
                            >
                                <svg
                                    className={`icon-md transition-transform ${
                                        showFilterDropdown ? "rotate-180" : ""
                                    }`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M3 4a1 1 0 011-1h16a1 1 0 01.8 1.6L14 13.5V19a1 1 0 01-1.447.894l-2-1A1 1 0 0110 18v-4.5L3.2 4.6A1 1 0 013 4z"
                                    />
                                </svg>
                                <span>Filtros</span>
                                {activeFilterCount > 0 && (
                                    <span className="badge badge-success text-xs font-semibold">
                                        {activeFilterCount}
                                    </span>
                                )}
                            </button>

                            {showFilterDropdown && (
                                <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-30 p-5 space-y-4 animate-in fade-in duration-200">
                                    <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
                                        <h3 className="font-semibold text-sm">Filtrar usuarios</h3>
                                        {activeFilterCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={clearFilters}
                                                className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
                                            >
                                                ✕ Limpiar todo
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="label mb-0">Estado</label>
                                                {activeFilter !== "all" && (
                                                    <span className="badge badge-success text-xs">
                                                        {getActiveFilterLabel(activeFilter)}
                                                    </span>
                                                )}
                                            </div>
                                            <select
                                                value={activeFilter}
                                                onChange={(e) =>
                                                    setActiveFilter(
                                                        e.target
                                                            .value as "all" | "active" | "inactive",
                                                    )
                                                }
                                                className="input text-sm"
                                            >
                                                <option value="all">Todos los estados</option>
                                                <option value="active">✓ Activos</option>
                                                <option value="inactive">✗ Inactivos</option>
                                            </select>
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="label mb-0">Rol</label>
                                                {adminFilter !== "all" && (
                                                    <span className="badge badge-success text-xs">
                                                        {getActiveFilterLabel(adminFilter)}
                                                    </span>
                                                )}
                                            </div>
                                            <select
                                                value={adminFilter}
                                                onChange={(e) =>
                                                    setAdminFilter(
                                                        e.target
                                                            .value as "all" | "admin" | "non_admin",
                                                    )
                                                }
                                                className="input text-sm"
                                            >
                                                <option value="all">Todos los roles</option>
                                                <option value="admin">👑 Solo administradores</option>
                                                <option value="non_admin">👤 Solo usuarios</option>
                                            </select>
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="label mb-0">Etiqueta</label>
                                                {labelFilterId !== "all" && selectedLabelName && (
                                                    <span
                                                        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                availableLabels.find(
                                                                    (l) => l.id === labelFilterId,
                                                                )?.color || "#6B7280",
                                                            color: getContrastTextColor(
                                                                availableLabels.find(
                                                                    (l) => l.id === labelFilterId,
                                                                )?.color || null,
                                                            ),
                                                        }}
                                                    >
                                                        {selectedLabelName}
                                                    </span>
                                                )}
                                            </div>
                                            <select
                                                value={pendingLabelFilterId}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setPendingLabelFilterId(
                                                        value === "all"
                                                            ? "all"
                                                            : Number(value),
                                                    );
                                                }}
                                                className="input text-sm"
                                            >
                                                <option value="all">Todas las etiquetas</option>
                                                {availableLabels.map((label) => (
                                                    <option key={label.id} value={label.id}>
                                                        {label.name}
                                                    </option>
                                                ))}
                                            </select>
                                            {loadingLabelFilter && (
                                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 animate-pulse">
                                                    ⏳ Cargando usuarios para la etiqueta...
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                                        <p className="text-xs text-gray-600 dark:text-gray-400">
                                            Mostrando <strong>{filteredUsers.length}</strong> de <strong>{users.length}</strong> usuarios
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

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

                {/* Bulk operation result */}
                {bulkOpResult && (
                    <div className="alert alert-success mb-6">
                        <div className="w-full">
                            <p className="font-semibold">Operación masiva completada</p>
                            <p className="text-sm mt-1">
                                Solicitados: {bulkOpResult.requested} | Actualizados: {bulkOpResult.updated || 0} | Fallidos: {bulkOpResult.failed || 0}
                            </p>
                        </div>
                        <button onClick={() => setBulkOpResult(null)}>
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

                {filteredUsers.length > 0 && hasSelectedUsers && (
                    <div className="card mb-6">
                        <div className="card-body py-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <p className="text-sm text-muted">
                                        Seleccionados: <strong>{selectedUserIds.length}</strong> de {filteredUsers.length}
                                    </p>
                                    <p className="text-xs text-muted mt-1">
                                        Usa esta barra para aplicar cambios a varios usuarios al mismo tiempo.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 w-full lg:w-auto">
                                    <div>
                                        <label className="label">Operación</label>
                                        <select
                                            value={bulkAction}
                                            onChange={(e) =>
                                                setBulkAction(
                                                    e.target.value as BulkUserOperation,
                                                )
                                            }
                                            className="input"
                                        >
                                            <option value="set_active">Cambiar estado (activo/inactivo)</option>
                                            <option value="set_admin">Cambiar rol (admin/usuario)</option>
                                            <option value="expire_password">Expirar contraseña</option>
                                            <option value="add_labels">Agregar etiquetas</option>
                                            <option value="remove_labels">Quitar etiquetas</option>
                                            <option value="replace_labels">Reemplazar etiquetas</option>
                                        </select>
                                    </div>

                                    {(bulkAction === "set_active" ||
                                        bulkAction === "set_admin") && (
                                        <div>
                                            <label className="label">Valor</label>
                                            <select
                                                value={bulkToggleValue}
                                                onChange={(e) =>
                                                    setBulkToggleValue(
                                                        Number(e.target.value) as 0 | 1,
                                                    )
                                                }
                                                className="input"
                                            >
                                                <option value={1}>Sí</option>
                                                <option value={0}>No</option>
                                            </select>
                                        </div>
                                    )}

                                    {(bulkAction === "add_labels" ||
                                        bulkAction === "remove_labels" ||
                                        bulkAction === "replace_labels") && (
                                        <div className="md:col-span-2 lg:col-span-2">
                                            <label className="label">Etiquetas</label>
                                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3 max-h-[180px] overflow-y-auto space-y-2">
                                                {availableLabels.length === 0 ? (
                                                    <p className="text-sm text-muted">
                                                        No hay etiquetas activas disponibles.
                                                    </p>
                                                ) : (
                                                    availableLabels.map((label) => {
                                                        const isSelected = bulkLabelIds.includes(
                                                            label.id,
                                                        );
                                                        return (
                                                            <label
                                                                key={label.id}
                                                                className="flex items-center justify-between gap-3 p-2 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSelected}
                                                                        onChange={() =>
                                                                            toggleBulkLabelSelection(
                                                                                label.id,
                                                                            )
                                                                        }
                                                                        className="checkbox"
                                                                    />
                                                                    <span
                                                                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full"
                                                                        style={{
                                                                            backgroundColor:
                                                                                label.color ||
                                                                                "#6B7280",
                                                                            color: getContrastTextColor(
                                                                                label.color,
                                                                            ),
                                                                        }}
                                                                    >
                                                                        {label.name}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-muted truncate">
                                                                    {label.slug}
                                                                </span>
                                                            </label>
                                                        );
                                                    })
                                                )}
                                            </div>
                                            <div className="mt-2 flex items-center justify-between">
                                                <p className="text-xs text-muted">
                                                    {bulkLabelIds.length} etiqueta(s) seleccionada(s)
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setBulkLabelIds(
                                                                availableLabels.map(
                                                                    (label) => label.id,
                                                                ),
                                                            )
                                                        }
                                                        className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                                                    >
                                                        Seleccionar todas
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setBulkLabelIds([])
                                                        }
                                                        className="text-xs text-muted hover:underline"
                                                    >
                                                        Limpiar
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-end gap-2">
                                        <button
                                            type="button"
                                            onClick={handleApplyBulk}
                                            disabled={!hasSelectedUsers || bulkApplying}
                                            className="btn btn-primary"
                                        >
                                            {bulkApplying ? "Aplicando..." : "Aplicar a Seleccionados"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={clearBulkSelection}
                                            disabled={!hasSelectedUsers || bulkApplying}
                                            className="btn btn-secondary"
                                        >
                                            Limpiar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Users Table */}
                {filteredUsers.length === 0 ? (
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
                        {users.length === 0 ? (
                            <>
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
                            </>
                        ) : (
                            <>
                                <h3 className="empty-state-title">Sin resultados</h3>
                                <p className="empty-state-description">
                                    No hay usuarios que coincidan con los filtros seleccionados.
                                </p>
                                <button
                                    onClick={clearFilters}
                                    className="btn btn-secondary"
                                >
                                    Limpiar filtros
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="card p-0">
                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead className="table-header">
                                    <tr>
                                        <th className="table-header-cell">
                                            <input
                                                type="checkbox"
                                                checked={isAllSelected}
                                                onChange={toggleSelectAll}
                                                className="checkbox"
                                            />
                                        </th>
                                        <th className="table-header-cell">
                                            Username
                                        </th>
                                        <th className="table-header-cell">
                                            Etiquetas
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
                                    {filteredUsers.map((user) => (
                                        <tr key={user.id} className="table-row">
                                            <td className="table-cell">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedUserIds.includes(user.id)}
                                                    onChange={() => toggleUserSelection(user.id)}
                                                    className="checkbox"
                                                />
                                            </td>
                                            <td className="table-cell font-medium">
                                                {user.username}
                                            </td>
                                            <td className="table-cell">
                                                <UserLabelsBadges
                                                    key={user.id}
                                                    userId={user.id}
                                                    maxShow={2}
                                                    clickable={true}
                                                    onClick={() =>
                                                        handleOpenEditModal(user)
                                                    }
                                                    cachedLabels={getCachedUserLabels(user.id)}
                                                    onLabelsLoaded={(labels) =>
                                                        cacheUserLabels(user.id, labels)
                                                    }
                                                />
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
                {showBulkPreviewModal && bulkPreview && (
                    <div className="modal-overlay">
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <div className="modal-header">
                                    <h2 className="modal-title">Previsualización de operación masiva</h2>
                                    <button
                                        onClick={() => {
                                            setShowBulkPreviewModal(false);
                                            setBulkPreview(null);
                                            setPendingBulkPayload(null);
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

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                                    <div className="card-body bg-gray-100 dark:bg-gray-700/40 rounded-lg py-3">
                                        <p className="text-xs text-muted">Operación</p>
                                        <p className="font-semibold">{bulkPreview.operation}</p>
                                    </div>
                                    <div className="card-body bg-gray-100 dark:bg-gray-700/40 rounded-lg py-3">
                                        <p className="text-xs text-muted">Solicitados</p>
                                        <p className="font-semibold">{bulkPreview.requested}</p>
                                    </div>
                                    <div className="card-body bg-green-100 dark:bg-green-900/20 rounded-lg py-3">
                                        <p className="text-xs text-muted">Cambios detectados</p>
                                        <p className="font-semibold">{bulkPreview.to_change || 0}</p>
                                    </div>
                                    <div className="card-body bg-amber-100 dark:bg-amber-900/20 rounded-lg py-3">
                                        <p className="text-xs text-muted">Sin cambios</p>
                                        <p className="font-semibold">
                                            {bulkPreview.results.filter((r) => r.status === "noop").length}
                                        </p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                                    <table className="table">
                                        <thead className="table-header">
                                            <tr>
                                                <th className="table-header-cell">Usuario</th>
                                                <th className="table-header-cell">Estado</th>
                                                <th className="table-header-cell">Detalle</th>
                                            </tr>
                                        </thead>
                                        <tbody className="table-body">
                                            {bulkPreview.results.map((item) => {
                                                const user = users.find((u) => u.id === item.user_id);
                                                return (
                                                    <tr key={`${item.user_id}-${item.status}`} className="table-row">
                                                        <td className="table-cell">
                                                            <div className="font-medium">{user?.username || `#${item.user_id}`}</div>
                                                            {user?.email && (
                                                                <div className="text-xs text-muted">{user.email}</div>
                                                            )}
                                                        </td>
                                                        <td className="table-cell">
                                                            <span
                                                                className={`badge ${
                                                                    item.status === "change"
                                                                        ? "badge-success"
                                                                        : item.status === "noop"
                                                                          ? "badge-neutral"
                                                                          : "badge-error"
                                                                }`}
                                                            >
                                                                {item.status}
                                                            </span>
                                                        </td>
                                                        <td className="table-cell text-muted">{item.message}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="modal-footer mt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowBulkPreviewModal(false)}
                                        className="btn btn-secondary"
                                        disabled={bulkApplying}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleConfirmBulkApply}
                                        className="btn btn-primary"
                                        disabled={bulkApplying || (bulkPreview.to_change || 0) === 0}
                                    >
                                        {bulkApplying ? "Aplicando..." : "Confirmar y aplicar"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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

                                <div className="form-group">
                                    <label className="label">Etiquetas</label>
                                    <div className="flex items-center justify-between gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                                        <UserLabelsBadges
                                            key={`${selectedUser.id}-${labelsRefreshKey}`}
                                            userId={selectedUser.id}
                                            maxShow={3}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedUserForLabels(
                                                    selectedUser,
                                                );
                                                setShowLabelsModal(true);
                                            }}
                                            className="btn btn-secondary whitespace-nowrap"
                                        >
                                            Editar etiquetas
                                        </button>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowEditModal(false);
                                            setShowLabelsModal(false);
                                            setSelectedUser(null);
                                            setSelectedUserForLabels(null);
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

            <UserLabelsModal
                isOpen={showLabelsModal}
                user={selectedUserForLabels}
                availableLabels={availableLabels}
                cachedUserLabels={
                    selectedUserForLabels
                        ? getCachedUserLabels(selectedUserForLabels.id)
                        : undefined
                }
                onUserLabelsUpdated={(labels) => {
                    if (selectedUserForLabels) {
                        cacheUserLabels(selectedUserForLabels.id, labels);
                    }
                }}
                onClose={() => {
                    setShowLabelsModal(false);
                    setSelectedUserForLabels(null);
                }}
                onUpdate={() => {
                    setLabelsRefreshKey((prev) => prev + 1);
                }}
            />
        </ProtectedRoute>
    );
}
