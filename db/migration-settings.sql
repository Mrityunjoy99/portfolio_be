-- Settings Migration
-- This file adds the settings table for admin user preferences

-- Settings table for storing admin configuration
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
  
  -- Theme preferences
  theme VARCHAR(20) DEFAULT 'system', -- 'light', 'dark', 'system'
  
  -- Dashboard preferences
  dashboard_layout VARCHAR(20) DEFAULT 'grid', -- 'grid', 'list'
  items_per_page INTEGER DEFAULT 10,
  show_stats_cards BOOLEAN DEFAULT TRUE,
  show_recent_activity BOOLEAN DEFAULT TRUE,
  
  -- Notification preferences
  email_notifications BOOLEAN DEFAULT TRUE,
  desktop_notifications BOOLEAN DEFAULT FALSE,
  contact_form_notifications BOOLEAN DEFAULT TRUE,
  
  -- Content preferences
  auto_save_drafts BOOLEAN DEFAULT TRUE,
  default_project_status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'published'
  require_confirmation_deletes BOOLEAN DEFAULT TRUE,
  
  -- Export/backup preferences
  auto_backup_enabled BOOLEAN DEFAULT FALSE,
  backup_frequency VARCHAR(20) DEFAULT 'weekly', -- 'daily', 'weekly', 'monthly'
  export_format VARCHAR(20) DEFAULT 'json', -- 'json', 'csv'
  
  -- Security preferences
  session_timeout_minutes INTEGER DEFAULT 60,
  require_2fa BOOLEAN DEFAULT FALSE,
  
  -- Display preferences
  date_format VARCHAR(20) DEFAULT 'YYYY-MM-DD',
  time_format VARCHAR(20) DEFAULT '24h', -- '12h', '24h'
  timezone VARCHAR(50) DEFAULT 'UTC',
  language VARCHAR(10) DEFAULT 'en',
  
  -- Advanced settings (JSON for flexible configuration)
  advanced_settings JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure one settings record per user
  UNIQUE(user_id)
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_admin_settings_user_id ON admin_settings(user_id);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_admin_settings_updated_at 
  BEFORE UPDATE ON admin_settings 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default settings for existing admin users
INSERT INTO admin_settings (user_id) 
SELECT id FROM admin_users 
WHERE id NOT IN (SELECT user_id FROM admin_settings WHERE user_id IS NOT NULL);
