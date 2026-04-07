-- Migracion: politicas de runtime para contenedores por servidor y por label
-- Fecha: 2026-04-07
-- Descripcion:
--   - Agrega defaults de runtime por servidor
--   - Agrega overrides de runtime por label
--   - Se usan para construir docker run con precedencia:
--       default global -> server.container_runtime_defaults -> label.container_runtime_overrides

ALTER TABLE servers
ADD COLUMN IF NOT EXISTS container_runtime_defaults JSONB NULL;

COMMENT ON COLUMN servers.container_runtime_defaults IS
'Defaults de runtime para contenedores en este servidor (JSON). Ej: {"gpus":"4","memory":"64g","shm_size":"16g"}';

ALTER TABLE labels
ADD COLUMN IF NOT EXISTS container_runtime_overrides JSONB NULL;

COMMENT ON COLUMN labels.container_runtime_overrides IS
'Overrides de runtime para usuarios con este label (JSON). Ej: {"memory":"128g"}';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'servers' AND column_name = 'container_runtime_defaults'
    ) THEN
        RAISE NOTICE '✓ Columna servers.container_runtime_defaults lista';
    ELSE
        RAISE EXCEPTION '✗ Error agregando servers.container_runtime_defaults';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'labels' AND column_name = 'container_runtime_overrides'
    ) THEN
        RAISE NOTICE '✓ Columna labels.container_runtime_overrides lista';
    ELSE
        RAISE EXCEPTION '✗ Error agregando labels.container_runtime_overrides';
    END IF;
END $$;
