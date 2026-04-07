"use client";

import { useEffect, useState } from "react";
import { labelsService, Label, User } from "@/lib/services";
import "../styles/modal.css";

interface UserLabelsModalProps {
    isOpen: boolean;
    user: User | null;
    onClose: () => void;
    onUpdate?: () => void;
    availableLabels?: Label[];
    cachedUserLabels?: Label[];
    onUserLabelsUpdated?: (labels: Label[]) => void;
}

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

export default function UserLabelsModal({
    isOpen,
    user,
    onClose,
    onUpdate,
    availableLabels,
    cachedUserLabels,
    onUserLabelsUpdated,
}: UserLabelsModalProps) {
    const [labels, setLabels] = useState<Label[]>([]);
    const [userLabels, setUserLabels] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [initialLabels, setInitialLabels] = useState<number[]>([]);

    useEffect(() => {
        if (isOpen && user) {
            loadData();
        }
    }, [isOpen, user, availableLabels, cachedUserLabels]);

    const loadData = async () => {
        try {
            setLoading(true);
            setError("");

            const hasAvailableLabels =
                Array.isArray(availableLabels) && availableLabels.length > 0;
            const hasCachedUserLabels =
                Array.isArray(cachedUserLabels);

            // Instant hydration from cache to avoid modal lag.
            if (hasAvailableLabels) {
                setLabels(availableLabels!);
            }
            if (hasCachedUserLabels) {
                const cachedIds = cachedUserLabels!.map((l) => l.id);
                setUserLabels(cachedIds);
                setInitialLabels(cachedIds);
            }

            // If we already have everything, skip network requests.
            if (hasAvailableLabels && hasCachedUserLabels) {
                return;
            }

            const [allLabels, userLabs] = await Promise.all([
                hasAvailableLabels
                    ? Promise.resolve(availableLabels!)
                    : labelsService.getAll(true),
                labelsService.getUserLabels(user!.id),
            ]);

            setLabels(allLabels);

            const userLabelIds = userLabs.map((l) => l.id);
            setUserLabels(userLabelIds);
            setInitialLabels(userLabelIds);
            onUserLabelsUpdated?.(userLabs);
        } catch (error: any) {
            console.error("Error loading labels:", error);
            setError(
                error.response?.data?.detail || "Error al cargar etiquetas",
            );
        } finally {
            setLoading(false);
        }
    };

    const handleToggleLabel = (labelId: number) => {
        setUserLabels((prev) =>
            prev.includes(labelId)
                ? prev.filter((id) => id !== labelId)
                : [...prev, labelId],
        );
    };

    const handleSave = async () => {
        if (!user) return;

        try {
            setSaving(true);
            setError("");

            await labelsService.setUserLabels(user.id, userLabels);

            const updatedLabels = labels.filter((label) =>
                userLabels.includes(label.id),
            );
            onUserLabelsUpdated?.(updatedLabels);

            setInitialLabels(userLabels);
            if (onUpdate) {
                onUpdate();
            }

            // Close after short delay to show feedback
            setTimeout(() => {
                onClose();
            }, 300);
        } catch (error: any) {
            console.error("Error saving labels:", error);
            setError(
                error.response?.data?.detail || "Error al guardar etiquetas",
            );
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setUserLabels(initialLabels);
        setError("");
        onClose();
    };

    if (!isOpen || !user) return null;

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        Etiquetas de {user.username}
                    </h2>
                    <button
                        onClick={handleCancel}
                        className="modal-close-btn"
                        disabled={saving}
                    >
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="alert alert-error mb-4">
                            <span>{error}</span>
                            <button
                                onClick={() => setError("")}
                                className="alert-close"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div className="text-center py-8">
                            <div className="spinner spinner-md"></div>
                            <p className="text-muted mt-4">
                                Cargando etiquetas...
                            </p>
                        </div>
                    ) : labels.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-muted">
                                No hay etiquetas disponibles
                            </p>
                        </div>
                    ) : (
                        <div className="labels-grid">
                            {labels.map((label) => (
                                <div key={label.id} className="label-item">
                                    <label className="label-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={userLabels.includes(
                                                label.id,
                                            )}
                                            onChange={() =>
                                                handleToggleLabel(label.id)
                                            }
                                            disabled={saving}
                                        />
                                        <span className="label-content">
                                            <span
                                                className="label-name"
                                                style={{
                                                    backgroundColor:
                                                        label.color || "#6B7280",
                                                    color: getContrastTextColor(
                                                        label.color,
                                                    ),
                                                }}
                                            >
                                                {label.name}
                                            </span>
                                        </span>
                                    </label>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        onClick={handleCancel}
                        className="btn btn-secondary"
                        disabled={saving}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn btn-primary"
                        disabled={
                            saving ||
                            loading ||
                            userLabels.length ===
                                initialLabels.length &&
                            userLabels.every((id) =>
                                initialLabels.includes(id),
                            )
                        }
                    >
                        {saving ? (
                            <>
                                <span className="spinner spinner-sm mr-2"></span>
                                Guardando...
                            </>
                        ) : (
                            "Guardar Cambios"
                        )}
                    </button>
                </div>
            </div>

            <style jsx>{`
                .labels-grid {
                    display: grid;
                    grid-template-columns: repeat(
                        auto-fill,
                        minmax(200px, 1fr)
                    );
                    gap: 1rem;
                    margin-top: 1.5rem;
                }

                .label-item {
                    display: flex;
                    align-items: center;
                }

                .label-checkbox {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                    gap: 0.75rem;
                    padding: 0.75rem;
                    border-radius: 0.5rem;
                    border: 1px solid #e5e7eb;
                    transition: all 0.2s ease;
                    width: 100%;
                }

                .label-checkbox input {
                    cursor: pointer;
                    width: 1.25rem;
                    height: 1.25rem;
                    flex-shrink: 0;
                }

                .label-checkbox input:disabled {
                    cursor: not-allowed;
                    opacity: 0.5;
                }

                .label-checkbox:hover {
                    border-color: #d1d5db;
                    background-color: #f9fafb;
                }

                .label-checkbox input:checked + .label-content {
                    color: inherit;
                }

                .label-content {
                    display: flex;
                    align-items: center;
                    flex-grow: 1;
                }

                .label-name {
                    font-size: 0.85rem;
                    font-weight: 500;
                    border-radius: 9999px;
                    padding: 0.2rem 0.6rem;
                }

                .btn {
                    padding: 0.5rem 1rem;
                    border-radius: 0.375rem;
                    font-size: 0.95rem;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .mr-2 {
                    margin-right: 0.5rem;
                }
            `}</style>
        </div>
    );
}
