"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/lib/api";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";

export default function LoginPage() {
    const router = useRouter();
    const { refreshUser } = useAuth();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const response = await authService.login(username, password);
            // El token se guarda automáticamente en una cookie httpOnly

            // Actualizar el contexto de autenticación
            await refreshUser();

            // Verificar el tipo de usuario y redirigir
            const userInfo = await authService.verifyToken();
            if (userInfo.is_admin === 1) {
                router.push("/dashboard");
            } else {
                router.push("/dashboard/user");
            }
        } catch (err: any) {
            console.error("Login error:", err);

            // Extraer el mensaje de error
            let errorMessage =
                "Error al iniciar sesión. Verifica tus credenciales.";

            if (err.response?.data?.detail) {
                const detail = err.response.data.detail;

                // Mapear mensajes del backend a español
                if (detail === "Invalid credentials") {
                    errorMessage = "Usuario o contraseña incorrectos.";
                } else if (detail === "Inactive user") {
                    errorMessage =
                        "Tu cuenta está desactivada. Contacta al administrador.";
                } else if (detail.includes("Staff only")) {
                    errorMessage =
                        "No tienes permisos para acceder al sistema.";
                } else {
                    errorMessage = detail;
                }
            } else if (err.message) {
                errorMessage = `Error de conexión: ${err.message}`;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-900 dark:to-gray-800">
            <div className="max-w-md w-full mx-4">
                <div className="card">
                    {/* Logo y título */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 text-white rounded-full mb-4">
                            <svg
                                className="w-8 h-8"
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
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                            Bienvenido
                        </h1>
                        <p className="text-muted mt-2">
                            Sistema de Gestión de Servidores
                        </p>
                    </div>

                    {/* Formulario de login */}
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="alert alert-error">
                                <div className="flex items-center">
                                    <svg
                                        className="w-5 h-5 mr-2"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                    <span className="text-sm">{error}</span>
                                </div>
                            </div>
                        )}

                        <div>
                            <label htmlFor="username" className="label">
                                Usuario o Correo
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="input"
                                placeholder="usuario o correo@usfq.edu.ec"
                                required
                                autoComplete="username"
                                disabled={loading}
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="label">
                                Contraseña
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="input pr-24"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="current-password"
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((value) => !value)}
                                    className="absolute inset-y-0 right-0 px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                    disabled={loading}
                                >
                                    {showPassword ? "Ocultar" : "Mostrar"}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full btn btn-primary"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <svg
                                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        ></circle>
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        ></path>
                                    </svg>
                                    Iniciando sesión...
                                </span>
                            ) : (
                                "Iniciar Sesión"
                            )}
                        </button>
                    </form>

                    {/* Link al registro */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
                        <p className="text-sm text-muted">
                            ¿No tienes una cuenta?{" "}
                            <Link
                                href="/register"
                                className="text-primary-600 hover:text-primary-700 font-medium transition-colors dark:text-primary-400 dark:hover:text-primary-300"
                            >
                                Regístrate aquí
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center mt-6 text-sm text-muted">
                    <p>© 2025 Orchestra. Todos los derechos reservados.</p>
                </div>
            </div>
        </div>
    );
}
