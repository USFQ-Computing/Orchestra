"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { user, loading, logout } = useAuth();
    const [isCollapsed, setIsCollapsed] = useState(false);

    useEffect(() => {
        // Cargar estado de la sidebar desde localStorage
        const savedCollapsed = localStorage.getItem("sidebarCollapsed");
        if (savedCollapsed !== null) {
            setIsCollapsed(savedCollapsed === "true");
        }
    }, []);

    const handleLogout = () => {
        logout();
    };

    const toggleSidebar = () => {
        const newCollapsed = !isCollapsed;
        setIsCollapsed(newCollapsed);
        localStorage.setItem("sidebarCollapsed", newCollapsed.toString());
    };

    // Mostrar loading solo durante la carga inicial
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                    <p className="mt-4 text-gray-600 dark:text-gray-400">
                        Cargando...
                    </p>
                </div>
            </div>
        );
    }

    // Si no hay usuario después de cargar, no mostrar nada (el AuthContext redirigirá)
    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 bg-white dark:bg-gray-800 shadow-lg transition-all duration-300 ${isCollapsed ? "w-20" : "w-64"}`}
            >
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className="flex items-center justify-center h-16 bg-primary-600 px-4">
                        {!isCollapsed ? (
                            <>
                                <div className="flex items-center space-x-2 text-white">
                                    <svg
                                        className="w-8 h-8 flex-shrink-0"
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
                                    <span className="text-xl font-bold whitespace-nowrap">
                                        Orchestra
                                    </span>
                                </div>
                                <button
                                    onClick={toggleSidebar}
                                    className="text-white hover:bg-primary-700 p-1 rounded transition-colors ml-2"
                                    title="Colapsar"
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
                                            d="M4 6h16M4 12h16M4 18h16"
                                        />
                                    </svg>
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={toggleSidebar}
                                className="text-white hover:bg-primary-700 p-1 rounded transition-colors"
                                title="Expandir"
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
                                        d="M4 6h16M4 12h16M4 18h16"
                                    />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-6 space-y-2">
                        {user?.is_admin === 1 ? (
                            <>
                                {/* Admin Navigation */}
                                <NavLink
                                    href="/dashboard"
                                    icon="dashboard"
                                    active={pathname === "/dashboard"}
                                    collapsed={isCollapsed}
                                >
                                    Dashboard
                                </NavLink>
                                <NavLink
                                    href="/dashboard/servers"
                                    icon="server"
                                    active={pathname === "/dashboard/servers"}
                                    collapsed={isCollapsed}
                                >
                                    Servidores
                                </NavLink>
                                <NavLink
                                    href="/dashboard/playbooks"
                                    icon="playbook"
                                    active={pathname === "/dashboard/playbooks"}
                                    collapsed={isCollapsed}
                                >
                                    Playbooks
                                </NavLink>
                                <NavLink
                                    href="/dashboard/executions"
                                    icon="history"
                                    active={
                                        pathname === "/dashboard/executions"
                                    }
                                    collapsed={isCollapsed}
                                >
                                    Ejecuciones
                                </NavLink>
                                <NavLink
                                    href="/dashboard/users"
                                    icon="users"
                                    active={pathname === "/dashboard/users"}
                                    collapsed={isCollapsed}
                                >
                                    Usuarios
                                </NavLink>
                                <NavLink
                                    href="/dashboard/labels"
                                    icon="tag"
                                    active={pathname === "/dashboard/labels"}
                                    collapsed={isCollapsed}
                                >
                                    Etiquetas
                                </NavLink>
                                <NavLink
                                    href="/dashboard/containers"
                                    icon="container"
                                    active={
                                        pathname === "/dashboard/containers"
                                    }
                                    collapsed={isCollapsed}
                                >
                                    Contenedores
                                </NavLink>
                            </>
                        ) : (
                            <>
                                {/* User Navigation */}
                                <NavLink
                                    href="/dashboard/user"
                                    icon="dashboard"
                                    active={pathname === "/dashboard/user"}
                                    collapsed={isCollapsed}
                                >
                                    Dashboard
                                </NavLink>
                                <NavLink
                                    href="/dashboard/user/profile"
                                    icon="profile"
                                    active={
                                        pathname === "/dashboard/user/profile"
                                    }
                                    collapsed={isCollapsed}
                                >
                                    Mi Perfil
                                </NavLink>
                                <NavLink
                                    href="/dashboard/user/containers"
                                    icon="container"
                                    active={
                                        pathname ===
                                        "/dashboard/user/containers"
                                    }
                                    collapsed={isCollapsed}
                                >
                                    Contenedores
                                </NavLink>
                            </>
                        )}
                    </nav>

                    {/* User info & logout */}
                    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                        {!isCollapsed ? (
                            <>
                                <div className="flex items-center justify-between mb-3">
                                    <ThemeToggle />
                                </div>
                                <div className="flex items-center space-x-3 mb-3">
                                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                                        <span className="text-primary-600 font-semibold">
                                            {user?.username
                                                ?.charAt(0)
                                                .toUpperCase() || "A"}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                            {user?.username || "Usuario"}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {user?.is_admin === 1
                                                ? "Administrador"
                                                : "Usuario"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                    <svg
                                        className="w-5 h-5 mr-2"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                        />
                                    </svg>
                                    Cerrar Sesión
                                </button>
                            </>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex justify-center">
                                    <ThemeToggle />
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    title="Cerrar Sesión"
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
                                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                        />
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main
                className={`min-h-screen transition-all duration-300 ${isCollapsed ? "ml-20" : "ml-64"}`}
            >
                <div className="p-8">{children}</div>
            </main>
        </div>
    );
}

function NavLink({
    href,
    icon,
    active,
    collapsed,
    children,
}: {
    href: string;
    icon: string;
    active: boolean;
    collapsed?: boolean;
    children: React.ReactNode;
}) {
    const getIcon = (type: string) => {
        switch (type) {
            case "dashboard":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                );
            case "server":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                    />
                );
            case "playbook":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                );
            case "history":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                );
            case "users":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                );
            case "tag":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    />
                );
            case "profile":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                );
            case "container":
                return (
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                );
            default:
                return null;
        }
    };

    return (
        <a
            href={href}
            className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                active
                    ? "bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            } ${collapsed ? "justify-center" : ""}`}
            title={collapsed ? children?.toString() : ""}
        >
            <svg
                className={`w-5 h-5 flex-shrink-0 ${collapsed ? "" : "mr-3"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                {getIcon(icon)}
            </svg>
            {!collapsed && <span className="font-medium">{children}</span>}
        </a>
    );
}
