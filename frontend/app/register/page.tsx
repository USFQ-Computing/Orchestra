"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

export default function RegisterPage() {
    const router = useRouter();
    const { refreshUser } = useAuth();
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [formData, setFormData] = useState({
        email: "",
        password: "",
        confirmPassword: "",
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // Validar que el correo sea de USFQ
        if (!formData.email.endsWith("@usfq.edu.ec")) {
            setError(
                "Debes usar un correo institucional de USFQ (@usfq.edu.ec)",
            );
            return;
        }

        // Extraer username del correo (parte antes del @)
        const username = formData.email.split("@")[0];

        // Validar que las contraseñas coincidan
        if (formData.password !== formData.confirmPassword) {
            setError("Las contraseñas no coinciden");
            return;
        }

        // Validar longitud mínima de contraseña
        if (formData.password.length < 6) {
            setError("La contraseña debe tener al menos 6 caracteres");
            return;
        }

        setLoading(true);

        try {
            const response = await api.post("/auth/signup", {
                username: username,
                email: formData.email,
                password: formData.password,
            });

            // Si el registro es exitoso, actualizar contexto y redirigir
            if (response.data.access_token) {
                // Actualizar el contexto de autenticación
                await refreshUser();
                // Los usuarios nuevos siempre van al dashboard de usuario
                router.push("/dashboard/user");
            }
        } catch (err: any) {
            console.error("Register error:", err);

            // Extraer el mensaje de error
            let errorMessage = "Error al crear la cuenta. Intenta de nuevo.";

            if (err.response?.data?.detail) {
                const detail = err.response.data.detail;

                // Mapear mensajes del backend a español
                if (detail.includes("already exists")) {
                    errorMessage =
                        "El nombre de usuario o correo electrónico ya está en uso.";
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
                                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                                />
                            </svg>
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                            Crear Cuenta
                        </h1>
                        <p className="text-muted mt-2">
                            Usa tu correo institucional de USFQ
                        </p>
                    </div>

                    {/* Formulario de registro */}
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
                            <label htmlFor="email" className="label">
                                Correo Electrónico *
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        email: e.target.value,
                                    })
                                }
                                className="input"
                                placeholder="tunombre@usfq.edu.ec"
                                required
                                autoComplete="email"
                                disabled={loading}
                            />
                            <p className="text-xs text-muted mt-1">
                                Tu nombre de usuario será la parte antes del @
                            </p>
                        </div>

                        <div>
                            <label htmlFor="password" className="label">
                                Contraseña *
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            password: e.target.value,
                                        })
                                    }
                                    className="input pr-24"
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
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
                            <p className="text-xs text-muted mt-1">
                                Mínimo 6 caracteres
                            </p>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="label">
                                Confirmar Contraseña *
                            </label>
                            <div className="relative">
                                <input
                                    id="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    value={formData.confirmPassword}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            confirmPassword: e.target.value,
                                        })
                                    }
                                    className="input pr-24"
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowConfirmPassword((value) => !value)
                                    }
                                    className="absolute inset-y-0 right-0 px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                                    aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                    disabled={loading}
                                >
                                    {showConfirmPassword ? "Ocultar" : "Mostrar"}
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
                                    Creando cuenta...
                                </span>
                            ) : (
                                "Crear Cuenta"
                            )}
                        </button>
                    </form>

                    {/* Link al login */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
                        <p className="text-sm text-muted">
                            ¿Ya tienes una cuenta?{" "}
                            <Link
                                href="/login"
                                className="text-primary-600 hover:text-primary-700 font-medium transition-colors dark:text-primary-400 dark:hover:text-primary-300"
                            >
                                Inicia sesión aquí
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
