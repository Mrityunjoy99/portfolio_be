-- Migration: Safe Google Auth Enhancement
-- This migration safely adds Google auth support alongside existing auth
-- PRODUCTION SAFE: Only adds columns, preserves existing data

-- Ensure we have the minimal required columns for Google auth
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'google';

-- Update existing users to have role set (safe update)
UPDATE admin_users SET provider = 'password', role = 'admin' WHERE provider IS NULL;

-- Create helpful indexes (safe operations)
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_google_id ON admin_users(google_id);

-- Clean up any unused functions or triggers related to old auth
-- (The schema already has basic triggers, we'll keep those)