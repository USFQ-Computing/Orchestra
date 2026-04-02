"use client";

import { memo, useEffect, useState } from "react";
import { Label, labelsService } from "@/lib/services";

interface UserLabelsBadgesProps {
    userId: number;
    maxShow?: number;
    onClick?: () => void;
    clickable?: boolean;
    cachedLabels?: Label[];
    onLabelsLoaded?: (labels: Label[]) => void;
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

function UserLabelsBadges({
    userId,
    maxShow = 3,
    onClick,
    clickable = false,
    cachedLabels,
    onLabelsLoaded,
}: UserLabelsBadgesProps) {
    const [labels, setLabels] = useState<Label[]>(cachedLabels || []);
    const [loading, setLoading] = useState(!cachedLabels);

    useEffect(() => {
        // Si ya tenemos cache, no hacer llamada API
        if (cachedLabels) {
            setLabels(cachedLabels);
            setLoading(false);
            return;
        }

        const loadLabels = async () => {
            try {
                const userLabels = await labelsService.getUserLabels(userId);
                setLabels(userLabels);
                onLabelsLoaded?.(userLabels);
            } catch (error) {
                console.error("Error loading user labels:", error);
            } finally {
                setLoading(false);
            }
        };

        loadLabels();
    }, [userId, cachedLabels, onLabelsLoaded]);

    if (loading) {
        return (
            <div className="inline-block">
                <span className="text-gray-400 text-xs">Cargando...</span>
            </div>
        );
    }

    if (labels.length === 0) {
        return (
            <div className="inline-block">
                <span className="text-gray-400 text-xs">Sin etiquetas</span>
            </div>
        );
    }

    const displayLabels = labels.slice(0, maxShow);
    const hiddenCount = labels.length - maxShow;

    return (
        <div
            className={`inline-flex items-center gap-2 flex-wrap ${
                clickable ? "cursor-pointer" : ""
            }`}
            onClick={clickable ? onClick : undefined}
        >
            {displayLabels.map((label) => (
                <span
                    key={label.id}
                    className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full"
                    style={{
                        backgroundColor: label.color || "#6B7280",
                        color: getContrastTextColor(label.color),
                    }}
                >
                    {label.name}
                </span>
            ))}
            {hiddenCount > 0 && (
                <span className="inline-block px-2 py-1 bg-gray-200 text-gray-600 text-xs font-medium rounded-full">
                    +{hiddenCount}
                </span>
            )}
        </div>
    );
}

export default memo(UserLabelsBadges, (prevProps, nextProps) => {
    // Custom comparison for memoization
    return (
        prevProps.userId === nextProps.userId &&
        prevProps.maxShow === nextProps.maxShow &&
        prevProps.clickable === nextProps.clickable &&
        prevProps.cachedLabels === nextProps.cachedLabels
    );
});
