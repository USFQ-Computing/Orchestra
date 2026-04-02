-- Migration: Create labels and user_labels tables for user grouping/categorization
-- Description: Adds support for many-to-many user labeling system
-- Date: 2026-03-31

-- Create labels table
CREATE TABLE IF NOT EXISTS labels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    color VARCHAR(20),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create user_labels junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS user_labels (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, label_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_labels_active ON labels(active);
CREATE INDEX IF NOT EXISTS idx_labels_slug ON labels(slug);
CREATE INDEX IF NOT EXISTS idx_user_labels_user_id ON user_labels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_labels_label_id ON user_labels(label_id);

-- Add comment explaining the tables
COMMENT ON TABLE labels IS 'User labels/groups for categorization and administration';
COMMENT ON TABLE user_labels IS 'Many-to-many relationship between users and labels';
COMMENT ON COLUMN labels.slug IS 'URL-friendly unique identifier for the label';
COMMENT ON COLUMN labels.active IS 'Soft delete flag for labels';
