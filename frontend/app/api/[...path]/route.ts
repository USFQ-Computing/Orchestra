import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_URL = process.env.API_URL || "http://server:8000";

async function proxyRequest(
    request: NextRequest,
    endpoint: string,
    method: string = "GET",
) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get("token")?.value;

        // Detectar si es FormData (multipart/form-data)
        const requestContentType = request.headers.get("content-type");
        const isFormData = requestContentType?.includes("multipart/form-data");

        const headers: HeadersInit = {};

        // Solo agregar Content-Type si NO es FormData
        if (!isFormData) {
            headers["Content-Type"] = "application/json";
        }

        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const options: RequestInit = {
            method,
            headers,
        };

        // Agregar body si no es GET o HEAD
        if (method !== "GET" && method !== "HEAD") {
            if (isFormData) {
                // Para FormData, enviar el FormData directamente
                options.body = await request.formData();
            } else {
                // Para JSON, enviar como texto
                const body = await request.text();
                if (body) {
                    options.body = body;
                }
            }
        }

        const response = await fetch(`${API_URL}${endpoint}`, options);

        // No-content responses must be returned without a body.
        if (
            response.status === 204 ||
            response.status === 205 ||
            response.status === 304
        ) {
            return new NextResponse(null, { status: response.status });
        }

        // Verificar el tipo de contenido de la respuesta
        const responseContentType = response.headers.get("content-type");
        const responseContentLength = response.headers.get("content-length");

        // Some backends send empty bodies with JSON content-type.
        if (responseContentLength === "0") {
            return new NextResponse(null, { status: response.status });
        }

        // Intentar parsear JSON solo si el content-type lo indica
        if (
            responseContentType &&
            responseContentType.includes("application/json")
        ) {
            try {
                const rawBody = await response.text();
                if (!rawBody.trim()) {
                    return new NextResponse(null, {
                        status: response.status,
                    });
                }

                const data = JSON.parse(rawBody);
                return NextResponse.json(data, { status: response.status });
            } catch (parseError) {
                console.error("JSON parse error:", parseError);
                return NextResponse.json(
                    { detail: "Invalid JSON response from backend" },
                    { status: 500 },
                );
            }
        } else {
            // Si no es JSON, devolver el texto plano
            const text = await response.text();
            return NextResponse.json(
                { detail: text || "Non-JSON response from backend" },
                { status: response.status },
            );
        }
    } catch (error) {
        console.error("Proxy error:", error);
        return NextResponse.json(
            {
                detail:
                    error instanceof Error
                        ? error.message
                        : "Internal server error",
            },
            { status: 500 },
        );
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    const endpoint = `/${params.path.join("/")}`;
    const searchParams = request.nextUrl.searchParams.toString();
    const fullEndpoint = searchParams
        ? `${endpoint}?${searchParams}`
        : endpoint;
    return proxyRequest(request, fullEndpoint, "GET");
}

export async function POST(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    const endpoint = `/${params.path.join("/")}`;
    return proxyRequest(request, endpoint, "POST");
}

export async function PUT(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    const endpoint = `/${params.path.join("/")}`;
    const searchParams = request.nextUrl.searchParams.toString();
    const fullEndpoint = searchParams
        ? `${endpoint}?${searchParams}`
        : endpoint;
    return proxyRequest(request, fullEndpoint, "PUT");
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    const endpoint = `/${params.path.join("/")}`;
    const searchParams = request.nextUrl.searchParams.toString();
    const fullEndpoint = searchParams
        ? `${endpoint}?${searchParams}`
        : endpoint;
    return proxyRequest(request, fullEndpoint, "PATCH");
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { path: string[] } },
) {
    const endpoint = `/${params.path.join("/")}`;
    const searchParams = request.nextUrl.searchParams.toString();
    const fullEndpoint = searchParams
        ? `${endpoint}?${searchParams}`
        : endpoint;
    return proxyRequest(request, fullEndpoint, "DELETE");
}
