-- Script de inicialización de la base de datos del cliente
-- Este script se ejecuta automáticamente al crear el contenedor de PostgreSQL

-- Crear tabla de usuarios (sincronizada desde el servidor central)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR UNIQUE NOT NULL,
    email VARCHAR UNIQUE NOT NULL,
    password_hash VARCHAR NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    must_change_password BOOLEAN DEFAULT FALSE,
    system_uid INTEGER UNIQUE NOT NULL,
    system_gid INTEGER DEFAULT 2000,
    ssh_public_key VARCHAR,
    password_max_age_days INTEGER DEFAULT NULL,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT username_valid_pattern CHECK (username ~ '^[a-z_][a-z0-9_-]*$')
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_system_uid ON users(system_uid);

-- Comentarios para documentación
COMMENT ON TABLE users IS 'Usuarios sincronizados desde el servidor central';
COMMENT ON COLUMN users.system_uid IS 'UID del sistema Linux para SSH authentication';
COMMENT ON COLUMN users.system_gid IS 'GID del sistema Linux para SSH authentication';
COMMENT ON COLUMN users.ssh_public_key IS 'Clave pública SSH del usuario';
COMMENT ON COLUMN users.password_max_age_days IS 'Maximum days before password must be changed. NULL means never expires.';
COMMENT ON COLUMN users.password_changed_at IS 'Timestamp of last password change. Used to compute shadow sp_lstchg field.';
