"use client";

import { useEffect, useState } from "react";
import { executionsService, Execution } from "@/lib/services";
import { useRouter } from "next/navigation";
import {
    cn,
    getExecutionStateClass,
    getFilterTabClass,
    getSpinnerClass,
    getButtonClass,
    getAlertClass,
    getIconContainerClass,
} from "@/lib/styles";

export default function ExecutionsPage() {
    const router = useRouter();
    const [executions, setExecutions] = useState<Execution[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState<string>("all");

    useEffect(() => {
        loadExecutions();
    }, [filter]);

    const loadExecutions = async () => {
        try {
            setLoading(true);
            let data;
            if (filter === "all") {
                data = await executionsService.getAll();
            } else {
                data = await executionsService.getByState(filter);
            }
            setExecutions(data);
            setError("");
        } catch (error: any) {
            console.error("Error loading executions:", error);
            setError(
                error.response?.data?.detail ||
                    "Error al cargar las ejecuciones",
            );
        } finally {
            setLoading(false);
        }
    };

    const getStateLabel = (state: string) => {
        switch (state) {
            case "dry":
                return "Pendiente";
            case "running":
                return "Ejecutando";
            case "success":
                return "Exitoso";
            case "failed":
            case "error":
                return "Fallido";
            default:
                return state;
        }
    };

    const getStateIcon = (state: string) => {
        switch (state) {
            case "success":
                return (
                    <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                );
            case "failed":
            case "error":
                return (
                    <svg
                        className="w-4 h-4 mr-1"
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
                );
            case "running":
                return (
                    <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        />
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                );
            case "dry":
            case "pending":
                return (
                    <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                );
            default:
                return null;
        }
    };

    const handleRowClick = (executionId: number) => {
        router.push(`/dashboard/executions/${executionId}`);
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="loading-content">
                    <div className={getSpinnerClass("lg")}></div>
                    <p className="mt-4 text-muted">Cargando ejecuciones...</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Ejecuciones de Playbooks</h1>
                    <p className="page-subtitle">
                        Historial y estado de ejecuciones de Ansible
                    </p>
                </div>
                <button
                    onClick={loadExecutions}
                    className={cn(
                        getButtonClass("secondary"),
                        "flex items-center space-x-2",
                    )}
                >
                    <svg
                        className="icon-sm"
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
                    <span>Actualizar</span>
                </button>
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

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {/* Total Executions */}
                <div className="card">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
                                Total
                            </p>
                            <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                                {executions.length}
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
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Successful Executions */}
                <div className="card">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">
                                Exitosas
                            </p>
                            <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                                {
                                    executions.filter(
                                        (e) => e.state === "success",
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

                {/* Running Executions */}
                <div className="card">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium mb-1">
                                En Ejecución
                            </p>
                            <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                                {
                                    executions.filter(
                                        (e) => e.state === "running",
                                    ).length
                                }
                            </p>
                        </div>
                        <div className={getIconContainerClass("warning")}>
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
                                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                />
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Failed Executions */}
                <div className="card">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">
                                Fallidas
                            </p>
                            <p className="text-3xl font-bold text-red-700 dark:text-red-300">
                                {
                                    executions.filter(
                                        (e) =>
                                            e.state === "failed" ||
                                            e.state === "error",
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

            {/* Filter Tabs */}
            <div className="filter-tabs">
                {["all", "dry", "running", "success", "error"].map((state) => (
                    <button
                        key={state}
                        onClick={() => setFilter(state)}
                        className={cn(
                            "filter-tab",
                            filter === state
                                ? "filter-tab-active"
                                : "filter-tab-inactive",
                        )}
                    >
                        {state === "all" ? "Todas" : getStateLabel(state)}
                    </button>
                ))}
            </div>

            {/* Executions List */}
            {executions.length === 0 ? (
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
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                    </svg>
                    <h3 className="empty-state-title">No hay ejecuciones</h3>
                    <p className="empty-state-description">
                        {filter === "all"
                            ? "No se han ejecutado playbooks todavía"
                            : `No hay ejecuciones con el estado: ${getStateLabel(filter)}`}
                    </p>
                    <button
                        onClick={() => router.push("/dashboard/playbooks")}
                        className={getButtonClass("primary")}
                    >
                        Ir a Playbooks
                    </button>
                </div>
            ) : (
                <div className="card p-0">
                    <div className="overflow-x-auto">
                        <table className="table">
                            <thead className="table-header">
                                <tr>
                                    <th className="table-header-cell">ID</th>
                                    <th className="table-header-cell">
                                        Playbook
                                    </th>
                                    <th className="table-header-cell">
                                        Usuario
                                    </th>
                                    <th className="table-header-cell">
                                        Servidores
                                    </th>
                                    <th className="table-header-cell">Fecha</th>
                                    <th className="table-header-cell">
                                        Estado
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="table-body">
                                {executions.map((execution) => (
                                    <tr
                                        key={execution.id}
                                        onClick={() =>
                                            handleRowClick(execution.id)
                                        }
                                        className="table-row cursor-pointer"
                                    >
                                        <td className="table-cell">
                                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                                #{execution.id}
                                            </span>
                                        </td>
                                        <td className="table-cell">
                                            <span className="text-sm text-gray-900 dark:text-white">
                                                Playbook #
                                                {execution.playbook_id}
                                            </span>
                                        </td>
                                        <td className="table-cell">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary-600 dark:bg-primary-500 flex items-center justify-center mr-2">
                                                    <span className="text-white font-semibold text-xs">
                                                        {(execution.user_username ||
                                                            `User${execution.user_id}`)[0].toUpperCase()}
                                                    </span>
                                                </div>
                                                <span className="text-sm text-gray-900 dark:text-white">
                                                    {execution.user_username ||
                                                        `User #${execution.user_id}`}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="table-cell">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                                {execution.servers.length}{" "}
                                                {execution.servers.length === 1
                                                    ? "servidor"
                                                    : "servidores"}
                                            </span>
                                        </td>
                                        <td className="table-cell">
                                            <div className="flex flex-col">
                                                <span className="text-sm text-gray-900 dark:text-white">
                                                    {new Date(
                                                        execution.executed_at,
                                                    ).toLocaleDateString(
                                                        "es-ES",
                                                        {
                                                            day: "2-digit",
                                                            month: "short",
                                                            year: "numeric",
                                                        },
                                                    )}
                                                </span>
                                                <span className="text-xs text-muted">
                                                    {new Date(
                                                        execution.executed_at,
                                                    ).toLocaleTimeString(
                                                        "es-ES",
                                                        {
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        },
                                                    )}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="table-cell">
                                            <div className="flex items-center">
                                                {/* Visual Indicator Dot */}
                                                <span
                                                    className={cn(
                                                        "h-3 w-3 rounded-full mr-2",
                                                        execution.state ===
                                                            "success" &&
                                                            "bg-green-500 shadow-lg shadow-green-500/50",
                                                        (execution.state ===
                                                            "failed" ||
                                                            execution.state ===
                                                                "error") &&
                                                            "bg-red-500 shadow-lg shadow-red-500/50",
                                                        execution.state ===
                                                            "running" &&
                                                            "bg-yellow-500 shadow-lg shadow-yellow-500/50 animate-pulse",
                                                        execution.state ===
                                                            "dry" &&
                                                            "bg-gray-400 dark:bg-gray-500",
                                                    )}
                                                ></span>
                                                <span
                                                    className={cn(
                                                        "text-sm font-medium",
                                                        execution.state ===
                                                            "success" &&
                                                            "text-green-700 dark:text-green-400",
                                                        (execution.state ===
                                                            "failed" ||
                                                            execution.state ===
                                                                "error") &&
                                                            "text-red-700 dark:text-red-400",
                                                        execution.state ===
                                                            "running" &&
                                                            "text-yellow-700 dark:text-yellow-400",
                                                        execution.state ===
                                                            "dry" &&
                                                            "text-gray-700 dark:text-gray-400",
                                                    )}
                                                >
                                                    {getStateLabel(
                                                        execution.state,
                                                    )}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
