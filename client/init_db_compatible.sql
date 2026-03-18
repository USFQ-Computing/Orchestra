-- Client DB compatibility script
-- Purpose: ensure the local client schema is compatible with the current program
-- starting from an existing users table like the one provided.

BEGIN;

-- 1) Create users table if it does not exist (base schema + required client columns)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER NOT NULL,
    username VARCHAR NOT NULL,
    email VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    must_change_password BOOLEAN DEFAULT FALSE,
    system_uid INTEGER NOT NULL,
    system_gid INTEGER DEFAULT 2000,
    ssh_public_key VARCHAR,
    password_max_age_days INTEGER DEFAULT NULL,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- 2) Add missing columns for existing databases
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS system_gid INTEGER DEFAULT 2000,
    ADD COLUMN IF NOT EXISTS ssh_public_key VARCHAR,
    ADD COLUMN IF NOT EXISTS password_max_age_days INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 3) Keep defaults aligned with client expectations
ALTER TABLE users
    ALTER COLUMN is_admin SET DEFAULT 0,
    ALTER COLUMN is_active SET DEFAULT 1,
    ALTER COLUMN must_change_password SET DEFAULT FALSE,
    ALTER COLUMN system_gid SET DEFAULT 2000,
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

-- 4) Ensure NOT NULL requirements used by sync flow
ALTER TABLE users
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN username SET NOT NULL,
    ALTER COLUMN email SET NOT NULL,
    ALTER COLUMN password_hash SET NOT NULL,
    ALTER COLUMN system_uid SET NOT NULL;

-- 5) Ensure constraints exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_pkey'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_username_key'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_email_key'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_system_uid_key'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_system_uid_key UNIQUE (system_uid);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'username_valid_pattern'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT username_valid_pattern
            CHECK (username::text ~ '^[a-z_][a-z0-9_-]*$'::text);
    END IF;
END
$$;

-- 6) Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_system_uid ON users(system_uid);

COMMIT;
