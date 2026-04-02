from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .router.ansible import router as ansible_router
from .router.auth import router as auth_router
from .router.client_api import router as client_api_router
from .router.containers import router as containers_router
from .router.executions import router as executions_router
from .router.labels import router as labels_router
from .router.servers import router as servers_router
from .router.sync import router as sync_router
from .router.users import router as users_router

app = FastAPI()


# Middleware para logging de requests (para debugging)
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"[REQUEST] {request.method} {request.url}")
    print(f"[HEADERS] Origin: {request.headers.get('origin')}")
    response = await call_next(request)
    print(f"[RESPONSE] Status: {response.status_code}")
    return response


# Configurar CORS - IMPORTANTE: debe ir ANTES de incluir routers
# Para desarrollo: permitir orígenes específicos con credenciales
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://frontend:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/")
def read_root():
    return {"hello": "server"}


app.include_router(auth_router)
app.include_router(client_api_router)
app.include_router(ansible_router)
app.include_router(executions_router)
app.include_router(labels_router)
app.include_router(servers_router)
app.include_router(users_router)
app.include_router(sync_router)
app.include_router(containers_router)
