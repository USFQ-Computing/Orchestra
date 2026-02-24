-- Migration: add password expiry fields to the users table
-- password_max_age_days: NULL = never expires; positive int = days until expiry
-- password_changed_at:   timestamp of the last password change (for sp_lstchg calculation)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_max_age_days INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN users.password_max_age_days IS 'Maximum days before password must be changed. NULL means never expires.';
COMMENT ON COLUMN users.password_changed_at IS 'Timestamp of last password change. Used to compute shadow sp_lstchg field.';
