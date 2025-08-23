-- Migration: Safe Google Auth Setup
-- This migration safely adds Google auth capabilities alongside existing auth
-- PRODUCTION SAFE: Only adds new columns and tables, preserves existing data

-- Add new columns for Google-only auth
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'google';

-- Update existing admin users to have proper role and provider (safe update)
UPDATE admin_users 
SET provider = 'password', role = 'admin' 
WHERE provider IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_users_google_id ON admin_users(google_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_provider ON admin_users(provider);